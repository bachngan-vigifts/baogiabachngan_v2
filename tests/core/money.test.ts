import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundVnd, toFinite, clampPercent } from '../../src/core/money.ts';

test('roundVnd làm tròn nửa lên', () => { assert.equal(roundVnd(349648.27), 349648); assert.equal(roundVnd(0.5), 1); assert.equal(roundVnd(2.4), 2); });
test('toFinite loại NaN/Infinity/rác', () => {
  assert.equal(toFinite('12.5'), 12.5); assert.equal(toFinite('abc'), 0); assert.equal(toFinite(Infinity, 7), 7); assert.equal(toFinite(null), 0); assert.equal(toFinite(undefined, 3), 3);
});
test('clampPercent giữ trong 0..100', () => { assert.equal(clampPercent(150), 100); assert.equal(clampPercent(-4), 0); assert.equal(clampPercent('58'), 58); assert.equal(clampPercent(NaN), 0); });
