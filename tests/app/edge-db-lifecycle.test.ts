import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { createDbLifecycle, createDbReadiness } from '../../src/core/db/request-lifecycle.js';

// Execute the real Edge handler, replacing only infrastructure imports (no network/database).
async function harness({ pooled = false, broken = false, handler = async (_req: Request, _env: any) => Response.json({ ok: true }) } = {}) {
  const source = readFileSync('supabase/functions/baogia-v2-api/index.ts', 'utf8').replace(/^import .*;\n/gm, '');
  const { code } = await transform(source, { loader: 'ts', format: 'iife' });
  const stats = { created: 0, closed: 0, probes: 0, routed: 0 };
  let serve: (req: Request) => Promise<Response> = null!;
  const background: Promise<unknown>[] = [];
  const env: Record<string, string> = { SUPABASE_DB_URL: 'postgres://fake.test/db', ...(pooled ? { SUPABASE_POOLER_URL: 'postgres://pool.fake.test/db' } : {}) };
  runInNewContext(code, {
    Deno: { env: { get: (key: string) => env[key] }, serve: (fn: typeof serve) => { serve = fn; } },
    createDbLifecycle, createDbReadiness, sql: () => 'select 1', schema: { positions: { id: 'id' } },
    createDb: () => {
      stats.created++;
      return {
        execute: async () => { stats.probes++; if (broken) throw Object.assign(new Error('unavailable'), { code: '08006' }); },
        select: () => ({ from: () => ({ limit: async () => [] }) }),
      };
    },
    closeDb: async () => { stats.closed++; },
    createAppRouter: () => ({ handle: async (req: Request, ctx: any) => { stats.routed++; return handler(req, ctx); } }),
    SYNC_PREFIX: '/api/staff/integrations/', supabaseFileStore: () => undefined,
    EdgeRuntime: { waitUntil: (work: Promise<unknown>) => background.push(work) },
    console: { warn() {}, error() {} }, Request, Response, Headers, URL, Blob, CompressionStream,
  });
  const request = (method = 'GET', path = '/api/staff/tasks') => serve(new Request('https://edge.test' + path, {
    method, headers: { origin: 'https://crm.minhlongonline.com' }, ...(method === 'POST' ? { body: '{}' } : {}),
  }));
  return { stats, request, background };
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
