import { and, eq, inArray, sql } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { deliveries, salesOrders } from '../schema.ts';
import { posGhnAccount, posGhnKind } from './pos-ghn-account.ts';

/**
 * HUỶ VẬN ĐƠN GHN (shop Lock 6096731) khi huỷ đơn / huỷ chuyến giao Ship COD trong CRM – để shipper không đến lấy hàng.
 * Chạy SAU khi CRM đã huỷ (không chặn thao tác huỷ): GHN từ chối (vd đã lấy hàng) → trả lý do để nhân viên xử lý trên GHN.
 * API GHN: POST v2/switch-status/cancel { order_codes }.
 */
const GHN_CANCEL = 'https://online-gateway.ghn.vn/shiip/public-api/v2/switch-status/cancel';

export interface GhnCancelResult { cancelled: string[]; errors: { code: string; message: string }[] }

export async function cancelGhnShipments(env: StaffEnv, deliveryIds: readonly string[]): Promise<GhnCancelResult | null> {
  if ((!env.ghnToken && !env.ghnMlToken) || !deliveryIds.length) return null;
  const rows = await env.db.select({ id: deliveries.id, code: deliveries.trackingCode, snapshot: salesOrders.posSnapshot }).from(deliveries)
    .innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
    .where(and(inArray(deliveries.id, [...deliveryIds]), eq(salesOrders.channel, 'pos'), sql`${deliveries.trackingCode}<>''`));
  const eligible = rows.map(r => ({ ...r, registerName: String(JSON.parse(r.snapshot || '{}').register?.name ?? '') }))
    .filter(r => posGhnKind(r.registerName));
  if (!eligible.length) return null;
  const result: GhnCancelResult = { cancelled: [], errors: [] };
  for (const kind of ['lock', 'minh-long'] as const) {
    const group = eligible.filter(r => posGhnKind(r.registerName) === kind); if (!group.length) continue;
    try {
      const account = await posGhnAccount(env, group[0]!.registerName);
      if (!account) continue;
      const response = await (env.ghnFetch ?? fetch)(GHN_CANCEL, {
        method: 'POST', headers: { Token: account.token, ShopId: account.shopId, 'content-type': 'application/json' },
        body: JSON.stringify({ order_codes: group.map(r => r.code) }), signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined,
      });
      let body: Record<string, unknown> = {}; try { body = await response.json() as Record<string, unknown>; } catch { /* GHN trả text khi lỗi */ }
      const items = Array.isArray(body.data) ? body.data as Record<string, unknown>[] : [];
      for (const r of group) {
        const item = items.find(x => String(x.order_code ?? '').toUpperCase() === r.code.toUpperCase());
        if (response.ok && item?.result === true) result.cancelled.push(r.code);
        else result.errors.push({ code: r.code, message: String(item?.message || body.message || `GHN lỗi ${response.status}`).slice(0, 300) });
      }
    } catch (e) { for (const r of group) result.errors.push({ code: r.code, message: e instanceof Error ? e.message : 'Không kết nối được GHN – huỷ vận đơn trên trang GHN.' }); }
  }
  const done = eligible.filter(r => result.cancelled.includes(r.code)).map(r => r.id);
  if (done.length) await env.db.update(deliveries).set({ trackingStatus: 'cancel', trackingUpdatedAt: new Date().toISOString() }).where(inArray(deliveries.id, done));
  return result;
}
