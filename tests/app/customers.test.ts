import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { purchaseHistory } from '../../src/modules/customer-hub/domain/overview.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  // new / old trong bộ mẫu chưa đặt mật khẩu: dùng chung mật khẩu của emp để đăng nhập.
  await d1.sqlite.prepare("UPDATE staff_credentials SET password_hash = (SELECT password_hash FROM staff_credentials WHERE member_id = 'emp'), activation_hash = NULL WHERE member_id IN ('new', 'old')").run();
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => (await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const }))
    .headers.get('set-cookie')!.split(';')[0]!;
  return { call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), other: await login('new@x.vn'), old: await login('old@x.vn') };
}

test('lịch sử mua hàng: gộp theo mã, số đơn, lần mua gần nhất', () => {
  const rows = purchaseHistory([
    { sku: 'a1', name: 'Ly cũ', unit: 'cái', qty: 2, unitPrice: 100, amount: 200, orderId: 'o1', orderDate: '2026-01-01' },
    { sku: 'A1', name: 'Ly', unit: 'cái', qty: 3, unitPrice: 90, amount: 270, orderId: 'o2', orderDate: '2026-03-01' },
    { sku: '', name: 'Hộp quà', unit: 'hộp', qty: 1, unitPrice: 50, amount: 50, orderId: 'o1', orderDate: '2026-01-01' },
  ]);
  assert.deepEqual(rows.map(r => [r.name, r.qty, r.amount, r.orders, r.lastDate, r.lastPrice]), [['Ly', 5, 470, 2, '2026-03-01', 90], ['Hộp quà', 1, 50, 1, '2026-01-01', 50]]);
});

