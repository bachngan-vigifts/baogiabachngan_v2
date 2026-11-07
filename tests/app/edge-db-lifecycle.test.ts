import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createDbLifecycle, createDbReadiness } from '../../src/core/db/request-lifecycle.js';

// Execute the real Edge handler, replacing only infrastructure imports (no network/database).
async function harness({ canaryUrl = '', pooled = false, legacyPooler = false, broken = false, region = '', poolerUrl = 'postgres://pool.fake.test/db', handler = async (_req: Request, _env: any) => Response.json({ ok: true }) } = {}) {
  const source = readFileSync('supabase/functions/baogia-v2-api/index.ts', 'utf8').replace(/^import .*;\n/gm, '');
  const { code } = await transform(source, { loader: 'ts', format: 'iife' });
  const stats = { created: 0, closed: 0, probes: 0, routed: 0 };
  let serve: (req: Request) => Promise<Response> = null!;
  const background: Promise<unknown>[] = [];
  const env: Record<string, string> = { SUPABASE_DB_URL: 'postgres://fake.test/db', ...(pooled ? { DB_POOLER_URL: poolerUrl } : {}), ...(legacyPooler ? { SUPABASE_POOLER_URL: 'postgres://legacy.pool.fake.test/db' } : {}), ...(region ? { SB_REGION: region } : {}), ...(canaryUrl ? { DB_POOLER_CANARY_URL: canaryUrl } : {}) };
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
  assert.match(timing, /^db;dur=[\d.]+, app;dur=[\d.]+;desc="3 queries", total;dur=[\d.]+, region;desc="ap-southeast-1", dbmode;desc="direct", inflight;desc="1"$/);
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

test('Edge báo vùng CSDL (đọc từ tên máy pooler) và bỏ tham số chọn vùng trước khi tới router', async () => {
  let seen = '';
  const h = await harness({ pooled: true, region: 'ap-southeast-1', poolerUrl: 'postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
    handler: async req => { seen = req.url; return Response.json({ ok: true }); } });
  const res = await h.request('GET', '/api/staff/orders?q=a&forceFunctionRegion=us-east-1');
  assert.match(res.headers.get('server-timing') || '', /region;desc="ap-southeast-1", dbregion;desc="us-east-1", dbmode;desc="pooler", inflight;desc="1"$/);
  assert.equal(new URL(seen).search, '?q=a');
  const down = await harness({ pooled: true, broken: true, poolerUrl: 'postgresql://x:y@aws-1-eu-central-1.pooler.supabase.com:6543/postgres' });
  const failed = await down.request();
  assert.equal(failed.status, 503);
  assert.match(failed.headers.get('server-timing') || '', /dbregion;desc="eu-central-1"/, 'lỗi 503 của mình vẫn có Server-Timing (giao diện không tưởng là vùng hỏng)');
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

test('deployment rejects a broken pooler connection before changing production secrets or deploying', () => {
 const workflow=readFileSync('.github/workflows/deploy-api.yml','utf8');
 const probe=workflow.indexOf('psql -X -w');
 assert.ok(probe>=0 && probe<workflow.indexOf('supabase secrets set'));
 assert.match(workflow,/default_transaction_read_only=on/);
 assert.match(workflow,/statement_timeout=5000/);
 assert.match(workflow,/SELECT 1' 2>\/dev\/null/);
});

test('pooler chỉ bật khi biến ENABLE_DB_POOLER = true; mặc định triển khai giữ tắt (gỡ DB_POOLER_URL)', () => {
  const workflow = readFileSync('.github/workflows/deploy-api.yml', 'utf8');
  assert.match(workflow, /SUPABASE_POOLER_URL: \$\{\{ vars\.ENABLE_DB_POOLER == 'true' && secrets\.SUPABASE_POOLER_URL \|\| '' \}\}/);
  assert.match(workflow, /env\.SUPABASE_POOLER_URL == ''\n[^\n]*\n\s*run: supabase secrets unset DB_POOLER_URL/);
});

test('CORS cho phép header x-region (thử máy chủ cạnh CSDL từ trình duyệt)', async () => {
  const h = await harness();
  const res = await h.request('OPTIONS');
  assert.match(res.headers.get('access-control-allow-headers') || '', /x-region/);
});

test('thử pooler có kiểm soát: chỉ lượt có x-db-pool: pooler dùng pooler (giữ ấm, max 3); lượt khác vẫn kết nối trực tiếp max 1', async () => {
  const h = await harness({ canaryUrl: 'postgres://canary.pool.fake.test/db' });
  const direct = await h.request();
  assert.match(direct.headers.get('server-timing') || '', /dbmode;desc="direct"/);
  const viaPool = await h.request('GET', '/api/staff/tasks', { 'x-db-pool': 'pooler' });
  assert.match(viaPool.headers.get('server-timing') || '', /dbmode;desc="pooler-canary"/);
  await h.request('GET', '/api/staff/tasks', { 'x-db-pool': 'pooler' });
  await Promise.all(h.background);
  assert.deepEqual(h.connections, [{ url: 'postgres://fake.test/db', max: 1 }, { url: 'postgres://canary.pool.fake.test/db', max: 3 }], 'pooler client tạo một lần, giữ ấm');
  assert.equal(h.stats.closed, 1, 'chỉ client trực tiếp bị đóng');
  assert.deepEqual(await (await h.request('GET', '/health', { 'x-db-pool': 'pooler' })).json(), { ok: true, databaseMode: 'transaction-pooler-canary' });
  const preflight = await h.request('OPTIONS');
  assert.match(preflight.headers.get('access-control-allow-headers') || '', /x-db-pool/);
  // Không có secret thử: header bị bỏ qua.
  const off = await harness();
  assert.match((await off.request('GET', '/api/staff/tasks', { 'x-db-pool': 'pooler' })).headers.get('server-timing') || '', /dbmode;desc="direct"/);
  // Pooler đã bật cho tất cả: không tạo client thử.
  const all = await harness({ pooled: true, canaryUrl: 'postgres://canary.pool.fake.test/db' });
  assert.match((await all.request('GET', '/api/staff/tasks', { 'x-db-pool': 'pooler' })).headers.get('server-timing') || '', /dbmode;desc="pooler"/);
  assert.equal(all.connections.length, 1);
});
test('inflight: số lượt đang xử lý cùng lúc trong isolate; đóng kết nối trực tiếp chạy nền sau khi trả phản hồi', async () => {
  let open!: () => void; const gate = new Promise<void>(r => { open = r; });
  const h = await harness({ handler: async () => { await gate; return Response.json({ ok: true }); } });
  const batch = [h.request(), h.request(), h.request()];
  await new Promise(r => setTimeout(r, 0)); open();
  const timings = (await Promise.all(batch)).map(r => /inflight;desc="(\d+)"/.exec(r.headers.get('server-timing') || '')?.[1]);
  assert.deepEqual(timings, ['1', '2', '3']);
  assert.equal(h.connections.length, 1, 'cùng một client trực tiếp (max 1) – giữ nguyên trong lúc thử');
  await Promise.all(h.background); assert.equal(h.stats.closed, 1);
  assert.match((await h.request()).headers.get('server-timing') || '', /inflight;desc="1"/, 'đếm giảm sau khi xong');
});
