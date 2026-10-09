import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';

const origin = 'https://trial.test';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=';

test('ảnh đại diện: tự đổi ảnh, Manager đổi cho nhân viên; mã mới mỗi lần; chat trả kèm mã ảnh', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const emp = await login('emp@x.vn'), mgr = await login('mgr@x.vn');

  assert.equal((await call('/me', emp)).data.user.avatar, null);
  assert.equal((await call('/avatar', emp, 'PUT', { image: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400, 'không nhận SVG');
  assert.equal((await call('/avatar', emp, 'PUT', { image: 'data:image/png;base64,/9j/4AAQ' })).status, 400, 'khai PNG nhưng là JPEG');
  assert.equal((await call('/avatar', emp, 'PUT', { image: 'data:image/jpeg;base64,' + '/9j/' + 'A'.repeat(130_000) })).status >= 400, true, 'quá lớn');
  const k1 = (await call('/avatar', emp, 'PUT', { image: JPEG })).data.avatar;
  assert.match(k1, /^[a-f0-9]{32}$/);
  assert.equal((await call('/me', emp)).data.user.avatar, k1);
  assert.deepEqual((await call(`/avatars?keys=${k1},khong-hop-le`, mgr)).data.avatars, { [k1]: JPEG });

  // Manager đổi ảnh cho nhân viên: mã mới, ảnh cũ hết hiệu lực.
  assert.equal((await call('/admin/members/mgr/avatar', emp, 'PUT', { image: PNG })).status, 403);
  const k2 = (await call('/admin/members/emp/avatar', mgr, 'PUT', { image: PNG })).data.avatar;
  assert.notEqual(k2, k1);
  assert.deepEqual((await call(`/avatars?keys=${k1},${k2}`, emp)).data.avatars, { [k2]: PNG });
  assert.equal((await call('/admin/members', mgr)).data.members.find((m: any) => m.id === 'emp').avatar, k2);
  assert.equal((await call('/admin/members/khong-co/avatar', mgr, 'PUT', { image: PNG })).status, 404);

  // Chat: danh bạ, thành viên, tin nhắn đều có mã ảnh.
  assert.equal((await call('/chat/people', mgr)).data.people.find((p: any) => p.id === 'emp').avatar, k2);
  const d = (await call('/chat/direct', mgr, 'POST', { memberId: 'emp' })).data;
  await call(`/chat/${d.id}/messages`, emp, 'POST', { body: 'Chào anh' });
  const t = (await call(`/chat/${d.id}/messages?full=1`, mgr)).data;
  assert.equal(t.messages.at(-1).avatar, k2);
  assert.equal(t.conversation.members.find((m: any) => m.id === 'emp').avatar, k2);

  assert.equal((await call('/avatar', emp, 'DELETE')).data.avatar, null);
  assert.deepEqual((await call(`/avatars?keys=${k2}`, emp)).data.avatars, {});
});