test('khách hàng: thêm mới (người tạo phụ trách), người liên hệ, phụ trách / chia sẻ, trang chi tiết đúng quyền', async () => {
  const { call, emp, mgr, other, old } = await setup();
  // Thêm khách: nhân viên tạo → mình phụ trách; Manager chọn được người phụ trách.
  const k = await call('/customers', emp, 'POST', { name: 'Công ty Hoàng Long', phone: '0901', taxCode: '0101234567' });
  assert.equal(k.status, 201);
  const k2 = await call('/customers', mgr, 'POST', { name: 'Công ty An Phát', ownerId: 'new' });
  let p = (await call(`/customers/${k.data.id}`, emp)).data;
  assert.equal(p.owner.id, 'emp'); assert.deepEqual(p.shared, []); assert.equal(p.customer.fromSapo, false);
  assert.deepEqual([p.access.canSeeAll, p.access.canManageStaff, p.access.canChangeOwner], [true, true, false]);
  assert.equal((await call(`/customers/${k2.data.id}`, mgr)).data.owner.id, 'new');
  // Danh sách: kèm người phụ trách; ?mine=1 gồm khách của mình và cùng phòng ban.
  const list = (await call('/customers', emp)).data.customers;
  assert.equal(list.find((x: any) => x.id === k.data.id).owner.name, 'Tên emp');
  assert.deepEqual((await call('/customers?mine=1', emp)).data.customers.map((x: any) => x.id).sort(), [k.data.id, k2.data.id].sort());
  assert.equal((await call('/customers/nope', emp)).status, 404);
  // Khách mới tạo lên trên cùng (không theo ABC).
  await new Promise(r => setTimeout(r, 5));
  const k3 = await call('/customers', mgr, 'POST', { name: 'Công ty Xuân Mai' });
  assert.deepEqual((await call('/customers', mgr)).data.customers.slice(0, 2).map((x: any) => x.id), [k3.data.id, k2.data.id]);

  // Người liên hệ: thêm / sửa / xoá; một người liên hệ chính.
  assert.equal((await call(`/customers/${k.data.id}/contacts`, emp, 'POST', { name: '' })).status, 400);
  assert.equal((await call(`/customers/${k.data.id}/contacts`, emp, 'POST', { name: 'Chị Lan', email: 'sai' })).status, 400);
  const c1 = await call(`/customers/${k.data.id}/contacts`, emp, 'POST', { name: 'Chị Lan', title: 'Kế toán', phone: '0902', isPrimary: true });
  const c2 = await call(`/customers/${k.data.id}/contacts`, emp, 'POST', { name: 'Anh Minh', title: 'Mua hàng', email: 'minh@hl.vn' });
  assert.equal((await call(`/customers/${k.data.id}/contacts/${c2.data.id}`, emp, 'PUT', { name: 'Anh Minh', title: 'Trưởng phòng mua hàng', isPrimary: true })).status, 200);
  p = (await call(`/customers/${k.data.id}`, emp)).data;
  assert.deepEqual(p.contacts.map((x: any) => [x.name, x.title, x.isPrimary]), [['Anh Minh', 'Trưởng phòng mua hàng', true], ['Chị Lan', 'Kế toán', false]]);
  assert.equal((await call(`/customers/${k.data.id}/contacts/${c1.data.id}`, emp, 'DELETE')).status, 200);
  assert.equal((await call(`/customers/${k2.data.id}/contacts/${c2.data.id}`, emp, 'DELETE')).status, 403, 'không phụ trách k2 → không sửa được');
  assert.equal((await call(`/customers/${k2.data.id}/contacts/${c2.data.id}`, mgr, 'DELETE')).status, 404, 'không xoá chéo khách');

  // Phụ trách / chia sẻ: chỉ Manager đổi người phụ trách; người phụ trách chia sẻ được; người ngoài không.
  assert.equal((await call(`/customers/${k.data.id}/staff`, emp, 'PUT', { ownerId: 'old' })).status, 403);
  assert.equal((await call(`/customers/${k.data.id}/staff`, other, 'PUT', { sharedIds: ['new'] })).status, 403);
  assert.equal((await call(`/customers/${k.data.id}/staff`, emp, 'PUT', { sharedIds: ['ncc'] })).status, 400, 'NCC không được chia sẻ');
  assert.equal((await call(`/customers/${k.data.id}/staff`, emp, 'PUT', { sharedIds: ['old'] })).data.shared[0].id, 'old');

  // Báo giá → đơn của khách (do emp phụ trách).
  const doc = { type: 'B2B', quoteNo: 'B2B_BG20261007_001', customer: 'Công ty Hoàng Long', customerId: k.data.id, vat: 8,
    rows: [{ name: 'Bình giữ nhiệt', sku: 'LHC', unit: 'cái', qty: 10, price: 200000, taxRate: 8 }] };
  const q = await call('/quotes', emp, 'POST', doc);
  assert.equal((await call(`/customers/${k.data.id}/approve`, mgr, 'POST', {})).status, 200, 'khách nhân viên tạo: Manager duyệt mới lập đơn được');
  await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 1 });
  const o = await call('/orders', emp, 'POST', { quoteId: q.data.id }); assert.equal(o.status, 201);
  await call(`/orders/${o.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)

  // Trang chi tiết: người phụ trách thấy đủ; người được chia sẻ (old) thấy đơn và mở được đơn; đồng nghiệp cùng nhóm (new) thấy nghiệp vụ nhưng không có quyền chia sẻ khách.
  let ov = (await call(`/customers/${k.data.id}/overview`, emp)).data;
  assert.equal(ov.quotes.length, 1); assert.equal(ov.quotes[0].total, 2_160_000); assert.equal(ov.quotes[0].orderId, o.data.id);
  assert.equal(ov.orders.length, 1); assert.equal(ov.stats.orders, 1); assert.equal(ov.stats.revenue, 2_160_000); assert.equal(ov.stats.balance, 2_160_000);
  assert.deepEqual(ov.purchases.map((x: any) => [x.sku, x.qty, x.orders]), [['LHC', 10, 1]]);
  assert.equal((await call(`/customers/${k.data.id}/overview`, old)).data.orders.length, 1);
  assert.equal((await call(`/orders/${o.data.id}`, old)).status, 200, 'được chia sẻ khách → mở được đơn của khách');
  ov = (await call(`/customers/${k.data.id}/overview`, other)).data;
  assert.equal(ov.access.canSeeAll, false); assert.equal(ov.orders.length, 1); assert.equal(ov.quotes.length, 1);
  // Tài khoản trang khách (email đăng nhập) chỉ người phụ trách / được chia sẻ / Manager thấy.
  assert.equal((await call('/customer-accounts', emp, 'POST', { customerId: k.data.id, name: 'Chị Lan', email: 'lan@hoanglong.vn' })).status, 201);
  assert.deepEqual((await call(`/customers/${k.data.id}/overview`, emp)).data.accounts.map((a: any) => a.email), ['lan@hoanglong.vn']);
  // Thẻ "Tài khoản" có chiết khấu riêng (Manager sửa ngay tại trang chi tiết) và SĐT; tài khoản chỉ có SĐT không lộ email nội bộ.
  const lan = (await call(`/customers/${k.data.id}/overview`, emp)).data.accounts[0];
  assert.deepEqual(lan.discounts, {});
  assert.equal((await call(`/customer-accounts/${lan.memberId}`, mgr, 'PUT', { discounts: { minhLong: 12, lock: 5 } })).status, 200);
  assert.equal((await call('/customer-accounts', emp, 'POST', { customerId: k.data.id, name: 'Anh Tú', phone: '0987654321' })).status, 201);
  const accs = (await call(`/customers/${k.data.id}/overview`, emp)).data.accounts;
  assert.deepEqual(accs.find((a: any) => a.memberId === lan.memberId).discounts, { minhLong: 12, lock: 5 });
  assert.deepEqual(accs.filter((a: any) => a.name === 'Anh Tú').map((a: any) => [a.email, a.phone]), [['', '0987654321']]);
  assert.deepEqual((await call(`/customers/${k.data.id}/overview`, other)).data.accounts, [], 'người không phụ trách không thấy tài khoản khách');
  assert.equal((await call('/customers/%E0/overview', emp)).status, 400, 'URL hỏng → 400, không phải 500');
  assert.equal((await call(`/orders/${o.data.id}`, other)).status, 200, 'đồng nghiệp cùng nhóm xem được chứng từ');

  // Manager đổi người phụ trách sang old: old không còn trong danh sách chia sẻ; bỏ trống người phụ trách được.
  p = (await call(`/customers/${k.data.id}/staff`, mgr, 'PUT', { ownerId: 'old' })).data;
  assert.equal(p.owner.id, 'old'); assert.deepEqual(p.shared, []);
  assert.equal((await call(`/customers/${k.data.id}/staff`, mgr, 'PUT', { ownerId: null })).data.owner, null);
  assert.equal((await call(`/customers/${k.data.id}/staff`, mgr, 'PUT', { ownerId: 'off' })).status, 400, 'nhân viên đã nghỉ');

  // Khách chưa có người phụ trách: đơn đầu tiên gán người phụ trách đơn làm người phụ trách khách.
  const q2 = await call('/quotes', emp, 'POST', { ...doc, quoteNo: 'B2B_BG20261007_002' });
  await call(`/quotes/${q2.data.id}/approve`, mgr, 'POST', { revision: 1 });
  assert.equal((await call('/orders', emp, 'POST', { quoteId: q2.data.id })).status, 201);
  assert.equal((await call(`/customers/${k.data.id}`, mgr)).data.owner.id, 'emp');
});


test('điều khoản riêng của khách: % cọc, hạn thanh toán, giới hạn công nợ – lưu, sửa, xoá về mặc định, chặn giá trị sai', async () => {
  const { call, mgr } = await setup();
  const c = await call('/customers', mgr, 'POST', { name: 'Khách điều khoản', depositRate: '50', paymentTerm: '7', creditLimit: '20.000.000' });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  let got = (await call('/customers/' + c.data.id, mgr)).data.customer;
  assert.deepEqual([got.depositRate, got.paymentTerm, got.creditLimit], [50, '7', 20000000]);
  assert.equal((await call('/customers/' + c.data.id, mgr, 'PUT', { name: 'Khách điều khoản', depositRate: '', paymentTerm: 'Thanh toán trước khi giao hàng', creditLimit: '' })).status, 200);
  got = (await call('/customers/' + c.data.id, mgr)).data.customer;
  assert.deepEqual([got.depositRate, got.paymentTerm, got.creditLimit], [null, 'Thanh toán trước khi giao hàng', null], 'để trống = dùng mặc định');
  for (const bad of [{ depositRate: '101' }, { depositRate: '-1' }, { paymentTerm: '4000' }, { creditLimit: 'abc' }])
    assert.equal((await call('/customers/' + c.data.id, mgr, 'PUT', { name: 'Khách điều khoản', ...bad })).status, 400, JSON.stringify(bad));
  // Form cũ không gửi các trường này: giữ nguyên giá trị đã lưu.
  await call('/customers/' + c.data.id, mgr, 'PUT', { name: 'Khách điều khoản', depositRate: '40' });
  assert.equal((await call('/customers/' + c.data.id, mgr, 'PUT', { name: 'Khách điều khoản 2' })).status, 200);
  got = (await call('/customers/' + c.data.id, mgr)).data.customer;
  assert.deepEqual([got.name, got.depositRate], ['Khách điều khoản 2', 40]);
});
