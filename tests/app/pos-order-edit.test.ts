import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { stockBalances } from '../../src/modules/inventory/schema.ts';
import { auditLogs } from '../../src/core/db/schema.ts';
import { customerPayments, deliveries, deliveryLines, salesOrders } from '../../src/modules/sales/schema.ts';

async function cod() {
  const f = await setup(), shift = await f.open();
  const sale = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery: { address: 'Địa chỉ cũ', receiverName: 'Người cũ', receiverPhone: '0900000000' } }));
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  const detail = (await f.call('/orders/' + sale.data.id, f.mgr)).data;
  return { ...f, shift, sale, detail, path: '/orders/' + sale.data.id + '/pos' };
}
const rows = (d: any, qty = 3, price = 200000) => d.lines.map((l: any) => ({ id: l.id, qty, price, discountType: 'percent', discountValue: 0 }));
test('Manager sửa COD: khách, SL/giá, giao hàng, công nợ và snapshot cùng cập nhật; không xuất/thu, có audit và chống ghi đè', async () => {
  const f = await cod();
  const customer = await f.call('/pos/customers', f.emp, 'POST', { name: 'Khách mới', phone: '0901111111' });
  assert.equal(customer.status, 201);
  const b = { revision: f.detail.order.revision, reason: 'Khách đổi số lượng', customerId: customer.data.id, customerName: 'Khách mới', phone: '0901111111', address: 'Địa chỉ khách',
    lines: rows(f.detail), total: 1, tax: 1, paymentNote: 'Ship COD - thu bằng chuyển khoản khi nhận', delivery: { address: 'Địa chỉ giao mới', receiverName: 'Người mới', receiverPhone: '0902222222' } };
  const saved = await f.call(f.path, f.mgr, 'PUT', b);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.total, 600000);
  const d = (await f.call('/orders/' + f.sale.data.id, f.mgr)).data;
  assert.equal(d.order.customerId, customer.data.id);
  assert.equal(d.order.phone, '0901111111');
  assert.equal(d.lines[0].qty, 3);
  assert.equal(d.lines[0].listUnitPrice, 200000);
  assert.equal(d.schedules[0].amount, 600000);
  assert.equal(d.schedules[0].note, b.paymentNote);
  assert.equal(d.deliveries[0].codAmount, 600000);
  assert.equal(d.deliveries[0].address, 'Địa chỉ giao mới');
  assert.equal((await f.db.select().from(deliveryLines))[0]!.qty, 3);
  assert.equal(d.receivable.balance, 600000);
  const snapshot = JSON.parse(d.order.posSnapshot);
  assert.equal(snapshot.total, 600000);
  assert.equal(snapshot.lines[0].qty, 3);
  assert.equal(snapshot.customer, 'Khách mới');
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10);
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
  const audit = (await f.db.select().from(auditLogs)).filter(a => a.action === 'amend-pos-order');
  assert.equal(audit.length, 1);
  assert.equal((await f.call(f.path, f.mgr, 'PUT', b)).status, 409);
});
test('Sửa COD kiểm quyền, số lượng/giá và tồn; lỗi rollback toàn bộ, không nhận dòng của đơn khác', async () => {
  const f = await cod(), base = { revision: f.detail.order.revision, reason: 'Kiểm thử', lines: rows(f.detail) };
  assert.equal((await f.call(f.path, f.emp, 'PUT', base)).status, 403);
  assert.equal((await f.call(f.path, '', 'PUT', base)).status, 401);
  assert.equal((await f.call(f.path, f.mgr, 'PUT', { ...base, reason: '' })).status, 400);
  assert.equal((await f.call(f.path, f.mgr, 'PUT', { ...base, lines: rows(f.detail, 100), customerName: 'Không được lưu' })).status, 409);
  for (const price of [-1, 1.5]) assert.equal((await f.call(f.path, f.mgr, 'PUT', { ...base, lines: rows(f.detail, 3, price) })).status, 400);
  assert.equal((await f.call(f.path, f.mgr, 'PUT', { ...base, lines: [{ ...base.lines[0], id: 'foreign' }] })).status, 400);
  const d = (await f.call('/orders/' + f.sale.data.id, f.mgr)).data;
  assert.equal(d.order.revision, f.detail.order.revision);
  assert.equal(d.lines[0].qty, 2);
  assert.equal(d.order.customerName, 'Nguyễn Khách kiểm thử');
  await f.db.update(deliveries).set({ status: 'in_transit' }).where(eq(deliveries.id, d.deliveries[0].id));
  assert.equal((await f.call(f.path, f.mgr, 'PUT', base)).status, 409);
  assert.equal((await f.call(f.path, f.mgr, 'PUT', { revision: d.order.revision, reason: 'Đổi số người nhận', delivery: { address: 'Địa chỉ mới', receiverName: 'Anh A', receiverPhone: '0903333333' } })).status, 200);
});
test('Đơn đã thu/xuất: sửa thông tin nhưng không sửa giá trị, phiếu thu, tồn hay báo cáo ca đã chốt', async () => {
  const f = await setup(), shift = await f.open();
  const sale = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id));
  assert.equal(sale.status, 201);
  const path = '/orders/' + sale.data.id + '/pos', d = (await f.call('/orders/' + sale.data.id, f.mgr)).data;
  await f.call('/cash/shifts/' + shift.id + '/close', f.emp, 'POST', { countedCash: 694400 });
  const report = (await f.call('/cash/shifts/' + shift.id, f.emp)).data;
  assert.equal((await f.call(path, f.mgr, 'PUT', { revision: d.order.revision, reason: 'Đổi giá', lines: rows(d) })).status, 409);
  const saved = await f.call(path, f.mgr, 'PUT', { revision: d.order.revision, reason: 'Bổ sung điện thoại', phone: '0904444444', customerName: 'Tên trên bill', paymentNote: 'Đã thu tiền mặt' });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal((await f.db.select().from(customerPayments))[0]!.amount, 194400);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8);
  assert.deepEqual((await f.call('/cash/shifts/' + shift.id, f.emp)).data, report);
  assert.equal((await f.db.select().from(salesOrders))[0]!.total, 194400);
});
