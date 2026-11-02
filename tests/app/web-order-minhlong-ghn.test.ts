import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { posRegisters, webStoreOrders } from '../../src/modules/sales/pos-schema.ts';

/** Đơn web Minh Long khi website chưa có cầu nối: CRM tự tạo / huỷ vận đơn bằng tài khoản GHN Minh Long, đồng bộ trạng thái như Lock. */
const address = { addressLine: '12 Hai Bà Trưng', provinceId: 220, provinceName: 'Cần Thơ', districtId: 1574, districtName: 'Quận Ninh Kiều', wardCode: '550307', wardName: 'Phường Tân An' };

async function minhLong() {
  const f = await setup();
  await f.db.update(posRegisters).set({ name: 'Showroom Gốm Sứ Minh Long Cần Thơ' }).where(eq(posRegisters.id, f.registerId));
  f.env.ghnMlToken = 'ml-token'; f.env.ghnMlShopId = '885001';
  const sync = (body: Record<string, unknown>) => f.call('/integrations/woocommerce/minhlong/order?token=test-ml-token', '', 'POST', body);
  const order = async (id: number, extra: Record<string, unknown> = {}) => {
    const r = await sync({ id, number: 'ML' + id, status: 'processing', total: '300000', currency: 'VND', payment_method_title: 'Trả tiền khi nhận hàng',
      billing: { first_name: 'Khách ML', phone: '0901 234 567' }, shipping: { address_1: '12 Hai Bà Trưng', city: 'Ninh Kiều', state: 'Cần Thơ' },
      line_items: [{ sku: 'BT07', name: 'Bộ trà 0.7 L Chim Lạc', quantity: 2, total: '300000' }], meta_data: [], ...extra });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return (await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.externalId, String(id))))[0]!;
  };
  const ghn: { url: string; headers: Record<string, string>; body: any }[] = [];
  const respond: { next: (url: string, body: any) => Response } = { next: () => Response.json({ code: 200, data: {} }) };
  f.env.ghnFetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    ghn.push({ url: String(url), headers: init?.headers as Record<string, string>, body });
    return respond.next(String(url), body);
  }) as typeof fetch;
  const act = (id: string, body: Record<string, unknown>) => f.call('/pos/web-orders/' + id + '/action', f.mgr, 'POST', body);
  return { f, sync, order, ghn, respond, act };
}

