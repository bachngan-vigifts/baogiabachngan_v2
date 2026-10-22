import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { AppError } from '../../../core/errors.ts';
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
/** Shared with opening's exclusive lock: no reset can race a stock write. */
export async function lockLedger(db: LedgerDb) {
  await db.execute(sql`select pg_advisory_xact_lock_shared(hashtext('stock_ledger_opening'))`);
}
export async function assertWarehousesOpened(db: LedgerDb, ids: readonly string[]) {
  const wanted = [...new Set(ids)].sort();
  if (!wanted.length) return;
  const list = await db.select({ id: warehouses.id, name: warehouses.name, kind: warehouses.kind }).from(warehouses).where(inArray(warehouses.id, wanted));
  const opened = new Set((await db.selectDistinct({ id: stockMoves.warehouseId }).from(stockMoves)
    .where(and(inArray(stockMoves.warehouseId, wanted), eq(stockMoves.refType, 'opening')))).map(w => w.id));
  for (const id of wanted) {
    const w = list.find(w => w.id === id);
    if (!w || w.kind !== 'stock') throw new AppError(400, 'Chọn kho thật hợp lệ.');
    if (!opened.has(id)) throw new AppError(409, `Kho "${w.name}" chưa chốt tồn đầu kỳ. Manager vào Sổ kho để chốt trước.`, 'WAREHOUSE_NOT_OPENED');
  }
}
/** Opening/reset may never overwrite any operational movement, regardless of its source. */
export async function guardInventoryOpening(db: LedgerDb, ids: readonly string[]) {
  const used = await db.select({ id: stockMoves.warehouseId, ref: stockMoves.refType, name: warehouses.name }).from(stockMoves)
    .innerJoin(warehouses, eq(warehouses.id, stockMoves.warehouseId))
    .where(and(inArray(stockMoves.warehouseId, [...ids]), ne(stockMoves.refType, 'opening'))).limit(1);
  if (used[0]) {
    const [opened] = await db.select({ id: stockMoves.id }).from(stockMoves).where(and(eq(stockMoves.warehouseId, used[0].id), eq(stockMoves.refType, 'opening'))).limit(1);
    throw new AppError(409, `Kho "${used[0].name}" ${opened ? 'đã chốt và đã' : 'chưa chốt nhưng đã'} có phát sinh ${used[0].ref}. Dùng phiếu điều chỉnh để sửa lệch.`, 'WAREHOUSE_OPENING_USED');
  }
}

const moveKey = (m: MoveInput) => [m.refType, m.refId, m.sku, m.warehouseId, m.kind].join('\u0000');
const balanceKey = (m: { sku: string; warehouseId: string }) => m.sku + '\u0000' + m.warehouseId;

export async function postMoves(db: LedgerDb, by: string, moves: readonly MoveInput[], now = new Date().toISOString()): Promise<number> {
  // Also safe for callers with a root connection; within a document transaction this is a savepoint.
  return db.transaction(async tx => {
    await lockLedger(tx);
    const merged = new Map<string, MoveInput>();
    for (const m of moves) {
      const sku = m.sku.trim(), qty = Math.round(Number(m.qty) * 1000) / 1000;
      if (!sku || !m.warehouseId || !Number.isFinite(qty) || qty === 0) continue;
      const item = { ...m, sku, qty }, key = moveKey(item), previous = merged.get(key);
      merged.set(key, previous ? { ...previous, qty: previous.qty + qty } : item);
    }
    const batch = [...merged.values()].filter(m => Math.abs(m.qty) > 0.0005);
    await assertWarehousesOpened(tx, batch.filter(m => m.kind !== 'opening').map(m => m.warehouseId));
    if (!batch.length) return 0;
    const keys = [...new Map(batch.map(m => [balanceKey(m), { sku: m.sku, warehouseId: m.warehouseId }])).values()]
      .sort((a, b) => a.sku.localeCompare(b.sku) || a.warehouseId.localeCompare(b.warehouseId));
    // A missing balance must be locked too. Insert zero inside the transaction; failures roll it back.
    for (const k of keys) await tx.insert(stockBalances).values({ ...k, qty: 0, updatedAt: now }).onConflictDoNothing();
    const balances = await tx.select().from(stockBalances).where(or(...keys.map(k => and(eq(stockBalances.sku, k.sku), eq(stockBalances.warehouseId, k.warehouseId)))))
      .orderBy(asc(stockBalances.sku), asc(stockBalances.warehouseId)).for('update');
    // Read AFTER locking: another transaction may have completed this same document while we waited.
    const recorded = new Set((await tx.select().from(stockMoves).where(or(...batch.map(m => and(eq(stockMoves.refType, m.refType), eq(stockMoves.refId, m.refId),
      eq(stockMoves.sku, m.sku), eq(stockMoves.warehouseId, m.warehouseId), eq(stockMoves.kind, m.kind)))))).map(moveKey));
    const pending = batch.filter(m => !recorded.has(moveKey(m)));
    const delta = new Map<string, number>();
    for (const m of pending) delta.set(balanceKey(m), (delta.get(balanceKey(m)) ?? 0) + m.qty);
    const short = keys.flatMap(k => {
      const have = balances.find(b => balanceKey(b) === balanceKey(k))?.qty ?? 0, change = delta.get(balanceKey(k)) ?? 0;
      return change && have + change < -0.0005 ? [`${k.sku} (còn ${have}, cần ${Math.max(0, -change)})`] : [];
    });
    if (short.length) throw new AppError(409, 'Tồn kho không đủ: ' + short.join('; ') + '. Dùng phiếu điều chỉnh hoặc điều chuyển để bổ sung tồn trước khi thực hiện / huỷ chứng từ.', 'STOCK_SHORT');
    for (const m of pending) await tx.insert(stockMoves).values({ id: crypto.randomUUID(), ...m,
      refNo: (m.refNo ?? '').slice(0, 60), note: (m.note ?? '').slice(0, 500), createdBy: by, createdAt: now });
    for (const k of keys) {
      const qty = delta.get(balanceKey(k)); if (!qty) continue;
      await tx.update(stockBalances).set({ qty: sql`${stockBalances.qty} + ${qty}`, updatedAt: now })
        .where(and(eq(stockBalances.sku, k.sku), eq(stockBalances.warehouseId, k.warehouseId)));
    }
    return pending.length;
  });
}

