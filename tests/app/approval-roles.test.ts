import {submitFixtureOrder} from '../helpers/submission-review-fixture.ts';
import { customerCreateFixture } from '../helpers/customer-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { quotations, quoteLines } from '../../src/modules/quotes/schema.ts';
import { products, pricePolicies } from '../../src/modules/catalog/schema.ts';
import { customerStockRequests } from '../../src/modules/portal/schema.ts';

/**
 * PHÊ DUYỆT CHỈ DO MANAGER HOẶC NGƯỜI ĐƯỢC MANAGER CHỈ ĐỊNH (cờ "Được duyệt", docs/PHAN-QUYEN.md) –
 * báo giá, khách hàng mới, sản phẩm mới, đơn hàng / HĐKT, đơn mua NCC, hộp "Cần duyệt".
 * Sale Admin: không duyệt (trừ khi được bật cờ); xem toàn công ty ở báo giá, khách hàng, đơn hàng, HĐKT và toàn bộ NCC.
 */
const origin = 'https://trial.test', now = '2026-10-01T00:00:00.000Z';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await db.insert(pricePolicies).values([{id:'retail',name:'Giá bán lẻ'},{id:'retail-vat',name:'Giá lẻ +VAT'}]);
  const pw = await hashPassword(PASSWORD, 1000);
  // sadmin: Sale Admin · duyet: Sale được Manager chỉ định duyệt · emp2: Sale thường (người tạo dữ liệu thứ hai).
  for (const [id, pos] of [['sadmin', 'sale-admin'], ['duyet', 'sale'], ['emp2', 'sale']] as const) {
    await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES (?,?,?,'0900','employee',?,1,'2026-01-01T00:00:00.000Z')").run(id, id + '@x.vn', 'Tên ' + id, pos);
    await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run(id, pw);
  }
  await db.insert(customers).values({ id: 'K1', name: 'Công ty An Phú', contact: 'Anh Phú', phone: '0902', email: '', address: 'Cần Thơ', search: '', taxCode: '0309', customerCode: 'AP01', sourceVersion: 0, syncedAt: '' });
  await db.insert(products).values([{ sku: 'LY1', name: 'Ly sứ', unit: 'cái', updatedAt: now }]);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const } as never);
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => {
    const res = await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), { db, passwordIterations: 1000 } as never);
    return res.headers.get('set-cookie')?.split(';')[0] ?? '';
  };
  const s = { db, call, mgr: await login('mgr@x.vn'), emp: await login('emp@x.vn'), sadmin: await login('sadmin@x.vn'), duyet: await login('duyet@x.vn'), emp2: await login('emp2@x.vn') };
  const rows = [{ name: 'Bộ trà', sku: 'LY1', qty: 10, price: 100000 }];
  let n = 0;
  /** Báo giá của `who`, đã gửi duyệt (pending). */
  const pendingQuote = async (who = s.emp) => {
    const q = await call('/quotes', who, 'POST', { type: 'HRC', quoteNo: 'HRC_A' + (++n), customer: 'Công ty An Phú', customerId: 'K1', vat: 8, shipping:{payer:'receiver'}, rows });
    assert.equal(q.status, 201, JSON.stringify(q.data));
    assert.equal((await call(`/quotes/${q.data.id}/submit`, who, 'POST', { revision: 1 })).status, 200);
    return q.data.id as string;
  };
  /** Đơn hàng nháp của nhân viên, đã gửi duyệt. */
  const pendingOrder = async () => {
    const qid = await pendingQuote();
    const q=(await call(`/quotes/${qid}`,s.mgr)).data;
    q.data.rows=q.data.rows.map((row:any)=>({...row,costPrice:50000,costMode:'manual'}));
    assert.equal((await call(`/quotes/${qid}`,s.mgr,'PUT',{revision:q.revision,data:q.data})).status,200);
    await call(`/quotes/${qid}/approve`, s.mgr, 'POST', { revision: 2 });
    const o = await call('/orders', s.emp, 'POST', { quoteId: qid }); assert.equal(o.status, 201, JSON.stringify(o.data));
    assert.equal((await submitFixtureOrder(call,o.data.id,s.emp)).status, 200);
    return o.data.id as string;
  };
  const pendingCustomer = async (name: string) => { const r = await call('/customers', s.emp, 'POST', customerCreateFixture({ name })); assert.equal(r.status, 201); return r.data.id as string; };
  const pendingProduct = async (sku: string) => { assert.equal((await call('/products', s.emp, 'POST', { sku, name: 'SP ' + sku, unit: 'cái', prices: {retail:100000,'retail-vat':108000} })).status, 201); return sku; };
  /** Đơn mua NCC chờ duyệt (Manager lập từ báo giá nguồn). */
  const pendingPurchase = async () => {
    const sup = (await call('/suppliers', s.mgr, 'POST', { name: 'NCC ' + (++n), contacts: [{ kind: 'order', email: `ncc${n}@ncc.vn` }] })).data.supplier.id;
    const qid = 'src' + n;
    await db.insert(quotations).values({ id: qid, creatorId: 'emp', quoteNo: 'B2B_' + qid, quoteType: 'B2B', customer: 'Khách', quoteDate: '2026-09-10', data: '{"rows":[]}', createdAt: now, updatedAt: now });
    await db.insert(quoteLines).values([{ id: 'ql' + qid, quoteId: qid, lineNo: 1, sku: 'LY1', name: 'Ly sứ', unit: 'cái', qty: 5 }]);
    const r = await call('/purchase-orders', s.mgr, 'POST', { orders: [{ supplierId: sup, warehouse: 'Kho', lines: [{ sku: 'LY1', quantity: 5, sources: [{ type: 'quote', id: qid, quantity: 5 }] }] }] });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const id = r.data.ids[0] as string, v = (await call(`/purchase-orders/${id}`, s.mgr)).data;
    return { id, body: { revision: v.revision, lines: [{ lineId: v.lines[0].id, price: 1000 }] } };
  };
  return { ...s, pendingQuote, pendingOrder, pendingCustomer, pendingProduct, pendingPurchase };
}