test('Web Minh Long: xác nhận tạo vận đơn GHN Minh Long (COD, khối lượng sửa được), Woo không xoá mã GHN / không kéo đơn về chờ', async () => {
  const { f, sync, order, ghn, respond, act } = await minhLong();
  const o = await order(501);
  const board = (await f.call('/pos/orders?registerId=' + f.registerId, f.mgr)).data.orders.find((x: any) => x.id === o.id);
  assert.deepEqual([board.actionsAvailable, board.ghnDirect, board.suggestedCod], [true, true, 300000]);

  // Danh mục địa chỉ lấy trong CRM (bản đóng gói sẵn), không cần cầu nối website.
  const provinces = await act(o.id, { action: 'locations' });
  assert.equal(provinces.status, 200, JSON.stringify(provinces.data)); assert.ok(provinces.data.locations.length > 0);

  assert.equal((await act(o.id, { action: 'confirm', ...address, codAmount: 300001 })).status, 400, 'COD vượt tổng đơn');
  assert.equal(ghn.length, 0);
  respond.next = () => Response.json({ code: 200, data: { order_code: 'gmlx01', total_fee: 32000, sort_code: '055-B' } });
  const ok = await act(o.id, { action: 'confirm', ...address, codAmount: 250000, ghnWeight: 1500, ghnRequiredNote: 'CHOTHUHANG' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual([ok.data.ghnOrderCode, ok.data.bucket], ['GMLX01', 'waiting_delivery']);
  const sent = ghn.at(-1)!;
  assert.match(sent.url, /shipping-order\/create$/);
  assert.deepEqual([sent.headers.Token, sent.headers.ShopId], ['ml-token', '885001']);
  assert.deepEqual([sent.body.client_order_code, sent.body.cod_amount, sent.body.weight, sent.body.required_note, sent.body.to_ward_code, sent.body.to_phone],
    ['WEB-ML501', 250000, 1500, 'CHOTHUHANG', '550307', '0901234567']);
  assert.deepEqual(sent.body.items, [{ name: 'Bộ trà 0.7 L Chim Lạc', code: 'BT07', quantity: 2, price: 150000 }]);
  let [stored] = await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id, o.id));
  assert.deepEqual([stored!.ghnOrderCode, stored!.ghnStatus, stored!.ghnFee, stored!.ghnSortCode, stored!.address],
    ['GMLX01', 'ready_to_pick', 32000, '055-B', '12 Hai Bà Trưng, Phường Tân An, Quận Ninh Kiều, Cần Thơ']);
  const sentCount=ghn.length;const replay=await act(o.id,{action:'confirm',...address});assert.equal(replay.status,200);assert.equal(replay.data.ghnOrderCode,'GMLX01');assert.equal(ghn.length,sentCount,'gửi lại trả mã cũ, không tạo vận đơn lần hai');

  // Website Minh Long gửi lại đơn (không biết vận đơn CRM tạo): giữ mã GHN, không kéo về "chờ xử lý".
  await sync({ id: 501, status: 'processing', meta_data: [] });
  [stored] = await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id, o.id));
  assert.equal(stored!.ghnOrderCode, 'GMLX01');
  assert.equal(stored!.status, 'processing');

  // Đồng bộ trạng thái GHN bằng tài khoản Minh Long: giao xong → hoàn thành.
  const { resetGhnSyncThrottle } = await import('../../src/modules/sales/api/pos-ghn-sync.ts'); resetGhnSyncThrottle();
  respond.next = (url) => /detail$/.test(url) ? Response.json({ code: 200, data: { status: 'delivered', updated_date: '2026-10-23T10:00:00Z' } }) : Response.json({});
  const pulled = await f.call('/pos/ghn/sync', f.mgr, 'POST', {});
  assert.equal(pulled.status, 200, JSON.stringify(pulled.data)); assert.equal(pulled.data.updated, 1);
  assert.equal(ghn.at(-1)!.headers.ShopId, '885001');
  [stored] = await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id, o.id));
  assert.deepEqual([stored!.status, stored!.ghnStatus], ['completed', 'delivered']);
  // Đơn CRM đã hoàn thành: website gửi "processing" không mở lại.
  await sync({ id: 501, status: 'processing' });
  assert.equal((await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id, o.id)))[0]!.status, 'completed');
});

test('Web Minh Long: huỷ đơn huỷ vận đơn GHN trước – GHN từ chối thì giữ đơn; webhook GHN chỉ nhận shop Minh Long', async () => {
  const { f, order, ghn, respond, act } = await minhLong();
  const o = await order(502, { date_paid_gmt: '2026-10-23T08:00:00' });
  assert.equal((await f.call('/pos/orders?registerId=' + f.registerId, f.mgr)).data.orders.find((x: any) => x.id === o.id).suggestedCod, 0, 'đã thanh toán online: gợi ý COD 0');
  respond.next = () => Response.json({ code: 200, data: { order_code: 'GMLX02', total_fee: 30000 } });
  assert.equal((await act(o.id, { action: 'confirm', ...address })).status, 200);
  assert.equal(ghn.at(-1)!.body.cod_amount, 0);

  f.env.ghnWebhookToken = 'w'.repeat(40);
  const hook = (body: Record<string, unknown>) => f.call('/integrations/ghn/pos-lock/webhook?token=' + 'w'.repeat(40), '', 'POST', body);
  assert.equal((await hook({ OrderCode: 'GMLX02', Status: 'picked', ShopID: 6096731 })).status, 403, 'shop Lock không cập nhật đơn Minh Long');
  assert.equal((await hook({ OrderCode: 'GMLX02', Status: 'picked', ShopID: 885001 })).status, 200);
  assert.equal((await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id, o.id)))[0]!.ghnStatus, 'picked');

  respond.next = () => Response.json({ code: 200, data: [{ order_code: 'GMLX02', result: false, message: 'Đơn đã lấy hàng' }] });
  const refused = await act(o.id, { action: 'cancel', reason: 'Khách đổi ý' });
  assert.equal(refused.status, 409); assert.match(refused.data.error, /Đơn đã lấy hàng/);
  assert.notEqual((await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id, o.id)))[0]!.status, 'cancelled');

  respond.next = () => Response.json({ code: 200, data: [{ order_code: 'GMLX02', result: true }] });
  const cancelled = await act(o.id, { action: 'cancel', reason: 'Khách đổi ý' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data)); assert.equal(cancelled.data.bucket, 'cancelled');
  assert.deepEqual(ghn.at(-1)!.body, { order_codes: ['GMLX02'] });
});

