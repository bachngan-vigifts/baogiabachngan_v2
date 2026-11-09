import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../core/errors.ts';
import { decideSepayMatch, normalizeSepayReference, parseSepayPayment } from './sepay-payment.ts';

test('SePay normalizes Vietnamese separators and parses aliases', () => {
  assert.equal(normalizeSepayReference('Thanh toán 16-12/19052026/HĐKT/ABC'), 'THANHTOAN161219052026HDKTABC');
  const p = parseSepayPayment({ id: 12, transfer_type: 'in', amount: '100000', account_number: ' 123 456 ', description: 'DH-001', transaction_date: '2026-11-09 10:00:00' });
  assert.deepEqual([p.providerId, p.amount, p.accountNumber, p.transferType], ['12', 100000, '123456', 'in']);
});

test('SePay rejects outbound, missing id, zero and malformed date', () => {
  for (const b of [
    { id: 1, transferType: 'out', transferAmount: 1, content: 'DH1' },
    { transferType: 'in', transferAmount: 1, accountNumber: '1', content: 'DH1' },
    { id: 1, transferType: 'in', transferAmount: 0, accountNumber: '1', content: 'DH1' },
    { id: 1, transferType: 'in', transferAmount: 1, accountNumber: '1', content: 'DH1', transactionDate: 'nope' },
    { id: 1, transferType: 'in', transferAmount: 1, content: 'DH1' },
  ]) assert.throws(() => parseSepayPayment(b), AppError);
});

test('SePay only auto-matches one order without overpayment', () => {
  assert.equal(decideSepayMatch([], 1).status, 'unmatched');
  assert.equal(decideSepayMatch([{ id: 'a', outstanding: 2 }, { id: 'b', outstanding: 2 }], 1).status, 'review');
  assert.equal(decideSepayMatch([{ id: 'a', outstanding: 0 }], 1).status, 'review');
  assert.equal(decideSepayMatch([{ id: 'a', outstanding: 99 }], 100).status, 'review');
  assert.deepEqual(decideSepayMatch([{ id: 'a', outstanding: 100 }], 40), { status: 'matched', reason: '', orderId: 'a' });
});
