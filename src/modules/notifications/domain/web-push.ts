/**
 * Web Push (như web cũ `lib/web-push-notifications.mjs`) chạy bằng WebCrypto (Deno / Node):
 *  - VAPID (RFC 8292): JWT ES256 ký bằng khoá riêng của máy chủ.
 *  - Mã hoá nội dung (RFC 8291, `aes128gcm`): web cũ gửi push RỖNG rồi service worker gọi API bằng cookie để lấy nội dung;
 *    web mới đăng nhập bằng mã phiên trong tab (service worker không đọc được) nên nội dung thông báo được mã hoá gửi kèm.
 */
const enc = new TextEncoder();
export const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64url = (s: string) => {
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t.padEnd(Math.ceil(t.length / 4) * 4, '=')), c => c.charCodeAt(0));
};
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const subtle = () => globalThis.crypto.subtle;

export interface VapidKeys { publicKey: string; privateKey: string }
/** Cặp khoá VAPID mới: `publicKey` = điểm P-256 không nén (65 byte, base64url); `privateKey` = thành phần d (base64url). */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const jwk = await subtle().exportKey('jwk', pair.privateKey);
  return { publicKey: b64url(raw), privateKey: jwk.d! };
}

/** Header Authorization `vapid t=<JWT>, k=<khoá công khai>` cho một endpoint push. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, nowSec = Math.floor(Date.now() / 1000)) {
  const pub = fromB64url(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('Khoá VAPID công khai không hợp lệ.');
  const key = await subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), d: keys.privateKey, ext: false },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`)));
  return `vapid t=${header}.${payload}.${b64url(sig)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await subtle().importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, bytes * 8));
}

/** Mã hoá nội dung push cho một trình duyệt (khoá `p256dh`, `auth` của subscription) theo RFC 8291 / RFC 8188 (một bản ghi). */
export async function encryptPushPayload(plaintext: string, p256dh: string, auth: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const uaPublic = fromB64url(p256dh), authSecret = fromB64url(auth);
  const local = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await subtle().exportKey('raw', local.publicKey));
  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(enc.encode(plaintext), new Uint8Array([2]))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** Giải mã (phía trình duyệt) – dùng trong test để chứng minh mã hoá đúng chuẩn. */
export async function decryptPushPayload(body: Uint8Array, uaPrivate: CryptoKey, uaPublicRaw: Uint8Array, auth: Uint8Array) {
  const salt = body.slice(0, 16), idlen = body[20]!, asPublic = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
  const asKey = await subtle().importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: asKey }, uaPrivate, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublicRaw, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await subtle().importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
  return new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2)));
}
