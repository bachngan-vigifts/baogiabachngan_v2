import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');
const printSource = source.slice(source.indexOf('async function printDeliveryForOrder('), source.indexOf('/** Trang phiếu đóng gói (nhóm Kho'));
function fixture() {
  let opened: any;
  const data = { order: {}, contract: null, lines: [{ id: 'line', qty: 10, deliveredQty: 2 }], deliveries: [
    { id: 'next', deliveryNo: 'GH-1', status: 'planned', lines: [{ orderLineId: 'line', qty: 3 }] },
    { id: 'done', deliveryNo: 'GH-2', status: 'delivered', lines: [{ orderLineId: 'line', qty: 2 }] },
    { id: 'cancelled', deliveryNo: 'GH-3', status: 'cancelled', lines: [{ orderLineId: 'line', qty: 5 }] },
  ] };
  const print = runInNewContext(printSource + ';printDeliveryForOrder', {
    api: async () => data, deliveryProductImages: async () => {}, openSlipPrint: (v: any) => { opened = v; },
    fmtDate: () => '', DELIVERY_STATUS: {}, NO_SCHEDULE: 'Lên lịch trước', sellerName: () => '', state: {},
    deliveryPrintData: (v: any) => v,
  });
  return { print, opened: () => opened };
}
test('lịch mở đúng chuyến đã chọn và số lượng chuyến, không lấy chuyến đang chờ đầu tiên', async () => {
  const f = fixture(); await f.print('order', 'done');
  assert.equal(f.opened().initial, 'done');
  const sheet = f.opened().build(f.opened().initial);
  assert.equal(sheet.delivery.deliveryNo, 'GH-2'); assert.equal(sheet.lines[0].qty, 2);
  assert.equal(sheet.lines[0].ordered, 10);
});
test('xem lịch sử chuyến huỷ vẫn đúng phiếu; in từ đơn giữ mặc định chuyến chưa giao', async () => {
  const f = fixture(); await f.print('order', 'cancelled');
  assert.equal(f.opened().initial, 'cancelled'); assert.equal(f.opened().build('cancelled').delivery.deliveryNo, 'GH-3');
  await f.print('order'); assert.equal(f.opened().initial, 'next');
  assert.equal(f.opened().choices.some((x: any) => x.value === 'cancelled'), false);
});
test('chuyến không còn tồn tại báo lỗi, không mở phiếu khác', async () => {
  const f = fixture(); await assert.rejects(f.print('order', 'missing'), /Không tìm thấy chuyến giao/);
  assert.equal(f.opened(), undefined);
});
test('nút lịch dùng đúng mã đơn/chuyến và không mời truy cập API đơn khi thiếu quyền', () => {
  let warehouse = false, allowed = true;
  const render = runInNewContext(source.slice(source.indexOf('function deliverySlipButtons('), source.indexOf('/** Người nhận của chuyến giao')) + ';deliverySlipButtons', {
    isWarehouse: () => warehouse, canPage: () => allowed, esc: (s: string) => s.replaceAll('"', '&quot;'),
  });
  const row = { orderId: 'order-1', id: 'trip-2', deliveryNo: 'GH-2' };
  assert.match(render(row), /data-ship-print-for="order-1" data-delivery-id="trip-2"/);
  assert.match(render(row), /data-pack-print-for="order-1"/);
  warehouse = true; assert.equal(render(row), '');
  warehouse = false; allowed = false; assert.equal(render(row), '');
});
