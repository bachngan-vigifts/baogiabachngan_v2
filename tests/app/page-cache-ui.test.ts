import { test } from 'node:test';
import assert from 'node:assert/strict';
// Module trình duyệt (JS thuần) – nạp qua URL để TypeScript không đòi khai báo kiểu.
const { createPageCache, isCacheable }: any = await import(new URL('../../trial-ui/page-cache.js', import.meta.url).href);

test('chỉ đệm lệnh đọc của danh sách / trang chi tiết; không đệm bán hàng nhanh, két, báo giá đang soạn, preflight, số đếm, lệnh ghi', () => {
  for (const p of ['/orders?flow=order&q=&limit=50', '/contracts?limit=50', '/customers?limit=50&offset=0', '/tasks?view=mine&status=open', '/tasks/people',
    '/receivables?q=', '/cashbook?from=2026-10-01&to=2026-10-29', '/purchase-orders?q=', '/inventory/status', '/stock-moves?page=1', '/orders/abc-123', '/customers/c1', '/dashboard/revenue?from=2026-05'])
    assert.equal(isCacheable(p), true, p);
  for (const p of ['/pos/options', '/cash', '/cash/entries?from=x', '/quotes/q1', '/orders/by-quote/q1', '/orders/o1/approval-preflight', '/tasks/summary', '/pulse',
    '/notifications', '/me', '/approvals', '/catalog-snapshot', '/orders?refresh=1'])
    assert.equal(isCacheable(p), false, p);
  assert.equal(isCacheable('/orders', 'POST'), false);
});

test('trả bản đệm (bản sao) trong 10 phút cùng phiên; "vừa lấy" trong 3 giây; báo khi dữ liệu mới khác bản cũ', () => {
  let t = 0;
  const c = createPageCache({ now: () => t });
  assert.equal(c.get('/orders', 's1'), null);
  assert.equal(c.set('/orders', 's1', { orders: [{ id: 1 }] }), false, 'lần đầu không tính là thay đổi');
  const hit = c.get('/orders', 's1');
  assert.deepEqual(hit.data, { orders: [{ id: 1 }] }); assert.equal(hit.recent, true);
  hit.data.orders.push({ id: 2 });
  assert.equal(c.get('/orders', 's1').data.orders.length, 1, 'trang sửa dữ liệu nhận được không làm hỏng bản đệm');
  t = 5000; assert.equal(c.get('/orders', 's1').recent, false);
  assert.equal(c.get('/orders', 's2'), null, 'phiên khác không thấy dữ liệu');
  assert.equal(c.set('/orders', 's1', { orders: [{ id: 1 }] }), false, 'giống hệt: không vẽ lại');
  assert.equal(c.set('/orders', 's1', { orders: [{ id: 1 }, { id: 3 }] }), true, 'khác: vẽ lại');
  t += 10 * 60_000 + 1; assert.equal(c.get('/orders', 's1'), null, 'quá 10 phút: tải như mới');
  c.set('/a', 's1', 1); c.clear(); assert.equal(c.size(), 0);
});
