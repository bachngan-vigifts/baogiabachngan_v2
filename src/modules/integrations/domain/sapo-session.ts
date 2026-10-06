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
 * Chuẩn hoá cookie Manager dán vào: nhận cả dòng `Cookie: a=1; b=2` lẫn chuỗi `a=1; b=2`.
 * Bắt buộc có `_admin_session_id` (phiên admin Sapo); trả '' nếu không hợp lệ.
 */
export function cleanCookie(raw: unknown): string {
  const value = String(raw ?? '').trim().replace(/^cookie:\s*/i, '').trim();
  if (!value || value.length > 30_000 || /[\r\n]/.test(value)) return '';
  return /(^|;\s*)_admin_session_id=[^;\s]+/.test(value) ? value : '';
}
