import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { orderProgress } from '../../src/modules/sales/domain/progress.ts';

test('đơn cũ ghi đã giao nhưng thiếu xuất: cảnh báo, không tick Giao hàng và không cho hoàn thành nhanh', () => {
  const source = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');
  const box = { hidden: true, innerHTML: '' };
  const render = runInNewContext(source.slice(source.indexOf('function renderProgress('), source.indexOf("$('#order-progress').addEventListener")) + ';renderProgress', {
    $: () => box, isManager: () => true, esc: (v: unknown) => String(v), fmtDate: (v: unknown) => String(v),
  });
  const input = { status: 'delivered', packed: false, physicalExportRequired: true, printing: false, marks: {} };
  render({ order: { status: input.status }, progress: orderProgress(input) });
  assert.match(box.innerHTML, /role="alert"/);
  assert.match(box.innerHTML, /chưa đủ chứng từ xuất kho/);
  assert.doesNotMatch(box.innerHTML, /data-progress="all"/);
  assert.match(box.innerHTML, /<li class="">\s*<span class="dot" aria-hidden="true">3<\/span><b>Giao hàng<\/b>/);
  render({ order: { status: input.status }, progress: orderProgress({ ...input, packed: true }) });
  assert.doesNotMatch(box.innerHTML, /role="alert"/);
  assert.match(box.innerHTML, /<li class="done">\s*<span class="dot" aria-hidden="true">✓<\/span><b>Giao hàng<\/b>/);
});
