import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { paymentSchedules } from '../../src/modules/sales/schema.ts';
import { incomingShipmentLines, incomingShipments, supplierPaymentSchedules, supplierPayments, suppliers } from '../../src/modules/suppliers/schema.ts';
import { tasks } from '../../src/modules/tasks/schema.ts';
import { debtAging } from '../../src/modules/sales/domain/sales.ts';
import { can, routePermission } from '../../src/modules/staff/domain/permissions.ts';

/** Công cụ Kế toán: huỷ phiếu thu, tuổi nợ, hoá đơn chờ xuất, công nợ NCC, sổ thu / chi, nhóm việc theo quyền, trang theo chức vụ. */
const origin = 'https://trial.test', now = '2026-10-01T00:00:00.000Z';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const pw = await hashPassword(PASSWORD, 1000);
  for (const [id, pos] of [['ketoan', 'accounting'], ['sa', 'sale-admin']] as const) {
    await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES (?,?,?,'0900','employee',?,1,'2026-01-01T00:00:00.000Z')").run(id, id + '@x.vn', 'Tên ' + id, pos);
    await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run(id, pw);
  }
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const } as never);
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => (await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), { db, passwordIterations: 1000 } as never)).headers.get('set-cookie')!.split(';')[0]!;
  await db.insert(warehouses).values([{ id: 'k1', name: 'Kho 1', kind: 'stock' }]);
  await db.insert(products).values([{ sku: 'LY1', name: 'Ly sứ', unit: 'cái', updatedAt: now }]);
  await db.insert(productStock).values([{ sku: 'LY1', warehouseId: 'k1', quantity: 100, updatedAt: now }]);
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), kt: await login('ketoan@x.vn'), sa: await login('sa@x.vn') };
}
async function confirmedOrder(s: Awaited<ReturnType<typeof setup>>, no: string) {
  const q = await s.call('/quotes', s.emp, 'POST', { type: 'B2B', quoteNo: no, customer: 'Khách ' + no, vat: 8, rows: [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 10, price: 1000 }] });
  assert.equal((await s.call(`/quotes/${q.data.id}/approve`, s.mgr, 'POST', { revision: 1 })).status, 200);
  const o = await s.call('/orders', s.emp, 'POST', { quoteId: q.data.id }), orderId = (o.data.order?.id ?? o.data.id) as string;
  assert.equal((await s.call(`/orders/${orderId}/status`, s.mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true })).status, 200);
  return orderId;
}

test('trang theo chức vụ: Kế toán bỏ Báo giá / Chăm sóc / Khách hỏi tồn; có Sổ thu chi, Huỷ phiếu thu, Doanh số toàn công ty', async () => {
  const s = await setup();
  const perms = (await s.call('/me', s.kt)).data.user.perms as string[];
  for (const k of ['page.quotes', 'page.care', 'page.stock-requests']) assert.ok(!perms.includes(k), k);
  for (const k of ['page.cashbook', 'payments.void', 'dashboard.all', 'page.receivables', 'page.orders']) assert.ok(perms.includes(k), k);
  const sa = (await s.call('/me', s.sa)).data.user.perms as string[];
  assert.ok(sa.includes('purchases.pay') && !sa.includes('page.cashbook') && !sa.includes('dashboard.all'), 'Sale Admin: quyền Kế toán nhưng không xem toàn công ty ngoài báo giá / khách / đơn / HĐKT');
  assert.equal((await s.call('/quotes', s.kt)).status, 403);
  assert.deepEqual(routePermission('GET', '/api/staff/cashbook', new URLSearchParams()), ['page.cashbook']);
  assert.equal(can({ role: 'employee', positionId: 'sale' }, 'page.cashbook'), false);
  const dash = await s.call('/dashboard/revenue', s.kt);
  assert.equal(dash.status, 200, JSON.stringify(dash.data)); assert.equal(dash.data.scope, 'company', 'Kế toán xem doanh số toàn công ty');
  assert.equal((await s.call('/dashboard/revenue', s.emp)).data.scope, 'self');
});

