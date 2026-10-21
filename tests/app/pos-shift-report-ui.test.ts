import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore shared browser presentation helpers
import { shiftReportSections } from '../../trial-ui/pos-report.js';

/** Báo cáo ca gom theo mục: mỗi mục có trang liên quan; dòng phụ bằng 0 ẩn đi; ca đã kết có thực đếm / lệch. */
test('báo cáo ca gom theo mục, ẩn dòng phụ bằng 0, mục nào cũng mở được trang liên quan', () => {
  const zero = { count: 0, amount: 0 };
  const d = { bills: { count: 3, revenue: 300000, discount: 0 }, cash: 200000, transfer: 100000, shift: { openingCash: 500000, closedAt: '2026-10-20T14:20:18Z' },
    expectedCash: 700000, countedCash: 690000, cashDifference: -10000, returns: { credit: 0, refundedTransfer: 0, exchanged: 0 },
    orderFlows: { deposit: 50000, balance: 0, prepaid: 0, pending: zero, outstanding: { count: 1, amount: 20000 } }, cod: { receivedInShift: zero, receivedFromPrevious: zero, pending: zero }, manual: [] };
  const s = shiftReportSections(d) as { title: string; open: string; rows: string[][] }[];
  assert.deepEqual(s.map(x => [x.title, x.open]), [['Bán hàng', 'orders'], ['Tiền đã thu', 'cash'], ['Đơn cọc / ship trả trước', 'flows'], ['Két tiền', 'cash'], ['Ship COD', 'cod']], 'không có trả hàng → ẩn mục');
  assert.deepEqual(s[0]!.rows.map(r => r[0]), ['Số bill', 'Giá trị đơn đã lập (gồm COD)'], 'chiết khấu 0 ẩn');
  assert.deepEqual(s[2]!.rows.map(r => r[0]), ['Tiền cọc thực nhận', 'Đơn nhận sau còn phải thu']);
  assert.deepEqual(s[3]!.rows.slice(-2), [['Thực đếm cuối ca', '690.000 đ'], ['Lệch', '-10.000 đ']]);
});
