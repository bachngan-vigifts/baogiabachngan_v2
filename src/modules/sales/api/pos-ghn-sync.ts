import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Router } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { posRegisters, posShifts } from '../pos-schema.ts';
import { customerPayments, deliveries, deliveryLines, paymentSchedules, salesOrderLines, salesOrders } from '../schema.ts';
import { cashLock } from './cash-store.ts';
import { assertNoStockRecovery } from './pos-order-flow-guards.ts';
import { recordDispatch } from './cancellation-guards.ts';
import { issuePosDelivery } from './pos-delivery-stock.ts';
import { refreshOrderStatus } from './routes.ts';
import { invoiceTasksChanged } from './invoice-task-hooks.ts';
import { vietnamDate } from '../domain/sales.ts';
import { posPermission } from './pos-store.ts';
import type { SessionState } from '../../staff/api/auth-routes.ts';
import { webStoreOrders } from '../pos-schema.ts';

const GHN_DETAIL = 'https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/detail';
const LOCK_GHN_SHOP_ID = '6096731';
const IN_TRANSIT = new Set(['picked', 'storing', 'transporting', 'sorting', 'delivering', 'money_collect_delivering', 'delivery_fail', 'delivery_failed', 'exception']);
const FAILED = new Set(['cancel', 'return', 'returned', 'returning', 'return_transporting', 'return_sorting', 'waiting_to_return', 'return_fail', 'damage', 'lost']);
const text = (value: unknown, max = 100) => String(value ?? '').trim().slice(0, max);

async function ghnDetail(env: StaffEnv, code: string) {
  if (!env.ghnToken) throw new AppError(503, 'Chưa cấu hình GHN_API_TOKEN.');
  const response = await (env.ghnFetch ?? fetch)(GHN_DETAIL, {
    method: 'POST', headers: { Token: env.ghnToken, ShopId: LOCK_GHN_SHOP_ID, 'content-type': 'application/json' }, body: JSON.stringify({ order_code: code }),
  });
  const raw = await response.text(); let body: Record<string, unknown> = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* GHN có thể trả text khi lỗi. */ }
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {};
  if (!response.ok || !text(data.status)) throw new AppError(502, text(body.message, 300) || `GHN không trả trạng thái cho ${code}.`);
  return { status: text(data.status).toLowerCase(), updatedAt: text(data.updated_date ?? data.updated_at, 60) || new Date().toISOString() };
}

