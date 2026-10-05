import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../../../core/errors.ts';
import { DEFAULT_POSITIONS, SELF_MESSAGES, activationLink, assertNotSelf, cleanMemberUpdate, cleanNewMember, cleanPhone, memberRole } from './members.ts';
import { roleFromPosition } from './roles.ts';

const msg = (fn: () => unknown) => { try { fn(); return 'OK'; } catch (e) { return e instanceof AppError ? `${e.status}:${e.message}` : 'LỖI LẠ'; } };
const good = { name: ' Nguyễn Văn A ', email: ' A@X.vn ', phone: ' 0911111111 ', positionId: 'sale' };

test('tạo nhân viên: cắt khoảng trắng, hạ chữ email; thứ tự kiểm giống bản cũ (điện thoại trước, rồi tên/email)', () => {
  assert.deepEqual(cleanNewMember(good), { name: 'Nguyễn Văn A', email: 'a@x.vn', phone: '0911111111', positionId: 'sale' });
  const phone = '400:Vui lòng nhập số điện thoại nhân viên (tối đa 40 ký tự).', nameEmail = '400:Nhập họ tên và địa chỉ email hợp lệ.';
  assert.equal(msg(() => cleanNewMember({ ...good, phone: undefined })), phone);
  assert.equal(msg(() => cleanNewMember({ ...good, phone: '  ' })), phone);
  assert.equal(msg(() => cleanNewMember({ ...good, phone: '9'.repeat(41) })), phone);
  assert.equal(msg(() => cleanNewMember({ ...good, name: ' ' })), nameEmail);
  assert.equal(msg(() => cleanNewMember({ ...good, name: 'x'.repeat(201) })), nameEmail);
  for (const email of ['sai', 'a@b', '@x.vn', 'a b@x.vn', 123, undefined, 'a'.repeat(250) + '@x.vn']) assert.equal(msg(() => cleanNewMember({ ...good, email })), nameEmail, String(email));
  assert.equal(msg(() => cleanNewMember({ ...good, phone: undefined, name: ' ' })), phone); // lỗi điện thoại được báo trước
  assert.equal(cleanNewMember({ ...good, positionId: undefined }).positionId, ''); // kiểm tra tồn tại chức vụ là việc của repo
});

test('sửa nhân viên: role phải hợp lệ và active phải là boolean thật; điện thoại bắt buộc', () => {
  const upd = { id: 'NV-1', name: 'A', email: 'a@x.vn', phone: '1', role: 'employee', active: true, positionId: 'sale' };
  assert.deepEqual(cleanMemberUpdate(upd), { id: 'NV-1', name: 'A', email: 'a@x.vn', phone: '1', positionId: 'sale', active: true });
  assert.equal(msg(() => cleanMemberUpdate({ ...upd, role: 'admin' })), '400:Quyền không hợp lệ.');
  assert.equal(msg(() => cleanMemberUpdate({ ...upd, active: 'true' })), '400:Quyền không hợp lệ.');
  assert.equal(msg(() => cleanMemberUpdate({ ...upd, phone: '' })), '400:Vui lòng nhập số điện thoại nhân viên (tối đa 40 ký tự).');
  assert.equal(msg(() => cleanMemberUpdate({ ...upd, name: '' })), '400:Nhập họ tên và địa chỉ email hợp lệ.');
});

test('đổi số điện thoại: chuỗi, tối đa 40 ký tự, được để rỗng', () => {
  assert.deepEqual(cleanPhone({ id: 'x', phone: ' 09 ' }), { id: 'x', phone: '09' });
  assert.deepEqual(cleanPhone({ id: 'x', phone: '' }), { id: 'x', phone: '' });
  assert.equal(msg(() => cleanPhone({ id: 'x', phone: 5 })), '400:Số điện thoại không hợp lệ.');
  assert.equal(msg(() => cleanPhone({ id: 'x', phone: '9'.repeat(41) })), '400:Số điện thoại không hợp lệ.');
});

test('không tự thao tác trên chính mình', () => {
  assert.equal(msg(() => assertNotSelf('m1', 'm1', SELF_MESSAGES.reset)), '400:Dùng chức năng đổi mật khẩu cho tài khoản của mình.');
  assert.equal(msg(() => assertNotSelf('m1', 'm2', SELF_MESSAGES.reset)), 'OK');
  assert.equal(msg(() => assertNotSelf('m1', undefined, SELF_MESSAGES.remove)), 'OK');
});

test('vai trò luôn suy từ chức vụ (chức vụ mặc định → vai trò đúng); không có chức vụ nào tạo ra vai trò lệch', () => {
  const expected: Record<string, string> = { manager: 'manager', supplier: 'supplier' };
  for (const p of DEFAULT_POSITIONS) assert.equal(memberRole(p.id), expected[p.id] ?? 'employee', p.id);
  assert.equal(memberRole('khong-co'), roleFromPosition('khong-co'));
});

test('liên kết kích hoạt: email được mã hoá, token nằm sau dấu # (không đi qua máy chủ)', () => {
  const t = 'a'.repeat(64);
  assert.equal(activationLink('https://x.vn', 'a+b@x.vn', t), `https://x.vn/login.html#email=a%2Bb%40x.vn&token=${t}`);
});

test('migration chức vụ mặc định khớp đúng DEFAULT_POSITIONS (một nguồn sự thật), id duy nhất, có manager và supplier', () => {
  const sql = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'migrations', '0002_seed_positions.sql'), 'utf8');
  const fromSql = [...sql.matchAll(/\('([^']+)', '([^']+)'\)/g)].map(m => ({ id: m[1]!, name: m[2]! }));
  assert.deepEqual(fromSql, [...DEFAULT_POSITIONS]);
  assert.equal(new Set(DEFAULT_POSITIONS.map(p => p.id)).size, DEFAULT_POSITIONS.length);
  assert.equal(new Set(DEFAULT_POSITIONS.map(p => p.name)).size, DEFAULT_POSITIONS.length); // tên cũng duy nhất (có ràng buộc trong DB)
  assert.ok(DEFAULT_POSITIONS.some(p => p.id === 'manager') && DEFAULT_POSITIONS.some(p => p.id === 'supplier'));
});
