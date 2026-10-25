import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GHN_WAITING, GHN_FAILED, webGhnOrderStatus } from '../../src/modules/sales/domain/ghn-status.ts';

test('GHN determines shipping state but never reverses source refunds or deleted orders', () => {
  for (const carrier of [...GHN_WAITING, ...GHN_FAILED, 'delivered']) {
    assert.equal(webGhnOrderStatus(carrier, 'refunded'), 'refunded');
    assert.equal(webGhnOrderStatus(carrier, 'trash'), 'trash');
  }
  for (const carrier of GHN_WAITING) assert.equal(webGhnOrderStatus(carrier, 'completed'), 'processing');
  for (const carrier of GHN_FAILED) assert.equal(webGhnOrderStatus(carrier, 'processing'), 'cancelled');
  assert.equal(webGhnOrderStatus('delivered', 'processing'), 'completed');
  assert.equal(webGhnOrderStatus('unknown', 'pending'), 'pending');
});
