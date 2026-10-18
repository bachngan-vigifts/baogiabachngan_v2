import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashCloseReason, cashEntryInput } from './cash.ts';
test('cash: loại phiếu quyết định chiều, tiền nguyên dương và lý do bắt buộc', () => {
  assert.equal(cashEntryInput({ kind: 'cash_out', amount: 100, reason: 'Nộp két' }).direction, 'out');
  assert.equal(cashEntryInput({ kind: 'cash_in', amount: 100, reason: 'Tiếp quỹ' }).direction, 'in');
  for (const b of [
    { kind: 'x', amount: 100, reason: 'x' },
    { kind: 'cash_in', amount: 0.1, reason: 'x' },
    { kind: 'cash_in', amount: 0, reason: 'x' },
    { kind: 'cash_in', amount: 100, reason: '' },
  ])
    assert.throws(() => cashEntryInput(b));
});
test('cash: không lệch không cần lý do; lệch chọn Khác phải có ghi chú', () => {
  assert.equal(cashCloseReason(0, null, null).differenceReason, '');
  assert.throws(() => cashCloseReason(1, 'other', ''));
  assert.throws(() => cashCloseReason(-1, 'unknown', 'x'));
  assert.equal(cashCloseReason(-1, 'counting', '').reasonCode, 'counting');
  assert.equal(cashCloseReason(1, 'other', 'Đã kiểm tra').differenceReason, 'Khác: Đã kiểm tra');
});
