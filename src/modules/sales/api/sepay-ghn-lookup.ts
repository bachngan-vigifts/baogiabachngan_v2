import { AppError } from '../../../core/errors.ts';
import { externalText } from '../../../core/http/external-request.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { posGhnAccount } from './pos-ghn-account.ts';

const GHN_DETAIL = 'https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/detail';
const amount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const flag = (value: unknown) => typeof value === 'boolean' ? value : null;
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function assertSepayGhnLookup(role: string) {
  if (role !== 'manager') throw new AppError(403, 'Chỉ Quản lý được tra vận đơn trực tiếp từ GHN.');
}

/** Manager opt-in; deliberately bypasses sync, stock, receipts and cashbook. No provider payload or credentials leave the server. */
export async function readSepayGhnWaybill(env: StaffEnv, shop: string, rawCode: string, signal?: AbortSignal) {
  const code = rawCode.trim().toUpperCase();
  if (!['lock', 'minh-long'].includes(shop) || !/^[A-Z0-9]{4,30}$/.test(code))
    throw new AppError(400, 'Chọn cửa hàng và nhập mã vận đơn GHN hợp lệ.');
  // The deploy config specifies Minh Long ShopId. Do not fall back to discovery or a second shop here.
  if (shop === 'minh-long' && (!env.ghnMlToken || !env.ghnMlShopId))
    throw new AppError(503, 'Chưa cấu hình đầy đủ kết nối GHN Minh Long.');
  const account = await posGhnAccount(env, shop === 'lock' ? 'lock' : 'minh long');
  if (!account?.token || !/^\d+$/.test(account.shopId)) throw new AppError(503, 'Chưa cấu hình đầy đủ kết nối GHN.');
  let response: Response, body: Record<string, unknown>;
  try {
    const result = await externalText(env.ghnFetch ?? fetch, GHN_DETAIL + '?' + new URLSearchParams({order_code:code}), {
      method:'GET', headers:{Token:account.token, ShopId:account.shopId, Accept:'application/json'},
      redirect:'error', signal,
    }, {timeoutMs:5000,maxBytes:512*1024});
    response = result.response;
    body = record(JSON.parse(result.text));
  } catch {
    throw new AppError(502, 'Không đọc được phản hồi GHN. Thử lại sau.');
  }
  if (response.status === 401 || response.status === 403 || body.code === 401 || body.code === 403)
    throw new AppError(502, 'GHN không cho kết nối cửa hàng này đọc vận đơn.');
  if (response.status === 400 || response.status === 404 || body.code === 400 || body.code === 404)
    throw new AppError(404, 'GHN không trả vận đơn cho cửa hàng đã chọn. Kiểm tra mã và cửa hàng.');
  if (!response.ok || body.code !== 200) throw new AppError(502, 'GHN chưa trả kết quả tra cứu hợp lệ.');
  const data = record(body.data);
  if (String(data.order_code ?? '').trim().toUpperCase() !== code ||
      (data.shop_id != null && String(data.shop_id) !== account.shopId))
    throw new AppError(502, 'GHN trả dữ liệu không khớp vận đơn hoặc cửa hàng.');
  const status = String(data.status ?? '');
  const clientCode = String(data.client_order_code ?? '').trim();
  return {code,shop,status:/^[a-z_]{1,48}$/.test(status)?status:null,
    clientOrderCode:/^[A-Za-z0-9._/-]{1,80}$/.test(clientCode)?clientCode:null,
    codAmount:amount(data.cod_amount), codCollected:flag(data.is_cod_collected), codTransferred:flag(data.is_cod_transferred),
    codTransferDate:date(data.cod_transfer_date)};
}
