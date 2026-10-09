import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers, customerStaff } from '../../src/modules/customers/schema.ts';
import { pricePolicies, productPrices, products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';

const origin = 'https://trial.test';
const t = '2026-10-06T00:00:00.000Z';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string, password = PASSWORD) => (await call('/login', '', 'POST', { email, password })).cookie;
  await db.insert(customers).values([
    { id: '1001', name: 'Công ty Hoàng Long', contact: 'Chị Lan', phone: '0901', email: 'lan@hl.vn', address: '1 Lê Lợi', search: '', taxCode: '0101234567', customerCode: 'HL01', sourceVersion: 0, syncedAt: t },
    { id: '1002', name: 'Công ty Khác', contact: '', phone: '', email: '', address: '', search: '', taxCode: '', customerCode: '', sourceVersion: 0, syncedAt: t },
  ]);
  // Nhân viên phụ trách khách 1001 (không phụ trách 1002) – chỉ cấp được tài khoản trang khách cho khách mình phụ trách / được chia sẻ.
  await db.insert(customerStaff).values({ customerId: '1001', memberId: 'emp', role: 'owner', createdAt: t });
  await db.insert(pricePolicies).values([{ id: 'le', name: 'Giá bán lẻ', sortOrder: 0 }, { id: 'si', name: 'Giá sỉ', sortOrder: 1 }]);
  await db.insert(warehouses).values({ id: 'k1', name: 'Kho Q1' });
  await db.insert(products).values([
    { sku: 'ML-01', name: 'Bộ trà Minh Long', brand: 'Minh Long', unit: 'bộ', taxable: true, taxOut: 8, updatedAt: t },
    { sku: 'LL-01', name: 'Bình giữ nhiệt', brand: 'Lock&Lock', unit: 'cái', taxable: true, taxOut: 10, updatedAt: t },
    { sku: 'NOPRICE', name: 'Chưa có giá', brand: 'Minh Long - LYS', updatedAt: t },
    { sku: 'HC-01', name: 'Nồi Gốm Bát Tràng', brand: 'Bát Tràng', unit: 'cái', updatedAt: t },
    { sku: 'LYS-01', name: 'Đĩa LYS', brand: 'LYS', unit: 'cái', updatedAt: t },
  ]);
  await db.insert(productPrices).values([{ sku: 'ML-01', policyId: 'le', price: 1_000_000 }, { sku: 'ML-01', policyId: 'si', price: 800_000 }, { sku: 'LL-01', policyId: 'le', price: 200_000 }, { sku: 'HC-01', policyId: 'le', price: 300_000 }, { sku: 'LYS-01', policyId: 'le', price: 90_000 }]);
  await db.insert(productStock).values({ sku: 'ML-01', warehouseId: 'k1', quantity: 9, updatedAt: t });
  return { db, call, login, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}
