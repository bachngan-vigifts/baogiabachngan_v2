import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { deliveries, salesOrders } from '../../src/modules/sales/schema.ts';
import { posRegisters } from '../../src/modules/sales/pos-schema.ts';
import { syncPosLockGhn } from '../../src/modules/sales/api/pos-ghn-sync.ts';
import { ghnCreateBody, ghnPhone, parseGhnShip } from '../../src/modules/sales/domain/pos-ghn.ts';

/**
 * TẠO VẬN ĐƠN GHN cho Ship COD quầy Lock (pos-ghn-create.ts): tự tạo sau khi lưu đơn, GHN lỗi thì đơn vẫn lưu + tạo lại được,
 * một lần (không tạo trùng), COD = còn thu khi giao (gồm phí ship thu khách), cho xem hàng; danh mục địa chỉ dùng token GHN.
 */
const ghnDelivery = { address: '12 Nguyễn Trãi, Phường Bến Thành, Quận 1, Hồ Chí Minh', receiverName: 'Chị Lan', receiverPhone: '+84 901 234 567', plannedDate: '2026-10-22',
  ghnProvinceId: 202, ghnDistrictId: 1442, ghnWardCode: '20101', ghnWeight: 800, ghnRequiredNote: 'CHOXEMHANGKHONGTHU', ghnNote: 'Gọi trước khi giao' };

async function withGhn() {
  const f = await setup(), shift = await f.open(), calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  let reply: () => Response = () => Response.json({ code: 200, message: 'Success', data: { order_code: 'GAB' + calls.length + 'XYZ', total_fee: 25000, expected_delivery_time: '2026-10-24T16:59:59Z', sort_code: '1-A-01' } });
  f.env.ghnToken = 'test-ghn-token';
  f.env.ghnFetch = (async (input, init) => {
    calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : null });
    return reply();
  }) as typeof fetch;
  return { ...f, shift, calls, setReply: (r: () => Response) => { reply = r; } };
}

test('Ship COD quầy Lock: lưu đơn là tạo vận đơn GHN đúng dữ liệu (COD gồm phí ship thu khách, cho xem hàng); gọi lại không tạo trùng', async () => {
  const f = await withGhn();
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(f.shift.id, { fulfillmentMode: 'cod', shippingFee: 30000, delivery: ghnDelivery }));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.ghnShipment.ok, true, JSON.stringify(made.data.ghnShipment));
  assert.equal(made.data.ghnOrderCode, 'GAB1XYZ'); assert.equal(made.data.ghnShipment.fee, 25000);
  const sent = f.calls.find(c => c.url.endsWith('/shipping-order/create'))!;
  assert.deepEqual([sent.headers.Token, sent.headers.ShopId], ['test-ghn-token', '6096731']);
  const b = sent.body;
  assert.deepEqual([b.payment_type_id, b.required_note, b.note, b.client_order_code, b.to_name, b.to_phone, b.to_district_id, b.to_ward_code, b.weight, b.service_type_id],
    [1, 'CHOXEMHANGKHONGTHU', 'Gọi trước khi giao', made.data.orderNo, 'Chị Lan', '0901234567', 1442, '20101', 800, 2]);
  assert.equal(b.cod_amount, 224400, '194.400 hàng + 30.000 phí ship thu khách');
  assert.deepEqual(b.items, [{ name: 'Ly sứ', code: '00123', quantity: 2, price: 97200 }], 'giá khai báo đã gồm VAT');
  const [ship] = await f.db.select().from(deliveries);
  assert.deepEqual([ship!.trackingCode, ship!.carrier, ship!.trackingStatus, ship!.codAmount], ['GAB1XYZ', 'GHN', 'ready_to_pick', 224400]);
  const snap = JSON.parse((await f.db.select().from(salesOrders).where(eq(salesOrders.id, made.data.id)))[0]!.posSnapshot!);
  assert.equal(snap.ghn.orderCode, 'GAB1XYZ'); assert.equal(snap.ghn.wardCode, '20101');
  // Bấm "Tạo lại" khi đã có mã: trả mã cũ, không gọi GHN lần nữa.
  const again = await f.call('/pos/cod/' + ship!.id + '/ghn', f.emp, 'POST', {});
  assert.equal(again.status, 200); assert.deepEqual([again.data.orderCode, again.data.existing], ['GAB1XYZ', true]);
  assert.equal(f.calls.filter(c => c.url.endsWith('/shipping-order/create')).length, 1);
  // Danh sách Ship COD hiện mã vận đơn; không còn nút tạo.
  const list = (await f.call('/pos/cod?shiftId=' + f.shift.id, f.emp)).data.deliveries;
  assert.deepEqual([list[0].trackingCode, list[0].canCreateGhn], ['GAB1XYZ', false]);
});

