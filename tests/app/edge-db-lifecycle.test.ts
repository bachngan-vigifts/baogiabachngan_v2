import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createDbLifecycle, createDbReadiness } from '../../src/core/db/request-lifecycle.js';

// Execute the real Edge handler, replacing only infrastructure imports (no network/database).
async function harness({ pooled = false, legacyPooler = false, broken = false, region = '', handler = async (_req: Request, _env: any) => Response.json({ ok: true }) } = {}) {
  const source = readFileSync('supabase/functions/baogia-v2-api/index.ts', 'utf8').replace(/^import .*;\n/gm, '');
  const { code } = await transform(source, { loader: 'ts', format: 'iife' });
  const stats = { created: 0, closed: 0, probes: 0, routed: 0 };
  let serve: (req: Request) => Promise<Response> = null!;
  const background: Promise<unknown>[] = [];
  const env: Record<string, string> = { SUPABASE_DB_URL: 'postgres://fake.test/db', ...(pooled ? { DB_POOLER_URL: 'postgres://pool.fake.test/db' } : {}), ...(legacyPooler ? { SUPABASE_POOLER_URL: 'postgres://legacy.pool.fake.test/db' } : {}), ...(region ? { SB_REGION: region } : {}) };
  const connections: {url:string;max?:number}[] = [];
  const hooks: { onQuery?: () => void } = {};
  runInNewContext(code, {
    Deno: { env: { get: (key: string) => env[key] }, serve: (fn: typeof serve) => { serve = fn; } },
    createDbLifecycle, createDbReadiness, sql: () => 'select 1', schema: { positions: { id: 'id' } },
    createDb: (_url: string, _schema: unknown, opts: { onQuery?: () => void; max?: number }) => {
      connections.push({url:_url,max:opts.max});
      stats.created++; hooks.onQuery = opts.onQuery;
      return {
        execute: async () => { stats.probes++; if (broken) throw Object.assign(new Error('unavailable'), { code: '08006' }); },
        select: () => ({ from: () => ({ limit: async () => [] }) }),
      };
    },
    closeDb: async () => { stats.closed++; },
    createAppRouter: () => ({ handle: async (req: Request, ctx: any) => { stats.routed++; return handler(req, ctx); } }),
    SYNC_PREFIX: '/api/staff/integrations/', supabaseFileStore: () => undefined,
    EdgeRuntime: { waitUntil: (work: Promise<unknown>) => background.push(work) },
    console: { warn() {}, error() {} }, Request, Response, Headers, URL, Blob, CompressionStream, AsyncLocalStorage, performance,
  });
  const request = (method = 'GET', path = '/api/staff/tasks', extra: Record<string, string> = {}) => serve(new Request('https://edge.test' + path, {
    method, headers: { origin: 'https://crm.minhlongonline.com', ...extra }, ...(method === 'POST' ? { body: '{}' } : {}),
  }));
  return { stats, request, background, connections, query: () => hooks.onQuery?.() };
}
test('Edge requests release direct clients after success/error; preflight failure never dispatches a write', async () => {
  const h = await harness();
  assert.equal((await h.request()).status, 200);
  assert.deepEqual(h.stats, { created: 1, closed: 1, probes: 1, routed: 1 });
  assert.equal((await h.request('GET', '/health')).status, 200);
  assert.equal(h.stats.closed, 2);
  const failed = await harness({ broken: true });
  const response = await failed.request('POST');
  assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '1');
  assert.equal((await response.json()).code, 'DB_CONNECTION_UNAVAILABLE');
  assert.equal(failed.stats.routed, 0); assert.equal(failed.stats.closed, 1);
  const ambiguous = await harness({ handler: async () => { throw Error('unknown write outcome'); } });
  assert.equal((await ambiguous.request('POST')).status, 503);
  assert.equal(ambiguous.stats.routed, 1); assert.equal(ambiguous.stats.closed, 1);
});
test('Edge waitUntil retains the active client until background work settles', async () => {
  let finish!: () => void;
  const work = new Promise<void>(resolve => { finish = resolve; });
  const h = await harness({ handler: async (_req, ctx) => { ctx.waitUntil(work); return Response.json({ ok: true }); } });
  assert.equal((await h.request()).status, 200); assert.equal(h.stats.closed, 0);
  finish(); await Promise.all(h.background); assert.equal(h.stats.closed, 1);
});
test('Edge transaction-pooler mode reuses its client and exposes only the connection mode in health', async () => {
  const h = await harness({ pooled: true });
  const result = await h.request('GET', '/health');
  assert.deepEqual(await result.json(), { ok: true, databaseMode: 'transaction-pooler' });
  await h.request(); assert.equal(h.stats.created, 1); assert.equal(h.stats.closed, 0);
});

