import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSalesCreateSapo } from './order-sapo-access.ts';

test('Sapo action is available to sales positions on draft, confirmed and completed accessible orders', () => {
  for (const positionId of ['sale', 'sale-admin', 'sales-ml', 'sales-lock']) {
    for (const status of ['draft', 'confirmed', 'delivering', 'delivered']) {
      assert.equal(canSalesCreateSapo({ role: 'employee', positionId }, { status }), true, `${positionId}/${status}`);
    }
    assert.equal(canSalesCreateSapo({ role: 'employee', positionId }, { status: 'cancelled' }), false);
  }
  assert.equal(canSalesCreateSapo({ role: 'manager' }, { status: 'delivered' }), true);
  assert.equal(canSalesCreateSapo({ role: 'manager' }, { status: 'cancelled' }), false);
});

test('sales Sapo action does not grant privileges to other positions or external roles', () => {
  for (const role of ['employee', 'supplier', 'customer']) {
    for (const positionId of ['warehouse', 'accounting', null, undefined]) {
      assert.equal(canSalesCreateSapo({ role, positionId }, { status: 'confirmed' }), false);
    }
  }
  for (const role of ['supplier', 'customer']) {
    assert.equal(canSalesCreateSapo({ role, positionId: 'sale' }, { status: 'draft' }), false);
  }
});
