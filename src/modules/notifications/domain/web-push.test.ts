import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64url, decryptPushPayload, encryptPushPayload, fromB64url, generateVapidKeys, vapidAuthorization } from './web-push.ts';

test('Web Push: nội dung mã hoá aes128gcm giải mã lại đúng (RFC 8291); JWT VAPID ký ES256 xác minh được', async () => {
  // "Trình duyệt": cặp khoá ECDH + auth 16 byte như PushSubscription.
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  const msg = JSON.stringify({ title: 'Khách đặt hàng', body: 'Công ty Hoàng Long – 3 sản phẩm', url: '/index.html#/orders' });
  const body = await encryptPushPayload(msg, b64url(uaPublic), b64url(auth));
  assert.equal(new DataView(body.buffer).getUint32(16), 4096); assert.equal(body[20], 65);
  assert.equal(await decryptPushPayload(body, ua.privateKey, uaPublic, auth), msg);

  const keys = await generateVapidKeys();
  assert.equal(fromB64url(keys.publicKey).length, 65);
  const h = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:x@y.vn', 1_800_000_000);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h)!;
  assert.equal(k, keys.publicKey);
  const [hd, pl, sig] = jwt!.split('.');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromB64url(pl!))), { aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 43200, sub: 'mailto:x@y.vn' });
  const pub = fromB64url(keys.publicKey);
  const verifyKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)) }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, fromB64url(sig!), new TextEncoder().encode(`${hd}.${pl}`)));
});
