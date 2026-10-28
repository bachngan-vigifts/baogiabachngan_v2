import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { productMovements } from '../schema.ts';
import { PRODUCT_HISTORY_LIMIT, type ProductMoveKind } from '../domain/product-history.ts';

type Db = StaffEnv['db'] | Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
export interface MovementInput {
  refKey: string; sku: string; kind: ProductMoveKind; name?: string; qty: number; unit?: string; unitPrice?: number | null;
  partner?: string; location?: string; refCode?: string; link?: string; status?: string; note?: string; occurredAt: string;
}

/**
 * Ghi biến động sản phẩm (dùng chung cho bán hàng, giao hàng, đồng bộ chứng từ kho Sapo).
 * Ghi lại cùng `refKey` thì cập nhật (vd. phiếu Sapo đổi trạng thái); sau đó mỗi mã chỉ giữ 20 giao dịch gần nhất.
 */
export async function recordMovements(db: Db, rows: MovementInput[]) {
  const clean = rows.filter(r => r.sku.trim() && Number.isFinite(r.qty)).map(r => ({
    id: crypto.randomUUID(), refKey: r.refKey, sku: r.sku.trim(), kind: r.kind, name: r.name ?? '', qty: r.qty, unit: r.unit ?? '', unitPrice: r.unitPrice ?? null,
    partner: r.partner ?? '', location: r.location ?? '', refCode: r.refCode ?? '', link: r.link ?? '', status: r.status ?? '', note: (r.note ?? '').slice(0, 500),
    occurredAt: r.occurredAt, recordedAt: new Date().toISOString(),
  }));
  if (!clean.length) return;
  for (let i = 0; i < clean.length; i += 200) {
    await db.insert(productMovements).values(clean.slice(i, i + 200)).onConflictDoUpdate({ target: productMovements.refKey, set: {
      qty: sql`excluded.qty`, unitPrice: sql`excluded.unit_price`, partner: sql`excluded.partner`, location: sql`excluded.location`, status: sql`excluded.status`,
      note: sql`excluded.note`, occurredAt: sql`excluded.occurred_at`, name: sql`excluded.name` } });
  }
}
/** Bỏ biến động theo tiền tố khoá (vd. đơn huỷ: `sale:<orderId>:`). */
export async function removeMovements(db: Db, refKeyPrefix: string) {
  await db.delete(productMovements).where(sql`${productMovements.refKey} LIKE ${refKeyPrefix.replace(/[%_\\]/g, '\\$&') + '%'}`);
}
/**
 * Lịch sử của mã, mới nhất trước – giữ ĐỦ mọi phát sinh (không xoá bớt). Mỗi lần một trang PRODUCT_HISTORY_LIMIT dòng;
 * `before` = con trỏ của dòng cuối trang trước ("Xem thêm" phát sinh cũ hơn).
 */
export async function historyOf(db: Db, sku: string, before?: string | null) {
  const cursor = parseHistoryCursor(before);
  const rows = await db.select().from(productMovements).where(and(eq(productMovements.sku, sku), cursor
    ? sql`(${productMovements.occurredAt}, ${productMovements.recordedAt}, ${productMovements.id}) < (${cursor.occurredAt}, ${cursor.recordedAt}, ${cursor.id})` : undefined))
    .orderBy(sql`${productMovements.occurredAt} DESC, ${productMovements.recordedAt} DESC, ${productMovements.id} DESC`).limit(PRODUCT_HISTORY_LIMIT + 1);
  const more = rows.length > PRODUCT_HISTORY_LIMIT, page = rows.slice(0, PRODUCT_HISTORY_LIMIT), last = page.at(-1);
  return { rows: page, nextCursor: more && last ? historyCursor(last) : null };
}
const historyCursor = (r: { occurredAt: string; recordedAt: string; id: string }) => Buffer.from(JSON.stringify([r.occurredAt, r.recordedAt, r.id])).toString('base64url');
function parseHistoryCursor(raw?: string | null) {
  if (!raw) return null;
  try {
    const [occurredAt, recordedAt, id] = JSON.parse(Buffer.from(raw.slice(0, 400), 'base64url').toString('utf8'));
    if ([occurredAt, recordedAt, id].every(v => typeof v === 'string' && v.length <= 100)) return { occurredAt, recordedAt, id };
  } catch { /* con trỏ hỏng: coi như trang đầu không được – báo lỗi bên dưới */ }
  throw new AppError(400, 'Con trỏ lịch sử không hợp lệ. Tải lại thẻ sản phẩm.');
}
