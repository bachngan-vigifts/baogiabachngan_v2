import {approveFixtureOrder} from '../helpers/approval-cost-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { deliveries, packingSlips, paymentSchedules } from '../../src/modules/sales/schema.ts';
import { stockBalances, stockMoves } from '../../src/modules/inventory/schema.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';

/** Rà soát Kế toán / tự động hoá: huỷ đơn dọn việc treo, chỉ người phụ trách sửa nháp, thu tiền / hoá đơn / công nợ, giữ hàng không trùng. */
const origin = 'https://trial.test', now = '2026-10-01T00:00:00.000Z';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const pw = await hashPassword(PASSWORD, 1000);
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('ketoan','ketoan@x.vn','Kế toán','0900','employee','accounting',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run('ketoan', pw);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const } as never);
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => (await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), { db, passwordIterations: 1000 } as never)).headers.get('set-cookie')!.split(';')[0]!;
  await db.insert(warehouses).values([{ id: 'k1', name: 'Kho 1', kind: 'stock' }]);
  await db.insert(products).values([{ sku: 'LY1', name: 'Ly sứ', unit: 'cái', updatedAt: now }]);
  await db.insert(productStock).values([{ sku: 'LY1', warehouseId: 'k1', quantity: 100, updatedAt: now }]);
  await postMoves(db, 'mgr', [{ sku:'LY1',warehouseId:'k1',qty:100,kind:'opening',refType:'opening',refId:'fixture-opening' }], now);
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), kt: await login('ketoan@x.vn') };
}
async function orderFor(s: Awaited<ReturnType<typeof setup>>, no: string, qty = 10) {
  const q = await s.call('/quotes', s.emp, 'POST', { type: 'B2B', quoteNo: no, customer: 'Khách ' + no, vat: 8, rows: [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty, price: 1000 }] });
  assert.equal(q.status, 201, JSON.stringify(q.data));
  assert.equal((await s.call(`/quotes/${q.data.id}/approve`, s.mgr, 'POST', { revision: 1 })).status, 200);
  const o = await s.call('/orders', s.emp, 'POST', { quoteId: q.data.id });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  return { quoteId: q.data.id as string, orderId: (o.data.order?.id ?? o.data.id) as string };
}

test('đơn nháp: Kế toán xem được nhưng không huỷ / gửi duyệt đơn của người khác; người phụ trách thì được', async () => {
  const s = await setup(), { orderId } = await orderFor(s, 'BG_KT1');
  const view = await s.call(`/orders/${orderId}`, s.kt);
  assert.equal(view.status, 200);
  assert.equal(view.data.order.canEdit, false);
  assert.equal((await s.call(`/orders/${orderId}/submit`, s.kt, 'POST', {})).status, 403);
  assert.equal((await s.call(`/orders/${orderId}/status`, s.kt, 'PUT', { status: 'cancelled' })).status, 403);
  assert.equal((await s.call(`/orders/${orderId}`, s.emp)).data.order.canEdit, true);
  assert.equal((await s.call(`/orders/${orderId}/submit`, s.emp, 'POST', {})).status, 200);
});

