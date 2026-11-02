import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const print = await import(pathToFileURL(new URL('../../trial-ui/order-print.js', import.meta.url).pathname).href);
const base = { transferNo: 'PCK20261102-001', statusLabel: 'Đang chuyển – chờ kho đến nhận', fromName: 'KHO VIGIFTS', toName: 'SR Minh Long - Lock', requestedByName: 'Nguyễn A', approvedByName: 'Lê B',
  createdAt: '2026-11-02T01:00:00.000Z', shippedAt: '2026-11-02T02:30:00.000Z', shippedByName: 'Trần Kho', reason: 'Khách lẻ cần <30> ly', shippedNote: '', doneNote: '', doneByName: '',
  lines: [{ sku: 'LY1', name: 'Ly sứ <đỏ>', unit: 'cái', qty: 30, receivedQty: null }, { sku: 'DIA2', name: 'Đĩa sứ', unit: 'cái', qty: 10, receivedQty: null }] };
test('phiếu điều chuyển để mang theo: thông tin kho đi/đến, cột SL nhận trống để ghi tay, 4 chữ ký, HTML được escape', () => {
  const p = print.transferPrintData({ ...base, status: 'shipped' }, 'Nhân viên in');
  const html = print.slipSheetHtml(p);
  assert.match(html, /PHIẾU ĐIỀU CHUYỂN KHO/);
  assert.deepEqual(['SL chuyển', 'SL nhận'].map(h => html.includes(`<th>${h}</th>`)), [true, true]);
  for (const label of ['Người lập phiếu', 'Thủ kho xuất (kho đi)', 'Người giao hàng', 'Thủ kho nhận (kho đến)']) assert.ok(html.includes(`<b>${label}</b>`), label);
  assert.ok(html.includes('KHO VIGIFTS') && html.includes('SR Minh Long - Lock') && html.includes('PCK20261102-001'));
  assert.ok(html.includes('02/11/2026'), 'ngày theo giờ Việt Nam');
  assert.ok(!html.includes('<đỏ>') && !html.includes('<30>'), 'tên hàng / lý do không chèn HTML');
  assert.deepEqual(p.lines.map((l: any) => l.received), ['', ''], 'chưa nhận: để trống cho kho đến ghi tay');
  assert.deepEqual(p.names, ['Nguyễn A', 'Trần Kho', '', '']);
  assert.equal(p.docNo, 'PCK20261102-001');
});
test('phiếu đã nhận hàng in sẵn SL thực nhận, ghi chú thiếu và tên người nhận; nhận 0 vẫn hiện số 0', () => {
  const p = print.transferPrintData({ ...base, status: 'done', statusLabel: 'Đã nhận hàng', doneByName: 'Phạm Nhận', doneNote: 'Giao thiếu 8 ly', shippedNote: 'Xe tải 51C',
    lines: [{ sku: 'LY1', name: 'Ly sứ', unit: 'cái', qty: 30, receivedQty: 22 }, { sku: 'DIA2', name: 'Đĩa sứ', unit: 'cái', qty: 10, receivedQty: 0 }] });
  assert.deepEqual(p.lines.map((l: any) => [l.received, l.note]), [[22, 'Thiếu 8'], ['0', 'Thiếu 10']]);
  assert.equal(p.note, 'Kho đi: Xe tải 51C · Nhận hàng: Giao thiếu 8 ly');
  assert.equal(p.names[3], 'Phạm Nhận');
  const html = print.slipSheetHtml(p);
  assert.match(html, /<td class="n">22<\/td>/);assert.match(html, /<td class="n">0<\/td>/);
});
test('phiếu cũ đã chuyển một bước (chưa có SL nhận) in như nhận đủ không ghi chú thiếu', () => {
  const p = print.transferPrintData({ ...base, status: 'done', shippedAt: null, shippedByName: '', lines: [{ sku: 'LY1', name: 'Ly', unit: 'cái', qty: 4, receivedQty: 4 }] });
  assert.deepEqual(p.lines.map((l: any) => [l.received, l.note]), [[4, '']]);
});
