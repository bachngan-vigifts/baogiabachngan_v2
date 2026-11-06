import { contractTest as test, assert } from '../TEST_TEMPLATE.ts';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { customerCreateFixture } from '../helpers/customer-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import { eq } from 'drizzle-orm';

async function fixture() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await d1.sqlite.prepare("UPDATE staff_credentials SET password_hash = (SELECT password_hash FROM staff_credentials WHERE member_id = 'emp') WHERE member_id IN ('new','old')").run();
  const router = createAppRouter(), origin = 'https://trial.test';
  const call = async (path: string, cookie = '', method = 'GET', body?: unknown) => {
    const r = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { db, passwordIterations: 1000, sapoOrderPush: 'off' });
    return { status: r.status, data: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const mgr = await login('mgr@x.vn'), owner = await login('emp@x.vn'), shared = await login('new@x.vn'), other = await login('old@x.vn');
  const made = await call('/customers', mgr, 'POST', customerCreateFixture({ name: 'Khách chia sẻ kiểm thử', contact: 'Anh Một', ownerId: null, sharedIds: ['new'], contacts: [{ name: 'Anh Một', isPrimary: true }] }));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const path = '/customers/' + made.data.id;
  const view = async (cookie = shared) => (await call(path, cookie)).data;
  return { db, call, mgr, owner, shared, other, path, view };
}

test('explicit shared staff can edit an unassigned customer form and contact directory without gaining approval or delegation rights', async () => {
  const f = await fixture(), p = await f.view();
  assert.equal(p.owner, null); assert.equal(p.access.canEditProfile, true); assert.equal(p.access.canEdit, false);
  assert.equal(p.access.canManageStaff, false); assert.equal(p.access.canChangeOwner, false);
  const contacts = p.contactDirectory.map((c: any) => ({ ...c, name: 'Anh Một mới', phone: '0900000101' }));
  const update = await f.call(f.path, f.shared, 'PUT', { ...p.customer, name: 'Khách chia sẻ đã cập nhật', phone: '0900000102', paymentDays: 30, contacts, contactDirectoryVersion: p.contactDirectoryVersion,
    ownerId: 'new', sharedIds: ['old'], approvalStatus: 'rejected' });
  assert.equal(update.status, 200, JSON.stringify(update.data));
  const next = await f.view();
  assert.equal(next.customer.name, 'Khách chia sẻ đã cập nhật'); assert.equal(next.customer.phone, '0900000102'); assert.equal(next.customer.paymentDays, 30);
  assert.equal(next.customer.contact, 'Anh Một mới'); assert.equal(next.contacts[0].id, p.contacts[0].id); assert.equal(next.contacts[0].phone, '0900000101');
  assert.equal(next.customer.approvalStatus, 'approved'); assert.equal(next.owner, null); assert.deepEqual(next.shared.map((s: any) => s.id), ['new']);
  assert.equal((await f.call(f.path + '/staff', f.shared, 'PUT', { ownerId: 'new', sharedIds: ['old'] })).status, 403);
  assert.equal((await f.call(f.path + '/approve', f.shared, 'POST', {})).status, 403);
  assert.equal((await f.call(f.path + '/reject', f.shared, 'POST', { reason: 'Không được tự từ chối' })).status, 403);
  assert.equal((await f.call(f.path + '/discounts', f.shared, 'PUT', { lock: 50 })).status, 403);
  assert.equal((await f.call(f.path + '/notes', f.shared, 'PUT', { text: 'Không mở thêm quyền', revision: 0 })).status, 403);
  assert.equal((await f.call(f.path + '/debt-note', f.shared, 'PUT', { text: 'Không mở thêm quyền', revision: 0 })).status, 403);
  assert.equal((await f.call(f.path, f.shared, 'PUT', { ...p.customer, contacts: p.contactDirectory, contactDirectoryVersion: p.contactDirectoryVersion })).status, 409, 'stale contact form cannot overwrite the newer save');
});

test('shared staff can maintain contacts and representative only for the shared customer; revocation blocks subsequent saves', async () => {
  const f = await fixture();
  const created = await f.call(f.path + '/contacts', f.shared, 'POST', { name: 'Người đại diện', title: 'Giám đốc' });
  assert.equal(created.status, 201, JSON.stringify(created.data)); const id = created.data.id;
  assert.equal((await f.call(f.path + '/contacts/' + id, f.shared, 'PUT', { name: 'Đại diện mới', isPrimary: false })).status, 200);
  assert.equal((await f.call(f.path + '/representative', f.shared, 'PUT', { contactId: id })).status, 200);
  const p = await f.view(); assert.equal(p.customer.representativeContactId, id);
  const another = await f.call('/customers', f.mgr, 'POST', customerCreateFixture({ name: 'Khách không chia sẻ', contact: 'Liên hệ khác', contacts: [{ name: 'Liên hệ khác', isPrimary: true }] }));
  assert.equal(another.status, 201);
  const foreignId = (await f.call('/customers/' + another.data.id, f.mgr)).data.contacts[0].id;
  assert.equal((await f.call(f.path + '/representative', f.shared, 'PUT', { contactId: foreignId })).status, 400);
  assert.equal((await f.call(f.path + '/contacts/' + foreignId, f.shared, 'PUT', { name: 'Không được sửa chéo khách' })).status, 404);
  assert.equal((await f.call('/customers/' + another.data.id, f.shared, 'PUT', { name: 'Khách không được chia sẻ' })).status, 403);
  assert.equal((await f.call(f.path + '/contacts/' + id, f.shared, 'DELETE')).status, 200);
  assert.equal((await f.view()).customer.representativeContactId, null);
  assert.equal((await f.call(f.path + '/staff', f.mgr, 'PUT', { sharedIds: [] })).status, 200);
  assert.equal((await f.view()).access.canEditProfile, false);
  assert.equal((await f.call(f.path, f.shared, 'PUT', { ...p.customer, name: 'Không được ghi sau thu hồi' })).status, 403);
  assert.equal((await f.call(f.path + '/contacts', f.shared, 'POST', { name: 'Không được thêm' })).status, 403);
  assert.equal((await f.call(f.path + '/representative', f.shared, 'PUT', { contactId: null })).status, 403);
});

test('same-position viewers and company-wide readers cannot edit without an explicit share; owner and manager permissions remain intact', async () => {
  const f = await fixture();
  assert.equal((await f.call(f.path + '/staff', f.mgr, 'PUT', { ownerId: 'emp' })).status, 200);
  const p = await f.view(f.other); assert.equal(p.access.peer, true); assert.equal(p.access.canEditProfile, false);
  assert.equal((await f.call(f.path, f.other, 'PUT', { ...p.customer, name: 'Đồng nghiệp không được sửa' })).status, 403);
  await f.db.update(employees).set({ positionId: 'sale-admin' }).where(eq(employees.id, 'old'));
  const all = await f.view(f.other); assert.equal(all.access.canSeeAll, true); assert.equal(all.access.canEditProfile, false);
  assert.equal((await f.call(f.path, f.other, 'PUT', { ...all.customer, name: 'Chỉ xem toàn công ty' })).status, 403);
  assert.equal((await f.call(f.path + '/contacts', f.other, 'POST', { name: 'Không được thêm' })).status, 403);
  for (const cookie of [f.owner, f.mgr]) {
    const own = await f.view(cookie); assert.equal(own.access.canEditProfile, true); assert.equal(own.access.canEdit, true);
    assert.equal((await f.call(f.path, cookie, 'PUT', { ...own.customer, name: 'Phụ trách và Manager vẫn sửa' })).status, 200);
  }
});
