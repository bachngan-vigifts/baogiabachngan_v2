/**
 * Phiên đăng nhập Sapo admin của Manager (cookie). Lưu MÃ HOÁ AES-GCM; khoá dẫn xuất từ secret SAPO_SYNC_TOKEN
 * của máy chủ (không nằm trong DB), nên lộ DB không lộ phiên Sapo. Port ý tưởng từ `lib/sapo-admin.mjs` bản cũ.
 */
const b64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function key(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('missing key');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sapo-runtime-session:' + secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptCookie(secret: string, cookie: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), new TextEncoder().encode(cookie));
  return `${b64(iv)}.${b64(new Uint8Array(data))}`;
}

/** Trả '' nếu không giải mã được (đổi secret, dữ liệu hỏng). */
export async function decryptCookie(secret: string, payload: string): Promise<string> {
  try {
    const [iv, data] = payload.split('.');
    if (!iv || !data) return '';
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(secret), unb64(data));
    return new TextDecoder().decode(plain);
  } catch { return ''; }
}

/**
 * Cookie phiên admin Sapo: `_admin_session_id` (bản cũ) hoặc `sapo-admin` (Sapo đổi sang từ 10/2026).
 * Phải có ít nhất một trong hai thì mới là phiên đăng nhập.
 */
export const SAPO_SESSION_COOKIE_RE = /(^|;\s*)(_admin_session_id|sapo-admin)=[^;\s]+/;
export const hasSapoSessionCookie = (cookie: string) => SAPO_SESSION_COOKIE_RE.test(cookie);

/**
 * Chuẩn hoá cookie Manager dán vào: nhận cả dòng `Cookie: a=1; b=2` lẫn chuỗi `a=1; b=2`.
 * Bắt buộc có cookie phiên admin Sapo (`SAPO_SESSION_COOKIE_RE`); trả '' nếu không hợp lệ.
 */
export function cleanCookie(raw: unknown): string {
  const value = String(raw ?? '').trim().replace(/^cookie:\s*/i, '').trim();
  if (!value || value.length > 30_000 || /[\r\n]/.test(value)) return '';
  return hasSapoSessionCookie(value) ? value : '';
}

/**
 * Gộp cookie Sapo trả về (Set-Cookie) vào chuỗi cookie đang dùng: cùng tên thì thay giá trị mới, tên mới thì thêm,
 * cookie bị xoá (giá trị rỗng / Max-Age=0) thì bỏ. Nhờ vậy khi Sapo gia hạn hoặc đổi phiên, app giữ được phiên mới.
 */
export function mergeSetCookies(cookie: string, setCookies: string[]): string {
  const jar = new Map<string, string>();
  for (const part of cookie.split(';')) { const i = part.indexOf('='); if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim()); }
  for (const header of setCookies) {
    const [pair = '', ...attrs] = header.split(';'), i = pair.indexOf('=');
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
    const removed = !value || attrs.some(a => /^\s*max-age\s*=\s*(0|-\d+)\s*$/i.test(a)) || attrs.some(a => { const m = /^\s*expires\s*=(.*)$/i.exec(a); return !!m && Date.parse(m[1]!) < Date.now(); });
    if (!/^[\w.-]+$/.test(name) || /[\r\n;]/.test(value)) continue;
    if (removed) jar.delete(name); else jar.set(name, value);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}
