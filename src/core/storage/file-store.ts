/**
 * Lưu file (đính kèm tin nhắn…) vào bucket private của Supabase Storage qua REST API (không cần supabase-js trong Edge).
 * Route tự kiểm tra quyền trước khi gọi; người dùng chỉ nhận link ký tên có hạn.
 * Test / máy dùng thử dùng `memoryFileStore` (link = data URL).
 */
import { assertFileMatchesMime } from './file-sniff.ts';

export const FILE_BUCKET = 'baogiabachngan-v2-files';
export const MAX_FILE_BYTES = 6 * 1024 * 1024;

export interface FileStore {
  /** `upsert`: ghi đè nếu khoá đã có (mặc định báo lỗi). */
  /** cacheSeconds: thời gian trình duyệt / CDN giữ file (Cache-Control max-age). Không đặt thì theo mặc định Supabase (1 giờ). */
  put(key: string, bytes: Uint8Array, mime: string, opts?: { upsert?: boolean; cacheSeconds?: number }): Promise<void>;
  /** Link công khai không hết hạn – chỉ có ở bucket public (ảnh sản phẩm). */
  publicUrl?(key: string): string;
  /** Link tải có hạn cho từng khoá (khoá không ký được thì bỏ qua). */
  signedUrls(keys: string[], seconds: number): Promise<Map<string, string>>;
  remove(keys: string[]): Promise<void>;
}

const safeKey = (key: string) => {
  if (!/^[\w./-]{1,300}$/.test(key) || key.startsWith('/') || key.split('/').includes('..')) throw new Error('Đường dẫn file không hợp lệ.');
  return key.split('/').map(encodeURIComponent).join('/');
};

export function supabaseFileStore(o: { url: string; serviceKey: string; bucket?: string; fetch?: typeof fetch; publicBucket?: boolean }): FileStore {
  const base = o.url.replace(/\/+$/, '') + '/storage/v1', bucket = o.bucket ?? FILE_BUCKET, doFetch = o.fetch ?? fetch;
  const headers = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${o.serviceKey}`, apikey: o.serviceKey, ...extra });
  const fail = async (what: string, res: Response) => { throw new Error(`${what} thất bại (${res.status}): ${(await res.text()).slice(0, 200)}`); };
  return {
    async put(key, bytes, mime, opts) {
      assertFileMatchesMime(bytes, mime); // nội dung phải đúng loại khai báo (chặn file độc đổi đuôi)
      const res = await doFetch(`${base}/object/${bucket}/${safeKey(key)}`, { method: 'POST', headers: headers({ 'content-type': mime, 'x-upsert': opts?.upsert ? 'true' : 'false', ...(opts?.cacheSeconds ? { 'cache-control': 'max-age=' + Math.floor(opts.cacheSeconds) } : {}) }), body: bytes as BodyInit });
      if (!res.ok) await fail('Tải file lên', res);
    },
    ...(o.publicBucket ? { publicUrl: (key: string) => `${base}/object/public/${bucket}/${safeKey(key)}` } : {}),
    async signedUrls(keys, seconds) {
      const out = new Map<string, string>();
      if (!keys.length) return out;
      const res = await doFetch(`${base}/object/sign/${bucket}`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ expiresIn: seconds, paths: keys }) });
      if (!res.ok) await fail('Tạo link file', res);
      for (const r of await res.json() as { path?: string; signedURL?: string | null }[]) if (r.path && r.signedURL) out.set(r.path, base + r.signedURL);
      return out;
    },
    async remove(keys) {
      if (!keys.length) return;
      const res = await doFetch(`${base}/object/${bucket}`, { method: 'DELETE', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ prefixes: keys }) });
      if (!res.ok) await fail('Xoá file', res);
    },
  };
}

/** Bộ nhớ trong (test, máy dùng thử): link trả về là data URL. */
export function memoryFileStore() {
  const files = new Map<string, { bytes: Uint8Array; mime: string }>();
  const toB64 = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
  const store: FileStore & { files: typeof files } = {
    files,
    async put(key, bytes, mime, opts) { safeKey(key); assertFileMatchesMime(bytes, mime); if (files.has(key) && !opts?.upsert) throw new Error('File đã tồn tại.'); files.set(key, { bytes, mime }); },
    publicUrl: key => `https://files.test/public/${key}`,
    async signedUrls(keys) { const out = new Map<string, string>(); for (const k of keys) { const f = files.get(k); if (f) out.set(k, `data:${f.mime};base64,${toB64(f.bytes)}`); } return out; },
    async remove(keys) { for (const k of keys) files.delete(k); },
  };
  return store;
}