test('Ship COD showroom Minh Long dùng GHN_ML_API_TOKEN và ShopId lấy đúng từ tài khoản riêng', async () => {
  const f = await setup();
  const shift = await f.open();
  await f.db.update(posRegisters).set({ name: 'Showroom Gốm Sứ Minh Long Cần Thơ' }).where(eq(posRegisters.id, f.registerId));
  const calls: { url: string; headers: Record<string, string> }[] = [];
  f.env.ghnMlToken = 'test-ghn-ml-token-unique';
  f.env.ghnFetch = (async (input, init) => {
    const url = String(input), headers = init?.headers as Record<string, string>; calls.push({ url, headers });
    if (url.endsWith('/shop/all')) return Response.json({ code: 200, data: { shops: [{ id: 7000123, status: 1 }] } });
    return Response.json({ code: 200, data: { order_code: 'GML123', total_fee: 21000 } });
  }) as typeof fetch;
  const made = await f.call('/pos/checkout', f.mgr, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery: ghnDelivery }));
  assert.equal(made.status, 201, JSON.stringify(made.data)); assert.equal(made.data.ghnOrderCode, 'GML123');
  const create = calls.find(c => c.url.endsWith('/shipping-order/create'))!;
  assert.deepEqual([create.headers.Token, create.headers.ShopId], ['test-ghn-ml-token-unique', '7000123']);
});

test('GHN lỗi: đơn COD vẫn lưu, trả lý do; danh sách Ship COD có nút tạo; tạo lại thành công; nhân viên quầy khác không tạo được', async () => {
  const f = await withGhn();
  f.setReply(() => Response.json({ code: 400, message: 'Số điện thoại không hợp lệ', code_message_value: 'Số điện thoại người nhận không hợp lệ' }, { status: 400 }));
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(f.shift.id, { fulfillmentMode: 'cod', delivery: ghnDelivery }));
  assert.equal(made.status, 201, 'đơn vẫn lưu khi GHN lỗi');
  assert.equal(made.data.ghnShipment.ok, false); assert.match(made.data.ghnShipment.message, /^GHN: Số điện thoại người nhận không hợp lệ/);
  const [ship] = await f.db.select().from(deliveries);
  assert.equal(ship!.trackingCode, '');
  const list = (await f.call('/pos/cod?shiftId=' + f.shift.id, f.emp)).data.deliveries;
  assert.equal(list[0].canCreateGhn, true);
  assert.equal((await f.call('/pos/cod/' + ship!.id + '/ghn', f.ncc, 'POST', {})).status, 403, 'tài khoản không bán hàng nhanh bị chặn');
  f.setReply(() => Response.json({ code: 200, data: { order_code: 'gretry1', total_fee: 22000 } }));
  const retry = await f.call('/pos/cod/' + ship!.id + '/ghn', f.emp, 'POST', {});
  assert.equal(retry.status, 200, JSON.stringify(retry.data)); assert.deepEqual([retry.data.orderCode, retry.data.existing], ['GRETRY1', false]);
  assert.equal((await f.db.select().from(deliveries))[0]!.trackingCode, 'GRETRY1');
});

test('Không đủ điều kiện tạo vận đơn: thiếu địa chỉ GHN báo rõ; đã nhập mã tay thì không tạo; chưa có token thì bỏ qua', async () => {
  const f = await withGhn();
  const legacy = await f.call('/pos/checkout', f.emp, 'POST', f.cart(f.shift.id, { fulfillmentMode: 'cod', delivery: { address: '1 Test', receiverName: 'A', receiverPhone: '0901234567' } }));
  assert.equal(legacy.status, 201); assert.equal(legacy.data.ghnShipment.ok, false); assert.match(legacy.data.ghnShipment.message, /chưa có địa chỉ chuẩn GHN/);
  const manual = await f.call('/pos/checkout', f.emp, 'POST', f.cart(f.shift.id, { fulfillmentMode: 'cod', delivery: { ...ghnDelivery, ghnOrderCode: 'GMANUAL1' } }));
  assert.equal(manual.status, 201); assert.equal(manual.data.ghnShipment, undefined, 'đã có mã tay → không tạo');
  assert.equal(f.calls.filter(c => c.url.endsWith('/shipping-order/create')).length, 0);
  f.env.ghnToken = undefined;
  const noToken = await f.call('/pos/checkout', f.emp, 'POST', f.cart(f.shift.id, { fulfillmentMode: 'cod', delivery: ghnDelivery }));
  assert.equal(noToken.status, 201); assert.equal(noToken.data.ghnShipment, undefined);
  assert.equal((await f.call('/pos/cod/' + (await f.db.select().from(deliveries).where(eq(deliveries.orderId, noToken.data.id)))[0]!.id + '/ghn', f.emp, 'POST', {})).status, 503);
});

