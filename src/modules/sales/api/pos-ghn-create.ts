import { and, asc, eq } from 'drizzle-orm';
import type { Router } from '../../../core/http/router.ts';
import { json } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { deliveries, salesOrderLines, salesOrders } from '../schema.ts';
import { findGhnByClientCode } from './ghn-client-code.ts';
import { ghnCreateBody, type GhnShip } from '../domain/pos-ghn.ts';
import { posPermission } from './pos-store.ts';
import { posGhnAccount, posGhnKind } from './pos-ghn-account.ts';

/**
 * TẠO VẬN ĐƠN GHN (shop Lock 6096731) cho chuyến giao Ship COD của quầy Lock – gọi API `shipping-order/create`.
 *  - Tự chạy ngay sau khi lưu đơn COD (POST /pos/checkout); GHN lỗi thì đơn vẫn lưu, trả `ghn.ok = false` + lý do.
 *  - Tạo lại: POST /pos/cod/:deliveryId/ghn (quầy / ca được kiểm ở pos-access.ts như các route /pos/cod/…).
 *  - Một lần: khoá dòng chuyến giao trong lúc gọi GHN; đã có mã vận đơn thì trả lại mã cũ; `client_order_code` = số đơn CRM.
 * Mã vận đơn ghi vào `deliveries.tracking_code` → đồng bộ trạng thái (pos-ghn-sync.ts) tự chạy tiếp.
 */
const GHN_CREATE = 'https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/create';
const text = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);

export interface GhnCreated { orderCode: string; fee: number | null; expectedDelivery: string; existing: boolean }

export async function createGhnShipment(env: StaffEnv, deliveryId: string): Promise<GhnCreated> {
  return env.db.transaction(async tx => {
    const [row] = await tx.select({ delivery: deliveries, order: salesOrders }).from(deliveries)
      .innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).where(eq(deliveries.id, deliveryId)).limit(1).for('update');
    if (!row || row.order.channel !== 'pos' || row.order.fulfillmentMode !== 'cod') throw new AppError(404, 'Không tìm thấy chuyến giao Ship COD.');
    const snapshot = JSON.parse(row.order.posSnapshot || '{}');
    if (row.delivery.trackingCode) return { orderCode: row.delivery.trackingCode, fee: snapshot.ghn?.fee ?? null, expectedDelivery: snapshot.ghn?.expectedDelivery ?? '', existing: true };
    if (row.order.status === 'cancelled' || row.delivery.status !== 'planned') throw new AppError(409, 'Chỉ tạo vận đơn GHN cho chuyến giao đang chờ giao của đơn chưa huỷ.');
    const account = await posGhnAccount(env, snapshot.register?.name);
    if (!account) throw new AppError(409, 'Tự tạo vận đơn GHN chỉ áp dụng quầy Lock hoặc showroom Minh Long. Quầy khác: tạo trên GHN rồi nhập mã vận đơn.');
    const ship = snapshot.ghn as GhnShip | undefined;
    if (!ship?.districtId || !ship.wardCode) throw new AppError(409, 'Đơn chưa có địa chỉ chuẩn GHN (Quận/Huyện, Phường/Xã). Tạo trên GHN rồi nhập mã vận đơn vào chuyến giao.');
    const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, row.order.id)).orderBy(asc(salesOrderLines.lineNo));
    const body = ghnCreateBody({
      orderNo: row.order.orderNo, receiverName: row.delivery.receiverName || row.order.customerName, receiverPhone: row.delivery.receiverPhone || row.order.phone,
      address: row.delivery.address, codAmount: row.delivery.codAmount, ship,
      // Giá khai báo cho GHN: đơn giá đã gồm VAT (tiền khách trả cho từng món).
      lines: lines.map(l => ({ sku: l.sku, name: l.name, qty: l.qty, unitPrice: l.qty > 0 ? (l.amount * (1 + l.taxRate / 100)) / l.qty : 0 })),
    });
    const ghnFetch = env.ghnFetch ?? fetch;
    let response: Response | null = null, result: Record<string, unknown> = {};
    try {
      response = await ghnFetch(GHN_CREATE, {
        method: 'POST', headers: { Token: account.token, ShopId: account.shopId, 'content-type': 'application/json' }, body: JSON.stringify(body),
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined,
      });
      const raw = await response.text();
      try { result = raw ? JSON.parse(raw) : {}; } catch { /* GHN có thể trả text khi lỗi */ }
    } catch { response = null; }
    const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
    let orderCode = response?.ok ? text(data.order_code, 50).toUpperCase() : '', trackingStatus = 'ready_to_pick', fee = Number.isFinite(Number(data.total_fee)) ? Number(data.total_fee) : null;
    if (!orderCode) {
      // Mất phản hồi / GHN báo trùng mã đơn: vận đơn có thể đã tạo ở lần trước – gắn lại đúng vận đơn đó.
      const existing = await findGhnByClientCode(ghnFetch, account, body.client_order_code);
      if (!existing) {
        if (!response) throw new AppError(504, 'Không kết nối được GHN. Đơn đã lưu – bấm "Tạo lại vận đơn GHN" sau.', 'GHN_TIMEOUT');
        throw new AppError(502, 'GHN: ' + (text(result.code_message_value) || text(result.message) || `lỗi ${response.status}`), 'GHN_CREATE_FAILED');
      }
      ({ orderCode, status: trackingStatus, fee } = existing);
    }
    const now = new Date().toISOString(), expectedDelivery = text(data.expected_delivery_time, 60);
    await tx.update(deliveries).set({ trackingCode: orderCode, carrier: 'GHN', trackingStatus, trackingUpdatedAt: now, updatedAt: now }).where(eq(deliveries.id, deliveryId));
    snapshot.ghn = { ...ship, orderCode, fee, expectedDelivery, sortCode: text(data.sort_code, 50), createdAt: now };
    await tx.update(salesOrders).set({ posSnapshot: JSON.stringify(snapshot) }).where(eq(salesOrders.id, row.order.id));
    return { orderCode, fee, expectedDelivery, existing: false };
  });
}

