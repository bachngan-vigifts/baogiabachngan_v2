import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { warehouses } from '../../catalog/schema.ts';
import { salesOrders } from '../schema.ts';
import { orderHolds } from './hold-routes.ts';
import { autoHoldExpiry, holdOrderStock, lockHolds } from './order-hold-store.ts';
import type { PosDb } from './pos-store.ts';

/**
 * KẾ HOẠCH CHUYỂN ĐỔI GIỮ HÀNG ĐƠN CŨ (hold_mode 'legacy' → 'capped'), docs/SO-KHO.md › Giữ hàng theo đơn.
 * Đơn CRM có trước khi bật giữ theo đơn đang giữ TOÀN BỘ phần chưa giao (có thể vượt tồn). Chuyển đổi áp đúng quy tắc mới:
 *  - mọi đơn cũ thôi giữ kiểu cũ cùng lúc, rồi lần lượt theo thứ tự gửi duyệt / lập (đơn trước giữ trước) giữ lại ≤ có thể bán;
 *  - chỉ đơn đã duyệt, có kho bán, có ngày giao còn hiệu lực (ngày giao + 3 ngày chưa qua) mới giữ; còn lại về 0 (bấm "Giữ hàng" khi cần).
 * Xem trước = chạy trọn trong giao dịch rồi huỷ (không ghi gì). Áp dụng = chạy lại, chỉ ghi khi kết quả trùng mã kế hoạch đã xem.
 */
export interface ConversionLine { sku: string; before: number; after: number }
export interface ConversionOrder { orderId: string; orderNo: string; status: string; warehouse: string | null; deliveryDate: string | null; reason: string; lines: ConversionLine[] }
export interface ConversionPlan { planId: string; generatedAt: string; orders: ConversionOrder[]; held: { before: number; after: number } }

class Preview extends Error { constructor(readonly plan: ConversionPlan) { super('preview'); } }
const round = (n: number) => Math.round(n * 1000) / 1000;

async function convert(tx: PosDb, actorId: string, now: string): Promise<ConversionPlan> {
  await lockHolds(tx);
  const legacy = await tx.select().from(salesOrders).where(and(eq(salesOrders.channel, 'crm'), eq(salesOrders.holdMode, 'legacy'),
    inArray(salesOrders.status, ['draft', 'confirmed', 'delivering']))).orderBy(sql`coalesce(${salesOrders.submittedAt}, ${salesOrders.createdAt})`, asc(salesOrders.orderNo)).for('update');
  const ids = legacy.map(o => o.id);
  const before = ids.length ? (await orderHolds(tx)).filter(h => ids.includes(h.orderId)) : [];
  if (ids.length) await tx.update(salesOrders).set({ holdMode: 'capped' }).where(inArray(salesOrders.id, ids));
  const names = new Map((await tx.select({ id: warehouses.id, name: warehouses.name }).from(warehouses)).map(w => [w.id, w.name]));
  const orders: ConversionOrder[] = [];
  for (const o of legacy) {
    const was = before.filter(h => h.orderId === o.id);
    const expiresAt = o.expectedDeliveryDate ? autoHoldExpiry(o.expectedDeliveryDate) : null;
    const reason = o.status === 'draft' ? 'Đơn nháp: giữ khi duyệt' : !o.holdsStock ? 'Đơn tắt giữ hàng' : !o.warehouseId ? 'Chưa chọn kho bán'
      : !expiresAt ? 'Không có ngày giao: không tự giữ' : expiresAt <= now ? 'Đã quá ngày giao + 3 ngày' : '';
    const got = reason ? [] : (await holdOrderStock(tx, { ...o, holdMode: 'capped' }, actorId, { source: 'conversion', expiresAt: expiresAt!, now })).lines;
    const skus = [...new Set([...was.map(h => h.sku), ...got.map(l => l.sku)])].sort();
    orders.push({ orderId: o.id, orderNo: o.orderNo, status: o.status, warehouse: o.warehouseId ? names.get(o.warehouseId) ?? o.warehouseId : null, deliveryDate: o.expectedDeliveryDate,
      reason: reason || (got.some(l => l.qty < l.want) ? 'Giữ tối đa có thể bán; phần thiếu chờ hàng về' : ''),
      lines: skus.map(sku => ({ sku, before: round(was.filter(h => h.sku === sku).reduce((n, h) => n + h.qty, 0)), after: round(got.filter(l => l.sku === sku).reduce((n, l) => n + l.qty, 0)) })) });
  }
  const planId = sha256Hex(JSON.stringify(orders.map(o => [o.orderId, o.lines.map(l => [l.sku, l.after])]))).slice(0, 16);
  const sum = (k: 'before' | 'after') => round(orders.reduce((n, o) => n + o.lines.reduce((m, l) => m + l[k], 0), 0));
  return { planId, generatedAt: now, orders, held: { before: sum('before'), after: sum('after') } };
}

/** Xem trước: chạy trọn rồi huỷ giao dịch – không ghi gì. */
export async function previewHoldConversion(db: PosDb & { transaction: (fn: (tx: PosDb) => Promise<unknown>) => Promise<unknown> }, actorId: string, now = new Date().toISOString()) {
  try { await db.transaction(async tx => { throw new Preview(await convert(tx, actorId, now)); }); }
  catch (e) { if (e instanceof Preview) return e.plan; throw e; }
  throw new Error('unreachable');
}

/** Áp dụng đúng kế hoạch đã xem (mã kế hoạch phải trùng – dữ liệu đổi thì xem lại). */
export async function applyHoldConversion(db: PosDb & { transaction: <T>(fn: (tx: PosDb) => Promise<T>) => Promise<T> }, actorId: string, planId: string, now = new Date().toISOString()) {
  return db.transaction(async tx => {
    const plan = await convert(tx, actorId, now);
    if (!plan.orders.length) return { ...plan, applied: 0 };
    if (plan.planId !== planId) throw new AppError(409, 'Dữ liệu giữ hàng đã thay đổi so với kế hoạch đã xem. Xem lại kế hoạch rồi áp dụng.', 'HOLD_PLAN_CHANGED');
    await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorId, module: 'sales', action: 'order-hold-conversion', entityType: 'sales_orders', entityId: planId,
      data: JSON.stringify({ planId, held: plan.held, orders: plan.orders.map(o => ({ orderNo: o.orderNo, reason: o.reason, lines: o.lines })) }).slice(0, 200_000), createdAt: now });
    return { ...plan, applied: plan.orders.length };
  });
}
