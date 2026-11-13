import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import { json, readJson, type Router, type RouteContext } from '../../../core/http/router.ts';
import { fileMatchesMime } from '../../../core/storage/file-sniff.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { products } from '../../catalog/schema.ts';
import { canSendEarlyRequest, canUsePurchasing } from '../domain/purchasing.ts';
import { cleanPhotoSlip, PhotoSlipError } from '../domain/photo-slip.ts';
import type { PhotoMediaType } from './photo-ai.ts';

type Ctx = RouteContext<StaffEnv>;
const MEDIA: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
/** Ảnh gửi model tối đa 5 MB; trình duyệt đã thu nhỏ trước khi gửi nên ảnh thường dưới 1,5 MB. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Chặn bấm lặp hoặc script gọi liên tục: mỗi lượt đọc là một lượt trả phí. */
export const PHOTO_READS_PER_DAY = 150;
const ACTION = 'early-photo-read';

function decodeBase64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4) throw new AppError(400, 'Ảnh gửi lên không hợp lệ.');
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function registerEarlyPhotoRoutes(router: Router<StaffEnv>) {
  /** Giao diện hỏi trước để biết dùng bộ đọc AI hay bộ đọc trên máy; không lộ khoá hay tên nhà cung cấp AI. */
  router.get('/purchase-early-photo/read', c => {
    const m = (c.state.session as SessionState).member;
    if (!canUsePurchasing(m) || !canSendEarlyRequest(m)) throw new AppError(403, 'Bạn chưa được cấp quyền xin hàng trước.');
    return json({ available: !!c.env.photoReader });
  }, 'business');

  router.post('/purchase-early-photo/read', async (c: Ctx) => {
    const m = (c.state.session as SessionState).member;
    if (!canUsePurchasing(m) || !canSendEarlyRequest(m)) throw new AppError(403, 'Bạn chưa được cấp quyền xin hàng trước.');
    const reader = c.env.photoReader;
    if (!reader) throw new AppError(503, 'Bộ đọc ảnh AI chưa được cấu hình.', 'photo_ai_unavailable');
    const body = await readJson(c.req, 7_200_000);
    if (typeof body.mediaType !== 'string' || !MEDIA.includes(body.mediaType) || typeof body.data !== 'string' || !body.data) throw new AppError(400, 'Chọn ảnh JPG, PNG hoặc WebP.');
    const bytes = decodeBase64(body.data);
    if (bytes.length > MAX_IMAGE_BYTES) throw new AppError(413, 'Ảnh quá lớn. Chụp lại hoặc cắt bớt phần ngoài bảng.');
    if (!fileMatchesMime(bytes, body.mediaType)) throw new AppError(400, 'Nội dung ảnh không đúng loại JPG, PNG hoặc WebP.');

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const [used] = await c.env.db.select({ n: sql<number>`count(*)::int` }).from(auditLogs)
      .where(and(eq(auditLogs.actorId, m.id), eq(auditLogs.action, ACTION), gte(auditLogs.createdAt, since)));
    if ((used?.n ?? 0) >= PHOTO_READS_PER_DAY) throw new AppError(429, `Bạn đã đọc ${PHOTO_READS_PER_DAY} ảnh trong 24 giờ qua. Nhập tay hoặc thử lại sau.`, 'photo_ai_limit');

    // Không mở transaction quanh lượt gọi AI: lượt gọi có thể kéo dài hàng chục giây.
    const result = await reader({ mediaType: body.mediaType as PhotoMediaType, data: body.data });
    let slip;
    try { slip = cleanPhotoSlip(result.output); }
    catch (error) { if (error instanceof PhotoSlipError) throw new AppError(422, error.message, 'photo_ai_failed'); throw error; }

    const skus = [...new Set(slip.rows.map(r => r.sku).filter(Boolean))];
    const known = skus.length ? await c.env.db.select({ sku: products.sku, name: products.name }).from(products).where(inArray(products.sku, skus)) : [];
    const names = new Map(known.map(p => [p.sku, p.name]));
    const rows = slip.rows.map(r => ({ ...r, name: names.get(r.sku) ?? '', inCatalogue: names.has(r.sku) }));
    // Nhật ký chỉ ghi số đếm và lượng token, không ghi ảnh hay nội dung phiếu.
    await c.env.db.insert(auditLogs).values({ id: crypto.randomUUID(), actorId: m.id, module: 'suppliers', action: ACTION, entityType: 'purchase-early-photo', entityId: m.id,
      data: JSON.stringify({ model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, rows: rows.length, totalCheck: slip.totalCheck, bytes: bytes.length }), createdAt: new Date().toISOString() });
    return json({ readable: slip.readable, rows, document: slip.document, statedTotal: slip.statedTotal, rowTotal: slip.rowTotal, totalCheck: slip.totalCheck });
  }, 'business');
}
