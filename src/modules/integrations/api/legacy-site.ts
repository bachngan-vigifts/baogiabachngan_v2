import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';

/**
 * WEB CŨ (baogia.minhlongonline.com) – nơi đang giữ ảnh sản phẩm của 4.000+ mã (`/api/staff/media-file?key=<sha256>`).
 * Ảnh ở đó chỉ trả cho người đã đăng nhập, nên máy chủ đăng nhập bằng một tài khoản nhân viên web cũ
 * (secret LEGACY_STAFF_EMAIL / LEGACY_STAFF_PASSWORD trên Supabase), giữ phiên trong bộ nhớ isolate và đăng nhập lại khi hết hạn.
 * Dùng cho: tải ảnh vào PDF / Excel (/images/fetch) và chuyển hẳn ảnh sang kho mới (/catalog/legacy-images/migrate).
 */
export const LEGACY_MEDIA = /^https:\/\/baogia\.minhlongonline\.com\/api\/staff\/media-file\?key=([a-f0-9]{64})$/;
export const legacyMediaKey = (url: string) => LEGACY_MEDIA.exec(url)?.[1] ?? null;

const COOKIE = '__Host-bn-session';
export class LegacyRateLimitError extends AppError {
  constructor(readonly retryAfter: number) {
    super(429, 'Web cũ đang giới hạn đăng nhập (429). Chờ ' + retryAfter + ' giây rồi tiếp tục; không cần đổi mật khẩu.');
  }
}
const sessionKey = async (site: NonNullable<StaffEnv['legacySite']>) => crypto.subtle.importKey(
  'raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['legacy-image-session-v1', site.base, site.email, site.password]))),
  'AES-GCM', false, ['encrypt', 'decrypt']);
/** Phiên được mã hoá, gắn với phiên Manager, để dùng tiếp khi Edge đổi isolate. Không trả cookie web cũ dạng rõ. */
export async function exportLegacySession(env: StaffEnv, owner: string): Promise<string | null> {
  const site = env.legacySite;
  if (!site || !session || session.base !== site.base || session.email !== site.email) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify({ cookie: session.cookie, expires: Date.now() + 3600_000 }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(owner) }, await sessionKey(site), bytes);
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(ciphertext)));
}
export async function restoreLegacySession(env: StaffEnv, owner: string, token: unknown): Promise<void> {
  const site = env.legacySite;
  if (!site || typeof token !== 'string' || token.length > 4096) return;
  try {
    const bytes = Uint8Array.from(atob(token), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(owner) }, await sessionKey(site), bytes.slice(12));
    const value = JSON.parse(new TextDecoder().decode(plain));
    if (typeof value.cookie !== 'string' || !/^__Host-bn-session=[A-Za-z0-9._~-]+$/.test(value.cookie) || !(value.expires > Date.now())) return;
    session = { cookie: value.cookie, at: Date.now(), email: site.email, base: site.base };
  } catch { /* token hết hạn / bị sửa / đổi tài khoản: đăng nhập bình thường */ }
}
let session: { cookie: string; at: number; email: string; base: string } | null = null;
let pendingLogin: { site: NonNullable<StaffEnv['legacySite']>; promise: Promise<string> } | null = null;
/** Xoá phiên đã nhớ (test). */
export const resetLegacySession = () => { session = null; pendingLogin = null; };

async function loginRequest(site: NonNullable<StaffEnv['legacySite']>): Promise<string> {
  const doFetch = site.fetch ?? fetch;
  let res: Response;
  try {
    // Web cũ chỉ nhận POST có Origin đúng của chính nó.
    res = await doFetch(`${site.base}/api/staff/login`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', origin: site.base }, body: JSON.stringify({ email: site.email, password: site.password }) });
  } catch { throw new AppError(502, 'Không kết nối được web cũ để lấy ảnh.'); }
  if (res.status === 429) {
    const retry = res.headers.get('retry-after') || '';
    const seconds = /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000);
    throw new LegacyRateLimitError(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) : 900);
  }
  const raw = res.headers.get('set-cookie') ?? '', m = new RegExp(`${COOKIE}=([^;,\\s]+)`).exec(raw);
  if (!res.ok || !m) throw new AppError(502, `Đăng nhập web cũ để lấy ảnh không được (${res.status}). Kiểm tra secret LEGACY_STAFF_EMAIL / LEGACY_STAFF_PASSWORD.`);
  session = { cookie: `${COOKIE}=${m[1]}`, at: Date.now(), email: site.email, base: site.base };
  return session.cookie;
}

/** Các ảnh được tải song song dùng chung một lần đăng nhập, tránh phiên vừa tạo bị lần khác thay thế. */
async function login(site: NonNullable<StaffEnv['legacySite']>): Promise<string> {
  if (session?.email === site.email && session.base === site.base) return session.cookie;
  if (pendingLogin?.site.email === site.email && pendingLogin.site.base === site.base
    && pendingLogin.site.password === site.password) return pendingLogin.promise;
  const pending = { site, promise: loginRequest(site) };
  pendingLogin = pending;
  try { return await pending.promise; }
  finally { if (pendingLogin === pending) pendingLogin = null; }
}

/** Tải một file ảnh của web cũ (đăng nhập lại 1 lần nếu phiên hết hạn). Trả về Response gốc (đã ok). */
export async function fetchLegacyMedia(env: StaffEnv, url: string): Promise<Response> {
  const site = env.legacySite;
  if (!site?.email || !site.password) throw new AppError(502, 'Ảnh nằm trên web cũ (cần đăng nhập) – chưa cấu hình secret LEGACY_STAFF_EMAIL / LEGACY_STAFF_PASSWORD.');
  if (!legacyMediaKey(url)) throw new AppError(400, 'Không phải link ảnh của web cũ.');
  const doFetch = site.fetch ?? fetch;
  for (let attempt = 0; attempt < 2; attempt++) {
    const cookie = await login(site);
    let res: Response;
    try { res = await doFetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { cookie, accept: 'image/*' } }); }
    catch { throw new AppError(502, 'Không tải được ảnh từ web cũ.'); }
    if (res.status === 401 || res.status === 403) {
      // Yêu cầu cũ trả 401 không được xoá phiên mới do yêu cầu khác vừa đăng nhập lại.
      if (session?.cookie === cookie) session = null;
      continue;
    }
    if (res.status === 404) throw new AppError(404, 'Web cũ không còn file ảnh này.');
    if (!res.ok) throw new AppError(502, `Web cũ trả lỗi ${res.status} khi lấy ảnh.`);
    return res;
  }
  throw new AppError(502, 'Tài khoản web cũ không có quyền xem ảnh.');
}
