import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { employees, credentials, positionPermissions } from '../../src/modules/staff/schema.ts';
import { tasks } from '../../src/modules/tasks/schema.ts';
import { salesOrders, paymentSchedules, customerPayments } from '../../src/modules/sales/schema.ts';
import { suppliers, incomingShipments, incomingShipmentLines, supplierPayments, supplierPaymentSchedules } from '../../src/modules/suppliers/schema.ts';
import { posRegisters, webStoreOrders } from '../../src/modules/sales/pos-schema.ts';
import { warehouses, pricePolicies } from '../../src/modules/catalog/schema.ts';
import { vietnamDate } from '../../src/modules/sales/domain/sales.ts';
import { addDaysIso } from '../../src/modules/tasks/domain/task-config.ts';
import { reconcileAutoTasks } from '../../src/modules/tasks/api/auto-tasks.ts';
const now = () => new Date().toISOString();
const ok = (r: any, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1); const router = createAppRouter();
  for (const [id, positionId] of [['kt1', 'accounting'], ['kt2', 'accounting'], ['sa', 'sale-admin']]) {
    await db.insert(employees).values({ id: id!, email: `${id}@x.vn`, name: id!, role: 'employee', positionId, createdAt: now() });
    await db.insert(credentials).values({ memberId: id!, passwordHash: await hashPassword(PASSWORD, 1000), version: 0 });
  }
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request('https://trial.test/api/staff' + path, { method, headers: { origin: 'https://trial.test', cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] || '' };
  };
  const login = async (id: string) => (await call('/login', '', 'POST', { email: `${id}@x.vn`, password: PASSWORD })).cookie;
  const today = vietnamDate().iso, yesterday = addDaysIso(today, -1);
  const order = async (id = 'SALE', dueDate = yesterday) => {
    await db.insert(salesOrders).values({ id, orderNo: id, quoteType: 'HRC', customerName: 'Khách <script>', status: 'confirmed', ownerId: 'emp', createdBy: 'emp', orderDate: today, total: 1000, taxCode: 'TEST-TAX', createdAt: now(), updatedAt: now() });
    await db.insert(paymentSchedules).values({ id: 'schedule-' + id, orderId: id, kind: 'balance', amount: 1000, dueDate, createdAt: now() });
    return id;
  };
  const purchase = async () => {
    await db.insert(suppliers).values({ id: 'SUP', name: 'Nhà cung cấp thử', nameKey: 'nha cung cap thu', createdBy: 'mgr', createdAt: now(), updatedAt: now() });
    await db.insert(incomingShipments).values({ id: 'BUY', ticketNumber: 'BUY', source: 'supplier-order', supplierId: 'SUP', supplierName: 'NCC thử', warehouse: 'Kho thử', createdAt: now(), createdBy: 'mgr', updatedAt: now() });
    await db.insert(incomingShipmentLines).values({ id: 'BUY-LINE', shipmentId: 'BUY', lineNo: 1, sku: 'SKU', quantity: 10, price: 100, taxRate: 0, printFee: 0 });
    await db.insert(supplierPaymentSchedules).values([{ id: 'BUY-S1', shipmentId: 'BUY', kind: 'installment', amount: 600, dueDate: yesterday, createdAt: now() }, { id: 'BUY-S2', shipmentId: 'BUY', kind: 'installment', amount: 150, dueDate: addDaysIso(today, 2), createdAt: now() }, { id: 'BUY-S3', shipmentId: 'BUY', kind: 'balance', amount: 250, dueDate: addDaysIso(today, 2), createdAt: now() }]);
    await db.insert(supplierPayments).values({ id: 'BUY-P1', shipmentId: 'BUY', amount: 200, paidDate: today, method: 'transfer', clientKey: 'BUY-P1', createdBy: 'mgr', createdAt: now() });
  };
  return { db, call, today, yesterday, order, purchase, kt1: await login('kt1'), kt2: await login('kt2'), mgr: await login('mgr'), emp: await login('emp'), sa: await login('sa') };
}

