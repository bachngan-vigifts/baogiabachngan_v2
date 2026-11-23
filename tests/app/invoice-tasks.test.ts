import {approveFixtureOrder} from '../helpers/approval-cost-fixture.ts';
import {confirmWarehouseSupply} from '../helpers/confirmed-warehouse-supply.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { PASSWORD } from '../helpers/staff-fixture.ts';
import { employees, credentials } from '../../src/modules/staff/schema.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { tasks } from '../../src/modules/tasks/schema.ts';
import { salesOrders, salesOrderLines, customerPayments } from '../../src/modules/sales/schema.ts';
import { posRegisters, webStoreOrders } from '../../src/modules/sales/pos-schema.ts';
import { posPaymentIntents } from '../../src/modules/sales/pos-order-flow-schema.ts';
import { invoiceTaskHooks } from '../../src/modules/sales/api/invoice-task-hooks.ts';
import { reconcileAutoTasks } from '../../src/modules/tasks/api/auto-tasks.ts';

type Fixture = Awaited<ReturnType<typeof setup>>;
const ok = (r: { status: number; data: any }, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
async function person(f: Fixture, id: string, positionId: string) {
  await f.db.insert(employees).values({ id, email: `${id}@x.vn`, name: id, role: 'employee', positionId, createdAt: new Date().toISOString() });
  await f.db.insert(credentials).values({ memberId: id, passwordHash: await hashPassword(PASSWORD, 1000), version: 0 });
  return (await f.call('/login', '', 'POST', { email: `${id}@x.vn`, password: PASSWORD })).cookie;
}
async function order(f: Fixture, no: string, contract = false) {
  const q = ok(await f.call('/quotes', f.emp, 'POST', { type: 'HRC', quoteNo: no, customer: no, customerTaxCode: '0101234567', vat: 8, rows: [{ sku: '00123', name: 'Ly sứ', qty: 2, price: 100000, taxRate: 8 }] }), 201);
  ok(await f.call(`/quotes/${q.id}/approve`, f.mgr, 'POST', { revision: 1 }));
  const o = contract ? ok(await f.call('/contracts', f.emp, 'POST', { quoteId: q.id, legalEntity: 'BN', depositRate: 30 }), 201) : ok(await f.call('/orders', f.emp, 'POST', { quoteId: q.id }), 201);
  const id = contract ? o.orderId : o.id;
  ok(await approveFixtureOrder(f,`/orders/${id}/status`,f.mgr,'PUT',{ status: 'confirmed', verified: true, costWarningsReviewed: true }));
  return id as string;
}
async function invoiceRows(f: Fixture, id?: string) {
  return f.db.select().from(tasks).where(and(eq(tasks.source, 'invoice'), id ? eq(tasks.sourceId, id) : undefined));
}

test('Kế toán: kho giao đủ đơn/HĐKT tạo việc ngay, giữ yêu cầu và người nhận, số hoá đơn tự đóng việc', async () => {
  const f = await setup(), accountant = await person(f, 'kt', 'accounting'), warehouse = await person(f, 'wh', 'warehouse');
  const id = await order(f, 'INVOICE-CONTRACT', true);
  const [line] = await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, id));
  const ship = async () => ok(await f.call('/deliveries', f.emp, 'POST', { orderId: id, plannedDate: '2026-10-20', lines: [{ orderLineId: line!.id, qty: 1 }] }), 201);
  const done = async (deliveryId: string) => ok(await f.call(`/deliveries/${deliveryId}/status`, warehouse, 'PUT', { status: 'delivered', photos: ['data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('delivery-photo')]).toString('base64')] }));
  const firstTrip=await ship();await confirmWarehouseSupply(f.db,f.call,f.mgr,id);
  await done(firstTrip.id);
  assert.equal((await invoiceRows(f, id)).length, 0, 'giao một phần chưa tự yêu cầu');
  await done((await ship()).id);
  const [task] = await invoiceRows(f, id);
  assert.ok(task); assert.equal(task.assigneePosition, 'accounting'); assert.equal(task.link, `#/contracts/${id}`);
  assert.match(task.title, /^Đã giao hàng · Chờ hoá đơn – HĐKT/);
  assert.ok(ok(await f.call('/notifications', accountant)).notifications.some((n: any) => n.eventType === 'task_assigned' && n.body === task.title));
  const visible = ok(await f.call('/tasks?refresh=1&source=invoice', accountant)).tasks;
  assert.equal(visible.length, 1); assert.equal(visible[0].completionFromSource, true);
  ok(await f.call(`/tasks/${task.id}`, accountant, 'PUT', { status: 'in_progress' }));
  ok(await f.call(`/orders/${id}/invoice-request`, f.emp, 'POST', { email: 'invoice@example.com', mode: 'draft', note: 'Giữ ghi chú khách' }));
  const [claimed] = await invoiceRows(f, id);
  assert.equal(claimed!.assigneeId, 'kt'); assert.match(claimed!.description, /GỬI BẢN NHÁP.*Giữ ghi chú khách/);
  assert.equal((await f.call(`/tasks/${task.id}`, accountant, 'PUT', { status: 'done' })).status, 409);
  ok(await f.call(`/orders/${id}/invoice`, accountant, 'PUT', { invoiceNo: 'HD-TEST-1' }));
  assert.equal((await invoiceRows(f, id))[0]!.status, 'done', 'đóng ngay, không chờ đọc danh sách');
  await reconcileAutoTasks(f.db);
  assert.equal((await invoiceRows(f, id)).length, 1); assert.equal((await invoiceRows(f, id))[0]!.status, 'done');
});

test('Kế toán: yêu cầu thủ công trước giao và Manager đánh dấu giao xong tạo việc ngay, không đụng việc khác', async () => {
  const f = await setup(), a = await order(f, 'INV-MANUAL'), b = await order(f, 'INV-PROGRESS');
  ok(await f.call(`/orders/${a}/invoice-request`, f.emp, 'POST', { mode: 'draft', email: 'a@example.com' }));
  assert.match((await invoiceRows(f, a))[0]!.title, /^Yêu cầu xuất hoá đơn/);
  const sourceTrip=ok(await f.call('/deliveries',f.emp,'POST',{orderId:b,plannedDate:'2026-10-24'}),201);void sourceTrip;
  await confirmWarehouseSupply(f.db,f.call,f.mgr,b);
  ok(await f.call(`/orders/${b}/progress`, f.mgr, 'POST', { stage: 'delivered' }));
  assert.match((await invoiceRows(f, b))[0]!.title, /^Đã giao hàng · Chờ hoá đơn/);
  assert.equal((await invoiceRows(f, a))[0]!.status, 'todo', 'đồng bộ riêng B không đóng nhầm A');
  ok(await f.call(`/orders/${b}/progress`, f.mgr, 'POST', { stage: 'delivered' }));
  assert.equal((await invoiceRows(f)).length, 2);
});

test('Kế toán: POS chuyển khoản hoàn tất có phiếu thực thu tạo việc ngay; tiền mặt và khoản chờ không tạo', async () => {
  const f = await setup(), s = await f.open();
  const cash = ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(s.id)), 201);
  assert.equal((await invoiceRows(f, cash.id)).length, 0);
  const cart = f.cart(s.id, { method: 'transfer', confirmed: true });
  const transfer = ok(await f.call('/pos/checkout', f.emp, 'POST', cart), 201);
  assert.equal((await invoiceRows(f, transfer.id)).length, 1);
  ok(await f.call('/pos/checkout', f.emp, 'POST', cart), 201);
  assert.equal((await invoiceRows(f, transfer.id)).length, 1);
  assert.equal((await f.call('/pos/checkout', f.emp, 'POST', f.cart(s.id, { method: 'transfer' }))).status, 400);
  const deposit = ok(await f.call('/pos/order-flows/checkout', f.emp, 'POST', f.cart(s.id, { saleFlow: 'deposit', method: 'transfer', confirmed: false, initialAmount: 50000 })), 201);
  assert.equal((await invoiceRows(f, deposit.id)).length, 0);
  const [intent] = await f.db.select().from(posPaymentIntents).where(eq(posPaymentIntents.orderId, deposit.id));
  ok(await f.call(`/pos/order-flow-intents/${intent!.id}/confirm`, f.emp, 'POST', { shiftId: s.id, confirmed: true, reference: 'TEST-DEPOSIT' }));
  assert.equal((await invoiceRows(f, deposit.id)).length, 0, 'đã nhận cọc nhưng chưa giao hàng');
  const balance = ok(await f.call(`/pos/order-flows/${deposit.id}/collect`, f.emp, 'POST', { key: crypto.randomUUID(), shiftId: s.id, amount: deposit.total - 50000, method: 'transfer', confirmed: true, pickup: true }), 201);
  assert.equal(balance.order.status, 'delivered');
  assert.equal((await invoiceRows(f, deposit.id)).length, 1, 'thu đủ và nhận hàng mới đẩy kế toán');
  ok(await f.call(`/orders/${cash.id}/invoice-request`, f.emp, 'POST', {}));
  assert.equal((await invoiceRows(f, cash.id)).length, 1, 'POS tiền mặt vẫn có thể yêu cầu tay');
});

test('Kế toán: GHN delivered tự đẩy cả khi Woo chưa completed; webhook lặp/đơn hoàn không tạo trùng, không cần quyền POS', async () => {
  const f = await setup(), accountant = await person(f, 'kt', 'accounting');
  await f.db.update(posRegisters).set({ name: 'CỬA HÀNG LOCKNLOCK CẦN THƠ' }).where(eq(posRegisters.id, f.registerId));
  const payload = { id: 901, number: 'WEB-901', status: 'processing', total: '300000', billing: { first_name: 'An', phone: '0901', email: 'an@example.com' }, shipping: { address_1: '1 Nguyễn Trãi' }, line_items: [{ sku: '00123', name: 'Ly', quantity: 2, total: '300000' }], date_created_gmt: '2026-10-20T01:00:00', date_modified_gmt: '2026-10-20T02:00:00', meta_data: [{ key: '_lnl_ghn_order_code', value: 'GHN901' }, { key: '_lnl_ghn_last_status', value: 'transporting' }] };
  const send = (p: object) => f.call('/integrations/woocommerce/lock/order?token=test-lock-token', '', 'POST', p);
  ok(await send(payload)); assert.equal((await invoiceRows(f)).length, 0);
  const delivered = { ...payload, meta_data: payload.meta_data.map(m => m.key === '_lnl_ghn_last_status' ? { ...m, value: 'delivered' } : m) };
  ok(await send(delivered));
  const [web] = await f.db.select().from(webStoreOrders);
  const [task] = await invoiceRows(f, web!.id);
  assert.ok(task); assert.match(task.description, /GHN901/); assert.match(task.description, /an@example.com/); assert.match(task.description, /00123 Ly × 2/);
  assert.equal((await f.call('/pos/orders', accountant)).status, 403);
  assert.equal(ok(await f.call(`/tasks/${task.id}`, accountant)).task.viewOnly, false);
  ok(await f.call(`/tasks/${task.id}`, accountant, 'PUT', { assigneeId: 'kt' }));
  ok(await f.call(`/tasks/${task.id}/comments`, accountant, 'POST', { body: 'Đã xuất hoá đơn WEB-001' }), 201);
  ok(await f.call(`/tasks/${task.id}`, accountant, 'PUT', { status: 'done' }));
  ok(await send(delivered)); await reconcileAutoTasks(f.db);
  assert.equal((await invoiceRows(f, web!.id)).length, 1); assert.equal((await invoiceRows(f, web!.id))[0]!.status, 'done');
  ok(await send({ ...delivered, id: 902, number: 'WEB-902', status: 'refunded' }));
  const [refunded] = await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.externalId, '902'));
  assert.equal(refunded!.status, 'refunded', 'carrier delivery must not reverse a financial refund');
  assert.equal(refunded!.ghnStatus, 'delivered', 'keep the actual carrier observation separately');
  assert.equal((await invoiceRows(f)).length, 1, 'đơn hoàn tiền không thêm nhiệm vụ xuất hoá đơn');
  const firstDate = task.createdAt;
  assert.equal((await invoiceRows(f, web!.id))[0]!.createdAt, firstDate);
});

