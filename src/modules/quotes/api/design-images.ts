import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import { sniffImage } from '../../../core/http/image-bytes.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';

const KEY = /^quote-designs\/[\w-]+\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/;
type Doc = Record<string, any>;
/** Keep private object keys, never expiring signed URLs, in quotation JSON and revision history. */
export function checkDesignKeys(viewer: SessionState['member'], data: Doc, previous?: Doc): void {
  const existing = new Set((previous?.rows || []).map((r: Doc) => r.designImageKey).filter(Boolean));
  for (const row of data.rows || []) if (row.designImageKey) {
    const key = String(row.designImageKey);
    if (!KEY.test(key) || (viewer.role !== 'manager' && !key.startsWith(`quote-designs/${viewer.id}/`) && !existing.has(key)))
      throw new AppError(403, 'Ảnh thiết kế chưa được cấp cho báo giá này. Đính kèm ảnh của bạn rồi thử lại.');
  }
}
/** Caller has already checked quotation scope; only its design keys can be signed. One batch per document. */
export async function withDesignImages(env: StaffEnv, data: Doc, requireFiles = false): Promise<Doc> {
  const keys = [...new Set<string>((data.rows || []).map((r: Doc) => r.designImageKey).filter((key: unknown): key is string => typeof key === 'string' && KEY.test(key)))];
  if (!keys.length) return data;
  if (!env.files) throw new AppError(503, 'Kho ảnh thiết kế chưa sẵn sàng.');
  const urls = await env.files.signedUrls(keys, 86400);
  if (requireFiles && keys.some(key => !urls.get(key))) throw new AppError(400, 'Ảnh thiết kế không còn trong kho file. Đính kèm lại ảnh rồi thử lại.', 'SALE_DESIGN_REQUIRED');
  return { ...data, rows: data.rows.map((row: Doc) => row.designImageKey ? { ...row, image: urls.get(row.designImageKey) || '' } : row) };
}
export function registerQuoteDesignImages(router: Router<StaffEnv>): void {
  router.post('/quotes/design-images', async c => {
    const viewer = (c.state.session as SessionState).member, store = c.env.files;
    if (!['manager', 'employee'].includes(viewer.role)) throw new AppError(403, 'Chưa có quyền đính kèm ảnh thiết kế.');
    if (!store) throw new AppError(503, 'Kho ảnh thiết kế chưa sẵn sàng.');
    const body = await readJson(c.req, 350_000), match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(body.image || ''));
    if (!match) throw new AppError(400, 'Chọn ảnh JPG, PNG hoặc WebP hợp lệ.');
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(match[2]!), ch => ch.charCodeAt(0)); } catch { throw new AppError(400, 'Dữ liệu ảnh không hợp lệ.'); }
    if (bytes.length > 240_000) throw new AppError(413, 'Ảnh thiết kế quá lớn. Chọn ảnh nhỏ hơn rồi thử lại.');
    if (sniffImage(bytes) !== match[1]) throw new AppError(415, 'Nội dung ảnh không đúng định dạng.');
    const ext = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}[match[1]!]!;
    const key = `quote-designs/${viewer.id}/${crypto.randomUUID()}.${ext}`;
    await store.put(key, bytes, match[1]!);
    try {
      const imageUrl = (await store.signedUrls([key], 86400)).get(key);
      if (!imageUrl) throw new AppError(503, 'Chưa mở được ảnh vừa tải. Vui lòng thử lại.');
      return json({key, imageUrl}, 201);
    } catch (error) { try { await store.remove([key]); } catch { /* No secret or object URL in logs. */ } throw error; }
  }, 'business');
}
