import { and, eq, ne, sql } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { warehouses } from '../../catalog/schema.ts';
import { stockBalances, stockMoves } from '../schema.ts';
import type { StockMoveKind, StockRefType } from '../domain/kinds.ts';

/** Giao dịch hoặc kết nối Drizzle (ghi sổ kho luôn chạy TRONG giao dịch của chứng từ gốc). */
export type LedgerDb = AnyDb | Parameters<Parameters<AnyDb['transaction']>[0]>[0];
/** App-level guard protects warehouses that already operate from the local ledger. */
export const inventoryOpeningHooks: { guard?: (db: LedgerDb, warehouseIds: string[]) => Promise<void> } = {};
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

/** Các dòng đã ghi của đơn / HĐKT (lần đầu `refId` = id đơn, các lần chỉnh sau `id#…`). */
const saleRef = (orderId: string) => sql`(${stockMoves.refId} = ${orderId} OR ${stockMoves.refId} LIKE ${orderId.replace(/[\\%_]/g, '\\$&') + '#%'})`;

/**
 * BÁN HÀNG → SỔ KHO: đưa số đã trừ của đơn / HĐKT về đúng trạng thái hiện tại.
 *  - `active` (đã duyệt, đang giao, đã giao) + có kho bán: kho bán bị trừ đúng số lượng từng mã của đơn.
 *  - Nháp / huỷ / không có kho: không trừ gì (huỷ sau khi duyệt = ghi dòng cộng lại).
 * Chỉ ghi phần chênh lệch (đổi kho, Manager sửa số lượng đơn đã duyệt…) – gọi lặp không ghi thêm. Chạy trong giao dịch của chứng từ.
 */
export async function syncSaleMoves(db: LedgerDb, by: string, order: { id: string; no: string; warehouseId: string | null; active: boolean },
  lines: readonly { sku: string; qty: number }[], note: string, now = new Date().toISOString()): Promise<number> {
  const want = new Map<string, number>();
  if (order.active && order.warehouseId) for (const l of lines) {
    const sku = l.sku.trim(); if (!sku || !(l.qty > 0)) continue;
    const k = sku + '\u0000' + order.warehouseId; want.set(k, (want.get(k) ?? 0) - l.qty);
  }
  const done = await db.select({ sku: stockMoves.sku, wh: stockMoves.warehouseId, qty: sql<number>`sum(${stockMoves.qty})`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
    .from(stockMoves).where(and(eq(stockMoves.refType, 'sales_order'), saleRef(order.id))).groupBy(stockMoves.sku, stockMoves.warehouseId);
  const have = new Map(done.map(r => [r.sku + '\u0000' + r.wh, r.qty]));
  const moves: MoveInput[] = [], refId = done.length ? `${order.id}#${crypto.randomUUID().slice(0, 8)}` : order.id;
  for (const k of new Set([...want.keys(), ...have.keys()])) {
    const delta = Math.round(((want.get(k) ?? 0) - (have.get(k) ?? 0)) * 1000) / 1000;
    if (!delta) continue;
    const [sku, warehouseId] = k.split('\u0000') as [string, string];
    moves.push({ sku, warehouseId, qty: delta, kind: delta < 0 ? 'sale' : 'reverse', refType: 'sales_order', refId, refNo: order.no, note });
  }
  return moves.length ? postMoves(db, by, moves, now) : 0;
}

/** Đơn đã trừ sổ kho theo đơn chưa (để phiếu đóng gói không trừ lần hai, giữ hàng không tính lại). */
export async function saleMovesPosted(db: LedgerDb, orderId: string) {
  return (await db.select({ id: stockMoves.id }).from(stockMoves).where(and(eq(stockMoves.refType, 'sales_order'), saleRef(orderId))).limit(1)).length > 0;
}
