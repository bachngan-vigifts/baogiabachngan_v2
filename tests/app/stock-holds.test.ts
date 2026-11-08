import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { salesOrderLines, salesOrders, stockHolds } from '../../src/modules/sales/schema.ts';

// The fixture delivery dates must stay unexpired regardless of when CI runs.
beforeEach(()=>mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-07T00:00:00.000Z')}));
afterEach(()=>mock.timers.reset());

/** GIỮ HÀNG CHO BÁO GIÁ: treo tồn 5 ngày, khả dụng = tồn − đang treo; hết hạn báo nhân viên; lập đơn thì tự bỏ treo. */
const origin = 'https://trial.test', now = '2026-10-01T00:00:00.000Z';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const } as never);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  await db.insert(warehouses).values([{ id: 'k1', name: 'Kho 1', kind: 'stock' }, { id: 'k2', name: 'Kho 2', kind: 'stock' }, { id: 'hcv', name: 'Hàng chờ về', kind: 'incoming' }]);
  await db.insert(products).values([{ sku: 'LY1', name: 'Ly sứ', unit: 'cái', updatedAt: now }, { sku: 'DIA1', name: 'Đĩa', unit: 'cái', updatedAt: now }]);
  await db.insert(productStock).values([{ sku: 'LY1', warehouseId: 'k1', quantity: 60, updatedAt: now }, { sku: 'LY1', warehouseId: 'k2', quantity: 40, updatedAt: now },
    { sku: 'LY1', warehouseId: 'hcv', quantity: 500, updatedAt: now }, { sku: 'DIA1', warehouseId: 'k1', quantity: 10, updatedAt: now }]);
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}
const quote = async (call: any, emp: string, mgr: string, no: string, rows: object[], approve = true) => {
  const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: no, customer: 'Khách ' + no, vat: 8, rows });
  assert.equal(q.status, 201, JSON.stringify(q.data));
  if (approve) assert.equal((await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 1 })).status, 200);
  return q.data.id as string;
};

test('giữ hàng: chỉ báo giá đã duyệt; giữ phần khả dụng (không tính hàng chờ về), báo mã thiếu; báo giá khác chỉ còn phần chưa treo', async () => {
  const { call, emp, mgr } = await setup();
  const draft = await quote(call, emp, mgr, 'BG_NHAP', [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 5, price: 1000 }], false);
  assert.equal((await call(`/quotes/${draft}/hold`, emp, 'POST', {})).status, 409, 'báo giá chưa duyệt');
  const a = await quote(call, emp, mgr, 'BG_A', [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 70, price: 1000 }, { name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 10, price: 1000 }, { name: 'Hộp', qty: 3, price: 5 }]);
  let st = (await call(`/quotes/${a}/hold`, emp)).data;
  assert.deepEqual([st.canHold, st.canRelease, st.canExtend, st.holds.length], [true, false, false, 0]);
  const h = await call(`/quotes/${a}/hold`, emp, 'POST', {});
  assert.equal(h.status, 201, JSON.stringify(h.data));
  assert.deepEqual(h.data.held.map((x: any) => [x.sku, x.need, x.qty]), [['LY1', 80, 80]], 'gộp 2 dòng cùng mã; dòng không có mã bỏ qua');
  assert.deepEqual(h.data.short, []);
  assert.ok(Date.parse(h.data.expiresAt) - Date.now() > 4.9 * 864e5, 'hạn 5 ngày');
  assert.equal((await call(`/quotes/${a}/hold`, emp, 'POST', {})).status, 409, 'đang giữ thì không giữ lần hai');
  // Báo giá B cần 50 ly + 15 đĩa: ly chỉ còn 100 − 80 = 20 khả dụng; đĩa còn 10.
  const b = await quote(call, emp, mgr, 'BG_B', [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 50, price: 1000 }, { name: 'Đĩa', sku: 'DIA1', unit: 'cái', qty: 15, price: 1000 }]);
  const hb = (await call(`/quotes/${b}/hold`, emp, 'POST', {})).data;
  assert.deepEqual(hb.held.map((x: any) => [x.sku, x.qty]).sort(), [['DIA1', 10], ['LY1', 20]]);
  assert.deepEqual(hb.short.map((x: any) => [x.sku, x.need, x.qty]).sort(), [['DIA1', 15, 10], ['LY1', 50, 20]]);
  const c = await quote(call, emp, mgr, 'BG_C', [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 1, price: 1000 }]);
  assert.equal((await call(`/quotes/${c}/hold`, emp, 'POST', {})).data.code, 'NOTHING_TO_HOLD', 'hết khả dụng');
  // Danh sách đang treo (mọi chỗ kiểm tồn dùng): mã, số lượng, báo giá, khách.
  const all = (await call('/stock-holds', emp)).data.holds;
  assert.deepEqual(all.map((x: any) => [x.sku, x.qty, x.quoteNo]).sort(), [['DIA1', 10, 'BG_B'], ['LY1', 20, 'BG_B'], ['LY1', 80, 'BG_A']]);
  // Bỏ giữ: nhân viên được; gia hạn: chỉ Manager (+5 ngày tính từ hạn cũ).
  assert.equal((await call(`/quotes/${b}/hold/extend`, emp, 'POST', {})).status, 403);
  const before = (await call(`/quotes/${a}/hold`, mgr)).data.expiresAt;
  const ext = (await call(`/quotes/${a}/hold/extend`, mgr, 'POST', {})).data;
  assert.ok(Date.parse(ext.expiresAt) - Date.parse(before) >= 5 * 864e5 - 1000, 'gia hạn thêm 5 ngày');
  st = (await call(`/quotes/${b}/hold/release`, emp, 'POST', {})).data;
  assert.deepEqual([st.holds.length, st.canHold], [0, true]);
  assert.equal((await call('/stock-holds', emp)).data.holds.length, 1);
});

