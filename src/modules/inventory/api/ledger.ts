import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
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

const slices = <T>(xs: T[], size = 500) => Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));
const moveKey = (m: MoveInput) => [m.refType, m.refId, m.sku, m.warehouseId, m.kind].join('\u0000');
const balanceKey = (m: { sku: string; warehouseId: string }) => m.sku + '\u0000' + m.warehouseId;
const LOCK_CHUNK = 500;
/** Thứ tự khoá (sku, warehouse_id) do Postgres sắp – một tham số JSON, không giới hạn số mã. */
async function sortedKeys(db: LedgerDb, keys: readonly { sku: string; warehouseId: string }[]) {
  const res = await db.execute(sql`select k.sku, k.warehouse_id from jsonb_to_recordset(${JSON.stringify(keys.map(k => ({ sku: k.sku, warehouse_id: k.warehouseId })))}::jsonb)
    as k(sku text, warehouse_id text) order by k.sku, k.warehouse_id`);
  const rows = (res as unknown as { rows?: { sku: string; warehouse_id: string }[] }).rows ?? (res as unknown as { sku: string; warehouse_id: string }[]);
  return rows.map(r => ({ sku: r.sku, warehouseId: r.warehouse_id }));
}

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
    // Gộp thành vài lệnh cho cả chứng từ (trước: 3 lượt gọi DB cho MỖI mã – đơn 20 dòng ≈ 60 lượt).
    for (const part of slices(keys)) await tx.insert(stockBalances).values(part.map(k => ({ ...k, qty: 0, updatedAt: now }))).onConflictDoNothing();
    // Khoá theo đúng thứ tự (sku, warehouse_id) của Postgres. Lô lớn (chốt đầu kỳ ~20.000 mã) chia ≤500 khoá / lệnh
    // (giới hạn 65.535 tham số); thứ tự toàn cục do chính Postgres sắp (cùng collation với ORDER BY bên dưới) nên các lô nối tiếp nhau.
    const ordered = keys.length <= LOCK_CHUNK ? keys : await sortedKeys(tx, keys);
    const balances = new Map<string, number>();
    for (const part of slices(ordered, LOCK_CHUNK)) for (const b of await tx.select({ sku: stockBalances.sku, warehouseId: stockBalances.warehouseId, qty: stockBalances.qty }).from(stockBalances)
      .where(sql`(${stockBalances.sku}, ${stockBalances.warehouseId}) in (${sql.join(part.map(k => sql`(${k.sku}, ${k.warehouseId})`), sql`, `)})`)
      .orderBy(asc(stockBalances.sku), asc(stockBalances.warehouseId)).for('update')) balances.set(balanceKey(b), b.qty);
    // Read AFTER locking: another transaction may have completed this same document while we waited.
    const recorded = new Set<string>();
    for (const part of slices(batch, LOCK_CHUNK)) for (const r of await tx.select({ refType: stockMoves.refType, refId: stockMoves.refId, sku: stockMoves.sku, warehouseId: stockMoves.warehouseId, kind: stockMoves.kind })
      .from(stockMoves).where(sql`(${stockMoves.refType}, ${stockMoves.refId}, ${stockMoves.sku}, ${stockMoves.warehouseId}, ${stockMoves.kind}) in (${sql.join(part.map(m =>
        sql`(${m.refType}, ${m.refId}, ${m.sku}, ${m.warehouseId}, ${m.kind})`), sql`, `)})`)) recorded.add(moveKey(r as MoveInput));
    const pending = batch.filter(m => !recorded.has(moveKey(m)));
    const delta = new Map<string, number>();
    for (const m of pending) delta.set(balanceKey(m), (delta.get(balanceKey(m)) ?? 0) + m.qty);
    const short = ordered.flatMap(k => {
      const have = balances.get(balanceKey(k)) ?? 0, change = delta.get(balanceKey(k)) ?? 0;
      return change && have + change < -0.0005 ? [`${k.sku} (còn ${have}, cần ${Math.max(0, -change)})`] : [];
    });
    if (short.length) throw new AppError(409, 'Tồn kho không đủ: ' + short.slice(0, 10).join('; ') + (short.length > 10 ? ` và ${short.length - 10} mã khác` : '') + '. Dùng phiếu điều chỉnh hoặc điều chuyển để bổ sung tồn trước khi thực hiện / huỷ chứng từ.', 'STOCK_SHORT');
    for (const part of slices(pending)) await tx.insert(stockMoves).values(part.map(m => ({ id: crypto.randomUUID(), ...m,
      refNo: (m.refNo ?? '').slice(0, 60), note: (m.note ?? '').slice(0, 500), createdBy: by, createdAt: now })));
    const changes = ordered.map(k => ({ ...k, qty: delta.get(balanceKey(k)) ?? 0 })).filter(k => k.qty);
    for (const part of slices(changes)) await tx.execute(sql`UPDATE ${stockBalances} SET ${sql.identifier('qty')} = ${stockBalances.qty} + v.d, ${sql.identifier('updated_at')} = ${now}
      FROM (VALUES ${sql.join(part.map(k => sql`(${k.sku}, ${k.warehouseId}, ${k.qty}::double precision)`), sql`, `)}) AS v(sku, wh, d)
      WHERE ${stockBalances.sku} = v.sku AND ${stockBalances.warehouseId} = v.wh`);
    return pending.length;
  });
}

/** Huỷ chứng từ: ghi dòng ngược lại (loại 'reverse') cho mọi dòng đã ghi của chứng từ đó – không xoá lịch sử. */
export async function reverseRef(db: LedgerDb, by: string, refType: StockRefType, refId: string, note: string, now = new Date().toISOString()): Promise<number> {
  return db.transaction(async tx => {
    await lockLedger(tx);
    const rows = await tx.select().from(stockMoves).where(and(eq(stockMoves.refType, refType), (refType === 'packing_slip' ? sql`split_part(${stockMoves.refId},'#',1)=${refId}` : eq(stockMoves.refId, refId)), ne(stockMoves.kind, 'reverse')));
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
