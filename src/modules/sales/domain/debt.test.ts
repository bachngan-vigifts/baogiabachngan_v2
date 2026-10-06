import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debtCounts } from './sales.ts';

test('công nợ chỉ tính khi đơn đã xác nhận hoặc HĐKT đã ký', () => {
  assert.equal(debtCounts('draft'), false);
  assert.equal(debtCounts('draft', 'draft'), false);
  assert.equal(debtCounts('draft', 'signed'), true);
  assert.equal(debtCounts('draft', 'completed'), true);
  for (const s of ['confirmed', 'delivering', 'delivered']) assert.equal(debtCounts(s), true);
  assert.equal(debtCounts('cancelled', 'signed'), false);
});
