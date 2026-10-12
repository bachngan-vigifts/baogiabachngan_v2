import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const print = await import(pathToFileURL(new URL('../../trial-ui/order-print.js', import.meta.url).pathname).href);
const order = { orderNo: 'DH_20261008_002', customerName: 'Khách', expectedDeliveryDate: '2026-10-10' };
const contract = { contractNo: '10-02/08102026/HĐKT/BN-QTSM' };
test('phiếu có HĐKT dùng số hợp đồng và giữ số riêng của phiếu / chuyến', () => {
  const packing = print.packingPrintData({ seller: 'BN', order, contract, slip: { slipNo: 'PK_001' }, lines: [] });
  const delivery = print.deliveryPrintData({ seller: 'BN', order, contract, delivery: { deliveryNo: 'GH_001' }, lines: [] });
  for (const p of [packing, delivery]) {
    assert.deepEqual(p.info[1], ['Số HĐKT', contract.contractNo]);
    const html = print.slipSheetHtml(p);
    assert.ok(html.includes(contract.contractNo));
    assert.ok(!html.includes(order.orderNo));
  }
  assert.equal(packing.docNo, 'PK_001');
  assert.equal(delivery.docNo, 'GH_001');
});
test('phiếu từ trang Kho dùng contractNo trong thông tin đơn tối giản', () => {
  const o = { ...order, contractNo: contract.contractNo };
  for (const build of [print.packingPrintData, print.deliveryPrintData]) {
    const p = build({ seller: 'BN', order: o, lines: [] });
    assert.deepEqual(p.info[1], ['Số HĐKT', contract.contractNo]);
    assert.equal(p.docNo, contract.contractNo);
  }
});
test('đơn chưa có HĐKT vẫn hiện số đơn đặt hàng', () => {
  assert.deepEqual(print.orderReference(order), { label: 'Số ĐH', number: order.orderNo });
  for (const build of [print.packingPrintData, print.deliveryPrintData]) {
    const p = build({ seller: 'BN', order, lines: [] });
    assert.deepEqual(p.info[1], ['Số ĐH', order.orderNo]);
  }
  assert.equal(print.orderPrintData({ order, lines: [], contract }).orderNo, order.orderNo);
});

test('đơn đặt hàng: ghi chú, ngày hẹn giao và ba người ký dùng chung cho mẫu xem/in', () => {
  const note = 'Giao tại kho\nGọi trước 30 phút <không để ngoài trời>';
  const p = print.orderPrintData({ order: { ...order, orderDate: '2026-10-08', note, contact: 'Anh Hải', ownerName: 'Võ Huỳnh Mai' }, lines: [] }, 'Người đang tải');
  assert.equal(p.note, note); assert.equal(p.expectedDeliveryDate, '10/10/2026');
  assert.deepEqual(p.signers, ['Anh Hải', 'Võ Huỳnh Mai', 'Lê Minh Thái']);
  const html = print.orderSheetHtml(p, { edit: true });
  assert.match(html, /Ngày hẹn giao<\/span><b[^>]*>10\/10\/2026/);
  assert.ok(html.indexOf('Ngày đặt') < html.indexOf('Ngày hẹn giao'));
  assert.match(html, /Giao tại kho\nGọi trước 30 phút &lt;không để ngoài trời&gt;/);
  assert.match(html, /Người phê duyệt/); assert.doesNotMatch(html, /Người tiếp nhận|Người soạn|Người đang tải/);
  assert.equal((html.match(/data-f="signers\./g) ?? []).length, 3);
  assert.equal(print.orderPrintData({ order: { ...order, expectedDeliveryDate: null }, lines: [] }).expectedDeliveryDate, '');
});

test('Excel đơn đặt hàng giữ ghi chú và cùng ngày hẹn giao/ba chữ ký, cả hai chế độ giá', async () => {
  const g = globalThis as any, saved = { document: g.document, ExcelJS: g.ExcelJS };
  let cells = new Map<string, any>();
  class Workbook {
    xlsx = { writeBuffer: async () => new Uint8Array([1]) };
    addWorksheet() {
      cells = new Map();
      return { columns: [], mergeCells() {}, getColumn: (n: number) => ({ letter: String.fromCharCode(64 + n) }),
        getCell: (ref: string) => { if (!cells.has(ref)) cells.set(ref, {}); return cells.get(ref); } };
    }
  }
  g.ExcelJS = { Workbook };
  g.document = { body: { append() {} }, createElement: () => ({ click() {}, remove() {} }) };
  try {
    const p = print.orderPrintData({ order: { ...order, note: 'Ghi chú dòng 1\nDòng 2', ownerName: 'Nhân viên phụ trách' }, lines: [] }, 'Người tải');
    for (const prices of [false, true]) {
      await print.downloadOrderExcel(p, { prices });
      const values = [...cells.values()].map(c => c.value);
      assert.ok(values.includes('Ngày hẹn giao')); assert.ok(values.includes('10/10/2026')); assert.ok(values.includes(p.note));
      assert.ok(values.includes('Người phê duyệt')); assert.ok(values.includes('Lê Minh Thái')); assert.ok(values.includes('Nhân viên phụ trách'));
      assert.ok(!values.includes('Người tiếp nhận') && !values.includes('Người soạn') && !values.includes('Người tải'));
      const deliveryLabel = [...cells.entries()].find(([, c]) => c.value === 'Ngày hẹn giao')![0];
      assert.equal(deliveryLabel.slice(-1), '6', 'ngày hẹn giao ở hàng ngay sau ngày đặt');
    }
  } finally { g.document = saved.document; g.ExcelJS = saved.ExcelJS; }
});
