import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers, customerStaff } from '../../src/modules/customers/schema.ts';
import { suppliers, supplierAccounts } from '../../src/modules/suppliers/schema.ts';
import { customerAccounts } from '../../src/modules/portal/schema.ts';
import { credentials, employees } from '../../src/modules/staff/schema.ts';
import { sha256Hex } from '../../src/modules/staff/domain/session.ts';
const origin = 'https://trial.test';
const valid = { name: 'Người đăng ký', email: 'partner@example.vn', phone: '+84 912 345 678', password: PASSWORD };
const ok = (r: any, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
const inviteToken = (r: { url: string }) => new URLSearchParams(new URL(r.url).hash.slice(1)).get('invite')!;
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  let now = Math.floor(Date.now() / 1000);
  const router = createAppRouter(), env = { db, passwordIterations: 1000, nowSec: () => now };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const r = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] || '' };
  };
  const login = async (email: string) => ok(await call('/login', '', 'POST', { email, password: PASSWORD }));
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  const emp = (await call('/login', '', 'POST', { email: 'emp@x.vn', password: PASSWORD })).cookie;
  await db.insert(customers).values(['kh1', 'kh2'].map(id => ({ id, name: id === 'kh1' ? 'Khách 1' : 'Khách 2', contact: '', phone: '', email: '', address: '', search: '', taxCode: '', customerCode: '', sourceVersion: 0, syncedAt: new Date().toISOString() })));
  await db.insert(customerStaff).values({ customerId: 'kh1', memberId: 'emp', role: 'owner', createdAt: new Date().toISOString() });
  const supplier = ok(await call('/suppliers', mgr, 'POST', { name: 'NCC được mời' }), 201).supplier;
  return { db, call, login, mgr, emp, supplier, advance: (seconds: number) => { now += seconds; } };
}

test('link khách: tự đăng ký thông tin, gắn sẵn hồ sơ/quyền/CK; không đổi sang khách khác hoặc nhân viên', async () => {
  const f = await setup();
  const r = ok(await f.call('/customers/kh1/invitations', f.mgr, 'POST', { discounts: { minhLong: 5 } }), 201), token = inviteToken(r);
  assert.equal(new URL(r.url).origin, origin); assert.equal(new URL(r.url).pathname, '/register.html'); assert.equal(new URL(r.url).search, '');
  const [cred] = await f.db.select().from(credentials).where(eq(credentials.memberId, r.memberId));
  assert.equal(cred!.activationHash, sha256Hex(token)); assert.equal(cred!.passwordHash, null);
  assert.deepEqual(ok(await f.call('/registration-info', '', 'POST', { token })).entityName, 'Khách 1');
  ok(await f.call('/register-partner', '', 'POST', { token, ...valid, role: 'manager', positionId: 'manager', customerId: 'kh2', discounts: { minhLong: 99 }, ownerId: 'emp' }));
  const [member] = await f.db.select().from(employees).where(eq(employees.id, r.memberId));
  assert.equal(member!.name, valid.name); assert.equal(member!.phone, '0912345678'); assert.equal(member!.role, 'customer'); assert.equal(member!.positionId, 'customer');
  const [a] = await f.db.select().from(customerAccounts).where(eq(customerAccounts.memberId, r.memberId));
  assert.equal(a!.customerId, 'kh1'); assert.equal(a!.ownerId, 'mgr'); assert.deepEqual(JSON.parse(a!.discounts), { minhLong: 5 });
  const session = await f.call('/login', '', 'POST', { email: valid.email, password: PASSWORD }); ok(session); assert.ok(session.cookie);
  assert.equal(ok(await f.call('/portal/me', session.cookie)).customer.id, 'kh1');
  ok(await f.call('/customers', session.cookie), 403);
  ok(await f.call('/register-partner', '', 'POST', { token, ...valid }), 400);
  ok(await f.call('/registration-info', '', 'POST', { token }), 400);
});

test('NCC: Manager lấy link tại hồ sơ; đăng ký và đăng nhập đúng portal, không có quyền CRM', async () => {
  const f = await setup(), r = ok(await f.call('/suppliers/' + f.supplier.id + '/invitations', f.mgr, 'POST', {}), 201), token = inviteToken(r);
  const info = ok(await f.call('/registration-info', '', 'POST', { token })); assert.equal(info.kind, 'supplier'); assert.equal(info.entityName, f.supplier.name);
  const registered = ok(await f.call('/register-partner', '', 'POST', { token, ...valid, supplierId: 'other' })); assert.equal(registered.portal, '/supplier.html');
  const [a] = await f.db.select().from(supplierAccounts).where(eq(supplierAccounts.memberId, r.memberId)); assert.equal(a!.supplierId, f.supplier.id);
  const session = await f.call('/login', '', 'POST', { email: valid.email, password: PASSWORD }); ok(session);
  assert.equal(ok(await f.call('/me', session.cookie)).user.role, 'supplier');
  assert.equal(ok(await f.call('/supplier-portal/early-requests', session.cookie)).canRespond, true);
  for (const path of ['/customers', '/orders', '/portal/me']) ok(await f.call(path, session.cookie), 403);
});

