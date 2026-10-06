import { AppError } from '../../../core/errors.ts';

/** Cửa hàng Sapo của Bách Ngân (đổi bằng env SAPO_ADMIN_BASE nếu cần). */
export const DEFAULT_SAPO_BASE = 'https://bachngankiengiang.mysapogo.com/admin';
const PAGE = 250;

export interface SapoClientOptions { cookie: string; base?: string; fetch?: typeof fetch; timeoutMs?: number }

const expired = () => new AppError(503, 'Phiên Sapo đã hết hạn. Manager cần đăng nhập lại Sapo trên trang Nhân viên.', 'SAPO_SESSION_EXPIRED');

/**
 * Gọi Sapo admin bằng cookie phiên của Manager. CHỈ ĐỌC (GET): app không bao giờ ghi gì vào Sapo.
 * Phân loại lỗi như bản cũ: chuyển về trang đăng nhập / 401 → phiên hết hạn; 403 → thiếu quyền.
 */
export function sapoClient(o: SapoClientOptions) {
  const base = (o.base || DEFAULT_SAPO_BASE).replace(/\/+$/, ''), origin = base.replace(/\/admin$/, ''), doFetch = o.fetch ?? fetch;
  async function get(path: string): Promise<Record<string, any>> {
    let res: Response;
    try {
      res = await doFetch(base + path, {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
        headers: {
          cookie: o.cookie, accept: 'application/json', 'x-requested-with': 'XMLHttpRequest',
          'x-sapo-client': 'sapo-frontend-v3', 'x-sapo-serviceid': 'sapo-frontend-v3', origin, referer: base, 'accept-language': 'vi',
        },
      });
    } catch { throw new AppError(504, 'Sapo chưa phản hồi. Vui lòng thử lại sau.', 'SAPO_UNREACHABLE'); }
    const text = await res.text();
    const location = res.headers.get('location') || '';
    if (res.status === 401 || (res.status >= 300 && res.status < 400) || /\/login/i.test(location)) throw expired();
    if (res.status === 403) throw new AppError(403, 'Tài khoản Sapo đang kết nối chưa đủ quyền xem dữ liệu này.', 'SAPO_PERMISSION_DENIED');
    if (!res.ok) throw new AppError(502, `Sapo báo lỗi (${res.status}).`, 'SAPO_HTTP_' + res.status);
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw /<html|đăng nhập|login/i.test(text.slice(0, 2000)) ? expired() : new AppError(502, 'Sapo trả dữ liệu không hợp lệ.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(502, 'Sapo trả dữ liệu không hợp lệ.');
    return body as Record<string, any>;
  }
  /**
   * Đọc danh sách theo trang (limit=250&page=N như bản cũ), từ trang `fromPage`, tối đa `maxPages` trang.
   * Trả `nextPage` khi chưa hết (lần sau đọc tiếp), null khi đã hết.
   */
  async function list(path: string, key: string, fromPage = 1, maxPages = 20) {
    const items: Record<string, any>[] = [];
    for (let page = fromPage; page < fromPage + maxPages; page++) {
      const body = await get(`${path}${path.includes('?') ? '&' : '?'}limit=${PAGE}&page=${page}`);
      const batch = body[key];
      if (!Array.isArray(batch)) throw new AppError(502, 'Sapo trả dữ liệu không đúng định dạng.');
      items.push(...batch);
      const total = Number(body.metadata?.total ?? body.total);
      if (batch.length < PAGE || (Number.isFinite(total) && total > 0 && (page * PAGE) >= total)) return { items, nextPage: null as number | null };
    }
    return { items, nextPage: fromPage + maxPages };
  }
  return { get, list };
}
