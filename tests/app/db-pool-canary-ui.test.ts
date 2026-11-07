import { test } from 'node:test';
import assert from 'node:assert/strict';
const { createDbPoolCanary, runLoadTest, summarizeLoad, loadReport } = await import(new URL('../../trial-ui/db-pool-canary.js', import.meta.url).href);

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) }; };
const timing = (mode: string, total: number, inflight: number) => `db;dur=1, app;dur=2;desc="1 queries", total;dur=${total}, region;desc="ap-northeast-2", dbmode;desc="${mode}", inflight;desc="${inflight}"`;

test('thử pooler chỉ trên máy này: bật thì gửi x-db-pool, tắt là hết ngay; nhớ qua lần mở app', () => {
  const store = memory();
  const c = createDbPoolCanary({ storage: () => store });
  assert.deepEqual(c.headers(), {}, 'mặc định tắt');
  c.set(true); assert.deepEqual(c.headers(), { 'x-db-pool': 'pooler' });
  assert.equal(createDbPoolCanary({ storage: () => store }).enabled(), true);
  c.set(false); assert.deepEqual(c.headers(), {}); assert.equal(store.getItem('bn-db-pool'), null);
  assert.doesNotThrow(() => createDbPoolCanary({ storage: () => { throw Error('blocked'); } }).set(true));
});

test('đo tải: mỗi chế độ gửi đúng số đợt × lượt GET cùng lúc, tách trực tiếp / pooler, đếm lỗi, đọc chế độ và inflight từ Server-Timing', async () => {
  const calls: { path: string; pool: boolean }[] = [];
  let active = 0, peak = 0;
  const probe = async (path: string, { pool }: { pool: boolean }) => {
    calls.push({ path, pool }); const n = calls.length; active++; peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 1)); active--;
    if (!pool && n === 2) throw Error('network');
    return { ms: pool ? 100 : 400, status: 200, timing: timing(pool ? 'pooler-canary' : 'direct', pool ? 50 : 350, pool ? 2 : 4) };
  };
  const r = await runLoadTest(probe, { parallel: 4, rounds: 2, pause: async () => {} });
  assert.equal(calls.length, 16); assert.equal(peak, 4, 'đúng 4 lượt cùng lúc mỗi đợt');
  assert.ok(calls.every(c => c.path === '/me'), 'chỉ API đọc nhẹ, không gửi lệnh ghi');
  assert.deepEqual([r.direct.count, r.direct.errors, r.direct.median, r.direct.serverMedian, r.direct.maxInflight, r.direct.modes], [8, 1, 400, 350, 4, ['direct']]);
  assert.deepEqual([r.pooler.count, r.pooler.errors, r.pooler.median, r.pooler.maxInflight, r.pooler.modes], [8, 0, 100, 2, ['pooler-canary']]);
  const text = loadReport(r, { parallel: 4, rounds: 2 });
  assert.match(text, /2 đợt × 4 lượt GET \/me/); assert.match(text, /Kết nối trực tiếp: .*lỗi 1\/8/); assert.match(text, /Pooler \(thử\): .*máy chủ báo: pooler-canary/);
  assert.equal(summarizeLoad([]).count, 0);
});