test('huỷ phiếu thu: chỉ Manager / quyền Huỷ phiếu thu, bắt buộc lý do; phiếu huỷ không tính đã thu; ghi lại phiếu mới được', async () => {
  const s = await setup(), orderId = await confirmedOrder(s, 'BG_VOID');
  const pay = await s.call('/payments', s.kt, 'POST', { orderId, amount: 5000 });
  assert.equal(pay.status, 201, JSON.stringify(pay.data));
  assert.equal((await s.call(`/payments/${pay.data.id}/void`, s.emp, 'POST', { reason: 'nhầm' })).status, 403, 'nhân viên Sale không huỷ được');
  assert.equal((await s.call(`/payments/${pay.data.id}/void`, s.kt, 'POST', { reason: '' })).status, 400, 'bắt buộc lý do');
  assert.equal((await s.call(`/payments/${pay.data.id}/void`, s.kt, 'POST', { reason: 'Ghi nhầm số tiền' })).status, 200);
  const again = await s.call(`/payments/${pay.data.id}/void`, s.kt, 'POST', { reason: 'Ghi nhầm số tiền' });
  assert.equal(again.status, 200, 'gửi lại y hệt sau khi mạng rớt: báo đã huỷ, không báo lỗi'); assert.equal(again.data.alreadyApplied, true);
  assert.equal((await s.call(`/payments/${pay.data.id}/void`, s.kt, 'POST', { reason: 'Lý do khác' })).status, 409, 'không huỷ hai lần');
  const d = (await s.call(`/orders/${orderId}`, s.kt)).data;
  assert.equal(d.receivable.paid, 0, 'phiếu huỷ không tính vào đã thu');
  assert.equal(d.payments[0].voidReason, 'Ghi nhầm số tiền'); assert.equal(d.payments[0].voidedByName, 'Tên ketoan'); assert.equal(d.canVoidPayment, true);
  assert.equal((await s.call('/payments', s.kt, 'POST', { orderId, amount: d.receivable.due })).status, 201, 'thu lại đủ sau khi huỷ phiếu nhầm');
});

test('công nợ: tuổi nợ quá hạn theo khoảng ngày, hạn thu, người phụ trách', async () => {
  assert.deepEqual(debtAging([{ amount: 100, dueDate: '2026-09-01' }, { amount: 50, dueDate: '2026-10-10' }, { amount: 30, dueDate: '2026-12-01' }], [{ amount: 40 }], '2026-10-20'),
    { oldestDue: '2026-09-01', overdueDays: 49, buckets: { d30: 50, d60: 60, over60: 0, d90: 0, over90: 0 } });
  const s = await setup(), orderId = await confirmedOrder(s, 'BG_AGE');
  await s.db.update(paymentSchedules).set({ dueDate: '2020-01-01' }).where(eq(paymentSchedules.orderId, orderId));
  const r = (await s.call('/receivables', s.kt)).data;
  assert.equal(r.receivables.length, 1);
  assert.equal(r.receivables[0].ownerName, 'Tên emp');
  assert.ok(r.receivables[0].aging.overdueDays > 60);
  assert.equal(r.totals.aging.over60, r.receivables[0].overdue);
  assert.equal(r.totals.aging.over90, r.receivables[0].overdue, 'hạn từ 2020: trên 90 ngày'); assert.equal(r.totals.aging.d90, 0);
  assert.deepEqual(debtAging([{ amount: 70, dueDate: '2026-08-10' }, { amount: 20, dueDate: '2026-06-01' }], [], '2026-10-20').buckets, { d30: 0, d60: 0, over60: 90, d90: 70, over90: 20 }, '71 ngày → 61–90; 141 ngày → trên 90');
});

test('hoá đơn chờ xuất: lọc ?invoice=requested và đếm trên Đơn hàng / HĐKT', async () => {
  const s = await setup(), orderId = await confirmedOrder(s, 'BG_HD');
  assert.equal((await s.call(`/orders/${orderId}/invoice-request`, s.emp, 'POST', { email: 'ke@khach.vn' })).status, 200);
  const all = (await s.call('/orders?flow=order', s.kt)).data, pending = (await s.call('/orders?flow=order&invoice=requested', s.kt)).data;
  assert.equal(all.invoicePending, 1); assert.deepEqual(pending.orders.map((o: any) => o.id), [orderId]);
  assert.equal((await s.call('/contracts?invoice=requested', s.kt)).data.contracts.length, 0);
  assert.equal((await s.call(`/orders/${orderId}/invoice`, s.kt, 'PUT', { invoiceNo: 'HD9' })).status, 200);
  assert.equal((await s.call('/orders?flow=order', s.kt)).data.invoicePending, 0);
});