test('Manager duyệt được mọi loại; nhân viên thường và Sale Admin (chưa được chỉ định) không duyệt được loại nào', async () => {
  const s = await setup();
  for (const who of [s.emp, s.sadmin]) {
    assert.equal((await s.call(`/quotes/${await s.pendingQuote(s.emp2)}/approve`, who, 'POST', { revision: 1 })).status, 403, 'báo giá');
    assert.equal((await s.call(`/customers/${await s.pendingCustomer('Khách ' + who.slice(-6))}/approve`, who, 'POST', {})).status, 403, 'khách hàng mới');
    assert.equal((await s.call(`/products/${await s.pendingProduct('SP' + who.slice(-6))}/approve`, who, 'POST', {})).status, 403, 'sản phẩm mới');
    const oid = await s.pendingOrder();
    assert.equal((await s.call(`/orders/${oid}/status`, who, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true })).status, 403, 'đơn hàng / HĐKT');
    const p = await s.pendingPurchase();
    // Sale Admin sees the supplier order, but approval remains a separate permission.
    const view = await s.call(`/purchase-orders/${p.id}`, who);
    assert.equal(view.status, who === s.sadmin ? 200 : 403, 'quyền xem mua hàng theo chức vụ');
    if (who === s.sadmin) assert.ok(!view.data.actions.includes('approve'), 'xem đơn không cấp quyền duyệt');
    assert.equal((await s.call(`/purchase-orders/${p.id}/approve`, who, 'POST', p.body)).status, 403, 'đơn mua NCC');
    const unchanged = await s.call(`/purchase-orders/${p.id}`, s.mgr);
    assert.equal(unchanged.data.revision, p.body.revision, 'từ chối duyệt không sửa đơn');
    assert.ok(unchanged.data.actions.includes('approve'), 'đơn vẫn chờ Manager duyệt');
    assert.equal((await s.call('/approvals', who)).status, 403, 'hộp Cần duyệt');
    assert.equal((await s.call('/me', who)).data.user.approver, false);
  }
  // Manager duyệt được tất cả.
  assert.equal((await s.call(`/quotes/${await s.pendingQuote()}/approve`, s.mgr, 'POST', { revision: 1 })).status, 200);
  assert.equal((await s.call(`/customers/${await s.pendingCustomer('Khách M')}/approve`, s.mgr, 'POST', {})).status, 200);
  assert.equal((await s.call(`/products/${await s.pendingProduct('SPM')}/approve`, s.mgr, 'POST', {})).status, 200);
  assert.equal((await s.call(`/orders/${await s.pendingOrder()}/status`, s.mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true })).status, 200);
  const p = await s.pendingPurchase();
  assert.equal((await s.call(`/purchase-orders/${p.id}/approve`, s.mgr, 'POST', p.body)).status, 200);
  assert.equal((await s.call('/approvals', s.mgr)).status, 200);
  assert.equal((await s.call('/me', s.mgr)).data.user.approver, true);
});