test('quyền cấp link: khách đúng phụ trách; NCC chỉ Manager; không lấy danh sách/cấp link qua tài khoản ngoài', async () => {
  const f = await setup();
  ok(await f.call('/customers/kh2/invitations', f.emp, 'POST', {}), 403);
  ok(await f.call('/customers/kh1/invitations', f.emp, 'POST', { discounts: { lock: 8 } }), 403);
  const invite = ok(await f.call('/customers/kh1/invitations', f.emp, 'POST', {}), 201);
  ok(await f.call('/suppliers/' + f.supplier.id + '/invitations', f.emp, 'POST', {}), 403);
  ok(await f.call('/customers/kh1/invitations', '', 'POST', {}), 401);
  const list = ok(await f.call('/customers/kh1/accounts', f.emp)).accounts;
  assert.equal(list.find((a: any) => a.memberId === invite.memberId).registrationPending, true);
  assert.equal(list[0].email, '');
  const ncc = (await f.call('/login', '', 'POST', { email: 'ncc@x.vn', password: PASSWORD })).cookie;
  ok(await f.call('/customers/kh1/invitations', ncc, 'POST', {}), 403);
});

test('token không thể sửa hồ sơ/loại; link hết hạn/cấp lại chỉ dùng bản mới, không đặt mật khẩu qua activate cũ', async () => {
  const f = await setup(), r = ok(await f.call('/customers/kh1/invitations', f.emp, 'POST', {}), 201), token = inviteToken(r);
  ok(await f.call('/registration-info', '', 'POST', { token: token.replace('kh1', 'kh2') }), 400);
  ok(await f.call('/registration-info', '', 'POST', { token: token.replace('.customer.', '.supplier.') }), 400);
  ok(await f.call('/activate', '', 'POST', { token, password: PASSWORD }), 400);
  f.advance(86401); ok(await f.call('/registration-info', '', 'POST', { token }), 400);
  const next = ok(await f.call('/customer-accounts/' + r.memberId + '/reset', f.emp, 'POST', {}));
  ok(await f.call('/registration-info', '', 'POST', { token }), 400);
  ok(await f.call('/register-partner', '', 'POST', { token: inviteToken(next), ...valid }));
  ok(await f.call('/customer-accounts/' + r.memberId + '/reset', f.emp, 'POST', {})); // existing account still has password recovery
});

test('đăng ký: trùng email/SĐT, mật khẩu yếu không tiêu thụ link; khách có thể chỉ dùng số điện thoại', async () => {
  const f = await setup(), r = ok(await f.call('/customers/kh1/invitations', f.emp, 'POST', {}), 201), token = inviteToken(r);
  ok(await f.call('/register-partner', '', 'POST', { token, ...valid, email: 'MGR@X.VN' }), 409);
  ok(await f.call('/register-partner', '', 'POST', { token, ...valid, password: 'short' }), 400);
  ok(await f.call('/register-partner', '', 'POST', { token, ...valid, phone: 'abc' }), 400);
  ok(await f.call('/register-partner', '', 'POST', { token, ...valid, email: '' }));
  const session = await f.call('/login', '', 'POST', { email: '+84 912 345 678', password: PASSWORD }); ok(session);
  const next = ok(await f.call('/customers/kh1/invitations', f.emp, 'POST', {}), 201);
  ok(await f.call('/register-partner', '', 'POST', { token: inviteToken(next), ...valid }), 409);
  ok(await f.call('/register-partner', '', 'POST', { token: inviteToken(next), ...valid, phone: '0987654321' }));
});

test('NCC ngừng/đổi gắn tài khoản làm link cũ vô hiệu; không dùng lời mời để đổi mật khẩu tài khoản đã đăng ký', async () => {
  const f = await setup(), path = '/suppliers/' + f.supplier.id;
  const r = ok(await f.call(path + '/invitations', f.mgr, 'POST', {}), 201), token = inviteToken(r);
  const next = ok(await f.call(path + '/invitations', f.mgr, 'POST', { memberId: r.memberId }));
  ok(await f.call('/registration-info', '', 'POST', { token }), 400);
  const token2 = inviteToken(next);
  await f.db.update(suppliers).set({ active: false }).where(eq(suppliers.id, f.supplier.id));
  ok(await f.call('/register-partner', '', 'POST', { token: token2, ...valid }), 400);
  await f.db.update(suppliers).set({ active: true }).where(eq(suppliers.id, f.supplier.id));
  const other = ok(await f.call('/suppliers', f.mgr, 'POST', { name: 'NCC khác' }), 201).supplier;
  ok(await f.call('/suppliers/' + other.id + '/accounts', f.mgr, 'PUT', { memberIds: [r.memberId] }));
  ok(await f.call('/registration-info', '', 'POST', { token: token2 }), 400);
  const rebound = ok(await f.call('/suppliers/' + other.id + '/invitations', f.mgr, 'POST', { memberId: r.memberId }));
  ok(await f.call('/register-partner', '', 'POST', { token: inviteToken(rebound), ...valid }));
  ok(await f.call('/suppliers/' + other.id + '/invitations', f.mgr, 'POST', { memberId: r.memberId }), 400);
});