test('việc Trả NCC / Theo dõi nợ: không đóng tay (kể cả Manager), đúng số tiền nguồn và tự đóng khi đã trả/thu đủ', async () => {
  const f = await setup(); await f.purchase(); await f.order('BUY'); await reconcileAutoTasks(f.db);
  const rows = await f.db.select().from(tasks), due = rows.find(t => t.autoKey === `po-pay:BUY:${f.yesterday}`)!, debt = rows.find(t => t.autoKey === 'debt-overdue-acc:BUY')!;
  assert.ok(due); assert.ok(debt);
  for (const t of [due, debt]) for (const actor of [f.kt1, f.mgr]) for (const status of ['done', 'cancelled']) {
    const r = await f.call(`/tasks/${t.id}`, actor, 'PUT', { status }); assert.equal(r.status, 409); assert.equal(r.data.code, 'TASK_SOURCE_MANAGED');
  }
  const d = ok(await f.call(`/tasks/accounting/${due.id}`, f.kt1)).task;
  assert.equal(d.completionFromSource, true); assert.deepEqual([d.sourceData.total, d.sourceData.paid, d.sourceData.periodAmount, d.sourceData.balance], [1000, 200, 400, 800]);
  await f.db.update(tasks).set({ description: 'Kỳ 999.999.999 đ' }).where(eq(tasks.id, due.id));
  assert.equal(ok(await f.call(`/tasks/accounting/${due.id}`, f.kt1)).task.sourceData.amount, 400, 'không tách tiền từ mô tả');
  await f.db.insert(supplierPayments).values({ id: 'PAY-FULL', shipmentId: 'BUY', amount: 800, paidDate: f.today, method: 'transfer', clientKey: 'PAY-FULL', createdBy: 'mgr', createdAt: now() });
  await f.db.insert(customerPayments).values({ id: 'COLLECT-FULL', orderId: 'BUY', amount: 1000, paidAt: f.today, method: 'transfer', createdBy: 'mgr', createdAt: now() });
  await reconcileAutoTasks(f.db);
  for (const t of [due, debt]) assert.equal((await f.db.select().from(tasks).where(eq(tasks.id, t.id)))[0]!.status, 'done');
});

test('banner cảnh báo: việc đóng tay còn tồn hiện đúng tiền/link, không tự mở lại, hết nợ thì ẩn', async () => {
  const f = await setup(); await f.order(); await reconcileAutoTasks(f.db);
  const [t] = await f.db.select().from(tasks).where(eq(tasks.autoKey, 'debt-overdue-acc:SALE'));
  await f.db.update(tasks).set({ status: 'done', completedBy: 'kt1', completedAt: now(), assigneeId: 'kt1', assigneePosition: null }).where(eq(tasks.id, t!.id));
  const d = ok(await f.call('/tasks/accounting?refresh=1', f.kt2));
  assert.equal(d.warnings.length, 1); assert.equal(d.warnings[0].source.overdue, 1000); assert.equal(d.warnings[0].source.link, '#/orders/SALE');
  assert.equal((await f.db.select().from(tasks).where(eq(tasks.id, t!.id)))[0]!.status, 'done');
  assert.equal(d.tasks.some((x: any) => x.id === t!.id), false, 'không lén đưa vào hàng đợi đang mở');
  await f.db.insert(customerPayments).values({ id: 'PAID', orderId: 'SALE', amount: 1000, paidAt: f.today, method: 'cash', createdBy: 'mgr', createdAt: now() });
  assert.equal(ok(await f.call('/tasks/accounting?refresh=1', f.kt2)).warnings.length, 0);
});

test('KPI và tab lấy dữ liệu thật: nhiều kỳ, tổng kỳ, quá hạn, nợ và invoice; quyền Kế toán/Sale Admin', async () => {
  const f = await setup(); await f.purchase(); const id = await f.order();
  await f.db.update(salesOrders).set({ invoiceStatus: 'requested', invoiceRequestedAt: now() }).where(eq(salesOrders.id, id));
  const d = ok(await f.call('/tasks/accounting?refresh=1', f.kt1));
  assert.deepEqual(d.kpis.invoices, { count: 1, overdue: 0 });
  assert.deepEqual(d.kpis.purchases, { count: 3, amount: 800, overdue: 1 });
  assert.deepEqual(d.kpis.debts, { count: 1, amount: 1000 }); assert.equal(d.kpis.unclaimed, 4); assert.equal(d.tabs.team, 4);
  assert.equal(ok(await f.call('/tasks/accounting', f.sa)).tabs.team, 4, 'Sale Admin có purchases.pay thấy nhóm kế toán');
  assert.equal(ok(await f.call('/tasks/summary', f.sa)).accountingAvailable, true);
  assert.equal(ok(await f.call('/tasks/summary', f.emp)).accountingAvailable, false);
  assert.equal((await f.call('/tasks/accounting', f.emp)).status, 403);
  const invoice = d.tasks.find((x: any) => x.sourceData.kind === 'invoice');
  assert.equal((await f.call(`/tasks/accounting/${invoice.id}`, f.emp)).status, 403);
  ok(await f.call(`/tasks/${invoice.id}`, f.kt1, 'PUT', { status: 'in_progress', revision: invoice.revision }));
  const claimed = ok(await f.call('/tasks/accounting?view=mine', f.kt1)); assert.equal(claimed.tasks.length, 1);
  const peers = ok(await f.call('/tasks/accounting?view=colleagues', f.kt2)); assert.equal(peers.tasks[0].viewOnly, true);
  assert.equal((await f.call(`/tasks/${invoice.id}`, f.kt2, 'PUT', { assigneeId: 'kt2' })).status, 403);
  assert.equal((await f.call(`/tasks/${invoice.id}/comments`, f.kt2)).status, 403);
  assert.equal((await f.call(`/tasks/${invoice.id}/comments`, f.kt2, 'POST', { body: 'Không được gửi' })).status, 403);
  ok(await f.call(`/tasks/${invoice.id}/comments`, f.kt1, 'POST', { body: 'Trao đổi bí mật' }), 201);
  const detail = ok(await f.call(`/tasks/accounting/${invoice.id}`, f.kt2)).task;
  assert.equal(detail.canComment, false); assert.ok(!JSON.stringify(detail).includes('Trao đổi bí mật'));
});