export async function applyGhnStatus(env: StaffEnv, deliveryId: string, status: string, observedAt: string) {
  const result = await env.db.transaction(async tx => {
    await cashLock(tx);
    const [row] = await tx.select({ delivery: deliveries, order: salesOrders }).from(deliveries)
      .innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).where(eq(deliveries.id, deliveryId)).limit(1).for('update');
    if (!row || row.order.channel !== 'pos' || row.order.fulfillmentMode !== 'cod') return { changed: false, delivered: false, orderId: '' };
    // Callback GHN có thể retry/đến lệch thứ tự: trạng thái sau khi giao thành công không được lùi lại.
    if (row.delivery.status === 'delivered' && status !== 'delivered') return { changed: false, delivered: false, orderId: row.order.id };
    const now = new Date().toISOString();
    await tx.update(deliveries).set({ trackingStatus: status, trackingUpdatedAt: observedAt, updatedAt: now }).where(eq(deliveries.id, deliveryId));
    // Chuyến / đơn đã huỷ: chỉ lưu trạng thái GHN, không xuất kho, không ghi thu COD (hàng hoàn nhận lại qua "Nhận hàng hoàn").
    if (row.delivery.status === 'cancelled' || row.order.status === 'cancelled') return { changed: true, delivered: false, orderId: row.order.id };

    if ((IN_TRANSIT.has(status)||status==='delivered') && row.delivery.status!=='delivered') await assertNoStockRecovery(tx,row.order.id);
    if (IN_TRANSIT.has(status) && !['in_transit', 'delivered'].includes(row.delivery.status)) {
      await tx.update(deliveries).set({ status: 'in_transit' }).where(eq(deliveries.id, deliveryId));
      await recordDispatch(tx,row.order.id,row.delivery.id,row.order.createdBy,status);
      await issuePosDelivery(tx, row.order.id, row.delivery.id, row.order.createdBy, true);
      await tx.update(salesOrders).set({ status: 'delivering', updatedAt: now }).where(and(eq(salesOrders.id, row.order.id), eq(salesOrders.status, 'confirmed')));
    }
    if (FAILED.has(status) && row.delivery.status !== 'delivered') {
      await tx.update(deliveries).set({ status: 'failed' }).where(eq(deliveries.id, deliveryId));
      return { changed: true, delivered: false, orderId: row.order.id };
    }
    if (status !== 'delivered' || row.delivery.status === 'delivered') return { changed: true, delivered: false, orderId: row.order.id };

    if (row.delivery.status !== 'in_transit') {
      await tx.update(deliveries).set({ status: 'in_transit' }).where(eq(deliveries.id, deliveryId));
      await recordDispatch(tx,row.order.id,row.delivery.id,row.order.createdBy,status);
      await issuePosDelivery(tx, row.order.id, row.delivery.id, row.order.createdBy, true);
    }
    const deliveredOn = vietnamDate().iso;
    await tx.update(deliveries).set({ status: 'delivered', deliveredAt: observedAt || now, updatedAt: now }).where(eq(deliveries.id, deliveryId));
    for (const line of await tx.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, deliveryId)))
      await tx.update(salesOrderLines).set({ deliveredQty: sql`least(${salesOrderLines.qty}, ${salesOrderLines.deliveredQty} + ${line.qty})` }).where(eq(salesOrderLines.id, line.orderLineId));
    await issuePosDelivery(tx, row.order.id, row.delivery.id, row.order.createdBy);
    await refreshOrderStatus(tx, row.order.id, deliveredOn);

    if (row.delivery.codAmount > 0) {
      const requestKey = `ghn-cod:${row.delivery.id}`;
      const [prior] = await tx.select({ id: customerPayments.id }).from(customerPayments).where(eq(customerPayments.requestKey, requestKey)).limit(1);
      if (!prior) {
        const [paid] = await tx.select({ amount: sql<number>`coalesce(sum(${customerPayments.amount}),0)`.mapWith(Number) }).from(customerPayments)
          .where(and(eq(customerPayments.deliveryId, deliveryId), isNull(customerPayments.voidedAt)));
        const amount = Math.max(0, row.delivery.codAmount - (paid?.amount ?? 0));
        const [schedule] = await tx.select({ id: paymentSchedules.id }).from(paymentSchedules).where(eq(paymentSchedules.orderId, row.order.id)).limit(1);
        if (amount > 0) await tx.insert(customerPayments).values({ id: crypto.randomUUID(), orderId: row.order.id, scheduleId: schedule?.id,
          customerId: row.order.customerId, deliveryId, shiftId: null, requestKey, paymentSource: 'ghn_cod', amount, method: 'other',
          reference: row.delivery.trackingCode, note: 'GHN xác nhận đã giao và đã thu COD', paidAt: deliveredOn,
          createdBy: row.order.createdBy, createdAt: now });
      }
    }
    return { changed: true, delivered: true, orderId: row.order.id };
  });
  if (result.delivered) await invoiceTasksChanged(env, { orderId: result.orderId });
  return result.changed;
}

export async function syncPosLockGhn(env: StaffEnv) {
  // Mỗi lượt tối đa 100 chuyến: chuyến lâu chưa kiểm trước (xoay vòng, không bỏ sót khi có nhiều hơn 100).
  const rows = await env.db.select({ id: deliveries.id, code: deliveries.trackingCode, orderNo: salesOrders.orderNo }).from(deliveries)
    .innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
    .innerJoin(posRegisters, eq(posRegisters.id, posShifts.registerId))
    .where(and(eq(salesOrders.channel, 'pos'), eq(salesOrders.fulfillmentMode, 'cod'), sql`lower(${posRegisters.name}) like '%lock%'`,
      sql`${deliveries.trackingCode}<>''`, inArray(deliveries.status, ['planned', 'in_transit', 'failed'])))
    .orderBy(sql`${deliveries.trackingUpdatedAt} asc nulls first`).limit(100);
  let updated = 0; const errors: { code: string; orderNo: string; message: string }[] = [];
  for (const row of rows) try {
    const state = await ghnDetail(env, row.code);
    if (await applyGhnStatus(env, row.id, state.status, state.updatedAt)) updated++;
  } catch (error) {
    errors.push({ code: row.code, orderNo: row.orderNo, message: error instanceof Error ? error.message : 'Lỗi GHN' });
    // Ghi lại lúc kiểm để lượt sau xoay sang chuyến khác (mã sai không chặn mãi đầu hàng đợi).
    await env.db.update(deliveries).set({ trackingUpdatedAt: new Date().toISOString() }).where(eq(deliveries.id, row.id));
  }
  return { ok: errors.length === 0, checked: rows.length, updated, errors };
}

