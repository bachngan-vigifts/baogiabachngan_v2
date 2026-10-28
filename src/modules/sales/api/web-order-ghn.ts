import { eq } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { webStoreOrders } from '../pos-schema.ts';
import { findGhnByClientCode } from './ghn-client-code.ts';
import { ghnCreateBody, parseGhnShip } from '../domain/pos-ghn.ts';
import { readWebOrderFinancials } from '../domain/web-order-financials.ts';
import { posGhnAccount } from './pos-ghn-account.ts';

/**
 * ĐƠN WEB MINH LONG XỬ LÝ THẲNG TRONG CRM (website Minh Long chưa có cầu nối `order-action` như web Lock):
 *  - Xác nhận: CRM tạo vận đơn GHN bằng tài khoản GHN Minh Long (secret GHN_ML_API_TOKEN), lưu mã / phí / mã phân loại.
 *  - Huỷ: huỷ vận đơn trên GHN trước; GHN từ chối (đã lấy hàng…) thì KHÔNG huỷ đơn trong CRM.
 *  - Trạng thái GHN cập nhật qua đồng bộ (pos-ghn-sync.ts) và webhook GHN.
 * Website Minh Long không nhận lại trạng thái (chưa có cầu nối) – khi cấu hình `webOrderAction.minhlongUrl`, đơn Minh Long đi qua cầu nối như Lock.
 */
const GHN_CREATE = 'https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/create';
const GHN_CANCEL = 'https://online-gateway.ghn.vn/shiip/public-api/v2/switch-status/cancel';
const MINH_LONG = 'Showroom Gốm Sứ Minh Long';
const text = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
type WebOrder = typeof webStoreOrders.$inferSelect;
export interface WebGhnAddress { addressLine: string; provinceId: number; provinceName: string; districtId: number; districtName: string; wardCode: string; wardName: string }

/** Đơn web Minh Long khi website chưa có cầu nối: CRM tự xử lý với GHN. */
export const minhLongDirect = (env: StaffEnv, order: Pick<WebOrder, 'source'>) => order.source === 'minhlong' && !env.webOrderAction?.minhlongUrl;

/** Tiền thu hộ gợi ý: đơn đã thanh toán (Woo có ngày thanh toán) = 0, còn lại thu đủ tổng đơn. Nhân viên sửa được trước khi tạo. */
export function suggestedWebCod(order: Pick<WebOrder, 'total' | 'financialSnapshot'>) {
  return readWebOrderFinancials(order.financialSnapshot)?.payment?.paidAt ? 0 : Math.max(0, Math.round(order.total));
}

