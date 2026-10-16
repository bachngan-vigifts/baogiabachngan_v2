import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore JS giao diện, chạy bằng Node như các kiểm thử UI khác.
import { parsePurchaseSheet, orderSubtotal, isoDate } from '../../trial-ui/purchase-import.js';

// Đọc file Excel tổng đơn của NCC (mẫu Minh Long): cột theo tiêu đề, gom theo số đơn, giữ số 0 đầu mã hàng, cảnh báo dòng lệch.
const HEAD = ['Đơn hàng', 'Số đơn', 'Ngày CT', 'Ngày giao', 'Ngày giao gốc', 'Mã hàng', 'Tên hàng', 'Bộ', 'Hoa văn', 'ĐVT', 'CL', 'Sl đặt', 'Sl chia', 'SL TồnkhoKKH', 'ĐG Bán', 'Trịgiáđơnhàng', 'Chiết khấu', 'SL giao', 'Tên Thời Hạn', 'Phân loại ĐH', 'SL còn lại'];
const row = (no: string, date: string, sku: string, name: string, qty: unknown, price: unknown, value: unknown, ck: unknown, giao: unknown) => [no, 'X', '', '', date, sku, name, '', '', 'Cái', 'L1', qty, '', '', price, value, ck, giao, '', '', '=L-R'];

test('đọc file tổng đơn NCC: gom theo số đơn, mã giữ số 0, ngày dd/mm/yyyy, CK trống = 0, cảnh báo trị giá lệch', () => {
  const raw = [HEAD,
    row('DD1/1026', '22/10/2026', '030937000', 'Chén chấm', 500, 15000, 5625000, 25, ''),
    row('DD2/1026', '30/10/2026', 'A1', 'Ly', 100, 1000, 100000, '', 40),
    row('DD2/1026', '30/10/2026', 'B2', 'Đĩa', 10, 2000, 99999999, 10, ''),
    row('', '', '', '', '', '', '', '', ''),
    row('DD3/1026', '01/11/2026', 'C3', 'Ca', 0, 1000, 0, 0, ''),
  ];
  const r = parsePurchaseSheet(raw);
  assert.deepEqual(r.orders.map((o: any) => [o.internalNo, o.arrivalDate, o.lines.map((l: any) => [l.sku, l.quantity, l.price, l.discount, l.received])]), [
    ['DD1/1026', '2026-10-22', [['030937000', 500, 15000, 25, 0]]],
    ['DD2/1026', '2026-10-30', [['A1', 100, 1000, 0, 40], ['B2', 10, 2000, 10, 0]]],
  ]);
  assert.equal(orderSubtotal(r.orders[1]!), 100000 + 18000);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0]!, /Dòng 4.*trị giá/); assert.match(r.warnings[1]!, /Dòng 6.*số lượng/);
  assert.equal(isoDate(46317), '2026-10-22', 'ngày dạng số của Excel');
  assert.equal(isoDate('31/02/2026'), '', 'ngày sai');
});