/** Huỷ chứng từ: ghi dòng ngược lại (loại 'reverse') cho mọi dòng đã ghi của chứng từ đó – không xoá lịch sử. */
export async function reverseRef(db: LedgerDb, by: string, refType: StockRefType, refId: string, note: string, now = new Date().toISOString()): Promise<number> {
  return db.transaction(async tx => {
    await lockLedger(tx);
    const rows = await tx.select().from(stockMoves).where(and(eq(stockMoves.refType, refType), eq(stockMoves.refId, refId), ne(stockMoves.kind, 'reverse')));
    return postMoves(tx, by, rows.map(r => ({ sku: r.sku, warehouseId: r.warehouseId, qty: -r.qty, kind: 'reverse' as const, refType, refId, refNo: r.refNo, note })), now);
  });
}

/** Kho thật (kind 'stock') theo tên – phiếu nhận NCC lưu tên kho dạng chữ. Không khớp → null (không ghi sổ, báo lại). */
export async function stockWarehouseByName(db: LedgerDb, name: string): Promise<string | null> {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const [w] = await db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.kind, 'stock'), eq(warehouses.active, true), sql`lower(trim(${warehouses.name})) = ${n}`)).limit(1);
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
  return db.transaction(async tx => {
    await lockLedger(tx);
    if (order.active && order.warehouseId) await assertWarehousesOpened(tx, [order.warehouseId]);
    const want = new Map<string, number>();
    if (order.active && order.warehouseId) for (const l of lines) {
      const sku = l.sku.trim(); if (!sku || !(l.qty > 0)) continue;
      const k = sku + '\u0000' + order.warehouseId; want.set(k, (want.get(k) ?? 0) - l.qty);
    }
    const done = await tx.select({ sku: stockMoves.sku, wh: stockMoves.warehouseId, qty: sql<number>`sum(${stockMoves.qty})`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
      .from(stockMoves).where(and(eq(stockMoves.refType, 'sales_order'), saleRef(order.id))).groupBy(stockMoves.sku, stockMoves.warehouseId);
    const have = new Map(done.map(r => [r.sku + '\u0000' + r.wh, r.qty]));
    const moves: MoveInput[] = [], refId = done.length ? `${order.id}#${crypto.randomUUID().slice(0, 8)}` : order.id;
    for (const k of new Set([...want.keys(), ...have.keys()])) {
      const delta = Math.round(((want.get(k) ?? 0) - (have.get(k) ?? 0)) * 1000) / 1000;
      if (!delta) continue;
      const [sku, warehouseId] = k.split('\u0000') as [string, string];
      moves.push({ sku, warehouseId, qty: delta, kind: delta < 0 ? 'sale' : 'reverse', refType: 'sales_order', refId, refNo: order.no, note });
    }
    return moves.length ? postMoves(tx, by, moves, now) : 0;
  });
}

/** Đơn đã trừ sổ kho theo đơn chưa (để phiếu đóng gói không trừ lần hai, giữ hàng không tính lại). */
export async function saleMovesPosted(db: LedgerDb, orderId: string) {
  return (await db.select({ id: stockMoves.id }).from(stockMoves).where(and(eq(stockMoves.refType, 'sales_order'), saleRef(orderId))).limit(1)).length > 0;
}