test('Web Minh Long: có cầu nối website thì đi qua cầu nối như Lock, không tự gọi GHN', async () => {
  const { f, order, ghn, act } = await minhLong();
  const o = await order(503);
  let bridge = 0;
  f.env.webOrderAction = { token: 'private', lockUrl: '', minhlongUrl: 'https://ml.test/action', fetch: (async () => { bridge++; return Response.json({ status: 'processing', ghnOrderCode: 'BRIDGE1' }); }) as typeof fetch };
  const r = await act(o.id, { action: 'confirm', ...address });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([bridge, ghn.length, r.data.ghnOrderCode], [1, 0, 'BRIDGE1']);
});

test('GHN ưu tiên hơn website hoàn thành; không cho bấm hoàn thành tay, delivered không lùi theo website',async()=>{
 const {f,order,sync,act}=await minhLong();
 const o=await order(599,{status:'completed',meta_data:[{key:'_lnl_ghn_order_code',value:'PRIORITY599'},{key:'_lnl_ghn_last_status',value:'delivering'}]});
 assert.equal(o.status,'processing');
 assert.equal((await act(o.id,{action:'complete'})).data.code,'GHN_STATUS_MANAGED');
 await sync({id:599,status:'completed',meta_data:[]});
 let stored=(await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id,o.id)))[0]!;
 assert.equal(stored.ghnOrderCode,'PRIORITY599');assert.equal(stored.status,'processing');
 f.env.ghnWebhookToken='w'.repeat(40);
 const hook=(status:string)=>f.call('/integrations/ghn/pos-lock/webhook?token='+'w'.repeat(40),'','POST',{OrderCode:'PRIORITY599',Status:status,ShopID:885001});
 assert.equal((await hook('delivered')).status,200);
 await sync({id:599,status:'processing',meta_data:[{key:'_lnl_ghn_order_code',value:'PRIORITY599'},{key:'_lnl_ghn_last_status',value:'delivering'}]});
 stored=(await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id,o.id)))[0]!;
 assert.equal(stored.status,'completed');assert.equal(stored.ghnStatus,'delivered');
 // Same carrier event also repairs a stale website label.
 await f.db.update(webStoreOrders).set({status:'processing'}).where(eq(webStoreOrders.id,o.id));
 assert.equal((await hook('delivered')).status,200);
 assert.equal((await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id,o.id)))[0]!.status,'completed');
});

test('Web Minh Long: tạo vận đơn mất phản hồi / trùng mã đơn → tra GHN theo mã đơn và gắn lại đúng vận đơn, không tạo trùng', async () => {
  const { order, ghn, respond, act } = await minhLong();
  const o = await order(601);
  // GHN đã tạo nhưng CRM không nhận được phản hồi (hết giờ) → tra theo client_order_code.
  respond.next = (url, body) => {
    if (url.endsWith('/create')) throw new Error('timeout sau khi GHN đã tạo');
    if (url.endsWith('/detail-by-client-code')) return body.client_order_code === 'WEB-ML601' ? Response.json({ code: 200, data: { order_code: 'gmlx77', client_order_code: 'WEB-ML601', status: 'ready_to_pick', total_fee: 30000 } }) : Response.json({ code: 400, message: 'not found' }, { status: 400 });
    return Response.json({ code: 200, data: {} });
  };
  const r = await act(o.id, { action: 'confirm', ...address, codAmount: 300000 });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.ghnOrderCode, 'GMLX77');
  assert.deepEqual(ghn.filter(x => /create|client-code/.test(x.url)).map(x => x.url.split('/').pop()), ['create', 'detail-by-client-code']);
  // GHN thật sự chưa tạo (tra không thấy): báo lỗi như cũ, không gắn mã.
  const o2 = await order(602);
  respond.next = url => url.endsWith('/create') ? Response.json({ code: 400, code_message_value: 'Địa chỉ không hợp lệ' }, { status: 400 }) : Response.json({ code: 400, message: 'not found' }, { status: 400 });
  const bad = await act(o2.id, { action: 'confirm', ...address, codAmount: 300000 });
  assert.equal(bad.status, 502); assert.match(bad.data.error, /Địa chỉ không hợp lệ/);
});
