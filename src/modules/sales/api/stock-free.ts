import { and, asc, eq, inArray } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import { stockBalances } from '../../inventory/schema.ts';
import { orderHolds } from './hold-routes.ts';
import { reservedBySku } from './pos-store.ts';
import type { PosDb } from './pos-store.ts';

/**
 * XUẤT / CHUYỂN KHÔNG LẤY HÀNG ĐANG GIỮ CHO ĐƠN KHÁC (docs/SO-KHO.md › Hàng đang giữ).
 * Lượng được lấy = tồn sổ kho − hàng đang giữ cho đơn / báo giá khác ở kho đó (cùng cách tính với POS: reservedBySku).
 * Gọi TRONG giao dịch của chứng từ, sau khoá `stock_holds` (giữ hàng mới không chen vào giữa) và trước khi ghi sổ;
 * khoá dòng tồn để chứng từ khác không trừ giữa lúc kiểm và lúc ghi. Thiếu tồn thật do postMoves báo (STOCK_SHORT).
 * Manager được lấy vượt khi ghi lý do – ghi nhật ký kèm các đơn bị ảnh hưởng.
 */
export interface FreeStockOptions { exceptOrderId?: string; override?: unknown; actor: { id: string; role: string }; context: { module: string; entityType: string; entityId: string; refNo: string } }

const round = (n: number) => Math.round(n * 1000) / 1000;

export async function assertFreeStock(db: PosDb, warehouseId: string, lines: readonly { sku: string; qty: number }[], opts: FreeStockOptions) {
  const need = new Map<string, number>();
  for (const l of lines) if (l.sku.trim() && l.qty > 0) need.set(l.sku, (need.get(l.sku) ?? 0) + l.qty);
  if (!need.size) return null;
  const skus = [...need.keys()].sort();
  const balances = await db.select({ sku: stockBalances.sku, qty: stockBalances.qty }).from(stockBalances)
    .where(and(eq(stockBalances.warehouseId, warehouseId), inArray(stockBalances.sku, skus))).orderBy(asc(stockBalances.sku)).for('update');
  const reserved = await reservedBySku(db, skus, warehouseId, opts.exceptOrderId);
  const short = skus.flatMap(sku => {
    const onHand = balances.find(b => b.sku === sku)?.qty ?? 0, held = reserved.get(sku) ?? 0, want = need.get(sku)!;
    // Không đủ tồn thật: để postMoves báo STOCK_SHORT (lỗi đúng bản chất hơn).
    if (want > onHand + 0.0005 || want <= Math.max(0, onHand - held) + 0.0005) return [];
    return [{ sku, onHand: round(onHand), held: round(held), free: round(Math.max(0, onHand - held)), want: round(want) }];
  });
  if (!short.length) return null;
  const holders = (await orderHolds(db, short.map(s => s.sku), warehouseId)).filter(h => h.orderId !== opts.exceptOrderId);
  const detail = short.map(s => {
    const refs = [...new Set(holders.filter(h => h.sku === s.sku).map(h => h.contractNo || h.orderNo))].slice(0, 5);
    return `${s.sku}: tồn ${s.onHand}, đang giữ cho đơn khác ${s.held}${refs.length ? ' (' + refs.join(', ') + ')' : ''}, được lấy ${s.free}, cần ${s.want}`;
  }).join('; ');
  const input = (opts.override && typeof opts.override === 'object' ? opts.override : {}) as Record<string, unknown>;
  const reason = String(input.reason ?? '').trim().slice(0, 500);
  if (opts.override === undefined || opts.override === null)
    throw new AppError(409, 'Hàng đang giữ cho đơn khác: ' + detail + '. Manager có thể xuất vượt khi ghi lý do.', 'HELD_FOR_OTHER_ORDER');
  if (opts.actor.role !== 'manager') throw new AppError(403, 'Chỉ Manager được lấy hàng đang giữ cho đơn khác.', 'HELD_FOR_OTHER_ORDER');
  if (reason.length < 5) throw new AppError(400, 'Ghi lý do lấy hàng đang giữ cho đơn khác (ít nhất 5 ký tự).', 'HELD_OVERRIDE_REASON');
  const record = { warehouseId, reason, short, holders: holders.filter(h => short.some(s => s.sku === h.sku)).map(h => ({ orderId: h.orderId, orderNo: h.orderNo, sku: h.sku, qty: h.qty })) };
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorId: opts.actor.id, module: opts.context.module, action: 'stock-hold-override', entityType: opts.context.entityType,
    entityId: opts.context.entityId, data: JSON.stringify({ refNo: opts.context.refNo, ...record }), createdAt: new Date().toISOString() });
  return record;
}
