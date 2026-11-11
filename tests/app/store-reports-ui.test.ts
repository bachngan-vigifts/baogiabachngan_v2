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

test('báo cáo đã nộp giữ đúng hạn khi chờ duyệt, duyệt muộn hoặc nộp lại; không hiển thị đồng hồ quá hạn', () => {
  const deadline='2026-11-07T15:00:00.000Z';
  for(const review of ['pending','ok','cash_error','excused']) {
    const d={deadline,report:{submittedAt:'2026-11-07T13:56:54.000Z',updatedAt:'2026-11-10T04:00:00Z',review,state:{state:'on_time'}}};
    for(const now of [Date.parse('2026-11-07T14:00:00Z'),Date.parse('2026-11-10T10:00:00Z')])
      assert.equal(ui.reportDeadlineText(d,now),'Đã nộp đúng hạn');
  }
  assert.equal(ui.reportDeadlineText({deadline,report:{review:'pending',state:{state:'late'}}}),'Đã nộp trễ');
  assert.equal(ui.reportDeadlineText({deadline,report:{}}),'Đã nộp chính thức','không suy đoán quá hạn từ ngày mở popup');
});

test('chỉ nháp/chưa nộp mới đếm ngược hạn; thời điểm hiển thị cố định giờ Việt Nam', () => {
  const d={deadline:'2026-11-07T15:00:00Z',report:null,draft:{updatedAt:'2026-11-07T14:00:00Z'}};
  assert.match(ui.reportDeadlineText(d,Date.parse('2026-11-07T14:00:00Z')),/còn 1 giờ/);
  assert.match(ui.reportDeadlineText(d,Date.parse('2026-11-08T00:00:00Z')),/Chưa nộp – đã quá hạn/);
  assert.equal(ui.reportDeadlineText({deadline:'invalid',report:null}),'Chưa xác định hạn nộp');
  const old=process.env.TZ;
  try {
    for(const timezone of ['UTC','America/Los_Angeles','Asia/Tokyo']) {
      process.env.TZ=timezone;
      const shown=ui.reportTimestampText('2026-11-07T02:15:00Z');assert.match(shown,/09:15/);assert.match(shown,/07[-/]11/);
    }
  } finally {if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
