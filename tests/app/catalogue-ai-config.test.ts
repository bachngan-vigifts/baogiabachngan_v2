import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=resolve('scripts/configure-catalogue-ai.mjs');
const run=(cwd:string)=>spawnSync(process.execPath,[script],{cwd,encoding:'utf8',env:process.env});
test('catalogue AI config parses inline empty bindings, preserves settings and is idempotent',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'catalogue-ai-'));writeFileSync(join(cwd,'wrangler.toml'),'name="crm-minhlong"\ncompatibility_date="2026-01-01"\nai={}\n[env.production]\nai={}\n[env.production.vars]\nKEEP="retained"\n[env.preview]\nai={}\n');
 const first=run(cwd);assert.equal(first.status,0,first.stderr);assert(!existsSync(join(cwd,'wrangler.toml')));const expected=JSON.parse(readFileSync(join(cwd,'wrangler.json'),'utf8'));assert.equal(expected.ai.binding,'AI');assert.equal(expected.env.production.ai.binding,'AI');assert.equal(expected.env.preview.ai.binding,'AI');assert.equal(expected.env.production.vars.KEEP,'retained');assert.equal(expected.pages_build_output_dir,'trial-ui');assert.equal(expected.compatibility_date,'2026-01-01');assert.equal(run(cwd).status,0);assert.deepEqual(JSON.parse(readFileSync(join(cwd,'wrangler.json'),'utf8')),expected);
});
test('catalogue AI config rejects conflicting binding without rewriting source',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'catalogue-ai-conflict-')),source='name="crm-minhlong"\n[ai]\nbinding="OTHER"\n';writeFileSync(join(cwd,'wrangler.toml'),source);const result=run(cwd);assert.notEqual(result.status,0);assert.equal(readFileSync(join(cwd,'wrangler.toml'),'utf8'),source);assert(!existsSync(join(cwd,'wrangler.json')));
});
