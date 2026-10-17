import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers, customerStaff } from '../../src/modules/customers/schema.ts';
import { normalizePhone, parseLoginId } from '../../src/modules/staff/domain/login-id.ts';

const origin = 'https://trial.test';

test('chuẩn hoá số điện thoại đăng nhập', () => {
  assert.equal(normalizePhone('0901 234 567'), '0901234567');
  assert.equal(normalizePhone('+84 901.234.567'), '0901234567');
  assert.equal(normalizePhone('84901234567'), '0901234567');
  assert.equal(normalizePhone('901234567'), '0901234567');
  assert.equal(normalizePhone('12345'), '');
  assert.deepEqual(parseLoginId(' Lan@HL.vn '), { kind: 'email', value: 'lan@hl.vn' });
  assert.deepEqual(parseLoginId('(+84) 90-123-4567'), { kind: 'phone', value: '0901234567' });
});

test('tài khoản khách đăng nhập bằng email hoặc số điện thoại; số không trùng giữa các khách; nhân viên không đăng nhập bằng số', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const emp = (await call('/login', '', 'POST', { email: 'emp@x.vn', password: PASSWORD })).cookie;
  await db.insert(customers).values({ id: '1001', name: 'Công ty Hoàng Long', contact: '', phone: '', email: '', address: '', search: '', taxCode: '', customerCode: '', sourceVersion: 0, syncedAt: '' });
  await db.insert(customerStaff).values({ customerId: '1001', memberId: 'emp', role: 'owner', createdAt: '2026-10-01T00:00:00.000Z' }); // nhân viên phụ trách khách → được cấp tài khoản trang khách
  const acc = await call('/customer-accounts', emp, 'POST', { customerId: '1001', name: 'Chị Lan', email: 'lan@hl.vn', phone: '+84 901 234 567' });
  assert.equal(acc.status, 201);
  assert.equal((await call('/customer-accounts', emp, 'POST', { customerId: '1001', name: 'Anh Minh', email: 'minh@hl.vn', phone: '0901234567' })).status, 409, 'số đã dùng cho tài khoản khách khác');
  await call('/activate', '', 'POST', { token: /token=([a-f0-9]{64})/.exec(acc.data.url)![1], password: 'khach-hang-123' });

  // Đăng nhập: email, số điện thoại ở nhiều dạng viết.
  assert.equal((await call('/login', '', 'POST', { email: 'lan@hl.vn', password: 'khach-hang-123' })).status, 200);
  for (const phone of ['0901234567', '0901 234 567', '+84901234567']) {
    const r = await call('/login', '', 'POST', { email: phone, password: 'khach-hang-123' });
    assert.equal(r.status, 200, phone); assert.equal(r.data.user.email, 'lan@hl.vn');
  }
  assert.equal((await call('/login', '', 'POST', { email: '0901234567', password: 'sai-mat-khau' })).status, 401);
  // Nhân viên (số trong bộ mẫu 0900000000) không đăng nhập bằng số điện thoại.
  assert.equal((await call('/login', '', 'POST', { email: '0900000000', password: PASSWORD })).status, 401);

  // Đổi số điện thoại đăng nhập; số cũ hết dùng được.
  assert.equal((await call(`/customer-accounts/${acc.data.memberId}`, emp, 'PUT', { phone: '0912 345 678' })).status, 200);
  assert.equal((await call('/login', '', 'POST', { email: '0901234567', password: 'khach-hang-123' })).status, 401);
  assert.equal((await call('/login', '', 'POST', { email: '0912345678', password: 'khach-hang-123' })).status, 200);
  assert.equal((await call('/customers/1001/accounts', emp)).data.accounts[0].phone, '0912345678');
  // Số không đọc được vẫn lưu nguyên (không dùng để đăng nhập).
  assert.equal((await call(`/customer-accounts/${acc.data.memberId}`, emp, 'PUT', { phone: 'máy lẻ 12' })).status, 200);
  assert.equal((await call('/customers/1001/accounts', emp)).data.accounts[0].phone, 'máy lẻ 12');
});

test('khách không có email: tạo tài khoản chỉ bằng số di động (gõ vào ô SĐT hoặc ô email), đặt mật khẩu và đăng nhập bằng số', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const emp = (await call('/login', '', 'POST', { email: 'emp@x.vn', password: PASSWORD })).cookie;
  await db.insert(customers).values({ id: '2002', name: 'Công ty Kim Trần Gia', contact: '', phone: '', email: '', address: '', search: '', taxCode: '', customerCode: '', sourceVersion: 0, syncedAt: '' });
  await db.insert(customerStaff).values({ customerId: '2002', memberId: 'emp', role: 'owner', createdAt: '2026-10-01T00:00:00.000Z' }); // nhân viên phụ trách khách → được cấp tài khoản trang khách
  assert.equal((await call('/customer-accounts', emp, 'POST', { customerId: '2002', name: 'Trần Hoàng' })).status, 400, 'phải có email hoặc số di động');
  assert.equal((await call('/customer-accounts', emp, 'POST', { customerId: '2002', name: 'Trần Hoàng', phone: '12345' })).status, 400, 'số không đăng nhập được');
  // Gõ số điện thoại vào ô email (như ảnh chụp) cũng được.
  const acc = await call('/customer-accounts', emp, 'POST', { customerId: '2002', name: 'Trần Hoàng', email: '0931 328 616', phone: '0931 328 616' });
  assert.equal(acc.status, 201, JSON.stringify(acc.data));
  assert.match(acc.data.url, /#email=0931328616&token=[a-f0-9]{64}$/, 'link đặt mật khẩu ghi số di động');
  const second = await call('/customer-accounts', emp, 'POST', { customerId: '2002', name: 'Chị Mai', phone: '0909 111 222' });
  assert.equal(second.status, 201, 'nhiều tài khoản chỉ có SĐT không đụng nhau');
  const list = (await call('/customers/2002/accounts', emp)).data.accounts;
  assert.deepEqual(list.map((a: any) => a.email), ['', ''], 'không hiện email nội bộ');
  await call('/activate', '', 'POST', { token: /token=([a-f0-9]{64})/.exec(acc.data.url)![1], password: 'khach-hang-123' });
  const r = await call('/login', '', 'POST', { email: '0931328616', password: 'khach-hang-123' });
  assert.equal(r.status, 200);
  assert.equal((await call('/portal/me', r.cookie)).data.user.email, '');
  // Không bỏ được số di động của tài khoản chỉ đăng nhập bằng số.
  assert.equal((await call(`/customer-accounts/${acc.data.memberId}`, emp, 'PUT', { phone: '' })).status, 400);
  assert.equal((await call(`/customer-accounts/${acc.data.memberId}`, emp, 'PUT', { phone: '0931 000 111' })).status, 200);
  assert.match((await call(`/customer-accounts/${acc.data.memberId}/reset`, emp, 'POST', {})).data.url, /#email=0931000111&token=/);
});