test('Danh mục địa chỉ: có token GHN thì lấy thẳng từ GHN (không cần kết nối website); lỗi đồng bộ kèm số đơn', async () => {
  const f = await withGhn();
  f.setReply(() => Response.json({ code: 200, data: [{ WardCode: '99001', WardName: 'Phường Mới', Status: 1 }, { WardCode: '99002', WardName: 'Phường Cũ', Status: 2 }] }));
  const r = await f.call('/pos/ghn/locations', f.emp, 'POST', { registerId: f.registerId, provinceId: 202, districtId: 987654 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.locations, [{ id: '99001', name: 'Phường Mới' }]);
  assert.match(f.calls.at(-1)!.url, /master-data\/ward\?district_id=987654$/);

  f.setReply(() => Response.json({ code: 200, data: { order_code: 'GSYNC1' } }));
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(f.shift.id, { fulfillmentMode: 'cod', delivery: ghnDelivery }));
  assert.equal(made.data.ghnShipment.ok, true);
  f.setReply(() => Response.json({ code: 400, message: 'Đơn hàng không tồn tại' }, { status: 400 }));
  const sync = await syncPosLockGhn(f.env);
  assert.deepEqual(sync.errors, [{ code: 'GSYNC1', orderNo: made.data.orderNo, message: 'Đơn hàng không tồn tại' }]);
});

test('pos-ghn: đọc form + body GHN', () => {
  assert.equal(parseGhnShip({ ghnDistrictId: 1442 }), null, 'thiếu phường');
  assert.deepEqual(parseGhnShip({ ghnDistrictId: '1442', ghnWardCode: '20101' }), { provinceId: 0, districtId: 1442, wardCode: '20101', weight: 500, length: 20, width: 20, height: 10, requiredNote: 'CHOXEMHANGKHONGTHU', note: '' });
  assert.throws(() => parseGhnShip({ ghnDistrictId: 1, ghnWardCode: 'x', ghnWeight: 0 }), /Khối lượng/);
  assert.throws(() => parseGhnShip({ ghnDistrictId: 1, ghnWardCode: 'x', ghnRequiredNote: 'BAT_KY' }), /xem hàng/);
  assert.equal(ghnPhone('84 912-345-678'), '0912345678');
  assert.throws(() => ghnPhone('12345'), /10 số/);
  const ship = parseGhnShip({ ghnDistrictId: 1, ghnWardCode: 'x' })!;
  assert.throws(() => ghnCreateBody({ orderNo: 'X', receiverName: 'A', receiverPhone: '0901234567', address: 'a', codAmount: 50_000_001, ship, lines: [] }), /thu hộ/);
  assert.equal(ghnCreateBody({ orderNo: 'X', receiverName: 'A', receiverPhone: '0901234567', address: 'a', codAmount: 0, ship, lines: [{ sku: 's', name: 'n', qty: 0.5, unitPrice: 1.4 }] }).items[0]!.quantity, 1);
});

