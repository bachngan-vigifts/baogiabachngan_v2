import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';

/** DANH BẠ NCC (đợt 1): chỉ Manager; trùng tên bỏ dấu bị chặn; liên hệ thay cả danh sách; tài khoản NCC thuộc đúng một NCC; không xoá, chỉ ngừng. */
const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  for (const [id, role, pos] of [['ncc1', 'supplier', 'supplier'], ['ncc2', 'employee', 'supplier']] as const) {
    await d1.sqlite.prepare(`INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES (?,?,?,'','${role}','${pos}',1,'2026-01-01T00:00:00.000Z')`).run(id, id + '@ncc.vn', 'TK ' + id);
    await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run(id, await hashPassword(PASSWORD, 1000));
  }
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), ncc: await login('ncc1@ncc.vn') };
}

test('danh bạ NCC: quyền, trùng tên, liên hệ, tài khoản, ngừng hoạt động', async () => {
  const { call, emp, mgr, ncc } = await setup();
  for (const who of [emp, ncc]) assert.equal((await call('/suppliers', who)).status, 403);
  assert.equal((await call('/suppliers', emp, 'POST', { name: 'X' })).status, 403);

  const a = await call('/suppliers', mgr, 'POST', { name: 'Gốm Sứ Minh Long', taxCode: '3700', contacts: [
    { kind: 'order', email: 'Don@MinhLong.vn', name: 'Chị Hoa' }, { kind: 'cc', email: 'ketoan@minhlong.vn' }, { kind: 'cc', email: 'ketoan@minhlong.vn' }] });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.deepEqual(a.data.contacts.map((c: any) => [c.kind, c.email]), [['cc', 'ketoan@minhlong.vn'], ['order', 'don@minhlong.vn']], 'email hạ chữ, bỏ trùng');
  assert.equal((await call('/suppliers', mgr, 'POST', { name: 'gom su  MINH LONG' })).status, 409, 'trùng tên bỏ dấu / hoa thường');
  assert.equal((await call('/suppliers', mgr, 'POST', { name: '' })).status, 400);
  assert.equal((await call('/suppliers', mgr, 'POST', { name: 'Y', contacts: [{ kind: 'order', email: 'sai' }] })).status, 400);
  const b = (await call('/suppliers', mgr, 'POST', { name: 'Lys Ceramics' })).data;

  // Sửa: khoá lạc quan + thay danh sách liên hệ.
  const id = a.data.supplier.id, stale = a.data.supplier.updatedAt;
  const u = await call(`/suppliers/${id}`, mgr, 'PUT', { name: 'Gốm Sứ Minh Long 1', updatedAt: stale, contacts: [{ kind: 'order', email: 'moi@minhlong.vn' }] });
  assert.equal(u.status, 200, JSON.stringify(u.data)); assert.deepEqual(u.data.contacts.map((c: any) => c.email), ['moi@minhlong.vn']);
  assert.equal((await call(`/suppliers/${id}`, mgr, 'PUT', { name: 'Đổi lần 2', updatedAt: stale })).status, 409, 'ghi đè bản cũ bị chặn');
  assert.equal((await call(`/suppliers/${id}`, mgr, 'PUT', { name: 'Lys ceramics' })).status, 409, 'đổi sang tên NCC khác');

  // Tài khoản NCC: chỉ tài khoản chức vụ NCC; mỗi tài khoản thuộc một NCC.
  const cands = (await call('/supplier-account-candidates', mgr)).data.accounts;
  assert.ok(['ncc1', 'ncc2'].every(i => cands.some((x: any) => x.id === i)) && !cands.some((x: any) => x.id === 'emp'));
  assert.equal((await call(`/suppliers/${id}/accounts`, mgr, 'PUT', { memberIds: ['emp'] })).status, 400, 'nhân viên thường không gắn được');
  assert.deepEqual((await call(`/suppliers/${id}/accounts`, mgr, 'PUT', { memberIds: ['ncc1', 'ncc2'] })).data.accounts.map((x: any) => x.id).sort(), ['ncc1', 'ncc2']);
  assert.deepEqual((await call(`/suppliers/${b.supplier.id}/accounts`, mgr, 'PUT', { memberIds: ['ncc2'] })).data.accounts.map((x: any) => x.id), ['ncc2']);
  assert.deepEqual((await call(`/suppliers/${id}`, mgr)).data.accounts.map((x: any) => x.id), ['ncc1'], 'ncc2 chuyển sang NCC mới');

  // Ngừng hoạt động: vẫn còn trong danh sách, lọc được; không gắn tài khoản mới vào NCC đã ngừng.
  const cur = (await call(`/suppliers/${id}`, mgr)).data.supplier;
  assert.equal((await call(`/suppliers/${id}`, mgr, 'PUT', { ...cur, updatedAt: cur.updatedAt, active: false })).status, 200);
  assert.deepEqual((await call('/suppliers?active=0', mgr)).data.suppliers.map((x: any) => x.id), [id]);
  assert.equal((await call(`/suppliers/${id}/accounts`, mgr, 'PUT', { memberIds: ['ncc1'] })).status, 400);
  assert.equal((await call(`/suppliers/${id}`, mgr, 'DELETE')).status, 405, 'không có xoá NCC');
  const list = (await call('/suppliers?q=lys', mgr)).data.suppliers;
  assert.deepEqual(list.map((x: any) => [x.name, x.accounts]), [['Lys Ceramics', 1]]);
});

test('giao diện NCC: không chèn HTML thô', () => {
  const ui = readFileSync(new URL('../../trial-ui/suppliers.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML/);
});
