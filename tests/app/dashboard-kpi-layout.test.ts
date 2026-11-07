import { test } from 'node:test';
import assert from 'node:assert/strict';

test('màu tổng điểm KPI theo các ngưỡng mức đạt, kể cả 0 và vượt 100%', async () => {
  const { kpiAttainmentClass } = await import(new URL('../../trial-ui/dashboard.js', import.meta.url).href);
  for (const value of [0, 0.03, 0.5999]) assert.equal(kpiAttainmentClass(value), 'is-poor');
  for (const value of [0.6, 0.8999]) assert.equal(kpiAttainmentClass(value), 'is-low');
  for (const value of [0.9, 1, 1.25]) assert.equal(kpiAttainmentClass(value), 'is-high');
});
