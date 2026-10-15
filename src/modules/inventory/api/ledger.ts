import { and, eq, ne, sql } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { warehouses } from '../../catalog/schema.ts';
import { stockBalances, stockMoves } from '../schema.ts';
import type { StockMoveKind, StockRefType } from '../domain/kinds.ts';

/** Giao dịch hoặc kết nối Drizzle (ghi sổ kho luôn chạy TRONG giao dịch của chứng từ gốc). */
export type LedgerDb = AnyDb | Parameters<Parameters<AnyDb['transaction']>[0]>[0];
export interface MoveInput { sku: string; warehouseId: string; qty: number; kind: StockMoveKind; refType: StockRefType; refId: string; refNo?: string; note?: string }

/**
 * Ghi các dòng phát sinh + cộng vào tồn. Gộp dòng trùng (mã, kho, loại) của cùng chứng từ; bỏ dòng 0.
 * Chứng từ đã ghi rồi (gọi lặp) thì bỏ qua – không cộng hai lần. Trả số dòng thực sự được ghi.
 */
export async function postMoves(db: LedgerDb, by: string, moves: readonly MoveInput[], now = new Date().toISOString()): Promise<number> {
  const merged = new Map<string, MoveInput>();
  for (const m of moves) {
    const sku = m.sku.trim(), qty = Math.round(Number(m.qty) * 1000) / 1000;
    if (!sku || !m.warehouseId || !Number.isFinite(qty) || qty === 0) continue;
    const key = [m.refType, m.refId, sku, m.warehouseId, m.kind].join('\u0000'), cur = merged.get(key);
    merged.set(key, cur ? { ...cur, qty: cur.qty + qty } : { ...m, sku, qty });
  }
  let written = 0;
  for (const m of merged.values()) {
    if (m.qty === 0) continue;
    const [row] = await db.insert(stockMoves).values({ id: crypto.randomUUID(), sku: m.sku, warehouseId: m.warehouseId, qty: m.qty, kind: m.kind, refType: m.refType, refId: m.refId,
      refNo: (m.refNo ?? '').slice(0, 60), note: (m.note ?? '').slice(0, 500), createdBy: by, createdAt: now }).onConflictDoNothing().returning({ id: stockMoves.id });
    if (!row) continue;
    written++;
    await db.insert(stockBalances).values({ sku: m.sku, warehouseId: m.warehouseId, qty: m.qty, updatedAt: now })
      .onConflictDoUpdate({ target: [stockBalances.sku, stockBalances.warehouseId], set: { qty: sql`${stockBalances.qty} + excluded.qty`, updatedAt: now } });
  }
  return written;
}

/** Huỷ chứng từ: ghi dòng ngược lại (loại 'reverse') cho mọi dòng đã ghi của chứng từ đó – không xoá lịch sử. */
export async function reverseRef(db: LedgerDb, by: string, refType: StockRefType, refId: string, note: string, now = new Date().toISOString()): Promise<number> {
  const rows = await db.select().from(stockMoves).where(and(eq(stockMoves.refType, refType), eq(stockMoves.refId, refId), ne(stockMoves.kind, 'reverse')));
  return postMoves(db, by, rows.map(r => ({ sku: r.sku, warehouseId: r.warehouseId, qty: -r.qty, kind: 'reverse' as const, refType, refId, refNo: r.refNo, note })), now);
}

/** Kho thật (kind 'stock') theo tên – phiếu nhận NCC lưu tên kho dạng chữ. Không khớp → null (không ghi sổ, báo lại). */
export async function stockWarehouseByName(db: LedgerDb, name: string): Promise<string | null> {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const [w] = await db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.kind, 'stock'), sql`lower(trim(${warehouses.name})) = ${n}`)).limit(1);
  return w?.id ?? null;
}
