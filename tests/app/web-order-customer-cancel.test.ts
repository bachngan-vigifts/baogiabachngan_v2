import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { posRegisters, webStoreOrders } from '../../src/modules/sales/pos-schema.ts';
import { auditLogs } from '../../src/core/db/schema.ts';
import { webNotifications as notifications } from '../../src/modules/notifications/schema.ts';
import { webOrderBucket } from '../../src/modules/sales/domain/web-order-outcome.ts';

/**
 * Khách huỷ đơn trên website (web-order-customer-cancel.ts): GHN chưa lấy hàng → CRM huỷ vận đơn GHN + huỷ đơn;
 * GHN đã lấy hàng → giữ theo quy trình GHN, báo Manager một lần. Chạy cho cả web Lock (vận đơn từ website) và Minh Long (vận đơn do CRM tạo).
 */
const SITES = { lock: ['CỬA HÀNG LOCKNLOCK CẦN THƠ', 'test-lock-token'], minhlong: ['Showroom Gốm Sứ Minh Long Cần Thơ', 'test-ml-token'] } as const;
async function fixture(source: keyof typeof SITES, ghn: string, ghnReply: 'ok' | 'refuse' = 'ok') {
  const f = await setup(), [name, token] = SITES[source];
  await f.db.update(posRegisters).set({ name }).where(eq(posRegisters.id, f.registerId));
  f.env.ghnToken = 'lock-token'; f.env.ghnMlToken = 'ml-token'; f.env.ghnMlShopId = '885001';
  const cancels: { code: string; token: string }[] = [];
  f.env.ghnFetch = (async (url: string, init?: RequestInit) => {
    assert.match(String(url), /switch-status\/cancel$/);
    const code = JSON.parse(String(init!.body)).order_codes[0], headers = init!.headers as Record<string, string>;
    cancels.push({ code, token: headers.Token! });
    return new Response(JSON.stringify({ code: 200, data: [{ order_code: code, result: ghnReply === 'ok', message: ghnReply === 'ok' ? 'OK' : 'Đơn hàng đã lấy, không thể huỷ' }] }), { status: 200 });
  }) as typeof fetch;
  let n = 0;
  // Lock: website gửi mã GHN trong meta; Minh Long: vận đơn do CRM tạo, website không biết mã.
  const send = (status: string) => f.call(`/integrations/woocommerce/${source}/order?token=${token}`, '', 'POST', { id: 7, number: 'W7', status, total: '100000', billing: { first_name: 'Khách', phone: '09' },
    line_items: [{ sku: '00123', name: 'Ly', quantity: 1, total: '100000' }],
    meta_data: source === 'lock' && ghn ? [{ key: '_lnl_ghn_order_code', value: 'G7' }, { key: '_lnl_ghn_last_status', value: ghn }] : [], date_modified_gmt: new Date(Date.now() + (n++) * 1000).toISOString() });
  assert.equal((await send('processing')).status, 200);
  if (source === 'minhlong' && ghn) await f.db.update(webStoreOrders).set({ ghnOrderCode: 'G7', ghnStatus: ghn }).where(eq(webStoreOrders.externalId, '7'));
  const row = async () => (await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.externalId, '7')))[0]!;
  const logs = async (id: string) => (await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'web-store-order'), eq(auditLogs.entityId, id)))).map(l => l.action);
  const alerts = async () => (await f.db.select().from(notifications).where(eq(notifications.eventType, 'web_order_customer_cancel'))).length;
  return { ...f, send, row, logs, alerts, cancels };
}

for (const source of ['lock', 'minhlong'] as const) {
  test(`${source}: chưa có vận đơn → huỷ đơn CRM theo website, không gọi GHN`, async () => {
    const f = await fixture(source, '');
    assert.equal((await f.send('cancelled')).status, 200);
    const o = await f.row();
    assert.equal(webOrderBucket(o.status, o.ghnStatus), 'cancelled'); assert.equal(f.cancels.length, 0);
    assert.deepEqual(await f.logs(o.id), [], 'website huỷ được ghi thẳng, không cần bước GHN');
  });

  for (const ghn of ['ready_to_pick', 'picking']) test(`${source}: GHN "${ghn}" (chưa lấy hàng) → CRM huỷ vận đơn GHN đúng tài khoản rồi huỷ đơn; gửi lặp không huỷ lại`, async () => {
    const f = await fixture(source, ghn);
    assert.equal((await f.send('cancelled')).status, 200);
    assert.equal((await f.send('cancelled')).status, 200);
    const o = await f.row();
    assert.equal(o.status, 'cancelled'); assert.equal(o.ghnStatus, 'cancel'); assert.equal(webOrderBucket(o.status, o.ghnStatus), 'cancelled');
    assert.deepEqual(f.cancels, [{ code: 'G7', token: source === 'lock' ? 'lock-token' : 'ml-token' }]);
    assert.deepEqual(await f.logs(o.id), ['web-order-customer-cancel-ghn-cancelled']);
    assert.equal(await f.alerts(), 0);
  });

  test(`${source}: GHN từ chối huỷ → giữ đơn chờ giao, báo Manager một lần`, async () => {
    const f = await fixture(source, 'ready_to_pick', 'refuse');
    assert.equal((await f.send('cancelled')).status, 200);
    assert.equal((await f.send('cancelled')).status, 200);
    const o = await f.row();
    assert.equal(webOrderBucket(o.status, o.ghnStatus), 'waiting_delivery'); assert.equal(o.ghnStatus, 'ready_to_pick');
    assert.equal(f.cancels.length, 2, 'lượt webhook sau thử huỷ lại');
    assert.deepEqual(await f.logs(o.id), ['web-order-customer-cancel-ghn-cancel-failed']);
    assert.ok(await f.alerts() >= 1);
    const before = await f.alerts(); await f.send('cancelled'); assert.equal(await f.alerts(), before, 'không báo trùng');
  });

  for (const ghn of ['picked', 'delivering']) test(`${source}: GHN "${ghn}" (đã lấy hàng) → không huỷ, theo quy trình GHN; báo Manager một lần`, async () => {
    const f = await fixture(source, ghn);
    assert.equal((await f.send('cancelled')).status, 200);
    const before = await f.alerts();
    assert.equal((await f.send('cancelled')).status, 200);
    const o = await f.row();
    assert.equal(webOrderBucket(o.status, o.ghnStatus), 'waiting_delivery'); assert.equal(o.ghnStatus, ghn);
    assert.equal(f.cancels.length, 0);
    assert.deepEqual(await f.logs(o.id), ['web-order-customer-cancel-after-pickup']);
    assert.ok(before >= 1); assert.equal(await f.alerts(), before);
  });
}

test('trạng thái khác "cancelled" không kích hoạt huỷ', async () => {
  const f = await fixture('lock', 'ready_to_pick');
  assert.equal((await f.send('on-hold')).status, 200);
  assert.equal(f.cancels.length, 0); assert.equal(webOrderBucket((await f.row()).status, (await f.row()).ghnStatus), 'waiting_delivery');
});
