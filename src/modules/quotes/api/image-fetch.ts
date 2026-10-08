import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError, badRequest } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { IMAGE_FETCH_MAX_BYTES, readLimited, sniffImage, toBase64 } from '../../../core/http/image-bytes.ts';
export { IMAGE_FETCH_MAX_BYTES, sniffImage } from '../../../core/http/image-bytes.ts';
import { fetchLegacyMedia, legacyMediaKey } from '../../integrations/api/legacy-site.ts';

/**
 * Ảnh sản phẩm / maquette cho file PDF / Excel báo giá: trình duyệt không vẽ được ảnh từ link ngoài (Sapo CDN, link dán tay)
 * vào canvas nếu nơi đó không bật CORS, nên máy chủ tải hộ rồi trả data URL.
 * Chỉ link http(s) tới tên miền công khai (không IP, không localhost), chỉ file ảnh, tối đa 5 MB, 10 giây, tự theo tối đa 3 lần chuyển hướng.
 * Loại ảnh xác định theo NỘI DUNG file (JPEG / PNG / GIF / WebP) – CDN hay trả Content-Type sai (`image/jpg`, `application/octet-stream`).
 */
/** Gửi như trình duyệt: vài CDN chặn yêu cầu không có User-Agent quen. */
const BROWSER_HEADERS = { accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };

export function publicImageUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) || /^[0-9a-f:]+$/.test(host)) return null; // IP thô
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp|invalid|test)$/.test(host)) return null;
  return u;
}

export function registerImageFetchRoutes(router: Router<StaffEnv>) {
  router.post('/images/fetch', async c => {
    const first = publicImageUrl(String((await readJson(c.req, 5000)).url ?? '').trim());
    if (!first) throw badRequest('Link ảnh không hợp lệ (chỉ nhận link http/https công khai).');
    // Ảnh sản phẩm còn nằm trên web cũ (cần đăng nhập): tải bằng phiên của tài khoản web cũ.
    if (legacyMediaKey(first.href)) {
      const bytes = await readLimited(await fetchLegacyMedia(c.env, first.href), IMAGE_FETCH_MAX_BYTES), mime = sniffImage(bytes);
      if (!mime) throw new AppError(415, 'File trên web cũ không phải ảnh JPEG / PNG / GIF / WebP.');
      return json({ dataUrl: `data:${mime};base64,${toBase64(bytes)}` });
    }
    const doFetch = c.env.imageFetch ?? fetch;
    const signal = AbortSignal.timeout(10_000);
    let url: URL = first;
    for (let hop = 0; ; hop++) {
      let res: Response;
      try { res = await doFetch(url.href, { redirect: 'manual', signal, headers: BROWSER_HEADERS }); }
      catch { throw new AppError(502, 'Không tải được ảnh.'); }
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location'), target: URL | null = next && hop < 3 ? publicImageUrl(new URL(next, url).href) : null;
        if (!target) throw new AppError(502, 'Không tải được ảnh.');
        url = target; continue;
      }
      if (!res.ok) throw new AppError(502, `Không tải được ảnh (${res.status}).`);
      const bytes = await readLimited(res, IMAGE_FETCH_MAX_BYTES), mime = sniffImage(bytes);
      if (!mime) throw new AppError(415, `Link không phải file ảnh JPEG / PNG / GIF / WebP (${(res.headers.get('content-type') || 'không rõ loại').split(';')[0]}).`);
      return json({ dataUrl: `data:${mime};base64,${toBase64(bytes)}` });
    }
  }, 'business');
}
