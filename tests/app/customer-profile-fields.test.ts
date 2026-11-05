import { customerCreateFixture } from '../helpers/customer-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { mergeCustomers } from '../../src/modules/customer-hub/api/duplicates.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await d1.sqlite.prepare("UPDATE staff_credentials SET password_hash = (SELECT password_hash FROM staff_credentials WHERE member_id = 'emp'), activation_hash = NULL WHERE member_id IN ('new', 'old')").run();
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => (await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }),
    { db, passwordIterations: 1 })).headers.get('set-cookie')!.split(';')[0]!;
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), other: await login('new@x.vn') };
}

test('số ngày công nợ: số nguyên 0–3650, sửa được và xoá về trống', async () => {
  const { call, mgr } = await setup();
  const k = await call('/customers', mgr, 'POST', customerCreateFixture({ name: 'Công ty Ngày Nợ', paymentDays: 45 }));
  assert.equal(k.status, 201);
  assert.equal((await call(`/customers/${k.data.id}`, mgr)).data.customer.paymentDays, 45);
  for (const bad of [3651, -1, '1,5', 'abc']) assert.equal((await call(`/customers/${k.data.id}`, mgr, 'PUT', { name: 'Công ty Ngày Nợ', paymentDays: bad })).status, 400, `paymentDays=${bad}`);
  assert.equal((await call(`/customers/${k.data.id}`, mgr, 'PUT', { name: 'Công ty Ngày Nợ', paymentDays: 0 })).status, 200);
  assert.equal((await call(`/customers/${k.data.id}`, mgr)).data.customer.paymentDays, 0);
  assert.equal((await call(`/customers/${k.data.id}`, mgr, 'PUT', { name: 'Công ty Ngày Nợ', paymentDays: null })).status, 200);
  assert.equal((await call(`/customers/${k.data.id}`, mgr)).data.customer.paymentDays, null);
});

test('người đại diện: chọn trong danh bạ của chính khách; liên hệ của khách khác bị chặn; xoá liên hệ thì bỏ chọn', async () => {
  const { call, emp, mgr } = await setup();
  const a = await call('/customers', mgr, 'POST', customerCreateFixture({ name: 'Công ty Đại Diện', contacts: [{ name: 'Ông Một' }, { name: 'Bà Hai', isRepresentative: true }] }));
  const b = await call('/customers', mgr, 'POST', customerCreateFixture({ name: 'Công ty Khác', contacts: [{ name: 'Người khác' }] }));
  assert.equal((await call('/customers', mgr, 'POST', customerCreateFixture({ name: 'Hai đại diện', contacts: [{ name: 'X', isRepresentative: true }, { name: 'Y', isRepresentative: true }] }))).status, 400);
  let p = (await call(`/customers/${a.data.id}`, mgr)).data;
  const hai = p.contacts.find((c: any) => c.name === 'Bà Hai'), mot = p.contacts.find((c: any) => c.name === 'Ông Một');
  assert.equal(p.customer.representativeContactId, hai.id);
  const other = (await call(`/customers/${b.data.id}`, mgr)).data.contacts[0];
  assert.equal((await call(`/customers/${a.data.id}/representative`, mgr, 'PUT', { contactId: other.id })).status, 400);
  assert.equal((await call(`/customers/${a.data.id}/representative`, mgr, 'PUT', { contactId: 5 })).status, 400);
  assert.equal((await call(`/customers/${a.data.id}/representative`, mgr, 'PUT', { contactId: mot.id })).status, 200);
  assert.equal((await call(`/customers/${a.data.id}`, mgr)).data.customer.representativeContactId, mot.id);
  assert.equal((await call(`/customers/${a.data.id}/representative`, emp, 'PUT', { contactId: hai.id })).status, 403, 'chỉ người phụ trách hoặc Manager');
  assert.equal((await call(`/customers/${a.data.id}/representative`, mgr, 'PUT', { contactId: null })).status, 200);
  assert.equal((await call(`/customers/${a.data.id}`, mgr)).data.customer.representativeContactId, null);
  assert.equal((await call(`/customers/${a.data.id}/representative`, mgr, 'PUT', { contactId: mot.id })).status, 200);
  assert.equal((await call(`/customers/${a.data.id}/contacts/${mot.id}`, mgr, 'DELETE')).status, 200);
  assert.equal((await call(`/customers/${a.data.id}`, mgr)).data.customer.representativeContactId, null);
});

