import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFromPosition, isSupplier, roleConsistencyIssue } from './roles.ts';

test('vai trò suy từ chức vụ giống bản cũ', () => {
  for (const [pos, role] of [['manager', 'manager'], ['supplier', 'supplier'], ['sale', 'employee'], ['sale-admin', 'employee'], ['sales-ml', 'employee'], ['warehouse', 'employee'], ['accounting', 'employee'], [null, 'employee'], [undefined, 'employee'], ['', 'employee']] as const)
    assert.equal(roleFromPosition(pos), role, String(pos));
});

test('tài khoản NCC = vai trò supplier HOẶC chức vụ supplier (dữ liệu lệch vẫn bị coi là NCC)', () => {
  assert.equal(isSupplier({ role: 'supplier', positionId: 'supplier' }), true);
  assert.equal(isSupplier({ role: 'supplier' }), true);
  assert.equal(isSupplier({ role: 'employee', positionId: 'supplier' }), true); // lệch: vẫn chặn
  assert.equal(isSupplier({ role: 'manager', positionId: 'supplier' }), true);
  assert.equal(isSupplier({ role: 'employee', positionId: 'sale' }), false);
  assert.equal(isSupplier({ role: 'manager', positionId: 'manager' }), false);
  assert.equal(isSupplier(null), false);
});

test('phát hiện dữ liệu lệch giữa vai trò và chức vụ', () => {
  assert.equal(roleConsistencyIssue({ role: 'employee', positionId: 'sale' }), null);
  assert.equal(roleConsistencyIssue({ role: 'supplier', positionId: 'supplier' }), null);
  assert.match(roleConsistencyIssue({ role: 'employee', positionId: 'supplier' })!, /không khớp/);
  assert.match(roleConsistencyIssue({ role: 'manager', positionId: 'sale' })!, /không khớp/);
});
