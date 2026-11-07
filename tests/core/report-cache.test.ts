import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { cachedReport, dropReportCache, reportCacheKey, REPORT_CACHE_TTL_MS } from '../../src/core/cache/report-cache.ts';

const T0 = Date.parse('2026-11-07T03:00:00Z'); // 10:00 giờ VN

test('Bản tính sẵn: dùng lại trong 30 phút, quá hạn / Cập nhật / qua nửa đêm VN thì tính lại', async () => {
  const { db } = await createTestDb();
  let runs = 0, clock = T0;
  const get = (refresh = false, params: Record<string, string> = { from: '2026-11-01', to: '2026-11-07' }) =>
    cachedReport(db, { scope: 'profit', viewer: 'manager', params, refresh, now: () => clock }, async () => ({ n: ++runs }));
  const a = await get();
  assert.equal(a.n, 1); assert.equal(a.cache.hit, false); assert.equal(a.cache.available, true);
  assert.equal(a.cache.computedAt, new Date(T0).toISOString());
  clock = T0 + REPORT_CACHE_TTL_MS - 1;
  const b = await get(false, { to: '2026-11-07', from: '2026-11-01', refresh: '0' }); // thứ tự tham số / refresh không đổi khoá
  assert.equal(b.n, 1); assert.equal(b.cache.hit, true); assert.equal(b.cache.computedAt, a.cache.computedAt);
  assert.equal((await get(true)).n, 2, 'nút Cập nhật luôn tính lại');
  clock += REPORT_CACHE_TTL_MS;
  assert.equal((await get()).n, 3, 'quá 30 phút thì tính lại');
  assert.equal((await get(false, { from: '2026-10-01', to: '2026-10-31' })).n, 4, 'bộ lọc khác là bản khác');
  // 23:50 → 00:05 giờ VN: cùng trong 30 phút nhưng "hôm nay" đã đổi.
  clock = Date.parse('2026-11-07T16:50:00Z'); assert.equal((await get()).n, 5);
  clock = Date.parse('2026-11-07T17:05:00Z'); const c = await get();
  assert.equal(c.n, 6, 'qua nửa đêm VN thì tính lại');
  assert.equal(c.cache.expiresAt, new Date(clock + REPORT_CACHE_TTL_MS).toISOString());
  clock = Date.parse('2026-11-08T16:45:00Z'); const d = await get();
  assert.equal(d.cache.expiresAt, '2026-11-08T17:00:00.000Z', 'hạn không vượt nửa đêm VN');
  await dropReportCache(db, 'profit');
  assert.equal((await get()).n, 8, 'bỏ cache sau khi sửa dữ liệu nguồn');
});

test('Bản tính sẵn tách theo người xem; bản quá 1 ngày được dọn khi ghi', async () => {
  const { db } = await createTestDb();
  let clock = T0;
  const get = (viewer: string, v: number) => cachedReport(db, { scope: 'dashboard-kpi', viewer, params: {}, now: () => clock }, async () => ({ v }));
  assert.equal((await get('emp:employee:self', 1)).v, 1);
  assert.equal((await get('mgr:manager:all', 2)).v, 2, 'người xem khác không dùng bản của nhau');
  assert.equal((await get('emp:employee:self', 3)).v, 1);
  clock = T0 + 2 * 86400_000; await get('mgr:manager:all', 4);
  const rows = await db.execute(sql`select key from report_cache order by key`) as any;
  assert.deepEqual((rows.rows ?? rows).map((r: any) => r.key), [reportCacheKey('dashboard-kpi', 'mgr:manager:all', {})]);
});

test('Chưa chạy migration (thiếu bảng): vẫn tính và trả số liệu, báo không có cache', async () => {
  const { db } = await createTestDb();
  await db.execute(sql`drop table report_cache`);
  let runs = 0;
  const get = () => cachedReport(db, { scope: 'profit', viewer: 'manager', params: {} }, async () => ({ n: ++runs }));
  const a = await get(), b = await get();
  assert.equal(a.n, 1); assert.equal(b.n, 2); assert.equal(b.cache.available, false); assert.equal(b.cache.hit, false);
  await dropReportCache(db, 'profit'); // không ném lỗi
});
