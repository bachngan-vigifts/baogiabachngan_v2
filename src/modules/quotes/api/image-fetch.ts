import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError, badRequest } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';

/**
 * Ảnh sản phẩm / maquette cho file PDF / Excel báo giá: trình duyệt không vẽ được ảnh từ link ngoài (Sapo CDN, link dán tay)
 * vào canvas nếu nơi đó không bật CORS, nên máy chủ tải hộ rồi trả data URL.
 * Chỉ link http(s) tới tên miền công khai (không IP, không localhost), chỉ file ảnh, tối đa 5 MB, 10 giây, tự theo tối đa 3 lần chuyển hướng.
 * Loại ảnh xác định theo NỘI DUNG file (JPEG / PNG / GIF / WebP) – CDN hay trả Content-Type sai (`image/jpg`, `application/octet-stream`).
 */
export const IMAGE_FETCH_MAX_BYTES = 5 * 1024 * 1024;
/** Gửi như trình duyệt: vài CDN chặn yêu cầu không có User-Agent quen. */
const BROWSER_HEADERS = { accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };

/** Loại ảnh theo vài byte đầu file; không phải ảnh hỗ trợ → null. */
export function sniffImage(b: Uint8Array): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function publicImageUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) || /^[0-9a-f:]+$/.test(host)) return null; // IP thô
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp|invalid|test)$/.test(host)) return null;
  return u;
}

async function readLimited(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) throw badRequest('Ảnh trống.');
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) { await reader.cancel(); throw new AppError(413, 'Ảnh quá lớn (tối đa 5 MB).'); }
    chunks.push(value);
  }
  const out = new Uint8Array(length); let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export function registerImageFetchRoutes(router: Router<StaffEnv>) {
  router.post('/images/fetch', async c => {
    const first = publicImageUrl(String((await readJson(c.req, 5000)).url ?? '').trim());
    if (!first) throw badRequest('Link ảnh không hợp lệ (chỉ nhận link http/https công khai).');
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
