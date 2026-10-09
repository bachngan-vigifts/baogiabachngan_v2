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
