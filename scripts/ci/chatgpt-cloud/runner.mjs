import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, symlink, writeFile, rename, statfs, stat } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

const [source = '/source', reports = '/reports', expectedSha] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(expectedSha || '')) throw new Error('Exact expected SHA is required');
await mkdir(reports, { recursive: true });
const summary = { schemaVersion: 1, expectedSha, pid: process.pid, startedAt: new Date().toISOString(), node: process.version, platform: `${os.platform()}/${os.arch()}`, commands: [], shards: [], status: 'running' };
const dependencies = process.env.CHATGPT_TESTER_NODE_MODULES_DIR || join(source, 'node_modules');
const active = new Set();
let cancelled = false;
let saves = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(summary, null, 2) + '\n';
  saves = saves.then(async () => {
    const pending = join(reports, 'summary.json.pending');
    await writeFile(pending, snapshot);
    await rename(pending, join(reports, 'summary.json'));
  });
  return saves;
}
function terminate(child, signal = 'SIGTERM') {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  cancelled = true;
  for (const child of active) terminate(child);
});

async function command(label, binary, args, cwd, timeoutMs = 600_000, extraEnv = {}) {
  if (cancelled) throw new Error('Runner cancelled');
  const item = { label, binary, args, startedAt: new Date().toISOString() };
  summary.commands.push(item);
  const stream = createWriteStream(join(reports, `${label}.log`));
  console.log(`START ${label}`);
  const result = await new Promise(resolve => {
    let settled = false;
    let timedOut = false;
    let killTimer;
    const child = spawn(binary, args, { cwd, env: { ...process.env, ...extraEnv }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    active.add(child);
    child.stdout.on('data', chunk => stream.write(chunk));
    child.stderr.on('data', chunk => stream.write(chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
      killTimer = setTimeout(() => terminate(child, 'SIGKILL'), 10_000);
    }, timeoutMs);
    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      active.delete(child);
      stream.end(() => resolve(value));
    }
    child.on('error', error => finish({ exitCode: null, signal: null, error: error.message, timedOut }));
    child.on('close', (exitCode, signal) => finish({ exitCode, signal, timedOut }));
  });
  Object.assign(item, result, { finishedAt: new Date().toISOString() });
  console.log(`END ${label}: exit=${result.exitCode} signal=${result.signal || '-'} timeout=${result.timedOut}`);
  await save();
  if (result.exitCode !== 0 || result.signal || result.timedOut) throw Object.assign(new Error(`${label} failed`), { result });
  return result;
}

function sha(dir) { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(); }
async function checkout(label) {
  const dir = `/job/${label}`;
  await command(`clone-${label}`, 'git', ['clone', '--shared', '--no-checkout', source, dir], '/job');
  await command(`checkout-${label}`, 'git', ['checkout', '--detach', expectedSha], dir);
  if (sha(dir) !== expectedSha) throw new Error('Checkout SHA mismatch');
  await symlink(dependencies, join(dir, 'node_modules'), 'dir');
  await mkdir(join(dir, '.test-tmp'), { recursive: true });
  return dir;
}

try {
  if (process.version !== 'v22.22.0') throw new Error('Node 22.22.0 required');
  if (sha(source) !== expectedSha) throw new Error('Source SHA mismatch');
  summary.php = execFileSync('php', ['-r', 'echo PHP_VERSION;'], { encoding: 'utf8' });
  if (!summary.php.startsWith('8.3.')) throw new Error('PHP 8.3 required');
  summary.python = execFileSync('python3', ['-c', 'import sys,tomllib; assert sys.version_info >= (3,11); print(sys.version.split()[0])'], { encoding: 'utf8' }).trim();
  summary.jq = execFileSync('jq', ['--version'], { encoding: 'utf8' }).trim();
  summary.curl = execFileSync('curl', ['--version'], { encoding: 'utf8' }).split('\n')[0];
  const space = await statfs('/job');
  summary.freeBytesAtStart = Number(space.bavail) * Number(space.bsize);
  if (summary.freeBytesAtStart < 2 * 1024 ** 3) throw new Error('At least 2 GiB free required');
  await command('source-clean', 'git', ['diff', '--exit-code', 'HEAD', '--'], source);
  await mkdir('/job', { recursive: true });
  const quality = await checkout('quality');
  await command('pdf-runtime', process.execPath, ['--input-type=module', '-e', "const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs'); console.log(pdf.version)"], quality);
  await command('typecheck', 'npm', ['run', 'typecheck'], quality);
  await command('ui-build', 'npm', ['run', 'ui:build'], quality);
  await command('quality-clean', 'git', ['diff', '--exit-code', 'HEAD', '--'], quality);
  let next = 1;
  async function worker() {
    for (;;) {
      if (cancelled) return;
      const index = next++;
      if (index > 4) return;
      const item = { index, total: 4, status: 'running' };
      summary.shards.push(item);
      try {
        const dir = await checkout(`shard-${index}`);
        await command(`tests-${index}`, process.execPath, [
          '--import', 'tsx', '--test', '--test-concurrency=2', `--test-shard=${index}/4`,
          '--test-reporter=spec', '--test-reporter-destination=stdout',
          '--test-reporter=junit', `--test-reporter-destination=${join(reports, `junit-${index}.xml`)}`,
          'tests/**/*.test.ts', 'src/**/*.test.ts',
        ], dir, 40 * 60_000, { TMPDIR: join(dir, '.test-tmp') });
        if ((await stat(join(reports, `junit-${index}.xml`))).size === 0) throw new Error('Missing JUnit result');
        await command(`clean-${index}`, 'git', ['diff', '--exit-code', 'HEAD', '--'], dir);
        if (sha(dir) !== expectedSha) throw new Error('Tested SHA changed');
        item.status = 'passed';
      } catch (error) {
        item.status = cancelled ? 'cancelled' : 'failed';
        item.error = error.message;
      }
      await save();
    }
  }
  await Promise.all([worker(), worker()]);
  summary.status = cancelled ? 'cancelled' : summary.shards.length === 4 && summary.shards.every(s => s.status === 'passed') ? 'passed' : 'failed';
  if (sha(source) !== expectedSha) throw new Error('Source SHA changed during execution');
} catch (error) {
  summary.status = cancelled ? 'cancelled' : 'error';
  summary.error = error.message;
} finally {
  summary.finishedAt = new Date().toISOString();
  await save();
  console.log(`RESULT ${summary.status} SHA ${expectedSha}`);
}
process.exitCode = summary.status === 'passed' ? 0 : 1;