/** Cấp tài khoản → khách tự đặt mật khẩu qua liên kết → đăng nhập. */
async function customerLogin(s: Awaited<ReturnType<typeof setup>>, by: string, body: object) {
  const r = await s.call('/customer-accounts', by, 'POST', body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const token = /token=([a-f0-9]{64})/.exec(r.data.url)![1];
  assert.equal((await s.call('/activate', '', 'POST', { token, password: 'khach-hang-123' })).status, 200);
  return { memberId: r.data.memberId as string, cookie: await s.login((body as any).email, 'khach-hang-123') };
}

test('tài khoản khách: nhân viên cấp (không đặt được CK), Manager đặt CK theo nhãn; khách chỉ vào được trang khách, nhân viên không vào trang khách', async () => {
  const s = await setup(), { call, emp, mgr } = s;
  assert.equal((await call('/customer-accounts', emp, 'POST', { customerId: '1001', name: 'Lan', email: 'x@hl.vn', discounts: { minhLong: 5 } })).status, 403, 'nhân viên không đặt CK');
  assert.equal((await call('/customer-accounts', emp, 'POST', { customerId: '9999', name: 'Lan', email: 'x@hl.vn' })).status, 404);
  assert.equal((await call('/customer-accounts', emp, 'POST', { customerId: '1001', name: 'Lan', email: 'emp@x.vn' })).status, 409, 'trùng email');
  // Khách KHÔNG phụ trách: không cấp được tài khoản (tài khoản trang khách xem được mọi đơn / công nợ của khách), không xem danh sách tài khoản.
  assert.equal((await call('/customer-accounts', emp, 'POST', { customerId: '1002', name: 'Kẻ lạ', email: 'la@khac.vn' })).status, 403, 'khách không phụ trách');
  assert.equal((await call('/customer-accounts', mgr, 'POST', { customerId: '1002', name: 'Chị Khác', email: 'chi@khac.vn' })).status, 201, 'Manager cấp được');
  assert.deepEqual((await call('/customers/1002/accounts', emp)).data.accounts, [], 'nhân viên không phụ trách không xem danh sách tài khoản / chiết khấu');
  assert.equal((await call('/customers/1002/accounts', mgr)).data.accounts.length, 1);
  const k = await customerLogin(s, emp, { customerId: '1001', name: 'Chị Lan', email: 'lan@hl.vn', phone: '0901' });
  let acc = (await call('/customers/1001/accounts', emp)).data.accounts;
  assert.deepEqual([acc[0].name, acc[0].activated, acc[0].owner.id, acc[0].discounts, acc[0].canManage], ['Chị Lan', true, 'emp', {}, true]);
  assert.equal((await call('/customer-accounts/' + k.memberId, emp, 'PUT', { discounts: { minhLong: 10 } })).status, 403);
  assert.equal((await call('/customer-accounts/' + k.memberId, mgr, 'PUT', { discounts: { minhLong: 101 } })).status, 400);
  assert.equal((await call('/customer-accounts/' + k.memberId, mgr, 'PUT', { discounts: { minhLong: 10, lock: 5 } })).status, 200);
  acc = (await call('/customers/1001/accounts', emp)).data.accounts;
  assert.deepEqual(acc[0].discounts, { minhLong: 10, lock: 5 });

  // Khách: vai trò riêng, chỉ trang khách hàng.
  assert.equal((await call('/me', k.cookie)).data.user.role, 'customer');
  for (const p of ['/quotes', '/products?q=a', '/catalog-snapshot', '/orders', '/customers', '/admin/members']) assert.equal((await call(p, k.cookie)).status, 403, p);
  for (const p of ['/portal/me', '/portal/catalog', '/portal/quotes']) { assert.equal((await call(p, emp)).status, 403, 'nhân viên: ' + p); assert.equal((await call(p, mgr)).status, 403, 'Manager: ' + p); }
  const me = (await call('/portal/me', k.cookie)).data;
  assert.deepEqual([me.customer.name, me.owner.name, me.discounts], ['Công ty Hoàng Long', 'Tên emp', { minhLong: 10, lock: 5 }]);
  // Tài khoản khách không lẫn vào danh sách nhân viên; không đổi được thành nhân viên ở trang Nhân viên.
  assert.ok(!(await call('/admin/members', mgr)).data.members.some((m: any) => m.id === k.memberId));
  assert.equal((await call('/admin/members', mgr, 'POST', { name: 'X', email: 'y@x.vn', phone: '1', positionId: 'customer' })).status, 400);

  // Danh mục cho khách: giá bán lẻ + CK theo nhãn, KHÔNG có tồn kho.
  const cat = (await call('/portal/catalog', k.cookie)).data;
  assert.equal(cat.policy, 'Giá bán lẻ');
  const row = (sku: string) => Object.fromEntries(cat.columns.map((c: string, i: number) => [c, cat.products.find((p: any[]) => p[0] === sku)[i]]));
  assert.deepEqual([row('ML-01').price, row('ML-01').discount, row('LL-01').discount], [1_000_000, 10, 5]);
  assert.ok(!JSON.stringify(cat).includes('Kho Q1') && !cat.columns.includes('stock'), 'không lộ tồn kho');
  assert.equal((await call('/portal/catalog?v=' + cat.version, k.cookie)).data.unchanged, true);
  // Chỉ thương hiệu Minh Long / Minh Long I / Minh Long - LYS / LYS / Lock&Lock; thương hiệu khác bị chặn cả khi gọi thẳng API.
  assert.deepEqual(cat.products.map((p: any[]) => p[0]).sort(), ['LL-01', 'LYS-01', 'ML-01', 'NOPRICE']);
  assert.equal((await call('/portal/quotes', k.cookie, 'POST', { items: [{ sku: 'HC-01', qty: 1 }] })).status, 400, 'thương hiệu bị chặn');
  assert.equal((await call('/portal/stock-requests', k.cookie, 'POST', { items: [{ sku: 'HC-01', qty: 1 }] })).status, 400, 'không hỏi tồn thương hiệu bị chặn');

  // Khoá tài khoản: phiên bị huỷ.
  assert.equal((await call('/customer-accounts/' + k.memberId, emp, 'PUT', { active: false })).status, 200);
  assert.equal((await call('/portal/me', k.cookie)).status, 401);
});

test('khách tạo báo giá → nhân viên phụ trách duyệt → khách xác nhận đặt hàng → nhân viên xác nhận đơn; đặt hàng thẳng; khách khác không thấy', async () => {
  const s = await setup(), { call, emp, mgr } = s;
  const k = await customerLogin(s, mgr, { customerId: '1001', name: 'Chị Lan', email: 'lan@hl.vn', ownerId: 'emp', discounts: { minhLong: 10 } });
  const other = await customerLogin(s, mgr, { customerId: '1002', name: 'Anh B', email: 'b@khac.vn' });

  assert.equal((await call('/portal/quotes', k.cookie, 'POST', { items: [{ sku: 'NOPRICE', qty: 1 }] })).status, 400, 'chưa có giá');
  assert.equal((await call('/portal/quotes', k.cookie, 'POST', { items: [] })).status, 400);
  const q = await call('/portal/quotes', k.cookie, 'POST', { items: [{ sku: 'ML-01', qty: 2 }, { sku: 'LL-01', qty: 3 }], note: 'Giao trước Tết' });
  assert.equal(q.status, 201, JSON.stringify(q.data)); assert.match(q.data.quoteNo, /^B2B_BG\d{8}_001$/); assert.equal(q.data.orderId, null);
  let d = (await call('/portal/quotes/' + q.data.id, k.cookie)).data;
  assert.equal(d.approvalStatus, 'pending');
  assert.deepEqual(d.data.rows.map((r: any) => [r.sku, r.price, r.discount, r.taxRate]), [['ML-01', 1_000_000, 10, 8], ['LL-01', 200_000, 0, 10]]);
  assert.equal(d.totals.subtotal, 2 * 900_000 + 3 * 200_000);
  assert.equal(d.data.customerId, '1001'); assert.match(d.data.notes, /Giao trước Tết/);
  // Chưa duyệt thì chưa đặt hàng được; khách khác không thấy.
  assert.equal((await call('/portal/quotes/' + q.data.id + '/order', k.cookie, 'POST', {})).data.code, 'QUOTE_NOT_APPROVED');
  assert.equal((await call('/portal/quotes/' + q.data.id, other.cookie)).status, 404);
  assert.equal((await call('/portal/quotes', other.cookie)).data.quotes.length, 0);

  // Nhân viên phụ trách thấy báo giá khách gửi và tự xác nhận (duyệt) được.
  const staffQ = (await call('/quotes', emp)).data.quotes.find((x: any) => x.id === q.data.id);
  assert.equal(staffQ.fromCustomer, true); assert.equal(staffQ.approvalStatus, 'pending');
  assert.equal((await call('/quotes/' + q.data.id, emp)).data.canApprove, true);
  assert.equal((await call('/quotes/' + q.data.id + '/approve', emp, 'POST', { revision: 1 })).status, 200);
  // Khách xác nhận đặt hàng → đơn "Chờ xác nhận"; nhân viên xác nhận đơn.
  assert.equal((await call('/portal/quotes/' + q.data.id + '/order', k.cookie, 'POST', { note: 'OK' })).data.code, 'CONFIRM_REQUIRED', 'khách phải xác thực thông tin trước khi gửi đơn');
  assert.equal((await call('/portal/quotes', k.cookie, 'POST', { items: [{ sku: 'LL-01', qty: 1 }], order: true })).data.code, 'CONFIRM_REQUIRED');
  const o = await call('/portal/quotes/' + q.data.id + '/order', k.cookie, 'POST', { note: 'OK', confirmed: true, deliveryDate: '2026-10-20' });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  assert.equal((await call('/orders/' + o.data.orderId, emp)).data.order.expectedDeliveryDate, '2026-10-20', 'ngày giao khách chọn khi gửi đơn');
  assert.equal((await call('/portal/quotes/' + q.data.id + '/order', k.cookie, 'POST', { confirmed: true })).data.code, 'ORDER_EXISTS');
  let orders = (await call('/portal/orders', k.cookie)).data.orders;
  assert.deepEqual([orders.length, orders[0].status, orders[0].total, orders[0].lines.length], [1, 'draft', 2_400_000 + 144_000 + 60_000, 2]);
  assert.ok(!JSON.stringify(orders).includes('costPrice'));
  // Công nợ chỉ tính khi đơn đã được xác nhận (đơn nháp chưa phát sinh công nợ, cả trang khách lẫn trang nhân viên).
  assert.deepEqual([orders[0].receivable, orders[0].schedules], [null, []]);
  assert.equal((await call('/receivables', emp)).data.receivables.length, 0);
  assert.equal((await call('/orders/' + o.data.orderId, emp)).data.order.status, 'draft');
  assert.equal((await call('/orders/' + o.data.orderId + '/status', emp, 'PUT', { status: 'confirmed', verified: true })).status, 403, 'chỉ Manager duyệt đơn');
  assert.equal((await call('/orders/' + o.data.orderId + '/status', mgr, 'PUT', { status: 'confirmed' })).data.code, 'VERIFY_REQUIRED', 'phải xác thực trước khi duyệt');
  assert.equal((await call('/orders/' + o.data.orderId + '/status', mgr, 'PUT', { status: 'confirmed', verified: true })).status, 200);
  // Chỉ Manager đổi ngày giao dự kiến của đơn đã duyệt; nhân viên lên lịch chuyến giao không ghi đè ngày trên đơn.
  assert.equal((await call('/orders/' + o.data.orderId + '/delivery-date', emp, 'PUT', { date: 'x' })).status, 400);
  assert.equal((await call('/orders/' + o.data.orderId + '/delivery-date', emp, 'PUT', { date: '2026-10-25' })).status, 403, 'đơn đã duyệt chỉ Manager được đổi ngày giao');
  assert.equal((await call('/orders/' + o.data.orderId + '/delivery-date', mgr, 'PUT', { date: '2026-10-25' })).status, 200);
  assert.equal((await call('/portal/orders', k.cookie)).data.orders[0].expectedDeliveryDate, '2026-10-25');
  assert.equal((await call('/notifications', k.cookie)).data.notifications[0].eventType, 'order_delivery_date');
  assert.equal((await call('/deliveries', emp, 'POST', { orderId: o.data.orderId, plannedDate: '2026-10-27' })).status, 201);
  assert.equal((await call('/portal/orders', k.cookie)).data.orders[0].expectedDeliveryDate, '2026-10-25', 'nhân viên lên lịch chuyến không sửa ngày trên đơn đã duyệt');
  // Đã xác nhận: kỳ phải trả + lịch sử thanh toán.
  orders = (await call('/portal/orders', k.cookie)).data.orders;
  assert.deepEqual(orders[0].schedules.map((x: any) => [x.kind, x.amount, x.dueDate]), [['balance', 2_604_000, null]]);
  assert.deepEqual([orders[0].payments, orders[0].receivable.due], [[], 2_604_000]);
  assert.equal((await call('/receivables', emp)).data.receivables.length, 1);
  assert.equal((await call('/portal/orders/' + o.data.orderId + '/cancel', k.cookie, 'POST', {})).status, 409, 'đã xác nhận thì khách không huỷ');
  assert.equal((await call('/payments', emp, 'POST', { orderId: o.data.orderId, amount: 1_000_000, paidAt: '2026-10-06', method: 'transfer' })).status, 201);
  const paid = (await call('/portal/orders', k.cookie)).data.orders.find((x: any) => x.id === o.data.orderId);
  assert.deepEqual([paid.receivable.paid, paid.receivable.balance, paid.payments[0].amount, paid.payments[0].method], [1_000_000, 1_604_000, 1_000_000, 'transfer']);
  assert.equal((await call('/orders/' + o.data.orderId + '/status', mgr, 'PUT', { status: 'confirmed', verified: true })).status, 409);

  // Đặt hàng thẳng từ danh mục: báo giá chờ + đơn chờ xác nhận; nhân viên xác nhận đơn = duyệt luôn báo giá.
  const direct = await call('/portal/quotes', k.cookie, 'POST', { items: [{ sku: 'LL-01', qty: 1 }], order: true, confirmed: true });
  assert.equal(direct.status, 201); assert.ok(direct.data.orderId); assert.match(direct.data.quoteNo, /_002$/);
  orders = (await call('/portal/orders', k.cookie)).data.orders;
  assert.equal(orders.find((x: any) => x.id === direct.data.orderId).status, 'draft');
  assert.equal((await call('/orders/' + direct.data.orderId + '/status', mgr, 'PUT', { status: 'confirmed', verified: true })).status, 200);
  assert.equal((await call('/quotes/' + direct.data.id, emp)).data.approvalStatus, 'approved');
  // Khách huỷ đơn chưa xác nhận.
  const third = await call('/portal/quotes', k.cookie, 'POST', { items: [{ sku: 'ML-01', qty: 1 }], order: true, confirmed: true });
  assert.equal((await call('/portal/orders/' + third.data.orderId + '/cancel', other.cookie, 'POST', {})).status, 409, 'khách khác không huỷ được');
  assert.equal((await call('/portal/orders/' + third.data.orderId + '/cancel', k.cookie, 'POST', {})).status, 200);

  // Báo giá nhân viên lập cho khách: khách chỉ thấy khi đã duyệt; không thấy giá nhập.
  const sq = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: 'B2B_X', customer: 'Công ty Hoàng Long', customerId: '1001', vat: 8, rows: [{ name: 'Ly', qty: 1, price: 100, costPrice: 60, purchaseDiscount: 40 }] });
  assert.ok(!(await call('/portal/quotes', k.cookie)).data.quotes.some((x: any) => x.id === sq.data.id), 'chưa duyệt: khách chưa thấy');
  await call('/quotes/' + sq.data.id + '/approve', mgr, 'POST', { revision: 1 });
  d = (await call('/portal/quotes/' + sq.data.id, k.cookie)).data;
  assert.equal(d.mine, false); assert.equal(d.data.rows[0].costPrice, undefined); assert.equal(d.data.rows[0].purchaseDiscount, undefined);
  // Nhân viên không phụ trách báo giá thường thì không duyệt được (chỉ Manager).
  const own = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: 'B2B_Y', customer: 'A', vat: 8, rows: [{ name: 'Ly', qty: 1, price: 1 }] });
  assert.equal((await call('/quotes/' + own.data.id + '/approve', emp, 'POST', { revision: 1 })).status, 403);
});
