import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { posRegisters, webStoreOrders } from '../../src/modules/sales/pos-schema.ts';

test('Web Lock giữ địa chỉ GHN có cấu trúc, đưa lên danh sách và lưu địa chỉ CRM xác nhận', async () => {
  const f = await setup();
  await f.db.update(posRegisters).set({ name: 'CỬA HÀNG LOCKNLOCK CẦN THƠ' }).where(eq(posRegisters.id, f.registerId));
  const payload = {
    id: 98765, number: 'WEB-98765', status: 'pending', total: '150000', currency: 'VND',
    billing: { first_name: 'Khách GHN', phone: '0901234567' },
    shipping: { address_1: '123 Nguyễn Trãi', address_2: 'Phường An Hội', city: 'Quận Ninh Kiều', state: 'Cần Thơ' },
    line_items: [{ sku: '00123', name: 'Ly', quantity: 1, total: '150000' }],
    meta_data: [
      { key: '_lnl_ghn_shipping_province_id', value: '220' }, { key: '_lnl_ghn_shipping_province_name', value: 'Cần Thơ' },
      { key: '_lnl_ghn_shipping_district_id', value: '1574' }, { key: '_lnl_ghn_shipping_district_name', value: 'Quận Ninh Kiều' },
      { key: '_lnl_ghn_shipping_ward_code', value: '550307' }, { key: '_lnl_ghn_shipping_ward_name', value: 'Phường An Hội' },
    ],
  };
  let response = await f.call('/integrations/woocommerce/lock/order?token=test-lock-token', '', 'POST', payload);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  let [stored] = await f.db.select().from(webStoreOrders);
  assert.deepEqual(JSON.parse(stored!.ghnAddressSnapshot), { addressLine: '123 Nguyễn Trãi', provinceId: 220, provinceName: 'Cần Thơ', districtId: 1574, districtName: 'Quận Ninh Kiều', wardCode: '550307', wardName: 'Phường An Hội' });
  const board = await f.call('/pos/orders?registerId=' + f.registerId, f.mgr);
  assert.equal(board.data.orders[0].ghnAddress.wardCode, '550307');

  let sent: any;
  f.env.webOrderAction = { token: 'private', lockUrl: 'https://lock.test/action', minhlongUrl: '', fetch: (async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ status: 'processing', ghnOrderCode: 'GYMTEST' });
  }) as typeof fetch };
  response = await f.call('/pos/web-orders/' + stored!.id + '/action', f.mgr, 'POST', { action: 'confirm', addressLine: '456 Đường Mới', provinceId: 220, provinceName: 'Cần Thơ', districtId: 1574, districtName: 'Quận Ninh Kiều', wardCode: '550308', wardName: 'Phường Tân An' });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(sent.wardCode, '550308');
  [stored] = await f.db.select().from(webStoreOrders);
  assert.equal(JSON.parse(stored!.ghnAddressSnapshot).addressLine, '456 Đường Mới');
  assert.equal(stored!.address, '456 Đường Mới, Phường Tân An, Quận Ninh Kiều, Cần Thơ');
});

test('Webhook trạng thái rút gọn không xoá địa chỉ GHN đã lưu', async () => {
  const f = await setup();
  await f.db.update(posRegisters).set({ name: 'CỬA HÀNG LOCKNLOCK CẦN THƠ' }).where(eq(posRegisters.id, f.registerId));
  const path = '/integrations/woocommerce/lock/order?token=test-lock-token';
  await f.call(path, '', 'POST', { id: 1, number: 'W1', status: 'pending', billing: { first_name: 'A' }, shipping: { address_1: '1 A', address_2: 'P', city: 'Q', state: 'T' }, meta_data: [{ key: '_lnl_ghn_shipping_province_id', value: 1 }] });
  const before = (await f.db.select().from(webStoreOrders))[0]!.ghnAddressSnapshot;
  await f.call(path, '', 'POST', { id: 1, status: 'processing' });
  assert.equal((await f.db.select().from(webStoreOrders))[0]!.ghnAddressSnapshot, before);
});

test('Backfill đơn Web Lock cũ chỉ lưu địa chỉ có đủ mã GHN', async () => {
  const f = await setup();
  await f.db.update(posRegisters).set({ name: 'CỬA HÀNG LOCKNLOCK CẦN THƠ' }).where(eq(posRegisters.id, f.registerId));
  await f.call('/integrations/woocommerce/lock/order?token=test-lock-token', '', 'POST', { id: 2, number: 'OLD-2', status: 'processing', billing: { first_name: 'Cũ', phone: '0901' }, shipping: { address_1: 'Địa chỉ cũ' } });
  f.env.sapoSyncToken = 'sapo-sync-token-at-least-thirty-two-characters';
  f.env.webOrderAction = { token: 'private', lockUrl: 'https://lock.test/action', minhlongUrl: '', fetch: (async () => Response.json({ updatedAt: '2026-10-22T21:00:00Z', ghnAddress: { addressLine: '12 Hai Bà Trưng', provinceId: 220, provinceName: 'Cần Thơ', districtId: 1574, districtName: 'Quận Ninh Kiều', wardCode: '550307', wardName: 'Phường Tân An' } })) as typeof fetch };
  const result = await f.call('/integrations/woocommerce/lock/backfill-addresses?token=' + encodeURIComponent(f.env.sapoSyncToken), '', 'POST', {});
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual({ checked: result.data.checked, updated: result.data.updated, skipped: result.data.skipped }, { checked: 1, updated: 1, skipped: 0 });
  const [stored] = await f.db.select().from(webStoreOrders);
  assert.equal(JSON.parse(stored!.ghnAddressSnapshot).wardCode, '550307');
});
