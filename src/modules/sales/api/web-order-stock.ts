import {readWebEdit} from '../domain/web-order-edit.ts';
import { and, asc, gt, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { products } from '../../catalog/schema.ts';
import { employees } from '../../staff/schema.ts';
import { postMoves, reverseRef } from '../../inventory/api/ledger.ts';
import { notifyMany } from '../../notifications/api/routes.ts';
import { posRegisters, webStoreOrders } from '../pos-schema.ts';

/**
 * SỔ KHO ĐƠN WEB (Lock, Minh Long) THEO TRẠNG THÁI GHN – quyết định Anh Thái 28/10/2026, docs/SO-KHO.md › Đơn web.
 *  - GHN báo đã lấy hàng (hoặc bất kỳ trạng thái nào sau đó) → tự trừ kho quầy của đơn theo dòng hàng website (chứng từ `web_order`).
 *  - GHN báo đã hoàn về shop (`returned`) → tự cộng lại đúng số đã trừ (dòng đảo).
 *  - Không trừ được (mã website không có trong danh mục, kho thiếu / chưa chốt đầu kỳ) → KHÔNG chặn đồng bộ GHN: đánh dấu `blocked`,
 *    báo Manager một lần; lượt đồng bộ sau thử lại.
 *  - `legacy`: đơn đã lấy hàng / kết thúc trước khi bật – không tự trừ bù.
 * Gọi lặp an toàn (khoá dòng đơn web; postMoves / reverseRef không ghi hai lần).
 */
const PRE_PICKUP = new Set(['', 'ready_to_pick', 'picking', 'money_collect_picking', 'cancel']);
const BACK = new Set(['returned']);

export const webStockAction = (ghnStatus: string, stockStatus: string) => {
  const s = ghnStatus.trim().toLowerCase();
  if (stockStatus === 'legacy') return 'none' as const;
  if (BACK.has(s)) return stockStatus === 'issued' ? 'return' as const : 'none' as const;
  if (!PRE_PICKUP.has(s) && ['none', 'blocked'].includes(stockStatus)) return 'issue' as const;
  return 'none' as const;
};

/** Người ghi sổ khi đồng bộ tự động (webhook / máy gọi): tài khoản Manager lập sớm nhất – dòng sổ ghi rõ "Tự động theo GHN". */
async function automationActor(env: StaffEnv) {
  const [m] = await env.db.select({ id: employees.id }).from(employees).where(and(eq(employees.role, 'manager'), eq(employees.active, true))).orderBy(asc(employees.createdAt)).limit(1);
  if (!m) throw new AppError(503, 'Chưa có tài khoản Manager để ghi sổ kho tự động.');
  return m.id;
}

export async function syncWebOrderStock(env: StaffEnv, webOrderId: string, by?: string) {
  const actorId = by ?? await automationActor(env), auto = by ? '' : 'Tự động theo GHN · ';
  const outcome = await env.db.transaction(async tx => {
    const [row] = await tx.select({ o: webStoreOrders, warehouseId: posRegisters.warehouseId }).from(webStoreOrders)
      .innerJoin(posRegisters, eq(posRegisters.id, webStoreOrders.registerId)).where(eq(webStoreOrders.id, webOrderId)).for('update');
    if (!row) return null;
    const o = row.o, action = webStockAction(o.ghnStatus, o.stockStatus), now = new Date().toISOString(), refNo = ('WEB ' + o.orderNo).slice(0, 60);
    if (action === 'none') return null;
    if (action === 'return') {
      await reverseRef(tx, actorId, 'web_order', o.id, `${auto}GHN hoàn về shop – ${refNo}`, now);
      await tx.update(webStoreOrders).set({ stockStatus: 'returned', stockNote: '', stockUpdatedAt: now }).where(eq(webStoreOrders.id, o.id));
      return { status: 'returned' as const, o };
    }
    let lines: { sku?: unknown; quantity?: unknown }[] = [];
    try { lines = JSON.parse(o.lines || '[]'); } catch { lines = []; }
    const want = new Map<string, number>(), bad: string[] = [];
    for (const l of lines) {
      const sku = String(l.sku ?? '').trim(), qty = Number(l.quantity);
      if (!sku || !(qty > 0)) { bad.push(sku || '(không mã)'); continue; }
      want.set(sku, (want.get(sku) ?? 0) + qty);
    }
    const known = want.size ? new Set((await tx.select({ sku: products.sku }).from(products).where(inArray(products.sku, [...want.keys()]))).map(p => p.sku)) : new Set<string>();
    for (const sku of want.keys()) if (!known.has(sku)) bad.push(sku);
    let note = readWebEdit(o.crmEditSnapshot).ghnCartReviewRequired?'Bản sửa CRM và vận đơn GHN cần đối soát sản phẩm; chưa tự xuất kho.':'';
    if (note) { /* keep explicit carrier/cart reconciliation block */ }
    else if (bad.length || !want.size) note = 'Mã website không khớp danh mục: ' + (bad.join(', ') || 'đơn không có dòng hàng');
    else {
      try {
        // Lỗi trong khối ghi sổ chỉ huỷ khối đó (savepoint) – trạng thái GHN vẫn được lưu, đơn đánh dấu cần đối soát.
        await tx.transaction(t => postMoves(t, actorId, [...want].map(([sku, qty]) => ({ sku, warehouseId: row.warehouseId, qty: -qty, kind: 'issue' as const,
          refType: 'web_order' as const, refId: o.id, refNo, note: `${auto}GHN ${o.ghnOrderCode} · ${o.customerName}` })), now));
      } catch (e) { if (!(e instanceof AppError)) throw e; note = e.message; }
    }
    if (note) {
      const first = o.stockStatus !== 'blocked' || o.stockNote !== note;
      await tx.update(webStoreOrders).set({ stockStatus: 'blocked', stockNote: note.slice(0, 500), stockUpdatedAt: now }).where(eq(webStoreOrders.id, o.id));
      return first ? { status: 'blocked' as const, o, note } : null;
    }
    await tx.update(webStoreOrders).set({ stockStatus: 'issued', stockNote: '', stockUpdatedAt: now }).where(eq(webStoreOrders.id, o.id));
    return { status: 'issued' as const, o };
  });
  if (outcome?.status === 'blocked')
    await notifyMany(env, 'managers', { eventType: 'web_order_stock_blocked', title: 'Đơn web chưa trừ được kho',
      body: `Web ${outcome.o.orderNo} (GHN ${outcome.o.ghnOrderCode || '—'}): ${outcome.note}. Kiểm mã / tồn rồi đồng bộ lại; cần thì lập phiếu điều chỉnh.`, url: '/index.html#/pos' }).catch(() => 0);
  return outcome?.status ?? null;
}

/** Lưới an toàn (chạy cùng lượt đồng bộ GHN): đơn đã qua lấy hàng mà chưa trừ / bị chặn, đã hoàn mà chưa cộng lại. */
export async function reconcileWebOrderStock(env: StaffEnv) {
  const rows = await env.db.select({ id: webStoreOrders.id, ghn: webStoreOrders.ghnStatus, stock: webStoreOrders.stockStatus }).from(webStoreOrders)
    .where(and(inArray(webStoreOrders.stockStatus, ['none', 'blocked', 'issued']), sql`${webStoreOrders.ghnStatus} <> ''`)).limit(500);
  let done = 0;
  for (const r of rows) if (webStockAction(r.ghn, r.stock) !== 'none' && await syncWebOrderStock(env, r.id)) done++;
  return done;
}

/** Durable repair cursor: one candidate, including already-issued rows, per tick. */
export async function reconcileWebOrderStockPage(env: StaffEnv, after: string) {
  const [row] = await env.db.select({id:webStoreOrders.id,ghn:webStoreOrders.ghnStatus,stock:webStoreOrders.stockStatus}).from(webStoreOrders)
    .where(and(gt(webStoreOrders.id,after),inArray(webStoreOrders.stockStatus,['none','blocked','issued']),sql`${webStoreOrders.ghnStatus}<>''`)).orderBy(asc(webStoreOrders.id)).limit(1);
  if (!row) return { next: null, updated: 0 };
  const updated = webStockAction(row.ghn,row.stock)!=='none' && await syncWebOrderStock(env,row.id) ? 1 : 0;
  return { next: row.id, updated };
}