test('Kế toán: tự bổ sung đơn cũ đủ điều kiện không cắt 500 dòng, bỏ đơn nháp/huỷ/đã xuất và POS chưa thực thu', async () => {
  const f = await setup(), stamp = '2026-10-01T00:00:00.000Z';
  const values = Array.from({ length: 505 }, (_, i) => ({ id: `old-${i}`, orderNo: `OLD-${i}`, quoteType: 'HRC' as const, customerName: 'Khách cũ', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-10-01', status: 'delivered' as const, total: 100, createdAt: stamp, updatedAt: stamp }));
  await f.db.insert(salesOrders).values(values);
  await f.db.insert(salesOrders).values([
    { ...values[0]!, id: 'issued', orderNo: 'ISSUED', invoiceStatus: 'issued', invoiceNo: 'HD1' },
    { ...values[0]!, id: 'cancelled', orderNo: 'CANCELLED', status: 'cancelled', invoiceStatus: 'requested' },
    { ...values[0]!, id: 'draft', orderNo: 'DRAFT', status: 'draft', invoiceStatus: 'requested' },
    { ...values[0]!, id: 'pos-no-receipt', orderNo: 'POS-PENDING', channel: 'pos', fulfillmentMode: 'counter', posSnapshot: JSON.stringify({ method: 'transfer' }) },
  ]);
  await reconcileAutoTasks(f.db); assert.equal((await invoiceRows(f)).length, 505);
  await reconcileAutoTasks(f.db); assert.equal((await invoiceRows(f)).length, 505);
  assert.ok((await invoiceRows(f)).every(t => t.status === 'todo'));
  assert.equal((await f.db.select().from(customerPayments)).length, 0, 'không tự ghi tiền khi bổ sung việc');
});

test('Kế toán: lỗi tạo nhiệm vụ không làm thất bại POS đã thu tiền, đồng bộ sau phục hồi đúng một nhiệm vụ', async () => {
  const f = await setup(), s = await f.open(), hook = invoiceTaskHooks.afterCommit;
  let bill: any;
  try {
    invoiceTaskHooks.afterCommit = async () => { throw new Error('Simulated task outage'); };
    bill = ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(s.id, { method: 'transfer', confirmed: true })), 201);
  } finally { invoiceTaskHooks.afterCommit = hook; }
  assert.equal((await f.db.select().from(customerPayments).where(eq(customerPayments.orderId, bill.id))).length, 1);
  assert.equal((await invoiceRows(f, bill.id)).length, 0);
  await reconcileAutoTasks(f.db);
  assert.equal((await invoiceRows(f, bill.id)).length, 1);
  await reconcileAutoTasks(f.db);
  assert.equal((await invoiceRows(f, bill.id)).length, 1);
});