async function ghnPost(env: StaffEnv, url: string, body: unknown) {
  const account = await posGhnAccount(env, MINH_LONG);
  if (!account?.token) throw new AppError(503, 'CRM chưa có token GHN Minh Long (secret GHN_ML_API_TOKEN).', 'GHN_ML_NOT_CONFIGURED');
  let response: Response;
  try {
    response = await (env.ghnFetch ?? fetch)(url, {
      method: 'POST', headers: { Token: account.token, ShopId: account.shopId, 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined,
    });
  } catch { throw new AppError(504, 'Không kết nối được GHN. Thử lại sau.', 'GHN_TIMEOUT'); }
  const raw = await response.text(); let result: Record<string, unknown> = {};
  try { result = raw ? JSON.parse(raw) : {}; } catch { /* GHN có thể trả text khi lỗi */ }
  return { response, result };
}

/** Tạo vận đơn GHN cho đơn web Minh Long đang chờ xử lý (một lần: khoá dòng; đã có mã thì trả lại mã cũ). */
export async function createWebOrderGhn(env: StaffEnv, orderId: string, address: WebGhnAddress, input: Record<string, unknown>) {
  return env.db.transaction(async tx => {
    const [order] = await tx.select().from(webStoreOrders).where(eq(webStoreOrders.id, orderId)).limit(1).for('update');
    if (!order) throw new AppError(404, 'Không tìm thấy đơn website.');
    if (order.ghnOrderCode) return { order, existing: true };
    const cod = Number(input.codAmount ?? suggestedWebCod(order));
    if (!Number.isFinite(cod) || cod < 0 || cod > Math.max(0, Math.round(order.total))) throw new AppError(400, 'Tiền thu hộ phải từ 0 đến tổng đơn.', 'cod_invalid');
    const ship = parseGhnShip({ ...input, ghnProvinceId: address.provinceId, ghnDistrictId: address.districtId, ghnWardCode: address.wardCode });
    if (!ship) throw new AppError(400, 'Vui lòng nhập đủ địa chỉ giao hàng GHN.', 'address_invalid');
    let lines: { sku?: string; name?: string; quantity?: number; total?: number }[] = [];
    try { lines = JSON.parse(order.lines || '[]'); } catch { /* dòng hàng hỏng: gửi nội dung rỗng */ }
    const body = ghnCreateBody({
      // Tiền tố WEB: không trùng số đơn POS trong cùng shop GHN Minh Long (GHN chặn client_order_code trùng).
      orderNo: 'WEB-' + order.orderNo, receiverName: order.customerName, receiverPhone: order.phone,
      address: [address.addressLine, address.wardName, address.districtName, address.provinceName].filter(Boolean).join(', '), codAmount: cod, ship,
      lines: lines.map(l => ({ sku: text(l.sku, 100), name: text(l.name, 200) || 'Sản phẩm', qty: Number(l.quantity) || 1, unitPrice: (Number(l.total) || 0) / Math.max(1, Number(l.quantity) || 1) })),
    });
    let response: Response | null = null, result: Record<string, unknown> = {};
    try { ({ response, result } = await ghnPost(env, GHN_CREATE, body)); }
    catch (e) { if (!(e instanceof AppError && e.code === 'GHN_TIMEOUT')) throw e; }
    const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
    let code = response?.ok ? text(data.order_code, 50).toUpperCase() : '', ghnStatus = 'ready_to_pick', fee = Math.max(0, Number(data.total_fee) || 0);
    if (!code) {
      // Mất phản hồi / GHN báo trùng mã đơn: vận đơn có thể đã tạo ở lần trước – gắn lại đúng vận đơn đó (ghn-client-code.ts).
      const account = await posGhnAccount(env, MINH_LONG);
      const existing = account?.token ? await findGhnByClientCode(env.ghnFetch ?? fetch, account, body.client_order_code) : null;
      if (!existing) {
        if (!response) throw new AppError(504, 'Không kết nối được GHN. Thử lại sau.', 'GHN_TIMEOUT');
        throw new AppError(502, 'GHN: ' + (text(result.code_message_value) || text(result.message) || `lỗi ${response.status}`), 'GHN_CREATE_FAILED');
      }
      code = existing.orderCode; ghnStatus = existing.status; fee = Math.max(0, existing.fee ?? 0);
    }
    const now = new Date().toISOString();
    const fields = { status: 'processing', ghnOrderCode: code, ghnStatus, ghnSortCode: text(data.sort_code, 100),
      ghnFee: fee, updatedAt: now,
      address: [address.addressLine, address.wardName, address.districtName, address.provinceName].filter(Boolean).join(', '), ghnAddressSnapshot: JSON.stringify(address) };
    await tx.update(webStoreOrders).set(fields).where(eq(webStoreOrders.id, order.id));
    return { order: { ...order, ...fields }, existing: false };
  });
}

/** Huỷ vận đơn GHN Minh Long; GHN từ chối thì ném lỗi để không huỷ đơn trong CRM khi shipper vẫn có thể đến lấy hàng. */
export async function cancelWebOrderGhn(env: StaffEnv, code: string) {
  const { response, result } = await ghnPost(env, GHN_CANCEL, { order_codes: [code] });
  const items = Array.isArray(result.data) ? result.data as Record<string, unknown>[] : [];
  const item = items.find(x => text(x.order_code, 50).toUpperCase() === code.toUpperCase());
  if (!response.ok || item?.result !== true) throw new AppError(409, 'GHN chưa huỷ được vận đơn ' + code + ': ' + (text(item?.message) || text(result.message) || `lỗi ${response.status}`) + '. Xử lý trên trang GHN rồi huỷ lại.', 'GHN_CANCEL_FAILED');
}