test('cờ "Được duyệt": chỉ Manager bật / tắt; người được chỉ định duyệt được mọi loại, tắt cờ là mất quyền ngay', async () => {
  const s = await setup();
  // Không ai ngoài Manager bật được cờ (kể cả tự bật, kể cả Sale Admin).
  assert.equal((await s.call('/admin/members/duyet/approver', s.emp, 'PUT', { approver: true })).status, 403);
  assert.equal((await s.call('/admin/members/sadmin/approver', s.sadmin, 'PUT', { approver: true })).status, 403);
  assert.equal((await s.call('/admin/members/duyet/approver', s.mgr, 'PUT', { approver: 'yes' })).status, 400);
  assert.equal((await s.call('/admin/members/mgr/approver', s.mgr, 'PUT', { approver: false })).status, 404, 'Manager luôn được duyệt');
  assert.equal((await s.call('/admin/members/duyet/approver', s.mgr, 'PUT', { approver: true })).status, 200);
  assert.equal((await s.call('/me', s.duyet)).data.user.approver, true);
  assert.ok((await s.call('/admin/members', s.mgr)).data.members.find((m: any) => m.id === 'duyet').approver);
  // Người được chỉ định: mở được báo giá / đơn đang chờ duyệt của người khác và duyệt được mọi loại.
  const qid = await s.pendingQuote();
  assert.equal((await s.call(`/quotes/${qid}`, s.duyet)).data.canApprove, true);
  assert.equal((await s.call(`/quotes/${qid}/approve`, s.duyet, 'POST', { revision: 1 })).status, 200);
  assert.equal((await s.call(`/customers/${await s.pendingCustomer('Khách D')}/approve`, s.duyet, 'POST', {})).status, 200);
  assert.equal((await s.call(`/products/${await s.pendingProduct('SPD')}/approve`, s.duyet, 'POST', {})).status, 200);
  const oid = await s.pendingOrder();
  assert.equal((await s.call(`/orders/${oid}`, s.duyet)).status, 200, 'mở được đơn chờ duyệt để kiểm tra');
  assert.equal((await s.call(`/orders/${oid}/status`, s.duyet, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true })).status, 200);
  const p = await s.pendingPurchase();
  assert.equal((await s.call(`/purchase-orders/${p.id}`, s.duyet)).status,403, 'cờ duyệt không vượt trần chức vụ mua');
  assert.equal((await s.call(`/purchase-orders/${p.id}/approve`, s.duyet, 'POST', p.body)).status, 403);
  assert.equal((await s.call('/approvals', s.duyet)).status, 200);
  // Sale Admin được Manager bật cờ thì cũng duyệt được.
  await s.call('/admin/members/sadmin/approver', s.mgr, 'PUT', { approver: true });
  assert.equal((await s.call(`/quotes/${await s.pendingQuote()}/approve`, s.sadmin, 'POST', { revision: 1 })).status, 200);
  // Tắt cờ → mất quyền ngay ở yêu cầu kế tiếp; nhật ký phân quyền ghi lại.
  assert.equal((await s.call('/admin/members/duyet/approver', s.mgr, 'PUT', { approver: false })).status, 200);
  assert.equal((await s.call(`/quotes/${await s.pendingQuote()}/approve`, s.duyet, 'POST', { revision: 1 })).status, 403);
  const log = (await s.call('/permissions', s.mgr)).data.log.map((x: any) => `${x.action}: ${x.detail}`);
  assert.ok(log.includes('Cấp quyền duyệt: Tên duyet') && log.includes('Thu quyền duyệt: Tên duyet') && log.includes('Cấp quyền duyệt: Tên sadmin'));
});

test('báo giá khách gửi: nhân viên phụ trách không tự xác nhận; người được chỉ định / Manager xác nhận', async () => {
  const s = await setup();
  const qid = await s.pendingQuote();
  // Giả lập báo giá khách gửi: người phụ trách là emp (đúng như trang khách hàng gán).
  const { sql } = await import('drizzle-orm');
  await s.db.execute(sql`UPDATE staff_quotations SET assignee_id = 'emp' WHERE id = ${qid}`);
  assert.equal((await s.call(`/quotes/${qid}/approve`, s.emp, 'POST', { revision: 1 })).status, 403);
  assert.equal((await s.call(`/quotes/${qid}`, s.emp)).data.canApprove, false);
});

