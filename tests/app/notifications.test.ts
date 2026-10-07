import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { pricePolicies, productPrices, products } from '../../src/modules/catalog/schema.ts';
import { webPushKeys } from '../../src/modules/notifications/schema.ts';
import { b64url, decryptPushPayload } from '../../src/modules/notifications/domain/web-push.ts';

const origin = 'https://trial.test', SECRET = 'x'.repeat(40), t = '2026-10-06T00:00:00.000Z';
/** "Trình duyệt" nhận push: cặp khoá ECDH + auth như PushSubscription. */
async function browser(endpoint: string) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  return { subscription: { endpoint, keys: { p256dh: b64url(pub), auth: b64url(auth) } }, read: (body: Uint8Array) => decryptPushPayload(body, pair.privateKey, pub, auth).then(JSON.parse) };
}

test('Web Push như web cũ: khách đặt hàng / gửi báo giá / hỏi tồn → nhân viên phụ trách nhận thông báo; trả lời → khách nhận; trang tự làm mới qua /notifications', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const pushed: { endpoint: string; body: Uint8Array; headers: Record<string, string> }[] = [];
  let gone = '';
  const pushFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    pushed.push({ endpoint: String(url), body: init!.body as Uint8Array, headers: init!.headers as Record<string, string> });
    return new Response('', { status: String(url) === gone ? 410 : 201 });
  }) as typeof fetch;
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoSyncToken: SECRET, pushFetch };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string, pw = PASSWORD) => (await call('/login', '', 'POST', { email, password: pw })).cookie;
  const emp = await login('emp@x.vn'), mgr = await login('mgr@x.vn');
  await db.insert(customers).values({ id: '1001', name: 'Công ty Hoàng Long', contact: '', phone: '', email: '', address: '', search: '', taxCode: '', customerCode: '', sourceVersion: 0, syncedAt: t });
  await db.insert(pricePolicies).values({ id: 'le', name: 'Giá bán lẻ', sortOrder: 0 });
  await db.insert(products).values([{ sku: 'ML-01', name: 'Bộ trà Minh Long', brand: 'Minh Long', unit: 'bộ', updatedAt: t }, { sku: 'LL-01', name: 'Bình giữ nhiệt', brand: 'Lock&Lock', unit: 'cái', updatedAt: t }]);
  await db.insert(productPrices).values([{ sku: 'ML-01', policyId: 'le', price: 1_000_000 }, { sku: 'LL-01', policyId: 'le', price: 200_000 }]);

  // Khoá VAPID tự sinh, khoá riêng lưu mã hoá.
  const cfg = (await call('/push/config', emp)).data;
  assert.equal(cfg.enabled, true); assert.equal(cfg.publicKey.length, 87);
  const [k] = await db.select().from(webPushKeys); assert.ok(!k!.encryptedPrivateKey.includes(cfg.publicKey.slice(0, 10)));
  assert.equal((await call('/push/config', emp)).data.publicKey, cfg.publicKey, 'khoá giữ nguyên');

  // Nhân viên phụ trách bật thông báo trên 2 thiết bị; một thiết bị đã gỡ (410) thì bị tắt.
  const phone = await browser('https://fcm.googleapis.com/fcm/send/phone'), pc = await browser('https://updates.push.services.mozilla.com/wpush/v2/pc');
  assert.equal((await call('/push/subscribe', emp, 'POST', { subscription: { endpoint: 'http://x', keys: {} } })).status, 400);
  assert.equal((await call('/push/subscribe', emp, 'POST', { subscription: phone.subscription })).status, 200);
  assert.equal((await call('/push/subscribe', emp, 'POST', { subscription: pc.subscription })).status, 200);
  // Tự gửi thông báo thử: tới đúng các thiết bị của mình, không lưu vào chuông.
  const tp = await call('/push/test', emp, 'POST', {});
  assert.deepEqual(tp.data, { devices: 2, sent: 2 });
  assert.equal((await phone.read(pushed.find(p => p.endpoint.includes('phone'))!.body)).title, 'Thông báo thử');
  assert.equal((await call('/notifications', emp)).data.notifications.length, 0, 'thông báo thử không vào chuông');
  assert.deepEqual((await call('/push/test', mgr, 'POST', {})).data, { devices: 0, sent: 0 });
  pushed.length = 0;
  const acc = await call('/customer-accounts', emp, 'POST', { customerId: '1001', name: 'Chị Lan', email: 'lan@hl.vn' });
  await call('/activate', '', 'POST', { token: /token=([a-f0-9]{64})/.exec(acc.data.url)![1], password: 'khach-hang-123' });
  const kh = await login('lan@hl.vn', 'khach-hang-123');

  // Khách đặt hàng → push tới cả 2 thiết bị của nhân viên phụ trách, nội dung mã hoá đúng chuẩn.
  const o = await call('/portal/quotes', kh, 'POST', { items: [{ sku: 'ML-01', qty: 2 }], order: true, confirmed: true });
  assert.equal(o.status, 201);
  assert.equal(pushed.length, 2);
  assert.equal(pushed[0]!.headers['Content-Encoding'], 'aes128gcm'); assert.match(pushed[0]!.headers.Authorization!, /^vapid t=.+, k=/);
  const note = await phone.read(pushed.find(p => p.endpoint.includes('phone'))!.body);
  assert.deepEqual([note.eventType, note.title, note.url], ['customer_order', 'Khách đặt hàng', `/index.html#/orders/${o.data.orderId}`]);
  assert.match(note.body, /Công ty Hoàng Long đặt 1 sản phẩm/);
  // Trang nhân viên tự làm mới: /notifications?since= trả thông báo mới; Manager không thấy thông báo gửi đích danh nhân viên.
  let list = (await call('/notifications', emp)).data;
  assert.equal(list.unreadCount, 1); assert.equal(list.notifications[0].eventType, 'customer_order');
  assert.equal((await call('/notifications?since=' + encodeURIComponent(list.notifications[0].createdAt), emp)).data.notifications.length, 0);
  assert.equal((await call('/notifications', mgr)).data.notifications.length, 0);
  assert.equal((await call('/notifications/read', emp, 'POST', { all: true })).data.read, 1);
  assert.equal((await call('/notifications', emp)).data.unreadCount, 0);

  // Thiết bị đã gỡ đăng ký (410) bị tắt, lần sau chỉ gửi máy còn lại.
  gone = pc.subscription.endpoint; pushed.length = 0;
  await call('/portal/quotes', kh, 'POST', { items: [{ sku: 'LL-01', qty: 1 }] });
  assert.equal(pushed.length, 2); pushed.length = 0;
  const q2 = (await call('/notifications', emp)).data.notifications[0];
  assert.deepEqual([q2.eventType, q2.title], ['customer_quote', 'Khách gửi yêu cầu báo giá']);

  // Khách hỏi tồn → nhân viên phụ trách nhận; trả lời → khách nhận thông báo và thấy câu trả lời.
  assert.equal((await call('/portal/stock-requests', kh, 'POST', { items: [{ sku: 'NOPE', qty: 1 }] })).status, 400);
  const sr = await call('/portal/stock-requests', kh, 'POST', { items: [{ sku: 'ML-01', qty: 50 }, { sku: 'LL-01', qty: 200 }], note: 'Cần giao tuần sau' });
  assert.equal(sr.status, 201);
  assert.equal(pushed.length, 1, 'chỉ máy còn đăng ký'); assert.equal(pushed[0]!.endpoint, phone.subscription.endpoint);
  assert.equal((await phone.read(pushed[0]!.body)).eventType, 'customer_stock_request');
  const open = (await call('/stock-requests?status=open', emp)).data.requests;
  assert.deepEqual([open.length, open[0].customerName, open[0].items.length, open[0].note], [1, 'Công ty Hoàng Long', 2, 'Cần giao tuần sau']);
  assert.equal((await call('/stock-requests', mgr)).data.requests.length, 1, 'Manager thấy tất cả');
  assert.equal((await call('/stock-requests', kh)).status, 403, 'khách không gọi API nhân viên');
  assert.equal((await call(`/stock-requests/${sr.data.id}/answer`, emp, 'POST', {})).status, 400);
  assert.equal((await call(`/stock-requests/${sr.data.id}/answer`, emp, 'POST', { items: [{ sku: 'ML-01', available: 50 }, { sku: 'LL-01', available: 120 }], answer: 'Lock&Lock còn 120, 80 cái về sau 5 ngày' })).status, 200);
  const mineReq = (await call('/portal/stock-requests', kh)).data.requests[0];
  assert.deepEqual([mineReq.status, mineReq.answerItems[1].available, mineReq.answer], ['answered', 120, 'Lock&Lock còn 120, 80 cái về sau 5 ngày']);
  const khNotes = (await call('/notifications', kh)).data.notifications;
  assert.deepEqual([khNotes[0].eventType, khNotes[0].url], ['stock_answer', '/customer.html#stock']);

  // Nhân viên xác nhận đơn / báo giá của khách → khách nhận thông báo.
  await call('/orders/' + o.data.orderId + '/status', emp, 'PUT', { status: 'confirmed', verified: true });
  assert.equal((await call('/notifications', kh)).data.notifications[0].eventType, 'order_confirmed');
  const qid = (await call('/portal/quotes', kh)).data.quotes.find((x: any) => !x.order)?.id;
  await call('/quotes/' + qid + '/approve', emp, 'POST', { revision: 1 });
  assert.equal((await call('/notifications', kh)).data.notifications[0].eventType, 'quote_confirmed');
});

test('Web Push chưa có SAPO_SYNC_TOKEN: thông báo vẫn lưu (trang tự làm mới), chỉ không đẩy', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), env = { db, passwordIterations: 1000 };
  const call = async (path: string, cookie = '') => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { headers: { origin, cookie } }), env);
    return { status: res.status, data: await res.json() as any };
  };
  const res = await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'mgr@x.vn', password: PASSWORD }) }), env);
  const mgr = res.headers.get('set-cookie')!.split(';')[0]!;
  assert.deepEqual((await call('/push/config', mgr)).data, { enabled: false, publicKey: '' });
  const { notify } = await import('../../src/modules/notifications/api/routes.ts');
  assert.equal((await notify(env, { eventType: 'x', title: 'Thử', targetRole: 'manager' })).ok, true);
  assert.equal((await call('/notifications', mgr)).data.notifications[0].title, 'Thử');
});
