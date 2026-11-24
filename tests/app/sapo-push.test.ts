import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { quotations } from '../../src/modules/quotes/schema.ts';
import { eq } from 'drizzle-orm';
import { cleanOrderInput } from '../../src/modules/sales/domain/order-input.ts';
import { credentials, employees } from '../../src/modules/staff/schema.ts';
import { salesContracts, salesOrders } from '../../src/modules/sales/schema.ts';
import { sapoPushProblems, type SapoPushInput } from '../../src/modules/integrations/domain/sapo-order.ts';

/**
 * ĐẨY ĐƠN SANG SAPO – CHỈ qua n8n → OpenClaw: CRM lưu đơn / HĐKT rồi giao hook n8n (idempotency key theo số chứng từ);
 * OpenClaw báo kết quả về /integrations/sapo/order-status. CRM không tự gọi ghi Sapo (đường tạo đơn trực tiếp đã gỡ).
 */
const origin = 'https://trial.test', SECRET = 's'.repeat(40);
type Raw = Record<string, any>;

async function setup(opts: { claw?: boolean } = {}) {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const hooks: { url: string; body: Raw }[] = [], sapoCalls: string[] = [];
  const sapoWebhookFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    hooks.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
    return Response.json({ success: true, runId: `run-${hooks.length}` });
  }) as typeof fetch;
  // Mọi lượt gọi thẳng Sapo admin bị ghi lại: luồng đơn hàng không được gọi tới.
  const sapoFetch = (async (input: string | URL | Request) => { sapoCalls.push(String(input)); return new Response('{}', { status: 500 }); }) as typeof fetch;
  const env = { db, passwordIterations: 1000, sapoSyncToken: SECRET, sapoFetch, ...(opts.claw === false ? {} : { sapoOrderMode: 'n8n' as const, sapoWebhookFetch }) };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const callback = async (body: Raw) => router.handle(new Request(origin + '/api/staff/integrations/sapo/order-status', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` }, body: JSON.stringify(body) }), env);
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const mgr = await login('mgr@x.vn'), emp = await login('emp@x.vn');
  await db.insert(customers).values({ id: '501', name: 'Công ty Hoàng Long', contact: 'Chị Lan', phone: '0901', email: '', address: '1 Lê Lợi', search: '', taxCode: '0101234567', customerCode: 'HL01', sourceVersion: 0, syncedAt: '' });
  const ROWS = [{ name: 'Bình giữ nhiệt', sku: 'LHC', unit: 'cái', qty: 10, price: 200000, taxRate: 8 }, { name: 'Hộp quà mới', sku: 'HQ-NEW', unit: 'hộp', qty: 5, price: 100000, taxRate: 8 }];
  /** Báo giá đã duyệt của emp (người phụ trách = emp). */
  const makeQuote = async (quoteNo: string, rows: object[] = ROWS) => {
    const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo, customer: 'Công ty Hoàng Long', customerId: '501', customerTaxCode: '0101234567', contact: 'Chị Lan', phone: '0901', vat: 8, date: '2026-10-09', rows });
    assert.equal(q.status, 201, JSON.stringify(q.data));
    assert.equal((await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 1 })).status, 200);
    return q.data.id as string;
  };
  const orderCount = async () => (await db.select({ id: salesOrders.id }).from(salesOrders)).length;
  return { db, hooks, sapoCalls, router, env, call, callback, mgr, emp, makeQuote, orderCount };
}

test('production: Sinh đơn và Sinh HĐKT giao đúng hai hook n8n/Claw, không gọi ghi Sapo trực tiếp', async () => {
  const s = await setup();
  const order = await s.call('/orders', s.emp, 'POST', { quoteId: await s.makeQuote('B2B_N8N_001') });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  assert.deepEqual([order.data.sapo.status, order.data.sapo.runId], ['updating', 'run-1']);
  assert.match(s.hooks[0]!.url, /crm-order-from-web-to-claw$/);
  assert.deepEqual([s.hooks[0]!.body.event, s.hooks[0]!.body.trigger_source], ['crm_create_sapo_order', 'order']);
  assert.equal(s.hooks[0]!.body.idempotency_key, `order:${order.data.sapo.code}`);
  assert.equal(s.hooks[0]!.body.items.length, 2);
  const callback = await s.router.handle(new Request(origin + '/api/staff/integrations/sapo/order-status', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ quote_number: order.data.sapo.code, status: 'created', sapo_order_id: 4321, sapo_order_code: order.data.sapo.code }) }), s.env);
  assert.equal(callback.status, 200, await callback.text());
  assert.equal((await s.call(`/orders/${order.data.id}`, s.emp)).data.order.sapoOrderId, '4321');

  const cancelled = await s.call(`/orders/${order.data.id}/status`, s.emp, 'PUT', { status: 'cancelled' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.deepEqual([cancelled.data.sapoCancel.status, cancelled.data.sapoCancel.sapoOrderId], ['updating', '4321']);
  assert.match(s.hooks[1]!.url, /crm-order-from-web-to-claw$/);
  assert.deepEqual([s.hooks[1]!.body.event, s.hooks[1]!.body.action, s.hooks[1]!.body.sapo_order_id], ['crm_cancel_sapo_order', 'cancel', '4321']);
  assert.equal(s.hooks[1]!.body.idempotency_key, `cancel:order:${order.data.sapo.code}:4321`);

  const contract = await s.call('/contracts', s.emp, 'POST', { quoteId: await s.makeQuote('B2B_N8N_002'), legalEntity: 'BN', depositRate: 30, paymentDays: 15 });
  assert.equal(contract.status, 201, JSON.stringify(contract.data));
  assert.deepEqual([contract.data.sapo.status, contract.data.sapo.code], ['updating', contract.data.contractNo]);
  assert.match(s.hooks[2]!.url, /crm-hdkt-sapo-order-from-web-to-claw$/);
  assert.deepEqual([s.hooks[2]!.body.event, s.hooks[2]!.body.trigger_source], ['crm_hdkt_create_sapo_order', 'hdkt']);
  assert.equal(s.hooks[2]!.body.idempotency_key, `hdkt:${contract.data.contractNo}`);
  assert.deepEqual(s.sapoCalls, [], 'không gọi thẳng Sapo admin');
});

test('chưa cấu hình n8n / dòng thiếu SKU / không có quyền xem báo giá → báo rõ; "Không tạo đơn trên Sapo" vẫn sinh chứng từ', async () => {
  const off = await setup({ claw: false });
  const qid = await off.makeQuote('B2B_BG20261009_001');
  const pre = (await off.call(`/sapo/preview?quoteId=${qid}`, off.emp)).data;
  assert.deepEqual([pre.viaClaw, pre.problems], [true, []]);
  const missing = await off.call('/orders', off.emp, 'POST', { quoteId: qid });
  assert.equal(missing.status, 503); assert.equal(missing.data.code, 'SAPO_WEBHOOK_MISSING');
  assert.equal(await off.orderCount(), 0, 'chưa cấu hình n8n: không lưu chứng từ nửa vời');
  const plain = await off.call('/orders', off.emp, 'POST', { quoteId: qid, pushSapo: false });
  assert.equal(plain.status, 201, JSON.stringify(plain.data)); assert.equal(plain.data.sapo, null);
  const k = await off.call('/contracts', off.emp, 'POST', { quoteId: await off.makeQuote('B2B_BG20261009_002'), legalEntity: 'BN', depositRate: 30, paymentDays: 15, pushSapo: false });
  assert.equal(k.status, 201, JSON.stringify(k.data)); assert.equal(k.data.sapo, null);
  assert.equal((await off.call('/orders/' + plain.data.id + '/sapo', off.emp, 'POST', {})).data.code, 'SAPO_WEBHOOK_MISSING');

  const s = await setup();
  const noSku = await s.makeQuote('B2B_BG20261009_005', [{ name: 'Hàng tự do', sku: '', qty: 1, price: 1000 }]);
  assert.match((await s.call(`/sapo/preview?quoteId=${noSku}`, s.emp)).data.problems.join(), /chưa có mã SKU/);
  assert.equal((await s.call('/orders', s.emp, 'POST', { quoteId: noSku })).data.code, 'SAPO_PUSH_INVALID');
  assert.equal(s.hooks.length, 0, 'dữ liệu thiếu SKU không được gửi n8n');
  const ncc = (await s.call('/login', '', 'POST', { email: 'ncc@x.vn', password: PASSWORD })).cookie;
  assert.equal((await s.call(`/sapo/preview?quoteId=${noSku}`, ncc)).status, 403);
  assert.deepEqual([...off.sapoCalls, ...s.sapoCalls], []);
});

test('đẩy Sapo: hàm thuần – kiểm dữ liệu trước khi gửi n8n', () => {
  const input: SapoPushInput = { code: 'DH_20261009_001', orderNo: 'DH_20261009_001', quoteNo: 'B2B_BG20261009_001', quoteType: 'B2B', contractNo: '',
    customer: { sapoId: 501, name: 'Khách', customerCode: '', taxCode: '', phone: '', email: '', contact: '', address: '' },
    lines: [{ sku: 'A', name: 'A', unit: 'cái', qty: 2, unitPrice: 1000, taxRate: 8 }, { sku: '', name: 'B', unit: '', qty: 1, unitPrice: 5, taxRate: 0 }],
    ownerName: 'Lan', ownerPhone: '', expectedDeliveryDate: '2026-10-20', subtotal: 2005, tax: 160, total: 2165 };
  assert.match(sapoPushProblems(input).join(), /Dòng 2 chưa có mã SKU/);
  assert.deepEqual(sapoPushProblems({ ...input, lines: [input.lines[0]!] }), []);
  assert.match(sapoPushProblems({ ...input, code: '' }).join(), /Chưa có số đơn/);
  assert.deepEqual(sapoPushProblems({ ...input, code: '', lines: [input.lines[0]!] }, { requireCode: false }), []);
});

test('sinh đơn: lọc ghi chú đúng ba phần, giữ điều khoản dài, sửa riêng và xoá ghi chú; không qua Sapo không cần phiên', async () => {
  const s = await setup();
  assert.deepEqual((await s.call('/orders/create-config', s.emp)).data, { version: 2, noteMaxLength: 20000, recipientFields: true });
  assert.equal((await s.call('/orders/create-config')).status, 401);
  const quoteId = await s.makeQuote('B2B_BG20261009_101');
  const preview = await s.call(`/orders/next-no?quoteId=${quoteId}&orderDate=2026-10-10`, s.emp);
  assert.equal(preview.status, 200); assert.match(preview.data.orderNo, /^DH_\d{3}_10102026$/);
  const longNote = '- Thanh toán: ' + 'Thanh toán sau khi giao hàng. '.repeat(100).trim();
  const [quote] = await s.db.select().from(quotations).where(eq(quotations.id, quoteId));
  const data = JSON.parse(quote!.data); data.notes = longNote; data.deliveryDate = '2026-10-30';
  await s.db.update(quotations).set({ data: JSON.stringify(data) }).where(eq(quotations.id, quoteId));
  const inherited = await s.call('/orders', s.emp, 'POST', { quoteId, pushSapo: false });
  assert.equal(inherited.status, 201, JSON.stringify(inherited.data));
  const read = async (id: string) => (await s.call('/orders/' + id, s.emp)).data.order;
  const inheritedNote = (await read(inherited.data.id)).note;
  assert.ok(inheritedNote.includes(longNote), 'payment terms are not truncated at old 2000-char limit');
  assert.equal(inheritedNote.split('\n').length, 3);
  const q2 = await s.makeQuote('B2B_BG20261009_102');
  const made = await s.call('/orders', s.emp, 'POST', { quoteId: q2, pushSapo: false, orderNo: 'PO-KHACH-001', note: 'Giao từng đợt\nGọi trước 30 phút', deliveryAddress: 'Kho khách hàng', receiverName: 'Người nhận riêng', receiverPhone: '0902000002', orderDate: '2026-10-10', deliveryDate: '2026-10-31' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const o = await read(made.data.id);
  assert.deepEqual([o.orderNo, o.note, o.address, o.orderDate, o.expectedDeliveryDate], ['PO-KHACH-001', 'Giao từng đợt\nGọi trước 30 phút', 'Kho khách hàng', '2026-10-10', '2026-10-31']);
  assert.equal(o.receiverName, 'Người nhận riêng'); assert.equal(o.receiverPhone, '0902000002');
  const q2data = (await s.call('/quotes/' + q2, s.emp)).data.data;
  assert.equal(o.contact, q2data.contact || ''); assert.equal(o.phone, q2data.phone || '');
  assert.equal(made.data.orderNo, 'PO-KHACH-001');
  const duplicateQuote = await s.makeQuote('B2B_BG20261009_102_DUP');
  const duplicate = await s.call('/orders', s.emp, 'POST', { quoteId: duplicateQuote, pushSapo: false, orderNo: 'PO-KHACH-001' });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.data.code, 'ORDER_NO_EXISTS');
  assert.equal((await s.call('/quotes/' + q2, s.emp)).data.data.notes, '', 'order overrides do not change quote');
  const q3 = await s.makeQuote('B2B_BG20261009_103');
  const [q3row] = await s.db.select().from(quotations).where(eq(quotations.id, q3));
  await s.db.update(quotations).set({ data: JSON.stringify({ ...JSON.parse(q3row!.data), notes: 'Ghi chú gốc', deliveryDate: '2026-10-30' }) }).where(eq(quotations.id, q3));
  const cleared = await s.call('/orders', s.emp, 'POST', { quoteId: q3, pushSapo: false, note: '', deliveryDate: '' });
  assert.equal(cleared.status, 201); assert.equal((await read(cleared.data.id)).note, ''); assert.equal((await read(cleared.data.id)).expectedDeliveryDate, null);
  assert.equal(s.hooks.length, 0, 'không tạo đơn Sapo thì không gửi n8n');
});

test('thông tin đơn hàng: kiểm ngày thật và giới hạn ghi chú ở server', () => {
  assert.throws(() => cleanOrderInput({ orderDate: '2026-02-30' }), /không hợp lệ/);
  assert.throws(() => cleanOrderInput({ deliveryDate: '31/10/2026' }), /không hợp lệ/);
  assert.throws(() => cleanOrderInput({ note: 'x'.repeat(20001) }), /không hợp lệ/);
  assert.throws(() => cleanOrderInput({ note: 123 }), /không hợp lệ/);
  for (const input of [{receiverName: 1}, {receiverName: 'x'.repeat(501)}, {receiverPhone: []}, {receiverPhone: '1'.repeat(101)}]) assert.throws(() => cleanOrderInput(input), /không hợp lệ/);
  assert.equal(cleanOrderInput({receiverPhone:' 0902000002 '}).receiverPhone,'0902000002');
  assert.deepEqual(cleanOrderInput({ deliveryDate: '', note: '' }), { receiverName: undefined, receiverPhone: undefined, orderDate: undefined, deliveryDate: null, deliveryAddress: undefined, note: '' });
});


test('đơn/HĐKT đã có: đẩy Sapo sau qua n8n, đã liên kết thì không gửi lại, không sinh thêm chứng từ CRM', async () => {
  const s = await setup();
  const quoteId = await s.makeQuote('B2B_BG20261012_201');
  const made = await s.call('/orders', s.emp, 'POST', { quoteId, pushSapo: false });
  const read = async () => (await s.call('/orders/' + made.data.id, s.emp)).data.order;
  assert.equal((await read()).canCreateSapo, true);
  const r = await s.call('/orders/' + made.data.id + '/sapo', s.emp, 'POST', {});
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.deepEqual([r.data.sapo.status, r.data.sapo.code], ['updating', (await read()).orderNo]);
  assert.deepEqual([s.hooks.length, s.hooks[0]!.body.trigger_source, s.hooks[0]!.body.idempotency_key], [1, 'order', `order:${(await read()).orderNo}`]);
  assert.equal((await s.callback({ quote_number: (await read()).orderNo, status: 'created', sapo_order_id: 8801, sapo_order_code: (await read()).orderNo })).status, 200);
  assert.equal((await read()).canCreateSapo, false); assert.ok((await read()).sapoOrderUrl);
  const again = await s.call('/orders/' + made.data.id + '/sapo', s.emp, 'POST', {});
  assert.equal(again.data.sapo.id, '8801'); assert.equal(s.hooks.length, 1, 'đã có đơn Sapo: không gửi n8n lần nữa');
  assert.equal(await s.orderCount(), 1);
  const k = await s.call('/contracts', s.emp, 'POST', { quoteId: await s.makeQuote('B2B_BG20261012_202'), legalEntity: 'BN', depositRate: 30, paymentDays: 15, pushSapo: false });
  const pushed = await s.call('/orders/' + k.data.orderId + '/sapo', s.emp, 'POST', {});
  assert.equal(pushed.status, 200, JSON.stringify(pushed.data)); assert.equal(pushed.data.sapo.code, k.data.contractNo);
  assert.equal(s.hooks.at(-1)!.body.trigger_source, 'hdkt');
  assert.equal(await s.orderCount(), 2); assert.equal((await s.db.select().from(salesContracts)).length, 1);
  assert.deepEqual(s.sapoCalls, []);
});

test('đẩy Sapo sau: kiểm quyền server, chứng từ đã duyệt / đã huỷ', async () => {
  const s = await setup();
  const made = await s.call('/orders', s.emp, 'POST', { quoteId: await s.makeQuote('B2B_BG20261012_203'), pushSapo: false });
  const path = '/orders/' + made.data.id + '/sapo';
  assert.equal((await s.call(path, '', 'POST', {})).status, 401);
  const [known] = await s.db.select().from(credentials).where(eq(credentials.memberId, 'emp'));
  await s.db.update(credentials).set({ passwordHash: known!.passwordHash }).where(eq(credentials.memberId, 'new'));
  await s.db.update(employees).set({ positionId: 'warehouse' }).where(eq(employees.id, 'new'));
  const other = (await s.call('/login', '', 'POST', { email: 'new@x.vn', password: PASSWORD })).cookie;
  assert.equal((await s.call(path, other, 'POST', {})).status, 403, 'chức vụ Kho không được cấp trang Đơn hàng');
  assert.equal(s.hooks.length, 0);
  await s.db.update(salesOrders).set({ status: 'confirmed' }).where(eq(salesOrders.id, made.data.id));
  assert.equal((await s.call(path, s.emp, 'POST', {})).status, 200, 'sale đẩy được đơn đã duyệt');
  assert.equal((await s.call('/orders/' + made.data.id, s.emp)).data.order.canEdit, false, 'Sapo permission must not unlock approved documents');
  assert.equal((await s.call('/orders/' + made.data.id, s.mgr)).data.order.canCreateSapo, true);
  await s.db.update(salesOrders).set({ status: 'cancelled' }).where(eq(salesOrders.id, made.data.id));
  assert.equal((await s.call(path, s.mgr, 'POST', {})).data.code, 'ORDER_CANCELLED');
  const order = (await s.call('/orders/' + made.data.id, s.mgr)).data.order;
  assert.equal(order.sapoOrderId, null); assert.equal(order.canCreateSapo, false);
  assert.equal(s.hooks.length, 1); assert.deepEqual(s.sapoCalls, []);
});

test('sales Sapo permission covers approved/completed documents without edit privileges or wider data scope', async () => {
  const s = await setup();
  const made = await s.call('/orders', s.emp, 'POST', { quoteId: await s.makeQuote('B2B_SAPO_ACCESS'), pushSapo: false });
  const path = '/orders/' + made.data.id;
  for (const positionId of ['sale', 'sales-ml', 'sales-lock', 'sale-admin']) {
    await s.db.update(employees).set({ positionId }).where(eq(employees.id, 'emp'));
    // Sale Admin may export a visible order belonging entirely to another employee.
    await s.db.update(salesOrders).set({ ownerId: positionId === 'sale-admin' ? 'mgr' : 'emp', createdBy: positionId === 'sale-admin' ? 'mgr' : 'emp' }).where(eq(salesOrders.id, made.data.id));
    for (const status of ['confirmed', 'delivered'] as const) {
      await s.db.update(salesOrders).set({ status }).where(eq(salesOrders.id, made.data.id));
      const detail = await s.call(path, s.emp);
      assert.equal(detail.status, 200, positionId);
      assert.equal(detail.data.order.canCreateSapo, true, `${positionId}/${status}`);
      assert.equal(detail.data.order.canEdit, false, 'approved document remains locked');
      assert.equal((await s.call(path + '/delivery-date', s.emp, 'PUT', { date: '2026-12-01' })).status, 403, 'export permission cannot edit approved orders');
      assert.equal((await s.call(path + '/status', s.emp, 'PUT', { status: 'cancelled' })).status, 403, 'export permission cannot cancel approved orders');
      const before = s.hooks.length;
      assert.equal((await s.call(path + '/sapo', s.emp, 'POST', {})).status, 200);
      assert.equal(s.hooks.length, before + 1);
      assert.equal(s.hooks.at(-1)!.body.trigger_source, 'order');
    }
  }
  await s.db.update(employees).set({ positionId: 'accounting' }).where(eq(employees.id, 'emp'));
  assert.equal((await s.call(path, s.emp)).data.order.canCreateSapo, false);
  assert.equal((await s.call(path + '/sapo', s.emp, 'POST', {})).data.code, 'SAPO_PUSH_FORBIDDEN');
  await s.db.update(employees).set({ positionId: 'sales-lock' }).where(eq(employees.id, 'emp'));
  // makeQuote assigns its customer to emp; remove that legitimate shared-customer access here.
  await s.db.update(salesOrders).set({ customerId: null }).where(eq(salesOrders.id, made.data.id));
  const before = s.hooks.length;
  assert.equal((await s.call(path, s.emp)).status, 404, 'sales position does not widen order scope');
  assert.equal((await s.call(path + '/sapo', s.emp, 'POST', {})).status, 404);
  assert.equal(s.hooks.length, before, 'forbidden requests never contact Sapo');
  assert.equal(await s.orderCount(), 1, 'export never duplicates the CRM document');
});

test('đẩy Sapo cho chứng từ có sẵn: tôn trọng công tắc tắt đẩy Sapo', async () => {
  const { db, hooks, call, emp, makeQuote, env } = await setup();
  const r = await call('/orders', emp, 'POST', { quoteId: await makeQuote('B2B_OFF_1'), pushSapo: false });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const router = createAppRouter();
  const res = await router.handle(new Request(origin + `/api/staff/orders/${r.data.id}/sapo`, { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: emp }, body: JSON.stringify({}) }),
    { ...env, db, sapoOrderPush: 'off' as const });
  assert.equal(res.status, 409); assert.equal(((await res.json()) as any).code, 'SAPO_PUSH_DISABLED');
  assert.equal(hooks.length, 0);
});