const approve = async (call: any, mgr: string, id: string, extra: object = {}) => {
  const r = await call(`/orders/${id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true, warehouseId: 'k1', ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data;
};

test('giữ hàng: lập đơn (nháp) vẫn giữ theo báo giá; duyệt thì chuyển sang đơn đúng số đã giữ; quá hạn thì bỏ treo và báo nhân viên một lần', async () => {
  const { db, call, emp, mgr } = await setup();
  const a = await quote(call, emp, mgr, 'BG_D', [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 30, price: 1000 }]);
  const b = await quote(call, emp, mgr, 'BG_E', [{ name: 'Đĩa', sku: 'DIA1', unit: 'cái', qty: 5, price: 1000 }]);
  assert.equal((await call(`/quotes/${a}/hold`, emp, 'POST', {})).status, 201);
  assert.equal((await call(`/quotes/${b}/hold`, emp, 'POST', {})).status, 201);
  const o = await call('/orders', emp, 'POST', { quoteId: a });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  const orderId = o.data.order?.id ?? o.data.id;
  assert.deepEqual((await db.select({ status: stockHolds.status }).from(stockHolds).where(eq(stockHolds.quoteId, a))).map(r => r.status), ['active'], 'đơn nháp chưa giữ: báo giá vẫn giữ');
  const held = await approve(call, mgr, orderId);
  assert.deepEqual(held.hold.map((l: any) => [l.sku, l.qty]), [['LY1', 30]], 'không ngày giao: giữ tiếp đúng số báo giá đã giữ');
  assert.deepEqual((await db.select({ status: stockHolds.status }).from(stockHolds).where(eq(stockHolds.quoteId, a))).map(r => r.status), ['converted']);
  // Cho hold của BG_E quá hạn → nhịp /pulse bỏ treo + gửi thông báo cho nhân viên.
  await db.update(stockHolds).set({ expiresAt: '2026-01-01T00:00:00.000Z' }).where(eq(stockHolds.quoteId, b));
  assert.deepEqual((await call('/stock-holds', emp)).data.holds.map((h: any) => [h.sku, h.qty, h.orderNo ? 'đơn' : h.quoteNo]), [['LY1', 30, 'đơn']], 'hết hạn không còn trừ khả dụng; đơn từ BG_D giữ thay báo giá');
  await call('/pulse', emp);
  assert.deepEqual((await db.select({ status: stockHolds.status }).from(stockHolds).where(eq(stockHolds.quoteId, b))).map(r => r.status), ['expired']);
  const notes = (await call('/notifications', emp)).data.notifications.filter((n: any) => n.title === 'Hết hạn giữ hàng');
  assert.equal(notes.length, 1); assert.match(notes[0].body, /BG_E/);
  await call('/pulse', emp);
  assert.equal((await call('/notifications', emp)).data.notifications.filter((n: any) => n.title === 'Hết hạn giữ hàng').length, 1, 'chỉ báo một lần');
});

test('đơn / HĐKT giữ theo đơn: duyệt có ngày giao thì giữ ≤ có thể bán; giao bớt giữ phần còn lại; huỷ thì bỏ; đã đẩy Sapo thì thôi giữ khi tồn Sapo cập nhật sau lúc đẩy', async () => {
  const { db, call, emp, mgr } = await setup();
  const a = await quote(call, emp, mgr, 'BG_F', [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 30, price: 1000 }, { name: 'Hộp', qty: 3, price: 5 }]);
  assert.equal((await call(`/quotes/${a}/hold`, emp, 'POST', {})).status, 201);
  const o = await call('/orders', emp, 'POST', { quoteId: a, deliveryDate: '2026-11-05' });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  const orderId = o.data.order?.id ?? o.data.id;
  const holds = async () => (await call('/stock-holds', emp)).data.holds.map((h: any) => [h.sku, h.qty, h.orderId ? 'đơn' : h.quoteNo]);
  assert.deepEqual(await holds(), [['LY1', 30, 'BG_F']], 'nháp: báo giá vẫn giữ');
  await approve(call, mgr, orderId);
  assert.deepEqual(await holds(), [['LY1', 30, 'đơn']], 'treo của báo giá chuyển sang đơn; dòng không mã bỏ qua');
  const row = (await call('/stock-holds', emp)).data.holds[0];
  assert.deepEqual([row.orderId, row.quoteId, row.customer, row.expiresAt], [orderId, a, 'Khách BG_F', null]);
  const view = (await call(`/orders/${orderId}/holds`, emp)).data;
  assert.deepEqual(view.holds.map((h: any) => [h.sku, h.qty, h.source, h.expiresAt]), [['LY1', 30, 'auto', '2026-11-08T16:59:59.000Z']], 'hạn = hết ngày giao + 3 ngày (giờ VN)');
  // Báo giá khác giữ: khả dụng = 100 − 30 (đơn) → giữ được 70 / 80.
  const b = await quote(call, emp, mgr, 'BG_G', [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 80, price: 1000 }]);
  const hb = (await call(`/quotes/${b}/hold`, emp, 'POST', {})).data;
  assert.deepEqual(hb.short.map((x: any) => [x.sku, x.need, x.qty]), [['LY1', 80, 70]]);
  await call(`/quotes/${b}/hold/release`, emp, 'POST', {});
  // Giao bớt 10 → còn giữ 20.
  await db.update(salesOrderLines).set({ deliveredQty: 10 }).where(and(eq(salesOrderLines.orderId, orderId), eq(salesOrderLines.sku, 'LY1')));
  assert.deepEqual(await holds(), [['LY1', 20, 'đơn']]);
  // Đã đẩy Sapo: còn giữ đến khi tồn nguồn của mã cập nhật SAU lúc đẩy.
  const pushedAt = new Date(Date.now() - 60_000).toISOString();
  await db.update(salesOrders).set({ sapoOrderId: '999', sapoOrderCode: 'SON999', sapoPushedAt: pushedAt }).where(eq(salesOrders.id, orderId));
  assert.deepEqual(await holds(), [['LY1', 20, 'đơn']], 'tồn chưa cập nhật sau lúc đẩy');
  await db.update(productStock).set({ updatedAt: new Date().toISOString() }).where(eq(productStock.sku, 'LY1'));
  assert.deepEqual(await holds(), [], 'tồn Sapo đã trừ → web thôi giữ, không trừ hai lần');
  // Chưa đẩy Sapo: huỷ thì bỏ giữ.
  const c = await quote(call, emp, mgr, 'BG_H', [{ name: 'Đĩa', sku: 'DIA1', unit: 'cái', qty: 4, price: 1000 }]);
  const oc = await call('/orders', emp, 'POST', { quoteId: c, deliveryDate: '2026-11-05' }), cid = oc.data.order?.id ?? oc.data.id;
  assert.deepEqual(await holds(), [], 'đơn nháp không giữ');
  await approve(call, mgr, cid);
  assert.deepEqual(await holds(), [['DIA1', 4, 'đơn']]);
  assert.equal((await call(`/orders/${cid}/status`, mgr, 'PUT', { status: 'cancelled' })).status, 200);
  assert.deepEqual(await holds(), [], 'huỷ đơn / HĐKT thì tự bỏ giữ');
  // Đơn tắt giữ hàng (holds_stock = false) không giữ.
  const d = await quote(call, emp, mgr, 'BG_I', [{ name: 'Đĩa', sku: 'DIA1', unit: 'cái', qty: 2, price: 1000 }]);
  const od = await call('/orders', emp, 'POST', { quoteId: d, deliveryDate: '2026-11-05' }), did = od.data.order?.id ?? od.data.id;
  await approve(call, mgr, did);
  await db.update(salesOrders).set({ holdsStock: false }).where(eq(salesOrders.id, did));
  assert.deepEqual(await holds(), []);
});

test('đơn cũ (hold_mode legacy) vẫn giữ toàn bộ phần chưa giao kể cả nháp cho tới khi chuyển đổi', async () => {
  const { db, call, emp, mgr } = await setup();
  const a = await quote(call, emp, mgr, 'BG_L', [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 500, price: 1000 }]);
  const o = await call('/orders', emp, 'POST', { quoteId: a }), id = o.data.order?.id ?? o.data.id;
  await db.update(salesOrders).set({ holdMode: 'legacy' }).where(eq(salesOrders.id, id));
  assert.deepEqual((await call('/stock-holds', emp)).data.holds.map((h: any) => [h.sku, h.qty]), [['LY1', 500]], 'kiểu cũ: giữ vượt tồn 100 – chờ kế hoạch chuyển đổi');
});