/**
 * Sau khi lưu đơn COD: tự tạo vận đơn nếu là quầy Lock, đã chọn địa chỉ chuẩn GHN và chưa nhập mã vận đơn tay.
 * Không bao giờ ném lỗi (đơn đã lưu) – trả `null` khi không áp dụng, hoặc `{ ok: false, message }` để giao diện hiện nút tạo lại.
 */
export async function autoCreateGhnForOrder(env: StaffEnv, orderId: string) {
  const [row] = await env.db.select({ id: deliveries.id, code: deliveries.trackingCode, snapshot: salesOrders.posSnapshot }).from(deliveries)
    .innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
    .where(and(eq(deliveries.orderId, orderId), eq(deliveries.status, 'planned'))).orderBy(asc(deliveries.createdAt)).limit(1);
  if (!row || row.code) return null;
  const snapshot = JSON.parse(row.snapshot || '{}');
  const kind = posGhnKind(snapshot.register?.name);
  if (!kind || (kind === 'lock' ? !env.ghnToken : !env.ghnMlToken)) return null;
  if (!snapshot.ghn?.districtId) return { ok: false as const, deliveryId: row.id, message: 'Đơn chưa có địa chỉ chuẩn GHN (Quận/Huyện, Phường/Xã) nên chưa tạo vận đơn. Tạo trên GHN rồi nhập mã vào chuyến giao.' };
  try { return { ok: true as const, deliveryId: row.id, ...(await createGhnShipment(env, row.id)) }; }
  catch (e) { return { ok: false as const, deliveryId: row.id, message: e instanceof Error ? e.message : 'Không tạo được vận đơn GHN.' }; }
}

export function registerPosGhnCreateRoutes(router: Router<StaffEnv>) {
  router.post('/pos/cod/:id/ghn', async c => {
    posPermission((c.state.session as SessionState).member);
    return json(await createGhnShipment(c.env, c.params.id!));
  }, 'business');
}
