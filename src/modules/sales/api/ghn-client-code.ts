/**
 * TRA VẬN ĐƠN GHN THEO MÃ ĐƠN CRM (client_order_code). Tạo vận đơn mà mất phản hồi (hết giờ, mạng ngắt, CRM lỗi sau khi GHN đã tạo)
 * thì lần bấm "Tạo lại" bị GHN chặn vì trùng mã đơn → không bao giờ có mã vận đơn, đồng bộ trạng thái / xuất kho lúc GHN lấy hàng không chạy.
 * Trước khi báo lỗi, hỏi GHN vận đơn đã có cho đúng mã đơn đó và gắn lại – không tạo trùng.
 */
const GHN_DETAIL_BY_CLIENT = 'https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/detail-by-client-code';
const text = (v: unknown, max = 100) => String(v ?? '').trim().slice(0, max);

export interface GhnExisting { orderCode: string; status: string; fee: number | null }

export async function findGhnByClientCode(fetchImpl: typeof fetch, account: { token: string; shopId: string }, clientCode: string): Promise<GhnExisting | null> {
  if (!clientCode) return null;
  try {
    const res = await fetchImpl(GHN_DETAIL_BY_CLIENT, {
      method: 'POST', headers: { Token: account.token, ShopId: account.shopId, 'content-type': 'application/json' }, body: JSON.stringify({ client_order_code: clientCode }),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined,
    });
    const raw = await res.text(); let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return null; }
    const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {};
    const orderCode = text(data.order_code, 50).toUpperCase();
    // Chỉ nhận vận đơn mang đúng mã đơn CRM (GHN trả client_order_code kèm theo).
    if (!res.ok || !orderCode || (data.client_order_code !== undefined && text(data.client_order_code) !== clientCode)) return null;
    const fee = Number(data.total_fee);
    return { orderCode, status: text(data.status).toLowerCase() || 'ready_to_pick', fee: Number.isFinite(fee) ? fee : null };
  } catch { return null; }
}
