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
let session: { cookie: string; at: number; email: string } | null = null;
/** Xoá phiên đã nhớ (test). */
export const resetLegacySession = () => { session = null; };

async function login(site: NonNullable<StaffEnv['legacySite']>): Promise<string> {
  const doFetch = site.fetch ?? fetch;
  let res: Response;
  try {
    // Web cũ chỉ nhận POST có Origin đúng của chính nó.
    res = await doFetch(`${site.base}/api/staff/login`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', origin: site.base }, body: JSON.stringify({ email: site.email, password: site.password }) });
  } catch { throw new AppError(502, 'Không kết nối được web cũ để lấy ảnh.'); }
  const raw = res.headers.get('set-cookie') ?? '', m = new RegExp(`${COOKIE}=([^;,\\s]+)`).exec(raw);
  if (!res.ok || !m) throw new AppError(502, `Đăng nhập web cũ để lấy ảnh không được (${res.status}). Kiểm tra secret LEGACY_STAFF_EMAIL / LEGACY_STAFF_PASSWORD.`);
  session = { cookie: `${COOKIE}=${m[1]}`, at: Date.now(), email: site.email };
  return session.cookie;
}

/** Tải một file ảnh của web cũ (đăng nhập lại 1 lần nếu phiên hết hạn). Trả về Response gốc (đã ok). */
export async function fetchLegacyMedia(env: StaffEnv, url: string): Promise<Response> {
  const site = env.legacySite;
  if (!site?.email || !site.password) throw new AppError(502, 'Ảnh nằm trên web cũ (cần đăng nhập) – chưa cấu hình secret LEGACY_STAFF_EMAIL / LEGACY_STAFF_PASSWORD.');
  if (!legacyMediaKey(url)) throw new AppError(400, 'Không phải link ảnh của web cũ.');
  const doFetch = site.fetch ?? fetch;
  for (let attempt = 0; attempt < 2; attempt++) {
    const cookie = session && session.email === site.email && attempt === 0 ? session.cookie : await login(site);
    let res: Response;
    try { res = await doFetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { cookie, accept: 'image/*' } }); }
    catch { throw new AppError(502, 'Không tải được ảnh từ web cũ.'); }
    if (res.status === 401 || res.status === 403) { session = null; continue; }
    if (res.status === 404) throw new AppError(404, 'Web cũ không còn file ảnh này.');
    if (!res.ok) throw new AppError(502, `Web cũ trả lỗi ${res.status} khi lấy ảnh.`);
    return res;
  }
  throw new AppError(502, 'Tài khoản web cũ không có quyền xem ảnh.');
}