/** Lần đồng bộ gần nhất (theo tiến trình): bấm liên tục trong 60 giây trả kết quả cũ, không gọi GHN lại. */
let lastSync: { at: number; result: Awaited<ReturnType<typeof syncPosLockGhn>> } | null = null;
const SYNC_GAP_MS = 60_000;

export function registerPosGhnSyncRoutes(router: Router<StaffEnv>) {
  router.post('/integrations/ghn/pos-lock/webhook', async c => {
    // Mã bí mật kiểm ở khu vực 'ghn-webhook' (auth-routes.ts), như webhook SePay / đơn web.
    const body = await readJson(c.req, 64_000);
    const orderCode = text(body.OrderCode ?? body.order_code, 100).toUpperCase();
    const status = text(body.Status ?? body.status, 100).toLowerCase();
    const shopId = text(body.ShopID ?? body.shop_id, 30);
    const observedAt = text(body.Time ?? body.updated_date ?? body.updated_at, 60) || new Date().toISOString();
    if (!orderCode || !status) throw new AppError(400, 'Webhook GHN thiếu mã vận đơn hoặc trạng thái.');
    if (shopId && shopId !== LOCK_GHN_SHOP_ID) throw new AppError(403, 'Webhook không thuộc shop GHN Lock.');

    const ships = await c.env.db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.trackingCode, orderCode)).limit(2);
    let updated = 0;
    for (const ship of ships) if (await applyGhnStatus(c.env, ship.id, status, observedAt)) updated++;

    const web = await c.env.db.select({ id: webStoreOrders.id, status: webStoreOrders.status, ghnStatus: webStoreOrders.ghnStatus }).from(webStoreOrders)
      .where(eq(webStoreOrders.ghnOrderCode, orderCode)).limit(2);
    for (const row of web) {
      if (row.ghnStatus.toLowerCase() === 'delivered' && status !== 'delivered') continue;
      const orderStatus = status === 'delivered' ? 'completed' : FAILED.has(status) ? 'cancelled' : row.status;
      await c.env.db.update(webStoreOrders).set({ status: orderStatus, ghnStatus: status, updatedAt: observedAt }).where(eq(webStoreOrders.id, row.id));
      await invoiceTasksChanged(c.env, { webOrderId: row.id });
      updated++;
    }
    return json({ ok: true, orderCode, status, updated });
  }, 'ghn-webhook');

  // Máy gọi (n8n / OpenClaw) bằng mã đồng bộ.
  router.post('/integrations/ghn/pos-lock/pull', async c => json(await syncPosLockGhn(c.env)), 'sapo-sync');
  /**
   * Đồng bộ trạng thái vận đơn GHN (shop Lock) ngay trong CRM: nhân viên bán hàng nhanh bấm "Đồng bộ GHN" hoặc mở Ship COD.
   * Giao xong → tự xuất kho, ghi thu COD (nguồn ghn_cod); hoàn / huỷ → chuyến giao "thất bại". Kiểm quyền ở máy chủ.
   */
  router.post('/pos/ghn/sync', async c => {
    posPermission((c.state.session as SessionState).member);
    if (!c.env.ghnToken) throw new AppError(503, 'CRM chưa có token GHN (secret GHN_API_TOKEN). Thêm secret rồi chạy lại "Triển khai API".', 'GHN_NOT_CONFIGURED');
    const now = Date.now();
    if (lastSync && now - lastSync.at < SYNC_GAP_MS) return json({ ...lastSync.result, cached: true, syncedAt: new Date(lastSync.at).toISOString() });
    const result = await syncPosLockGhn(c.env);
    lastSync = { at: now, result };
    return json({ ...result, cached: false, syncedAt: new Date(now).toISOString() });
  }, 'business');
}
/** Chỉ cho test: xoá bộ nhớ lần đồng bộ gần nhất. */
export const resetGhnSyncThrottle = () => { lastSync = null; };