test('công nợ NCC theo nhà cung cấp + sổ thu / chi (phiếu huỷ đánh dấu, không cộng tổng)', async () => {
  const s = await setup();
  await s.db.insert(suppliers).values({ id: 'ncc1', name: 'NCC Một', nameKey: 'ncc mot', createdAt: now, updatedAt: now, createdBy: 'mgr' } as never);
  const base = { source: 'supplier-order' as const, warehouse: 'Kho', supplierId: 'ncc1', supplierName: 'NCC Một', createdAt: now, updatedAt: now, createdBy: 'mgr', approvalStatus: 'approved' as const };
  await s.db.insert(incomingShipments).values([{ ...base, id: 'po1', ticketNumber: 'PO-1' }, { ...base, id: 'po2', ticketNumber: 'PO-2', cancelledAt: now }]);
  await s.db.insert(incomingShipmentLines).values(['po1', 'po2'].map(id => ({ id: 'l-' + id, shipmentId: id, lineNo: 1, sku: 'LY1', quantity: 10, price: 100, printFee: 0, taxRate: 0 })));
  await s.db.insert(supplierPaymentSchedules).values({ id: 'sch1', shipmentId: 'po1', kind: 'balance', amount: 1000, dueDate: '2020-01-01', createdAt: now } as never);
  await s.db.insert(supplierPayments).values([{ id: 'sp1', shipmentId: 'po1', amount: 300, paidDate: '2026-10-05', method: 'transfer', clientKey: 'k1', createdBy: 'ketoan', createdAt: now },
    { id: 'sp2', shipmentId: 'po1', amount: 50, paidDate: '2026-10-06', method: 'cash', clientKey: 'k2', createdBy: 'ketoan', createdAt: now, voidedAt: now, voidReason: 'trùng' }]);
  assert.equal((await s.call('/supplier-payables', s.emp)).status, 403, 'Sale không xem công nợ NCC');
  const p = (await s.call('/supplier-payables', s.kt)).data;
  assert.deepEqual(p.suppliers.map((x: any) => [x.supplierName, x.orders, x.balance, x.overdue]), [['NCC Một', 1, 700, 700]], 'đơn huỷ không tính');
  const orderId = await confirmedOrder(s, 'BG_SO');
  await s.call('/payments', s.kt, 'POST', { orderId, amount: 2000, paidAt: '2026-10-05' });
  assert.equal((await s.call('/cashbook?from=2026-10-01&to=2026-10-31', s.emp)).status, 403);
  const cb = (await s.call('/cashbook?from=2026-10-01&to=2026-10-31', s.kt)).data;
  assert.deepEqual(cb.entries.map((e: any) => [e.date, e.kind, e.amount, e.voided]), [['2026-10-05', 'in', 2000, false], ['2026-10-05', 'out', 300, false], ['2026-10-06', 'out', 50, true]]);
  assert.deepEqual([cb.totals.in, cb.totals.out, cb.totals.net], [2000, 300, 1700]);
  assert.equal((await s.call('/cashbook?from=2026-10-31&to=2026-10-01', s.kt)).status, 400);
});

test('nhóm nhận việc theo quyền: Sale Admin (có quyền ghi trả NCC) thấy việc nhóm Kế toán; nợ quá hạn tạo việc cho nhóm Kế toán', async () => {
  const s = await setup();
  await s.db.insert(tasks).values({ id: 't-acc', title: 'Xuất hoá đơn thử', status: 'todo', priority: 'normal', source: 'manual', assigneePosition: 'accounting', createdBy: 'mgr', createdAt: now, updatedAt: now } as never);
  const seen = async (cookie: string) => (await s.call('/tasks?view=team', cookie)).data.tasks.some((t: any) => t.id === 't-acc');
  assert.equal(await seen(s.kt), true); assert.equal(await seen(s.sa), true, 'Sale Admin có quyền purchases.pay'); assert.equal(await seen(s.emp), false);
  const orderId = await confirmedOrder(s, 'BG_QH');
  await s.db.update(paymentSchedules).set({ dueDate: '2020-01-01' }).where(eq(paymentSchedules.orderId, orderId));
  await s.call('/tasks?refresh=1', s.mgr);
  const auto = await s.db.select({ key: tasks.autoKey, pos: tasks.assigneePosition, who: tasks.assigneeId }).from(tasks).where(eq(tasks.sourceId, orderId));
  assert.ok(auto.some(t => t.key === `debt-overdue-acc:${orderId}` && t.pos === 'accounting'), JSON.stringify(auto));
  assert.ok(auto.some(t => t.key === `debt-overdue:${orderId}` && t.who === 'emp'));
});

test('Cần kiểm tra (chỉ đọc): thu trùng cùng đơn / số tiền / ngày, yêu cầu xuất HĐ quá 7 ngày; người ngoài Kế toán không xem được', async () => {
  const s = await setup(), orderId = await confirmedOrder(s, 'BG_CHECK');
  for (const key of ['dup-check-key-0001', 'dup-check-key-0002']) assert.equal((await s.call('/payments', s.kt, 'POST', { orderId, amount: 1000, key })).status, 201);
  assert.equal((await s.call('/payments', s.kt, 'POST', { orderId, amount: 2000, key: 'dup-check-key-0003' })).status, 201, 'số tiền khác: không tính trùng');
  const { salesOrders } = await import('../../src/modules/sales/schema.ts');
  await s.db.update(salesOrders).set({ invoiceStatus: 'requested', invoiceRequestedAt: '2020-01-01T00:00:00.000Z' }).where(eq(salesOrders.id, orderId));
  const r = await s.call('/tasks/accounting/checks', s.kt); assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.duplicatePayments.length, 1); assert.deepEqual([r.data.duplicatePayments[0].amount, r.data.duplicatePayments[0].count], [1000, 2]);
  assert.match(r.data.duplicatePayments[0].link, new RegExp(orderId));
  assert.equal(r.data.staleInvoices.length, 1); assert.ok(r.data.staleInvoices[0].days > 7);
  assert.ok(Array.isArray(r.data.cashWithoutPhoto), 'Kế toán xem được phiếu két');
  assert.equal((await s.call('/tasks/accounting/checks', s.emp)).status, 403);
});
