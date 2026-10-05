import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../../core/errors.ts';
import { supplierNameKey, cleanSupplierInput, cleanContacts, defaultRecipients, canManageSuppliers, planAccountLink } from './directory.ts';

const status = (fn: () => unknown) => { try { fn(); return 200; } catch (e) { return e instanceof AppError ? e.status : -1; } };

test('khoá tên NCC: bỏ dấu, hạ chữ, gộp khoảng trắng, đ = d – để không tạo trùng NCC chỉ vì gõ khác kiểu', () => {
  assert.equal(supplierNameKey('  Minh   LONG '), 'minh long');
  assert.equal(supplierNameKey('Đông Á  Gốm Sứ'), 'dong a gom su');
  assert.equal(supplierNameKey('DONG A gom su'), supplierNameKey('Đông Á Gốm Sứ'));
  assert.equal(supplierNameKey('Xưởng in Hạnh Nguyên (Anh Liêm)'), 'xuong in hanh nguyen (anh liem)');
});

test('thông tin NCC: cắt khoảng trắng, bắt buộc tên, kiểm tra độ dài và email', () => {
  const ok = cleanSupplierInput({ name: '  Minh Long I ', taxCode: ' 123 ', email: 'a@b.vn' });
  assert.deepEqual(ok, { name: 'Minh Long I', nameKey: 'minh long i', taxCode: '123', address: '', phone: '', email: 'a@b.vn', note: '' });
  assert.equal(status(() => cleanSupplierInput({ name: '   ' })), 400);
  assert.equal(status(() => cleanSupplierInput({ name: 'A', email: 'khong-hop-le' })), 400);
  assert.equal(status(() => cleanSupplierInput({ name: 'x'.repeat(181) })), 400);
  assert.equal(status(() => cleanSupplierInput({ name: 'A', phone: 12345 })), 400);
  assert.equal(status(() => cleanSupplierInput(null)), 400);
  assert.equal(status(() => cleanSupplierInput({ name: 'A', email: '' })), 200); // email để trống được
});

test('liên hệ NCC: chuẩn hoá chữ thường, bỏ trùng, kiểm tra loại và email, tối đa 20 CC', () => {
  const out = cleanContacts([{ kind: 'order', email: ' Don@NCC.vn ' }, { kind: 'order', email: 'don@ncc.vn' }, { kind: 'cc', email: 'don@ncc.vn', name: 'Kế toán' }]);
  assert.deepEqual(out.map(c => `${c.kind}:${c.email}`), ['order:don@ncc.vn', 'cc:don@ncc.vn']);
  assert.equal(status(() => cleanContacts([{ kind: 'bcc', email: 'a@b.vn' }])), 400);
  assert.equal(status(() => cleanContacts([{ kind: 'order', email: 'a b@x.vn' }])), 400);
  assert.equal(status(() => cleanContacts('x')), 400);
  assert.equal(status(() => cleanContacts(Array.from({ length: 21 }, (_, i) => ({ kind: 'cc', email: `c${i}@x.vn` })))), 400);
  assert.equal(status(() => cleanContacts(Array.from({ length: 20 }, (_, i) => ({ kind: 'cc', email: `c${i}@x.vn` })))), 200);
});

test('địa chỉ gửi đơn điền sẵn khi duyệt: To = liên hệ order đầu tiên, CC = mọi liên hệ cc', () => {
  assert.deepEqual(defaultRecipients([{ kind: 'cc', email: 'k@x.vn' }, { kind: 'order', email: 'a@x.vn' }, { kind: 'order', email: 'b@x.vn' }, { kind: 'cc', email: 'l@x.vn' }]), { to: 'a@x.vn', cc: ['k@x.vn', 'l@x.vn'] });
  assert.deepEqual(defaultRecipients([]), { to: '', cc: [] });
});

test('chỉ Manager quản lý danh mục NCC', () => {
  assert.equal(canManageSuppliers({ role: 'manager', active: true, positionId: 'manager' }), true);
  assert.equal(canManageSuppliers({ role: 'manager', active: false }), false);
  assert.equal(canManageSuppliers({ role: 'employee', active: true }), false);
  assert.equal(canManageSuppliers({ role: 'supplier', active: true, positionId: 'supplier' }), false);
  assert.equal(canManageSuppliers({ role: 'manager', active: true, positionId: 'supplier' }), false); // dữ liệu lệch: coi là NCC
  assert.equal(canManageSuppliers(null), false);
});

test('gắn tài khoản vào NCC: chỉ Manager; NCC phải đang hoạt động; tài khoản phải là tài khoản NCC đang hoạt động', () => {
  const mgr = { role: 'manager' as const, active: true, positionId: 'manager' };
  const ncc = { id: 'n1', role: 'supplier' as const, active: true, positionId: 'supplier' };
  const sup = { id: 's1', active: true };
  assert.deepEqual(planAccountLink(mgr, ncc, sup), { memberId: 'n1', supplierId: 's1' });
  assert.deepEqual(planAccountLink(mgr, { ...ncc, role: 'employee' }, sup).memberId, 'n1'); // chức vụ NCC là đủ (vai trò lệch vẫn là NCC)
  assert.equal(status(() => planAccountLink({ role: 'employee', active: true }, ncc, sup)), 403);
  assert.equal(status(() => planAccountLink(null, ncc, sup)), 403);
  assert.equal(status(() => planAccountLink(mgr, ncc, { id: 's1', active: false })), 400);
  assert.equal(status(() => planAccountLink(mgr, ncc, null)), 400);
  assert.equal(status(() => planAccountLink(mgr, { ...ncc, active: false }, sup)), 400);
  assert.equal(status(() => planAccountLink(mgr, { id: 'e1', role: 'employee', active: true, positionId: 'sale' }, sup)), 400); // nhân viên thường không gắn vào NCC
  assert.equal(status(() => planAccountLink(mgr, { id: 'm2', role: 'manager', active: true, positionId: 'manager' }, sup)), 400);
});
