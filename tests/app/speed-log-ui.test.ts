import { test } from 'node:test';
import assert from 'node:assert/strict';
// Module trình duyệt (JS thuần) – nạp qua URL để TypeScript không đòi khai báo kiểu.
const { parseServerTiming, routeOf, summarize, speedReport }: any = await import(new URL('../../trial-ui/speed-log.js', import.meta.url).href);

test('đọc Server-Timing của Edge: chờ CSDL, xử lý, số truy vấn, tổng, vùng', () => {
  assert.deepEqual(parseServerTiming('db;dur=120.5, app;dur=80;desc="9 queries", total;dur=210, region;desc="ap-southeast-1"'),
    { db: 120.5, app: 80, queries: 9, total: 210, region: 'ap-southeast-1' });
  assert.deepEqual(parseServerTiming(null), {});
});

test('gom theo API: bỏ query string và mã chứng từ / uuid', () => {
  assert.equal(routeOf('/orders?flow=order&q=abc'), '/orders');
  assert.equal(routeOf('/orders/3f1c2a9e-1111-4222-8333-944455556666/history'), '/orders/:id/history');
  assert.equal(routeOf('/orders/by-quote/DH_007_29102026'), '/orders/by-quote/:id');
  assert.equal(routeOf('/tasks/summary'), '/tasks/summary');
});

test('tổng hợp: trung vị / p90 / máy chủ / mạng theo từng API, sắp API tốn thời gian nhất lên đầu; báo cáo để gửi hỗ trợ', () => {
  const e = (route: string, ms: number, server?: number, db = 0, queries = 0) => ({ route, ms, server, db, queries, region: server ? 'ap-southeast-1' : undefined });
  const list = [e('GET /orders', 400, 300, 150, 9), e('GET /orders', 600, 500, 200, 9), e('GET /orders', 500, 350, 180, 9), e('GET /pulse', 90, 40, 10, 2), e('GET /me', 1000)];
  const s = summarize(list);
  assert.equal(s.routes[0].route, 'GET /orders');
  assert.equal(s.routes[0].median, 500); assert.equal(s.routes[0].server, 350); assert.equal(s.routes[0].queries, 9);
  assert.equal(s.routes[0].network, 100); // mạng từng lượt: 100, 100, 150
  assert.equal(s.region, 'ap-southeast-1');
  const meOnly = s.routes.find((r: any) => r.route === 'GET /me');
  assert.ok(Number.isNaN(meOnly.server), 'không có Server-Timing (bản API cũ) thì để trống, không tính mạng sai');
  const text = speedReport(list, { connection: { effectiveType: '4g', rtt: 100 } });
  assert.match(text, /GET \/orders ×3: 500 ms/);
  assert.match(text, /mạng: 4g \(rtt 100 ms\)/);
});
