import { SESSION_COOKIE, sessionCookie, sha256Hex } from '../domain/session.ts';

/**
 * Phiên đăng nhập khi đi qua Edge Function `baogia-v2-api` (supabase/functions) và proxy cùng tên miền giao diện
 * (functions/api/staff/[[path]].js – Cloudflare Pages Function). Trình duyệt chỉ giữ cookie HttpOnly `__Host-bn-session`
 * của chính tên miền giao diện (first-party); token KHÔNG nằm trong JSON và không nằm trong Web Storage.
 */
/** Proxy gửi kèm mã bí mật dùng chung (secret API_PROXY_SECRET) để Edge Function tin IP người dùng nó chuyển tiếp. */
export const PROXY_SECRET_HEADER = 'x-bn-proxy-secret';
/** IP thật của người dùng do proxy ghi (Cloudflare ghi đè cf-connecting-ip của yêu cầu từ Worker bằng IP của Worker). */
export const CLIENT_IP_HEADER = 'x-bn-client-ip';

const SESSION_RE = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]{64})(?:;|$)`);
const sameSecret = (a: string, b: string) => {
  const x = sha256Hex(a), y = sha256Hex(b);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
};

/**
 * Header chuyển cho router từ yêu cầu vào Edge Function:
 * - chỉ giữ cookie phiên (bỏ mọi cookie khác);
 * - luồng đồng bộ Sapo (`sync`) không dùng phiên: bỏ cookie, giữ nguyên Authorization cho router kiểm mã bí mật;
 * - `Authorization: Bearer <token>` của bản giao diện cũ (token từng lưu ở localStorage) được đổi thành cookie MỘT lần:
 *   trả `legacyToken` để phản hồi đặt cookie HttpOnly, từ đó giao diện chỉ dùng cookie. (Chuyển tiếp – bỏ được khi
 *   không còn máy nào giữ token cũ: 30 ngày sau khi bản này lên.)
 * - IP người dùng từ proxy chỉ được tin khi proxy gửi đúng mã bí mật (≥ 32 ký tự); dùng cho giới hạn số lần đăng nhập.
 */
export function edgeRequestHeaders(incoming: Headers, o: { sync: boolean; proxySecret?: string }): { headers: Headers; legacyToken: string } {
  const headers = new Headers(incoming);
  const cookie = SESSION_RE.exec(incoming.get('cookie') || '')?.[1] ?? '';
  const secret = headers.get(PROXY_SECRET_HEADER) || '', ip = (headers.get(CLIENT_IP_HEADER) || '').trim();
  for (const k of ['cookie', PROXY_SECRET_HEADER, CLIENT_IP_HEADER]) headers.delete(k);
  if ((o.proxySecret ?? '').length >= 32 && secret && sameSecret(secret, o.proxySecret!) && /^[0-9a-f:.]{2,45}$/i.test(ip)) headers.set('cf-connecting-ip', ip);
  if (o.sync) return { headers, legacyToken: '' };
  const bearer = /^Bearer ([a-f0-9]{64})$/.exec(headers.get('authorization') || '')?.[1] ?? '';
  headers.delete('authorization');
  const token = cookie || bearer;
  if (token) headers.set('cookie', `${SESSION_COOKIE}=${token}`);
  return { headers, legacyToken: cookie ? '' : bearer };
}

/**
 * Cookie gửi về trình duyệt: giữ nguyên Set-Cookie của router (đăng nhập, gia hạn, đăng xuất). Yêu cầu dùng token cũ
 * (Bearer) thành công mà router không đặt cookie → đặt cookie phiên cho token đó (chuyển từ localStorage sang cookie).
 */
export function edgeResponseCookies(res: Response, legacyToken: string): string[] {
  const set = res.headers.getSetCookie();
  if (!set.length && legacyToken && res.ok) return [sessionCookie(legacyToken)];
  return set;
}
