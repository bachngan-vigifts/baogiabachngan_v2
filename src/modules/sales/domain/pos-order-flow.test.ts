import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flowInitialAmount,
  flowHoldUntil,
  flowRemaining,
  saleFlowOf,
} from './pos-order-flow.ts';
test('cọc 30% nguyên đồng, ít nhất 1; tùy chọn 50%/khác, trả trước bắt buộc 100%', () => {
  assert.equal(flowInitialAmount('deposit', 194400, undefined), 58320);
  assert.equal(flowInitialAmount('deposit', 1, undefined), 1);
  assert.equal(flowInitialAmount('deposit', 105, undefined), 32);
  assert.equal(flowInitialAmount('deposit', 194400, 97200), 97200);
  assert.equal(flowInitialAmount('deposit', 194400, 12345), 12345);
  assert.equal(flowInitialAmount('prepaid', 194400, undefined), 194400);
  for (const n of [0, -1, 1.1, 194401, 'bad'])
    assert.throws(() => flowInitialAmount('deposit', 194400, n));
  assert.throws(() => flowInitialAmount('prepaid', 194400, 50000));
  assert.throws(() => flowInitialAmount('deposit', 0, undefined));
  assert.throws(() => flowInitialAmount('prepaid', 1000000000001, undefined));
  assert.throws(() => flowInitialAmount('deposit', NaN, undefined));
});
test('hạn giữ 5 ngày độc lập múi giờ; ship đã trả đủ giữ đến xuất; dư nợ không âm', () => {
  assert.equal(
    flowHoldUntil('2026-10-20T18:30:00.000Z'),
    '2026-10-25T18:30:00.000Z',
  );
  assert.equal(
    flowHoldUntil('2026-10-20T18:30:00.000Z', true),
    '9999-12-31T23:59:59.999Z',
  );
  assert.equal(flowRemaining(100, 150), 0);
  assert.equal(saleFlowOf('{"saleFlow":"deposit"}'), 'deposit');
  assert.equal(saleFlowOf('{bad'), null);
  assert.equal(saleFlowOf({ saleFlow: 'cod' }), null);
});