test('Edge trả Server-Timing (chờ CSDL, xử lý + số truy vấn của đúng yêu cầu, vùng) cho trình duyệt đọc; JSON chuyển nguyên văn', async () => {
  let h: Awaited<ReturnType<typeof harness>>;
  h = await harness({ region: 'ap-southeast-1', handler: async () => { h.query(); h.query(); h.query(); return Response.json({ list: [1, 2], text: 'Đơn' }); } });
  const res = await h.request();
  const timing = res.headers.get('server-timing') || '';
  assert.match(timing, /^db;dur=[\d.]+, app;dur=[\d.]+;desc="3 queries", total;dur=[\d.]+, region;desc="ap-southeast-1"$/);
  assert.equal(res.headers.get('access-control-expose-headers'), 'server-timing');
  assert.deepEqual(await res.json(), { list: [1, 2], text: 'Đơn' });
  // Đăng nhập: Set-Cookie → sessionToken trong JSON (như trước).
  const token = 'a'.repeat(64);
  const login = await harness({ handler: async () => new Response(JSON.stringify({ ok: true }), { headers: { 'set-cookie': `__Host-bn-session=${token}; Path=/` } }) });
  assert.deepEqual(await (await login.request('POST', '/api/staff/login')).json(), { ok: true, sessionToken: token });
});
test('Edge nén gzip cả phản hồi vừa (> 4 KB) khi trình duyệt hỗ trợ', async () => {
  const big = { rows: Array.from({ length: 300 }, (_, i) => ({ i, name: 'Khách hàng ' + i })) };
  const h = await harness({ handler: async () => Response.json(big) });
  const res = await h.request();
  assert.equal(res.headers.get('content-encoding'), null, 'không gửi accept-encoding thì không nén');
  const gz = await h.request('GET', '/api/staff/tasks', { 'accept-encoding': 'gzip, br' });
  assert.equal(gz.headers.get('content-encoding'), 'gzip');
  const { gunzipSync } = await import('node:zlib');
  const bytes = Buffer.from(await gz.arrayBuffer());
  assert.ok(bytes.length < JSON.stringify(big).length / 3, 'nén còn dưới 1/3');
  assert.deepEqual(JSON.parse(gunzipSync(bytes).toString()), big);
  const small = await (await harness()).request('GET', '/api/staff/tasks', { 'accept-encoding': 'gzip' });
  assert.equal(small.headers.get('content-encoding'), null, 'phản hồi nhỏ không nén');
});

test('pooler deployment uses a permitted Supabase secret name and the existing GitHub secret', () => {
  const workflow = readFileSync('.github/workflows/deploy-api.yml','utf8');
  assert.match(workflow, /DB_POOLER_URL="\$SUPABASE_POOLER_URL"/);
  assert.doesNotMatch(workflow, /supabase secrets set[^\n]*\sSUPABASE_POOLER_URL=/);
});
test('new pooler secret enables warm max-3 client; legacy setting still works and new setting takes precedence', async () => {
  for (const options of [{pooled:true},{legacyPooler:true},{pooled:true,legacyPooler:true}]) {
    const h=await harness(options);
    assert.equal((await (await h.request('GET','/health')).json()).databaseMode,'transaction-pooler');
    await h.request();
    assert.deepEqual(h.connections,[{url:options.pooled?'postgres://pool.fake.test/db':'postgres://legacy.pool.fake.test/db',max:3}]);
    assert.equal(h.stats.closed,0);assert.equal(h.stats.created,1);
  }
});
