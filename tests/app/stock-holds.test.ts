import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { stockHolds } from '../../src/modules/sales/schema.ts';

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

test('giữ hàng: lập đơn từ báo giá thì tự bỏ treo; quá hạn thì bỏ treo và báo nhân viên một lần', async () => {
  const { db, call, emp, mgr } = await setup();
  const a = await quote(call, emp, mgr, 'BG_D', [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 30, price: 1000 }]);
  const b = await quote(call, emp, mgr, 'BG_E', [{ name: 'Đĩa', sku: 'DIA1', unit: 'cái', qty: 5, price: 1000 }]);
  assert.equal((await call(`/quotes/${a}/hold`, emp, 'POST', {})).status, 201);
  assert.equal((await call(`/quotes/${b}/hold`, emp, 'POST', {})).status, 201);
  const o = await call('/orders', emp, 'POST', { quoteId: a });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  assert.deepEqual((await db.select({ status: stockHolds.status }).from(stockHolds).where(eq(stockHolds.quoteId, a))).map(r => r.status), ['converted']);
  // Cho hold của BG_E quá hạn → nhịp /pulse bỏ treo + gửi thông báo cho nhân viên.
  await db.update(stockHolds).set({ expiresAt: '2026-01-01T00:00:00.000Z' }).where(eq(stockHolds.quoteId, b));
  assert.equal((await call('/stock-holds', emp)).data.holds.length, 0, 'hết hạn không còn trừ khả dụng');
  await call('/pulse', emp);
  assert.deepEqual((await db.select({ status: stockHolds.status }).from(stockHolds).where(eq(stockHolds.quoteId, b))).map(r => r.status), ['expired']);
  const notes = (await call('/notifications', emp)).data.notifications.filter((n: any) => n.title === 'Hết hạn giữ hàng');
  assert.equal(notes.length, 1); assert.match(notes[0].body, /BG_E/);
  await call('/pulse', emp);
  assert.equal((await call('/notifications', emp)).data.notifications.filter((n: any) => n.title === 'Hết hạn giữ hàng').length, 1, 'chỉ báo một lần');
});