test('ghi chú công nợ cũ: chỉ người xem được toàn bộ khách đọc / sửa; không lộ ở danh sách; sửa đồng thời báo xung đột', async () => {
  const { call, emp, mgr, other } = await setup();
  const k = await call('/customers', emp, 'POST', customerCreateFixture({ name: 'Công ty Nợ Cũ', legacyDebtNote: 'Nợ cũ AppSheet 50 triệu' }));
  assert.equal(k.status, 201);
  let p = (await call(`/customers/${k.data.id}`, emp)).data;
  assert.equal(p.debtNote.text, 'Nợ cũ AppSheet 50 triệu'); assert.equal(p.debtNote.revision, 1);
  assert.equal((await call(`/customers/${k.data.id}`, mgr)).data.debtNote.text, 'Nợ cũ AppSheet 50 triệu');
  // Nhân viên không phụ trách / không được chia sẻ: không đọc, không sửa.
  assert.equal((await call(`/customers/${k.data.id}`, other)).data.debtNote, null);
  assert.equal((await call(`/customers/${k.data.id}/debt-note`, other)).status, 403);
  assert.equal((await call(`/customers/${k.data.id}/debt-note`, other, 'PUT', { text: 'x', revision: 1 })).status, 403);
  // Danh sách và trang tổng quan không mang ghi chú công nợ.
  const listed = JSON.stringify((await call('/customers', emp)).data);
  assert.ok(!listed.includes('Nợ cũ AppSheet') && !listed.includes('legacyDebtNote') && !listed.includes('debtNote'));
  assert.ok(!JSON.stringify((await call(`/customers/${k.data.id}/overview`, other)).data).includes('Nợ cũ AppSheet'));
  // Sửa theo phiên bản.
  const saved = await call(`/customers/${k.data.id}/debt-note`, emp, 'PUT', { text: 'Đã thu bớt, còn 20 triệu', revision: 1 });
  assert.equal(saved.status, 200); assert.equal(saved.data.revision, 2);
  assert.equal((await call(`/customers/${k.data.id}/debt-note`, mgr, 'PUT', { text: 'ghi đè', revision: 1 })).data.code, 'CUSTOMER_DEBT_NOTE_CONFLICT');
  assert.equal((await call(`/customers/${k.data.id}/debt-note`, emp, 'PUT', { text: 'a'.repeat(2001), revision: 2 })).status, 400);
  assert.equal((await call(`/customers/${k.data.id}/debt-note`, mgr)).data.text, 'Đã thu bớt, còn 20 triệu');
  assert.equal((await call('/customers', emp, 'POST', customerCreateFixture({ name: 'Ghi chú quá dài', legacyDebtNote: 'a'.repeat(2001) }))).status, 400);
});