test('đơn web GHN: không bịa link, giữ đóng tay, chưa nhận không đọc trao đổi; không suy đoán tồn sau khi đóng', async () => {
  const f = await setup();
  await f.db.insert(warehouses).values({ id: 'W', name: 'Kho test', kind: 'stock' });
  await f.db.insert(pricePolicies).values([{ id: 'P', name: 'Bảng giá test' }, { id: 'P2', name: 'Bảng giá thứ hai' }]);
  await f.db.insert(posRegisters).values({ id: 'R', name: 'Quầy test', warehouseId: 'W', pricePolicyId: 'P', secondPricePolicyId: 'P2', updatedBy: 'mgr', createdAt: now(), updatedAt: now() });
  await f.db.insert(webStoreOrders).values({ id: 'WEB', source: 'lock', externalId: 'WEB', orderNo: 'WEB-TEST', registerId: 'R', status: 'processing', customerName: 'Khách thử', total: 500, ghnOrderCode: 'GHN-TEST', ghnStatus: 'delivered', orderedAt: now(), updatedAt: now() });
  const d = ok(await f.call('/tasks/accounting?kind=web&refresh=1', f.kt1)), t = d.tasks[0];
  assert.equal(t.sourceData.link, ''); assert.equal(t.sourceData.ghnCode, 'GHN-TEST'); assert.equal(t.completionFromSource, false); assert.match(t.completionHelp, /Tạm thời/);
  assert.equal((await f.call(`/tasks/${t.id}/comments`, f.kt1)).status, 403, 'chưa nhận việc không đọc trao đổi');
  ok(await f.call(`/tasks/${t.id}`, f.kt1, 'PUT', { assigneeId: 'kt1' }));
  ok(await f.call(`/tasks/${t.id}/comments`, f.kt1, 'POST', { body: 'Số hoá đơn thử' }), 201);
  ok(await f.call(`/tasks/${t.id}`, f.kt1, 'PUT', { status: 'done' }));
  const closed = ok(await f.call('/tasks/accounting?view=closed_today&refresh=1', f.kt1));
  assert.equal(closed.tasks[0].id, t.id); assert.equal(closed.tabs.closed_today, 1); assert.equal(closed.warnings.length, 0);
});

test('quyền nguồn được kiểm lại: bỏ quyền giá / quyền trang không lộ số tiền hay link qua API kế toán', async () => {
  const f = await setup(); await f.purchase(); await f.order(); await reconcileAutoTasks(f.db);
  await f.db.delete(positionPermissions).where(and(eq(positionPermissions.positionId, 'accounting'), eq(positionPermissions.permission, 'page.purchases')));
  const noPage = ok(await f.call('/tasks/accounting', f.kt1));
  assert.ok(noPage.tasks.filter((t: any) => t.sourceData.kind === 'purchase').every((t: any) => t.sourceData.amount === null && t.sourceData.link === '' && t.link === '' && t.description === ''));
  await f.db.delete(positionPermissions).where(eq(positionPermissions.positionId, 'accounting'));
  const d = ok(await f.call('/tasks/accounting?refresh=1', f.kt1));
  assert.ok(d.tasks.length > 0); assert.ok(d.tasks.every((t: any) => t.sourceData.amount === null && t.sourceData.link === '' && t.link === '' && t.description === ''));
  assert.equal(d.warnings.length, 0);
  assert.equal(ok(await f.call('/tasks/accounting?q=400', f.kt1)).tasks.length, 0, 'không dò được mô tả có số tiền bị ẩn');
  const other = ok(await f.call('/tasks/accounting', f.sa)); assert.equal(other.kpis.purchases.amount, 800);
});

