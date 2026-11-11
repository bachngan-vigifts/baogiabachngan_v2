import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { extractTaxCode } from '../domain/tax-code-lookup.ts';

/**
 * Tra MST để tạo nhanh khách hàng: nhận MST hoặc link trang tra cứu (masothue, thongtindoanhnghiep…), CHỈ lấy số MST từ link
 * rồi tra VietQR (dữ liệu tổng hợp từ Tổng cục Thuế) – không tải trang người dùng dán (các trang này chặn bot, và tránh SSRF).
 * Chỉ trả thông tin để ĐIỀN SẴN biểu mẫu; tạo khách vẫn qua POST /customers (kiểm trùng MST, bắt buộc người liên hệ, duyệt như cũ).
 */
type Ctx = RouteContext<StaffEnv>;
const VIETQR = 'https://api.vietqr.io/v2/business/';
const CACHE_MS = 6 * 3600_000, PER_MINUTE = 20;
const cache = new Map<string, { at: number; data: TaxLookupResult }>();
const usage = new Map<string, number[]>();
export interface TaxLookupResult { taxCode: string; name: string; internationalName: string; shortName: string; address: string; status: string; active: boolean; source: string; updatedAt: string | null }

const clean = (v: unknown, max = 500) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

export async function lookupTaxCode(taxCode: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<TaxLookupResult> {
  const hit = cache.get(taxCode);
  if (hit && now - hit.at < CACHE_MS) return hit.data;
  let r: Response;
  try { r = await fetcher(VIETQR + encodeURIComponent(taxCode), { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) }); }
  catch { throw new AppError(504, 'Dịch vụ tra cứu MST chưa phản hồi. Thử lại sau hoặc nhập tay.', 'TAX_LOOKUP_UNAVAILABLE'); }
  if (r.status === 429) throw new AppError(429, 'Dịch vụ tra cứu MST đang bận (giới hạn lượt tra). Thử lại sau vài giây.', 'TAX_LOOKUP_BUSY');
  if (!r.ok) throw new AppError(502, `Dịch vụ tra cứu MST lỗi ${r.status}. Thử lại sau hoặc nhập tay.`, 'TAX_LOOKUP_UNAVAILABLE');
  const text = await r.text();
  if (text.length > 100_000) throw new AppError(502, 'Dữ liệu tra cứu MST không hợp lệ.', 'TAX_LOOKUP_UNAVAILABLE');
  let body: { code?: string; desc?: string; data?: Record<string, unknown> | null; metadata?: { updatedAt?: string } };
  try { body = JSON.parse(text); } catch { throw new AppError(502, 'Dữ liệu tra cứu MST không hợp lệ.', 'TAX_LOOKUP_UNAVAILABLE'); }
  if (body.code !== '00' || !body.data) throw new AppError(404, `Không tìm thấy doanh nghiệp với MST ${taxCode}.${body.desc ? ' (' + clean(body.desc, 200) + ')' : ''}`, 'TAX_CODE_NOT_FOUND');
  const d = body.data, status = clean(d.status, 200);
  if (clean(d.id, 20) && clean(d.id, 20) !== taxCode) throw new AppError(502, 'Kết quả tra cứu không khớp MST đã nhập.', 'TAX_LOOKUP_UNAVAILABLE');
  const data: TaxLookupResult = { taxCode, name: clean(d.name), internationalName: clean(d.internationalName), shortName: clean(d.shortName, 200), address: clean(d.address, 1000),
    status, active: !status || /đang hoạt động/i.test(status) && !/ngừng|tạm ngừng|không hoạt động|bỏ địa chỉ/i.test(status), source: 'VietQR (dữ liệu Tổng cục Thuế)',
    updatedAt: typeof body.metadata?.updatedAt === 'string' && Number.isFinite(Date.parse(body.metadata.updatedAt)) ? body.metadata.updatedAt : null };
  if (!data.name) throw new AppError(404, `Không tìm thấy tên doanh nghiệp với MST ${taxCode}.`, 'TAX_CODE_NOT_FOUND');
  if (cache.size > 2000) cache.clear();
  cache.set(taxCode, { at: now, data });
  return data;
}

export function registerTaxLookupRoutes(router: Router<StaffEnv>) {
  router.post('/customer-tax-lookup', async (c: Ctx) => {
    const me = (c.state.session as SessionState).member;
    if (!['manager', 'employee'].includes(me.role)) throw new AppError(403, 'Chỉ nhân viên được tra cứu MST.');
    const body = await readJson(c.req, 4_000), parsed = extractTaxCode(typeof body.input === 'string' ? body.input : '');
    if ('error' in parsed) throw new AppError(400, parsed.error, 'TAX_CODE_INVALID');
    const now = Date.now(), recent = (usage.get(me.id) || []).filter(t => now - t < 60_000);
    if (recent.length >= PER_MINUTE) throw new AppError(429, 'Bạn tra cứu quá nhiều lần trong 1 phút. Thử lại sau.', 'TAX_LOOKUP_RATE');
    recent.push(now); usage.set(me.id, recent);
    return json(await lookupTaxCode(parsed.taxCode, c.env.externalFetch ?? fetch, now));
  }, 'business');
}