test('Huỷ đơn / huỷ chuyến Ship COD quầy Lock: huỷ luôn vận đơn trên GHN; GHN từ chối thì CRM vẫn huỷ và trả lý do', async () => {
  const f = await withGhn();
  f.setReply(() => Response.json({ code: 200, data: { order_code: 'GCANCEL1' } }));
  const a = await f.call('/pos/checkout', f.emp, 'POST', f.cart(f.shift.id, { fulfillmentMode: 'cod', delivery: ghnDelivery }));
  assert.equal(a.data.ghnShipment.ok, true);
  f.setReply(() => Response.json({ code: 200, data: [{ order_code: 'GCANCEL1', result: true, message: 'OK' }] }));
  const cancelled = await f.call('/orders/' + a.data.id + '/status', f.mgr, 'PUT', { status: 'cancelled' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.deepEqual(cancelled.data.ghnCancel, { cancelled: ['GCANCEL1'], errors: [] });
  const sent = f.calls.at(-1)!;
  assert.match(sent.url, /switch-status\/cancel$/); assert.deepEqual(sent.body, { order_codes: ['GCANCEL1'] }); assert.equal(sent.headers.ShopId, '6096731');
  const [shipA] = await f.db.select().from(deliveries).where(eq(deliveries.orderId, a.data.id));
  assert.deepEqual([shipA!.status, shipA!.trackingStatus], ['cancelled', 'cancel']);

  f.setReply(() => Response.json({ code: 200, data: { order_code: 'GCANCEL2' } }));
  const b = await f.call('/pos/checkout', f.emp, 'POST', f.cart(f.shift.id, { fulfillmentMode: 'cod', delivery: ghnDelivery }));
  const [shipB] = await f.db.select().from(deliveries).where(eq(deliveries.orderId, b.data.id));
  f.setReply(() => Response.json({ code: 200, data: [{ order_code: 'GCANCEL2', result: false, message: 'Đơn hàng đã lấy, không thể huỷ' }] }));
  const r = await f.call('/deliveries/' + shipB!.id + '/status', f.mgr, 'PUT', { status: 'cancelled' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.ghnCancel, { cancelled: [], errors: [{ code: 'GCANCEL2', message: 'Đơn hàng đã lấy, không thể huỷ' }] });
  assert.equal((await f.db.select().from(deliveries).where(eq(deliveries.id, shipB!.id)))[0]!.status, 'cancelled', 'CRM vẫn huỷ chuyến');
});

test('Đã có vận đơn GHN: không cho sửa SL / giá / người nhận ở CRM (GHN vẫn giữ số cũ)', async () => {
  const f = await withGhn();
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(f.shift.id, { fulfillmentMode: 'cod', delivery: ghnDelivery }));
  assert.equal(made.data.ghnShipment.ok, true);
  const d = (await f.call('/orders/' + made.data.id, f.mgr)).data, path = '/orders/' + made.data.id + '/pos';
  const lines = d.lines.map((l: any) => ({ id: l.id, qty: 3, price: 108000, discountType: 'percent', discountValue: 0 }));
  const edit = await f.call(path, f.mgr, 'PUT', { revision: d.order.revision, reason: 'Khách lấy thêm', lines });
  assert.equal(edit.status, 409); assert.equal(edit.data.code, 'GHN_SHIPMENT_EXISTS');
  const addr = await f.call(path, f.mgr, 'PUT', { revision: d.order.revision, reason: 'Đổi địa chỉ', delivery: { address: 'Địa chỉ khác', receiverName: 'Chị Lan', receiverPhone: '+84 901 234 567' } });
  assert.equal(addr.status, 409); assert.equal(addr.data.code, 'GHN_SHIPMENT_EXISTS');
});

test('Ship COD: GHN đã tạo nhưng CRM mất phản hồi → bấm tạo lại tra theo mã đơn, gắn đúng vận đơn (không kẹt vì trùng mã)', async () => {
  const f = await withGhn();
  let created = false;
  f.setReply(() => { throw new Error('unused'); });
  f.env.ghnFetch = (async (input, init) => {
    const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : null;
    f.calls.push({ url, headers: init?.headers as Record<string, string>, body });
    if (url.endsWith('/create')) { if (!created) { created = true; throw new Error('timeout sau khi GHN đã tạo'); } return Response.json({ code: 400, message: 'client_order_code đã tồn tại' }, { status: 400 }); }
    if (url.endsWith('/detail-by-client-code')) return created ? Response.json({ code: 200, data: { order_code: 'gabdup1', client_order_code: body.client_order_code, status: 'ready_to_pick' } }) : Response.json({ code: 400 }, { status: 400 });
    return Response.json({ code: 200, data: [] });
  }) as typeof fetch;
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(f.shift.id, { fulfillmentMode: 'cod', delivery: ghnDelivery }));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.ghnShipment.ok, true, 'tra theo mã đơn ngay trong lần tạo');
  const [ship] = await f.db.select().from(deliveries);
  assert.deepEqual([ship!.trackingCode, ship!.trackingStatus], ['GABDUP1', 'ready_to_pick']);
  const again = await f.call('/pos/cod/' + ship!.id + '/ghn', f.emp, 'POST', {});
  assert.deepEqual([again.data.orderCode, again.data.existing], ['GABDUP1', true]);
  assert.equal(f.calls.filter(c => c.url.endsWith('/create')).length, 1, 'không gọi tạo lần hai');
});