test('cảnh báo NCC: chỉ kỳ thiếu hạn chưa được trả đủ; không đoán hạn, không đổi KPI, kiểm lại quyền nguồn', async () => {
  const f = await setup(); await f.purchase();
  await f.db.update(supplierPaymentSchedules).set({ dueDate: null }).where(eq(supplierPaymentSchedules.shipmentId, 'BUY'));
  const read = async (cookie = f.kt1) => ok(await f.call('/tasks/accounting?kind=invoice&view=mine&refresh=1', cookie));
  let d = await read();
  assert.equal(d.sourceWarnings.purchases.count, 3); assert.equal(d.sourceWarnings.purchases.orderCount, 1);
  assert.deepEqual(d.sourceWarnings.purchases.orders[0], { id: 'BUY', docNo: 'BUY', missingPeriods: 3, link: '#/purchases/BUY', linkLabel: 'Bổ sung hạn trả' });
  assert.equal(d.kpis.purchases.count, 0); assert.equal(d.tasks.length, 0, 'cảnh báo độc lập bộ lọc việc');
  assert.equal((await f.db.select().from(tasks)).some(t => t.autoKey?.startsWith('po-pay:')), false);
  await f.db.insert(supplierPayments).values({ id: 'PAY-PART', shipmentId: 'BUY', amount: 450, paidDate: f.today, method: 'transfer', clientKey: 'PAY-PART', createdBy: 'mgr', createdAt: now() });
  assert.equal((await read()).sourceWarnings.purchases.count, 2, 'không đếm kỳ đã được phân bổ trả đủ');
  await f.db.update(supplierPaymentSchedules).set({ dueDate: f.yesterday }).where(eq(supplierPaymentSchedules.id, 'BUY-S2'));
  d = await read(); assert.equal(d.sourceWarnings.purchases.count, 2); assert.equal(d.kpis.purchases.count, 0, 'kỳ có hạn được trả trước theo công thức cũ');
  await f.db.update(supplierPaymentSchedules).set({ dueDate: f.today }).where(eq(supplierPaymentSchedules.id, 'BUY-S3'));
  d = await read(); assert.equal(d.sourceWarnings.purchases.count, 1); assert.equal(d.kpis.purchases.count, 0);
  await f.db.update(supplierPaymentSchedules).set({ dueDate: f.today }).where(eq(supplierPaymentSchedules.id, 'BUY-S1'));
  d = await read(); assert.equal(d.sourceWarnings.purchases.count, 0); assert.equal(d.kpis.purchases.amount, 350, 'bổ sung hạn dùng luồng tự sinh hiện có');
  await f.db.update(supplierPaymentSchedules).set({ dueDate: null }).where(eq(supplierPaymentSchedules.shipmentId, 'BUY'));
  await f.db.delete(positionPermissions).where(and(eq(positionPermissions.positionId, 'accounting'), eq(positionPermissions.permission, 'purchases.prices')));
  assert.equal((await read()).sourceWarnings.purchases.available, false);
  assert.equal((await read()).sourceWarnings.purchases.orders.length, 0);
  assert.equal((await read(f.sa)).sourceWarnings.purchases.count, 2, 'Sale Admin giữ quyền hiện có');
  await f.db.insert(supplierPayments).values({ id: 'PAY-REST', shipmentId: 'BUY', amount: 350, paidDate: f.today, method: 'transfer', clientKey: 'PAY-REST', createdBy: 'mgr', createdAt: now() });
  assert.equal((await read(f.sa)).sourceWarnings.purchases.count, 0);
  await f.db.update(supplierPayments).set({ voidedAt: now() }).where(eq(supplierPayments.id, 'PAY-REST'));
  assert.equal((await read(f.sa)).sourceWarnings.purchases.count, 2, 'phiếu chi huỷ không được coi là đã trả');
  await f.db.update(incomingShipments).set({ cancelledAt: now() }).where(eq(incomingShipments.id, 'BUY'));
  assert.equal((await read(f.sa)).sourceWarnings.purchases.count, 0);
});

