import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debtCounts, receivable } from './sales.ts';

test('công nợ chỉ tính khi đơn đã xác nhận hoặc HĐKT đã ký', () => {
  assert.equal(debtCounts('draft'), false);
  assert.equal(debtCounts('draft', 'draft'), false);
  assert.equal(debtCounts('draft', 'signed'), true);
  assert.equal(debtCounts('draft', 'completed'), true);
  for (const s of ['confirmed', 'delivering', 'delivered']) assert.equal(debtCounts(s), true);
  assert.equal(debtCounts('cancelled', 'signed'), false);
});

test('trạng thái thanh toán / đặt cọc', () => {
  const today = '2026-10-06', dep = { kind: 'deposit', amount: 300, dueDate: '2026-10-10' }, bal = { kind: 'balance', amount: 700, dueDate: null };
  const st = (sch: any[], paid: number[], t = today) => { const r = receivable(sch, paid.map(amount => ({ amount })), t); return [r.payState, r.deposit, r.depositPaid]; };
  assert.deepEqual(st([], []), ['none', 0, 0]);
  assert.deepEqual(st([bal], []), ['unpaid', 0, 0]);
  assert.deepEqual(st([bal], [200]), ['partial', 0, 0]);
  assert.deepEqual(st([dep, bal], []), ['deposit_due', 300, 0]);
  assert.deepEqual(st([dep, bal], [100]), ['deposit_due', 300, 100]);
  assert.deepEqual(st([dep, bal], [300]), ['deposit_paid', 300, 300]);
  assert.deepEqual(st([dep, bal], [100], '2026-10-11'), ['overdue', 300, 100]);
  assert.deepEqual(st([dep, bal], [1000]), ['paid', 300, 300]);
});
