import { test } from 'node:test';
import assert from 'node:assert/strict';
const ui: any = await import(new URL('../../trial-ui/store-reports.js', import.meta.url).href);

test('nhãn kỳ báo cáo và nhịp nhắc 30 phút', () => {
  assert.equal(ui.periodLabel('daily', '2026-11-05'), '05/11');
  assert.equal(ui.periodLabel('weekly', '2026-11-02'), '02/11–08/11');
  assert.equal(ui.periodLabel('monthly', '2026-11'), 'Tháng 11/2026');
  const now = Date.parse('2026-11-05T13:00:00Z');
  assert.equal(ui.shouldRemind([], 0, now), false, 'không có việc thì không nhắc');
  assert.equal(ui.shouldRemind([{}], 0, now), true, 'chưa nhắc lần nào');
  assert.equal(ui.shouldRemind([{}], now - 29 * 60_000, now), false, 'chưa đủ 30 phút');
  assert.equal(ui.shouldRemind([{}], now - 30 * 60_000, now), true);
});

test('hướng dẫn PDF cho CHT có trong giao diện', async () => {
  const { existsSync, statSync } = await import('node:fs');
  const file = new URL('../../trial-ui/' + ui.GUIDE_URL.split('?')[0], import.meta.url);
  assert.ok(existsSync(file), 'file PDF hướng dẫn phải nằm trong trial-ui');
  assert.ok(statSync(file).size > 50_000);
});