test('huỷ đơn: phiếu đóng gói / chuyến giao còn mở huỷ theo, hàng đã đóng ghi đảo về kho; đơn huỷ không giao, không ghi thu được', async () => {
  const s = await setup(), { orderId } = await orderFor(s, 'BG_HUY');
  await s.db.insert(packingSlips).values([
    { id: 'ps1', slipNo: 'PĐG1', orderId, status: 'sent', createdBy: 'emp', createdAt: now, updatedAt: now },
    { id: 'ps2', slipNo: 'PĐG2', orderId, status: 'packed', stockWarehouseId: 'k1', createdBy: 'emp', createdAt: now, updatedAt: now },
  ]);
  await postMoves(s.db as never, 'mgr', [{ sku: 'LY1', warehouseId: 'k1', qty: -4, kind: 'issue', refType: 'packing_slip', refId: 'ps2', refNo: 'PĐG2', note: '' }]);
  await s.db.insert(deliveries).values({ id: 'dl1', deliveryNo: 'GH1', orderId, plannedDate: '2026-10-20', status: 'planned', createdBy: 'emp', createdAt: now, updatedAt: now });
  assert.equal((await s.call(`/orders/${orderId}/status`, s.mgr, 'PUT', { status: 'cancelled' })).status, 200);
  const slips = await s.db.select({ id: packingSlips.id, status: packingSlips.status }).from(packingSlips).where(eq(packingSlips.orderId, orderId));
  assert.deepEqual(slips.map(x => x.status).sort(), ['cancelled', 'cancelled']);
  assert.deepEqual((await s.db.select({ status: deliveries.status }).from(deliveries).where(eq(deliveries.id, 'dl1'))).map(x => x.status), ['cancelled']);
  const reversed = await s.db.select({ qty: stockMoves.qty }).from(stockMoves).where(and(eq(stockMoves.refId, 'ps2'), eq(stockMoves.kind, 'reverse')));
  assert.deepEqual(reversed.map(x => x.qty), [4], 'hàng đã đóng về lại kho');
  assert.deepEqual((await s.db.select({ qty: stockBalances.qty }).from(stockBalances).where(eq(stockBalances.sku, 'LY1'))).map(x => x.qty), [100], 'huỷ xuất trả về đúng tồn đầu kỳ');
  assert.equal((await s.call('/deliveries/dl1/status', s.mgr, 'PUT', { status: 'in_transit' })).status, 409);
  assert.equal((await s.call('/payments', s.mgr, 'POST', { orderId, amount: 1000 })).status, 409);
});

test('Kế toán: thu tiền không ghi ngày tương lai, không thu vượt; hoá đơn chỉ nhập cho đơn đã duyệt; công nợ lọc còn nợ / đã thu đủ', async () => {
  const s = await setup(), { orderId } = await orderFor(s, 'BG_THU');
  assert.equal((await s.call(`/orders/${orderId}/invoice`, s.kt, 'PUT', { invoiceNo: 'HD1' })).status, 409, 'đơn nháp chưa nhập hoá đơn');
  assert.equal((await approveFixtureOrder(s,`/orders/${orderId}/status`,s.mgr,'PUT',{ status: 'confirmed', verified: true, costWarningsReviewed: true })).status, 200);
  const due = (await s.db.select({ amount: paymentSchedules.amount }).from(paymentSchedules).where(eq(paymentSchedules.orderId, orderId))).reduce((t, x) => t + x.amount, 0);
  assert.ok(due > 0);
  assert.equal((await s.call('/payments', s.kt, 'POST', { orderId, amount: 1, paidAt: '2099-01-01' })).status, 400, 'ngày thu tương lai');
  const [a, b] = await Promise.all([s.call('/payments', s.kt, 'POST', { orderId, amount: due }), s.call('/payments', s.kt, 'POST', { orderId, amount: due })]);
  assert.deepEqual([a.status, b.status].sort(), [201, 400], 'bấm hai lần cùng lúc: chỉ một phiếu thu');
  const list = async (status = '') => (await s.call('/receivables' + (status ? '?status=' + status : ''), s.kt)).data.receivables.map((r: any) => r.orderNo);
  assert.deepEqual(await list(), [], 'đã thu đủ không còn trong "Còn phải thu"');
  assert.equal((await list('paid')).length, 1);
  assert.equal((await s.call(`/orders/${orderId}/invoice`, s.kt, 'PUT', { invoiceNo: 'HD1' })).status, 200);
});

test('giữ hàng: báo giá đã lập đơn không giữ thêm (đơn đang giữ)', async () => {
  const s = await setup(), { quoteId } = await orderFor(s, 'BG_GIU');
  const st = (await s.call(`/quotes/${quoteId}/hold`, s.emp)).data;
  assert.deepEqual([st.canHold, st.ordered], [false, true]);
  assert.equal((await s.call(`/quotes/${quoteId}/hold`, s.emp, 'POST', {})).data.code, 'QUOTE_HAS_ORDER');
});