test('Sale Admin: có quyền của Sale + Kế toán + Kho; xem toàn công ty CHỈ ở báo giá, khách hàng, đơn hàng, HĐKT', async () => {
  const s = await setup();
  const perms = (await s.call('/me', s.sadmin)).data.user.perms as string[];
  for (const k of ['page.quotes', 'page.orders', 'page.contracts', 'page.customers', 'purchases.prices', 'purchases.pay', 'suppliers.edit', 'page.packing', 'page.stock-lookup', 'purchases.receive'])
    assert.ok(perms.includes(k), 'Sale Admin có ' + k);
  assert.ok(!perms.includes('perm.manage'), 'không quản lý phân quyền');
  // Dữ liệu của emp2 (Sale khác) – Sale Admin xem được.
  const q = await s.call('/quotes', s.emp2, 'POST', { type: 'HRC', quoteNo: 'HRC_X1', customer: 'Công ty An Phú', customerId: 'K1', vat: 8, rows: [{ name: 'Ly', qty: 1, price: 1 }] });
  assert.equal((await s.call('/quotes?limit=50', s.sadmin)).data.quotes.some((x: any) => x.id === q.data.id), true, 'báo giá toàn công ty');
  assert.equal((await s.call(`/quotes/${q.data.id}`, s.sadmin)).status, 200);
  assert.equal((await s.call('/quotes?limit=50', s.emp)).data.quotes.some((x: any) => x.id === q.data.id), true, 'Sale cùng chức vụ cũng thấy (phạm vi Cùng chức vụ)');
  const c = await s.call('/customers', s.emp2, 'POST', customerCreateFixture({ name: 'Khách của emp2', phone: '0911222333' }));
  assert.equal((await s.call(`/customers/${c.data.id}`, s.sadmin)).status, 200, 'khách hàng');
  await s.call(`/quotes/${q.data.id}/submit`, s.emp2, 'POST', { revision: 1 });
  await s.call(`/quotes/${q.data.id}/approve`, s.mgr, 'POST', { revision: 1 });
  const o = await s.call('/orders', s.emp2, 'POST', { quoteId: q.data.id }); assert.equal(o.status, 201, JSON.stringify(o.data));
  assert.equal((await s.call(`/orders/${o.data.id}`, s.sadmin)).status, 200, 'đơn hàng');
  assert.equal((await s.call('/orders?flow=order&limit=50', s.sadmin)).data.orders.some((x: any) => x.id === o.data.id), true);
  const q2 = await s.call('/quotes', s.emp2, 'POST', { type: 'HRC', quoteNo: 'HRC_X2', customer: 'Công ty An Phú', customerId: 'K1', vat: 8, rows: [{ name: 'Ly', qty: 1, price: 1 }] });
  await s.call(`/quotes/${q2.data.id}/submit`, s.emp2, 'POST', { revision: 1 }); await s.call(`/quotes/${q2.data.id}/approve`, s.mgr, 'POST', { revision: 1 });
  const k = await s.call('/contracts', s.emp2, 'POST', { quoteId: q2.data.id, legalEntity: 'BN', depositRate: 30, paymentDays: 15 }); assert.equal(k.status, 201, JSON.stringify(k.data));
  assert.equal((await s.call(`/orders/${k.data.orderId}`, s.sadmin)).status, 200, 'HĐKT');
  assert.equal((await s.call('/contracts?limit=50', s.sadmin)).data.contracts.some((x: any) => x.orderId === k.data.orderId || x.id === k.data.id), true);
  // Sale Admin KHÔNG sửa được báo giá của người khác (quyền sửa chưa chốt – giữ như cũ).
  assert.notEqual((await s.call(`/quotes/${q.data.id}`, s.sadmin, 'PUT', { revision: 99, data: {} })).status, 200);

  // Mục KHÔNG nằm trong danh sách: khách hỏi tồn, chăm sóc khách, doanh số → không toàn công ty.
  // Khách hỏi tồn (khách gửi từ trang khách hàng, phụ trách emp2) – ghi thẳng dòng như trang khách hàng tạo.
  await s.db.insert(customerStockRequests).values({ id: 'SR1', memberId: 'emp2', customerId: c.data.id, ownerId: 'emp2', items: '[{"sku":"LY1","name":"Ly","unit":"cái","qty":2}]', createdAt: now });
  assert.equal((await s.call('/stock-requests?status=all', s.emp2)).data.requests.some((x: any) => x.id === 'SR1'), true, 'người phụ trách thấy');
  assert.equal((await s.call('/stock-requests?status=all', s.sadmin)).data.requests.some((x: any) => x.id === 'SR1'), false, 'khách hỏi tồn của người khác: không');
  assert.equal((await s.call('/stock-requests?status=all', s.mgr)).data.requests.some((x: any) => x.id === 'SR1'), true);
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const care = await s.call('/care', s.emp2, 'POST', { customerId: 'K1', contactName: 'Anh Phú', type: 'call', result: 'consulting', remindBefore: '1d', content: 'Gọi khách hỏi quà Tết', nextAt: today });
  assert.equal(care.status, 201, JSON.stringify(care.data));
  assert.equal(JSON.stringify((await s.call('/care', s.sadmin)).data).includes('Gọi khách hỏi quà Tết'), false, 'chăm sóc của người khác: không');
  assert.equal(JSON.stringify((await s.call('/care', s.mgr)).data).includes('Gọi khách hỏi quà Tết'), true);
  assert.equal((await s.call('/dashboard/revenue?owner=emp2', s.sadmin)).status, 403, 'doanh số chỉ của mình');
  assert.equal((await s.call('/dashboard/revenue', s.sadmin)).status, 200);
});
