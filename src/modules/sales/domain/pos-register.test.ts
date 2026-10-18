import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPosRegister } from './pos-register.ts';
const registers = [
  { id: 'ml', name: 'Quầy Minh Long', active: true },
  { id: 'lock', name: 'Quầy Lock', active: true },
];
test('Quầy mặc định cho NVBH và CHT Lock/Minh Long lấy đúng chức vụ, không dựa tên nhân viên', () => {
  assert.equal(defaultPosRegister('sales-lock', null, registers), 'lock');
  assert.equal(defaultPosRegister('sales-ml', null, registers), 'ml');
  assert.equal(defaultPosRegister('custom-lock', 'CHT LOCK', registers), 'lock');
  assert.equal(defaultPosRegister('custom-ml', 'CHT MINH LONG', registers), 'ml');
  assert.equal(defaultPosRegister('custom', '  Cửa hàng trưởng Minh Long  ', registers), 'ml');
  assert.equal(defaultPosRegister('manager', 'Manager', registers), null);
  assert.equal(defaultPosRegister('sale', 'Sale', registers), null);
});
test('Không gợi ý quầy ngừng hoạt động, bị thiếu hoặc trùng tên', () => {
  assert.equal(defaultPosRegister('sales-lock', '', []), null);
  assert.equal(defaultPosRegister('sales-lock', '', [{ ...registers[1]!, active: false }]), null);
  assert.equal(defaultPosRegister('sales-lock', '', [...registers, { ...registers[1]!, id: 'duplicate' }]), null);
});
