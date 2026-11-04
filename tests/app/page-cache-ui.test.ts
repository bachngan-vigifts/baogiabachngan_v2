import { test } from 'node:test';
import assert from 'node:assert/strict';
// Module trình duyệt (JS thuần) – nạp qua URL để TypeScript không đòi khai báo kiểu.
const { createPageCache, isCacheable, isPassiveWrite }: any = await import(new URL('../../trial-ui/page-cache.js', import.meta.url).href);

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

test('không đệm số chứng từ kế tiếp; lệnh chỉ đọc / đánh dấu đã đọc không xoá bộ đệm; bỏ được một trang', () => {
  for (const p of ['/orders/next-no?quoteId=q1&orderDate=2026-10-30', '/contracts/next-no?quoteId=q1&legalEntity=vigifts'])
    assert.equal(isCacheable(p), false, p);
  for (const p of ['/notifications/read', '/chat/c1/read', '/pos/preview', '/csp-report', '/inventory/count-stock', '/inventory/count-candidates', '/pos/ghn/locations'])
    assert.equal(isPassiveWrite(p), true, p);
  for (const p of ['/orders', '/tasks/t1', '/payments/p1/void', '/inventory/adjustments', '/chat/c1/messages', '/customers/c1/notes'])
    assert.equal(isPassiveWrite(p), false, p);
  const c = createPageCache();
  c.set('/orders/o1', 's1', { order: 1 }); c.set('/orders', 's1', { orders: [] });
  c.drop('/orders/o1');
  assert.equal(c.get('/orders/o1', 's1'), null); assert.notEqual(c.get('/orders', 's1'), null, 'chỉ bỏ đúng trang đó');
});

test('đệm thêm các trang chỉ để xem: hàng sắp về, lịch nhận NCC, công nợ NCC, nguồn mua, thẻ kho, kho, việc kế toán, khách trùng, trang kho', () => {
  for (const p of ['/purchase-incoming?q=&page=1', '/purchase-receiving-calendar?from=2026-10-01&to=2026-10-31', '/supplier-payables', '/purchase-sources?q=ly',
    '/inventory/card?sku=A&warehouseId=w', '/stock-warehouses', '/tasks/accounting/daily', '/customer-duplicates', '/warehouse-work'])
    assert.equal(isCacheable(p), true, p);
  for (const p of ['/tasks/accounting/checks', '/supplier-payments/x']) assert.equal(isCacheable(p), false, p);
  assert.equal(isCacheable('/purchase-incoming', 'POST'), false, 'lệnh ghi không đệm');
});

/** Storage giả tối thiểu (getItem / setItem / removeItem / key / length) như localStorage / sessionStorage. */
function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, map: m };
}

test('đệm danh sách Sản phẩm / Báo giá có phân trang và dữ liệu ít đổi; không đệm tra giá / tồn theo mã, tìm nhanh, quầy', () => {
  for (const p of ['/products?limit=50&offset=0&q=&brand=', '/quotes?limit=30&offset=30&q=&type=', '/product-brands', '/printing-workshops', '/care/config', '/avatars?keys=a,b'])
    assert.equal(isCacheable(p), true, p);
  for (const p of ['/products?skus=A1,B2', '/products?limit=8&q=binh', '/quotes?limit=40&q=abc', '/pos/options', '/pos/options?stock=1', '/quotes/next-no?type=x'])
    assert.equal(isCacheable(p), false, p);
});

test('bản đệm giữ qua tải lại trang: danh sách ở sessionStorage 10 phút, dữ liệu ít đổi ở localStorage 24 giờ; khác phiên / xoá thì mất', () => {
  let t = 0; const local = fakeStorage(), session = fakeStorage();
  const storage = { local: () => local, session: () => session };
  createPageCache({ now: () => t, storage }).set('/orders?limit=50', 's1', { orders: [1] });
  createPageCache({ now: () => t, storage }).set('/product-brands', 's1', { brands: ['LnL'] });
  assert.equal(session.length, 1); assert.equal(local.length, 1);
  assert.ok(![...session.map.values(), ...local.map.values()].some(v => v.includes('s1')), 'không lưu nguyên mã phiên');
  let c = createPageCache({ now: () => t, storage }); // "tải lại trang": bộ nhớ trống, đọc từ storage
  assert.deepEqual(c.get('/orders?limit=50', 's1').data, { orders: [1] });
  assert.equal(c.get('/orders?limit=50', 's2'), null, 'phiên khác không thấy');
  t = 2 * 3_600_000; c = createPageCache({ now: () => t, storage });
  assert.equal(c.get('/orders?limit=50', 's1'), null, 'danh sách quá 10 phút');
  assert.deepEqual(c.get('/product-brands', 's1').data, { brands: ['LnL'] }, 'dữ liệu ít đổi còn trong 24 giờ');
  c.clear(); assert.equal(local.length + session.length, 0, 'xoá hết cả bản lưu trên máy');
  const broken = { local: () => { throw new Error('blocked'); }, session: () => null };
  const b = createPageCache({ storage: broken }); b.set('/product-brands', 's1', 1);
  assert.equal(b.get('/product-brands', 's1').data, 1, 'trình duyệt chặn lưu trữ: vẫn chạy bằng bộ nhớ');
});
