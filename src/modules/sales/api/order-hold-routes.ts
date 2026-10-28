import { and, asc, eq, gt } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { orderStockHolds, salesOrders } from '../schema.ts';
import { orderScopeFor } from './routes.ts';
import { holdOrderStock, lockHolds, manualHoldExpiry, MANUAL_HOLD_DAYS, orderHoldLines, releaseOrderHolds } from './order-hold-store.ts';
import { applyHoldConversion, previewHoldConversion } from './order-hold-conversion.ts';

/** Giữ hàng trên chi tiết đơn CRM (order-hold-store.ts): xem, Giữ hàng / Giữ thêm (5 ngày), huỷ giữ, Manager gia hạn. */
type Ctx = RouteContext<StaffEnv>;
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();

export function registerOrderHoldRoutes(router: Router<StaffEnv>) {
  /** Đơn trong phạm vi người xem (nhân viên phụ trách / Manager); khoá dòng đơn khi ghi. */
  async function load(c: Ctx, db: StaffEnv['db'] | Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0], lock = false) {
    const q = db.select().from(salesOrders).where(and(eq(salesOrders.id, c.params.id!), orderScopeFor(viewer(c)))).limit(1);
    const [o] = lock ? await q.for('update') : await q;
    if (!o) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
    return o;
  }
  const audit = (db: Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0], c: Ctx, orderId: string, action: string, data: unknown) =>
    db.insert(auditLogs).values({ id: crypto.randomUUID(), actorId: viewer(c).id, module: 'sales', action, entityType: 'sales_orders', entityId: orderId, data: JSON.stringify(data), createdAt: nowIso() });

  /** Kế hoạch chuyển đổi đơn cũ sang giữ có giới hạn – chỉ Manager. Xem trước không ghi; áp dụng phải trùng mã kế hoạch. */
  router.get('/stock-holds/conversion', async c => {
    if (viewer(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager xem kế hoạch chuyển đổi giữ hàng.');
    return json(await previewHoldConversion(c.env.db as never, viewer(c).id));
  }, 'business');
  router.post('/stock-holds/conversion', async c => {
    if (viewer(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager áp dụng kế hoạch chuyển đổi giữ hàng.');
    const b = await readJson(c.req, 1_000);
    if (b.confirmed !== true || typeof b.planId !== 'string' || !b.planId) throw new AppError(400, 'Xem kế hoạch và xác nhận đúng mã kế hoạch trước khi áp dụng.');
    return json(await applyHoldConversion(c.env.db as never, viewer(c).id, b.planId));
  }, 'business');

  router.get('/orders/:id/holds', async c => {
    const o = await load(c, c.env.db), now = nowIso(), m = viewer(c);
    const [lines, rows] = await Promise.all([
      orderHoldLines(c.env.db, o, now),
      c.env.db.select({ sku: orderStockHolds.sku, qty: orderStockHolds.qty, source: orderStockHolds.source, expiresAt: orderStockHolds.expiresAt }).from(orderStockHolds)
        .where(and(eq(orderStockHolds.orderId, o.id), eq(orderStockHolds.status, 'active'), gt(orderStockHolds.expiresAt, now))).orderBy(asc(orderStockHolds.expiresAt)),
    ]);
    const open = o.channel === 'crm' && o.holdMode === 'capped' && ['confirmed', 'delivering'].includes(o.status);
    return json({ holdMode: o.holdMode, lines, holds: rows, manualDays: MANUAL_HOLD_DAYS,
      canHold: open && !!o.warehouseId && lines.some(l => l.remaining > l.held), canRelease: open && rows.length > 0, canExtend: open && rows.length > 0 && m.role === 'manager' });
  }, 'business');

  /** Giữ hàng / Giữ thêm (khi hàng về): mỗi mã tối đa có thể bán tại kho bán, hạn 5 ngày. Mã chống gửi lặp bắt buộc. */
  router.post('/orders/:id/holds', async c => {
    const b = await readJson(c.req, 1_000), key = String(b.clientKey ?? '');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new AppError(400, 'Thiếu mã chống gửi lặp – tải lại trang rồi thử lại.');
    const result = await c.env.db.transaction(async tx => {
      // Thứ tự khoá chung: stock_holds → đơn (như xác nhận xuất kho / POS) – tránh khoá chéo.
      await lockHolds(tx); const o = await load(c, tx, true);
      const r = await holdOrderStock(tx, o, viewer(c).id, { source: 'manual', expiresAt: manualHoldExpiry(), clientKey: key });
      if (!r.replayed) await audit(tx, c, o.id, 'order-hold', { clientKey: key, lines: r.lines.filter(l => l.qty > 0).map(l => ({ sku: l.sku, qty: l.qty })) });
      return r;
    });
    return json(result, result.replayed ? 200 : 201);
  }, 'business');

  router.post('/orders/:id/holds/release', async c => {
    const b = await readJson(c.req, 2_000), reason = String(b.reason ?? '').trim().slice(0, 500);
    if (reason.length < 3) throw new AppError(400, 'Nhập lý do huỷ giữ hàng.');
    const released = await c.env.db.transaction(async tx => {
      await lockHolds(tx); const o = await load(c, tx, true);
      const n = await releaseOrderHolds(tx, o.id, viewer(c).id);
      if (n) await audit(tx, c, o.id, 'order-hold-release', { reason, rows: n });
      return n;
    });
    return json({ ok: true, released });
  }, 'business');

  /** Manager gia hạn mọi dòng giữ còn hiệu lực thêm 5 ngày (tính từ hạn hiện tại, không lùi về trước hôm nay). */
  router.post('/orders/:id/holds/extend', async c => {
    if (viewer(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager gia hạn giữ hàng.');
    const extended = await c.env.db.transaction(async tx => {
      await lockHolds(tx); const o = await load(c, tx, true), now = nowIso();
      const rows = await tx.select({ id: orderStockHolds.id, expiresAt: orderStockHolds.expiresAt }).from(orderStockHolds)
        .where(and(eq(orderStockHolds.orderId, o.id), eq(orderStockHolds.status, 'active'), gt(orderStockHolds.expiresAt, now)));
      if (!rows.length) throw new AppError(409, 'Đơn không còn giữ hàng – bấm "Giữ hàng" lại.');
      for (const r of rows) await tx.update(orderStockHolds).set({ expiresAt: manualHoldExpiry(Math.max(Date.now(), Date.parse(r.expiresAt))) }).where(eq(orderStockHolds.id, r.id));
      await audit(tx, c, o.id, 'order-hold-extend', { rows: rows.length, days: MANUAL_HOLD_DAYS });
      return rows.length;
    });
    return json({ ok: true, extended });
  }, 'business');
}
