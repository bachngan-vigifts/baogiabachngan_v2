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

// @ts-ignore shared browser presentation helpers
import { shiftFigures, differenceState } from '../../trial-ui/shift-report-view.js';
test('kết ca: két hệ thống lấy theo máy chủ, tách tiền mặt bán / COD / thu chi tay; chênh lệch 3 trạng thái', () => {
  const f = shiftFigures({ shift: { openingCash: 2_000_000 }, cash: 9_120_000, cashSales: 8_000_000, cashCod: 1_120_000, transfer: 13_180_000,
    manual: [{ direction: 'in', kind: 'other_income', amount: 300_000 }, { direction: 'out', kind: 'petty_expense', amount: 150_000 }], expectedCash: 11_270_000, pendingEntries: [{}] });
  assert.deepEqual([f.manualIn, f.manualOut, f.other, f.received, f.pending], [300_000, 150_000, 0, 22_300_000, 1], 'COD đã thu nằm trong tiền mặt / chuyển khoản – không cộng thêm lần nữa');
  assert.equal(shiftFigures({ shift: { openingCash: 0 }, cash: 100, cashSales: 100, cashCod: 0, manual: [], expectedCash: 90 }).other, -10, 'phần máy chủ tính khác hiện thành dòng "Khác"');
  assert.equal(differenceState('', 100).state, 'empty');
  assert.deepEqual([differenceState('100', 100).state, differenceState('80', 100).diff], ['match', -20]);
});
