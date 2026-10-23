import { eq, inArray, sql } from 'drizzle-orm';
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
  await trimHistory(db, [...new Set(clean.map(r => r.sku))]);
}
/** Bỏ biến động theo tiền tố khoá (vd. đơn huỷ: `sale:<orderId>:`). */
export async function removeMovements(db: Db, refKeyPrefix: string) {
  await db.delete(productMovements).where(sql`${productMovements.refKey} LIKE ${refKeyPrefix.replace(/[%_\\]/g, '\\$&') + '%'}`);
}
/** Mỗi mã chỉ giữ PRODUCT_HISTORY_LIMIT giao dịch mới nhất. */
export async function trimHistory(db: Db, skus: string[]) {
  // Một lệnh cho cả lô mã (trước: một lệnh DELETE mỗi mã – đơn 20 dòng = 20 lượt gọi DB).
  for (let i = 0; i < skus.length; i += 500) {
    const part = skus.slice(i, i + 500);
    await db.execute(sql`DELETE FROM ${productMovements} WHERE ${productMovements.id} IN (
      SELECT id FROM (SELECT ${productMovements.id} AS id, row_number() OVER (PARTITION BY ${productMovements.sku} ORDER BY ${productMovements.occurredAt} DESC, ${productMovements.recordedAt} DESC) AS rn
        FROM ${productMovements} WHERE ${inArray(productMovements.sku, part)}) ranked WHERE rn > ${PRODUCT_HISTORY_LIMIT})`);
  }
}
export async function historyOf(db: Db, sku: string) {
  return db.select().from(productMovements).where(eq(productMovements.sku, sku))
    .orderBy(sql`${productMovements.occurredAt} DESC, ${productMovements.recordedAt} DESC`).limit(PRODUCT_HISTORY_LIMIT);
}