test('cảnh báo web: tách thiếu mã/trạng thái/đã giao, không rò PII và không tạo invoice trước xác nhận GHN', async () => {
  const f = await setup();
  await f.db.insert(warehouses).values({ id: 'W-D', name: 'Kho web', kind: 'stock' });
  await f.db.insert(pricePolicies).values([{ id: 'PD', name: 'Giá web' }, { id: 'PD2', name: 'Giá web 2' }]);
  await f.db.insert(posRegisters).values({ id: 'R-D', name: 'Quầy web', warehouseId: 'W-D', pricePolicyId: 'PD', secondPricePolicyId: 'PD2', updatedBy: 'mgr', createdAt: now(), updatedAt: now() });
  for (const [id, code, status, webStatus] of [['NO-CODE', '', '', 'processing'], ['NO-STATUS', 'GHN-NO-STATUS', '', 'completed'], ['DELIVERED', 'GHN-OK', 'delivered', 'processing'], ['TRACKING', 'GHN-WAIT', 'delivering', 'processing'], ['CANCELLED', '', '', 'cancelled'], ['REFUNDED', '', '', 'refunded']]) {
    await f.db.insert(webStoreOrders).values({ id: id!, source: 'lock', externalId: id!, orderNo: id!, registerId: 'R-D', status: webStatus!, ghnOrderCode: code, ghnStatus: status, customerName: 'PII-NAME', phone: 'PII-PHONE', address: 'PII-ADDRESS', email: 'PII-EMAIL', total: 987654, orderedAt: now(), updatedAt: '2026-10-20T06:52:01' });
  }
  const d = ok(await f.call('/tasks/accounting?kind=purchase&refresh=1', f.kt1)), web = d.sourceWarnings.web;
  assert.deepEqual([web.count, web.missingCode, web.missingStatus, web.delivered], [4, 1, 1, 1]);
  assert.equal(web.orders.find((o: any) => o.id === 'DELIVERED').issue, 'delivered');
  assert.equal(web.orders.find((o: any) => o.id === 'NO-STATUS').issue, 'missing_status');
  assert.equal(web.orders[0].updatedAt, '2026-10-20T06:52:01');
  for (const secret of ['PII-NAME', 'PII-PHONE', 'PII-ADDRESS', 'PII-EMAIL', '987654']) assert.equal(JSON.stringify(web).includes(secret), false);
  assert.ok(web.orders.every((o: any) => !o.link)); assert.equal(d.kpis.invoices.count, 1);
  const invoiceKeys = (await f.db.select().from(tasks)).filter(t => t.autoKey?.startsWith('invoice-web:')).map(t => t.autoKey);
  assert.deepEqual(invoiceKeys, ['invoice-web:DELIVERED']);
  assert.equal((await f.call('/tasks/accounting', f.emp)).status, 403);
  assert.equal(ok(await f.call('/tasks/accounting', f.sa)).sourceWarnings.web.count, 4);
});

test('cảnh báo web vẫn giữ ranh giới quầy khi NVBH được cấp purchases.pay', async () => {
  const f = await setup();
  await f.db.update(employees).set({ positionId: 'sales-lock' }).where(eq(employees.id, 'emp'));
  await f.db.insert(positionPermissions).values({ positionId: 'sales-lock', permission: 'purchases.pay' });
  await f.db.insert(warehouses).values([{ id: 'WL', name: 'MINH LONG - LOCKNLOCK CẦN THƠ', kind: 'stock' }]);
  await f.db.insert(pricePolicies).values([{ id: 'PL', name: 'Giá L' }, { id: 'PL2', name: 'Giá L2' }]);
  for (const [id, name, source] of [['LOCK', 'CỬA HÀNG LOCKNLOCK CẦN THƠ', 'lock'], ['ML', 'Showroom Gốm Sứ Minh Long Cần Thơ', 'minhlong']]) {
    await f.db.insert(posRegisters).values({ id: id!, name: name!, warehouseId: 'WL', pricePolicyId: 'PL', secondPricePolicyId: 'PL2', updatedBy: 'mgr', createdAt: now(), updatedAt: now() });
    await f.db.insert(webStoreOrders).values({ id: id!, source: source!, externalId: id!, orderNo: id!, registerId: id!, status: 'processing', orderedAt: now(), updatedAt: now() });
  }
  const d = ok(await f.call('/tasks/accounting', f.emp));
  assert.deepEqual(d.sourceWarnings.web.orders.map((o: any) => o.docNo), ['LOCK']);
  assert.equal(ok(await f.call('/tasks/accounting', f.kt1)).sourceWarnings.web.count, 2);
});
