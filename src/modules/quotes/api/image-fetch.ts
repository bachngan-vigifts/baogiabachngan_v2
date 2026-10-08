import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError, badRequest } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';

/**
 * Ảnh sản phẩm / maquette cho file PDF / Excel báo giá: trình duyệt không vẽ được ảnh từ link ngoài (Sapo CDN, link dán tay)
 * vào canvas nếu nơi đó không bật CORS, nên máy chủ tải hộ rồi trả data URL.
 * Chỉ link https tới tên miền công khai (không IP, không localhost), chỉ file ảnh, tối đa 5 MB, 10 giây, tự theo tối đa 3 lần chuyển hướng.
 */
export const IMAGE_FETCH_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif)$/;

export function publicImageUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
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
    if (!first) throw badRequest('Link ảnh không hợp lệ (chỉ nhận link https công khai).');
    const doFetch = c.env.imageFetch ?? fetch;
    const signal = AbortSignal.timeout(10_000);
    let url: URL = first;
    for (let hop = 0; ; hop++) {
      let res: Response;
      try { res = await doFetch(url.href, { redirect: 'manual', signal, headers: { accept: 'image/*' } }); }
      catch { throw new AppError(502, 'Không tải được ảnh.'); }
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location'), target: URL | null = next && hop < 3 ? publicImageUrl(new URL(next, url).href) : null;
        if (!target) throw new AppError(502, 'Không tải được ảnh.');
        url = target; continue;
      }
      if (!res.ok) throw new AppError(502, `Không tải được ảnh (${res.status}).`);
      const mime = (res.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
      if (!IMAGE_TYPES.test(mime)) throw new AppError(415, 'Link không phải file ảnh.');
      return json({ dataUrl: `data:${mime};base64,${toBase64(await readLimited(res, IMAGE_FETCH_MAX_BYTES))}` });
    }
  }, 'business');
}