test('từ chối khách: bắt buộc lý do, giữ hồ sơ, không dùng được, ẩn khỏi danh sách mặc định; duyệt lại / gửi duyệt lại', async () => {
  const { db, call, emp, mgr, other } = await setup();
  const input = customerCreateFixture({ name: 'Công ty Bị Từ Chối' });
  const k = await call('/customers', emp, 'POST', input);
  assert.equal(k.data.approvalStatus, 'pending');
  // Chỉ người duyệt từ chối; phải có lý do.
  assert.equal((await call(`/customers/${k.data.id}/reject`, emp, 'POST', { reason: 'không thích' })).status, 403);
  for (const reason of [undefined, '', '   ', 'x'.repeat(1001)]) assert.equal((await call(`/customers/${k.data.id}/reject`, mgr, 'POST', { reason })).status, 400);
  assert.equal((await call(`/customers/${k.data.id}/reject`, mgr, 'POST', { reason: '  Sai mã số thuế  ' })).status, 200);
  assert.equal((await call(`/customers/${k.data.id}/reject`, mgr, 'POST', { reason: 'lần hai' })).status, 404, 'đã từ chối thì không từ chối lại');
  const p = (await call(`/customers/${k.data.id}`, mgr)).data.customer;
  assert.equal(p.approvalStatus, 'rejected'); assert.equal(p.rejectReason, 'Sai mã số thuế'); assert.equal(p.rejectedByName, 'Tên mgr'); assert.ok(p.rejectedAt);
  // Danh sách: mặc định ẩn; ?status=rejected cho người duyệt và người tạo, không cho người khác; ô chọn khách không có.
  assert.ok(!(await call('/customers', mgr)).data.customers.some((c: any) => c.id === k.data.id));
  assert.deepEqual((await call('/customers?status=rejected', mgr)).data.customers.map((c: any) => c.id), [k.data.id]);
  assert.deepEqual((await call('/customers?status=rejected', emp)).data.customers.map((c: any) => c.id), [k.data.id]);
  assert.deepEqual((await call('/customers?status=rejected', other)).data.customers, []);
  assert.ok(!(await call('/customers?usable=1', mgr)).data.customers.some((c: any) => c.id === k.data.id));
  assert.equal((await call('/customers', mgr)).data.pendingCount, 0);
  // Không dùng được: không cấp tài khoản cổng khách, không tạo đơn.
  assert.equal((await call('/customer-accounts', mgr, 'POST', { customerId: k.data.id, name: 'A', email: 'a@tuchoi.vn' })).data.code, 'CUSTOMER_REJECTED');
  const q = await call('/quotes', mgr, 'POST', { type: 'B2B', quoteNo: 'B2B_RJ', customer: 'Công ty Bị Từ Chối', customerId: k.data.id, vat: 8, rows: [{ name: 'Ly', sku: 'L1', unit: 'cái', qty: 1, price: 1000 }] });
  assert.equal((await call('/orders', mgr, 'POST', { quoteId: q.data.id })).data.code, 'CUSTOMER_REJECTED');
  // Không xoá được ở đây; DB cũng từ chối trạng thái rejected thiếu lý do.
  assert.equal((await call(`/customers/${k.data.id}`, emp, 'DELETE')).status, 404);
  const k2 = await call('/customers', emp, 'POST', customerCreateFixture({ name: 'Công ty Thiếu Lý Do' }));
  await assert.rejects(() => db.execute(sql`update sapo_customers set approval_status = 'rejected' where id = ${k2.data.id}`));
  // Nhập lại đúng MST / SĐT của khách đã bị từ chối không bị coi là trùng.
  assert.equal((await call('/customers', emp, 'POST', { ...input, name: 'Công ty Bị Từ Chối (đã sửa)' })).status, 201);
  // Gửi duyệt lại: người tạo hoặc người duyệt; xoá lý do cũ.
  assert.equal((await call(`/customers/${k.data.id}/resubmit`, other, 'POST', {})).status, 403);
  assert.equal((await call(`/customers/${k.data.id}/resubmit`, emp, 'POST', {})).status, 200);
  const again = (await call(`/customers/${k.data.id}`, mgr)).data.customer;
  assert.deepEqual([again.approvalStatus, again.rejectReason, again.rejectedBy, again.rejectedAt], ['pending', null, null, null]);
  assert.equal((await call(`/customers/${k.data.id}/resubmit`, emp, 'POST', {})).status, 404, 'chỉ gửi lại khi đang bị từ chối');
  // Duyệt lại trực tiếp khách bị từ chối.
  assert.equal((await call(`/customers/${k.data.id}/reject`, mgr, 'POST', { reason: 'Thiếu giấy phép' })).status, 200);
  assert.equal((await call(`/customers/${k.data.id}/approve`, emp, 'POST', {})).status, 403);
  assert.equal((await call(`/customers/${k.data.id}/approve`, mgr, 'POST', {})).status, 200);
  const approved = (await call(`/customers/${k.data.id}`, mgr)).data.customer;
  assert.deepEqual([approved.approvalStatus, approved.rejectReason, approved.rejectedBy], ['approved', null, null]);
  assert.equal((await call('/orders', mgr, 'POST', { quoteId: q.data.id })).status, 201);
});

test('gộp khách trùng MST: giữ ghi chú công nợ cũ của mọi bản, bù người đại diện và số ngày công nợ', async () => {
  const { db, call, emp, mgr } = await setup();
  const a = await call('/customers', emp, 'POST', customerCreateFixture({ name: 'Công ty Giữ Lại', contacts: [{ name: 'A1' }], legacyDebtNote: 'Nợ A' }));
  const b = await call('/customers', mgr, 'POST', customerCreateFixture({ name: 'Công ty Bản Trùng', contacts: [{ name: 'B1', isRepresentative: true }], legacyDebtNote: 'Nợ B', paymentDays: 30 }));
  const bContact = (await call(`/customers/${b.data.id}`, mgr)).data.contacts[0];
  await db.execute(sql`update sapo_customers set tax_code = (select tax_code from sapo_customers where id = ${a.data.id}) where id = ${b.data.id}`);
  assert.equal(await mergeCustomers(db, a.data.id, [b.data.id], 'mgr'), 1);
  const merged = (await call(`/customers/${a.data.id}`, mgr)).data;
  assert.equal(merged.customer.paymentDays, 30);
  assert.equal(merged.customer.representativeContactId, bContact.id);
  assert.match(merged.debtNote.text, /Nợ A/); assert.match(merged.debtNote.text, /Nợ B/);
  assert.equal((await call(`/customers/${b.data.id}`, mgr)).status, 404);
});
