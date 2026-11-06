import { AppError } from '../../../core/errors.ts';
import { hasSapoSessionCookie, mergeSetCookies } from '../domain/sapo-session.ts';

/** Cửa hàng Sapo của Bách Ngân (đổi bằng env SAPO_ADMIN_BASE nếu cần). */
export const DEFAULT_SAPO_BASE = 'https://bachngankiengiang.mysapogo.com/admin';
const PAGE = 250;

export interface SapoClientOptions { cookie: string; base?: string; fetch?: typeof fetch; timeoutMs?: number }

/**
 * Sapo không nhận phiên. `why` (mã HTTP / nơi chuyển hướng, không chứa cookie) hiện kèm thông báo và ghi log
 * để phân biệt "phiên hết hạn thật" với "Sapo đổi cách đăng nhập" khi chẩn đoán.
 */
const expired = (why = '') => {
  if (why) console.warn('sapo session rejected', why);
  return new AppError(503, `Phiên Sapo đã hết hạn hoặc Sapo không nhận phiên này${why ? ` (${why})` : ''}. Manager cần đăng nhập lại Sapo rồi kết nối lại.`, 'SAPO_SESSION_EXPIRED');
};
/** Đường dẫn chuyển hướng, bỏ phần query (có thể chứa mã). */
const pathOf = (location: string) => { try { return new URL(location, 'https://x').pathname; } catch { return '?'; } };

/**
 * Gọi Sapo admin bằng cookie phiên của Manager. Đồng bộ chỉ ĐỌC (`get` / `list`); `send` (POST / PUT) chỉ dùng cho
 * thao tác ghi (hiện không còn luồng nào trong CRM dùng: tạo đơn Sapo đi qua n8n → OpenClaw).
 * Phân loại lỗi như bản cũ: chuyển về trang đăng nhập / 401 → phiên hết hạn; 403 → thiếu quyền.
 */
export function sapoClient(o: SapoClientOptions) {
  let cookie = o.cookie;
  const base = (o.base || DEFAULT_SAPO_BASE).replace(/\/+$/, ''), origin = base.replace(/\/admin$/, ''), doFetch = o.fetch ?? fetch;
  /**
   * Sapo (từ 10/2026) đăng nhập bằng cookie `sapo-admin`; cookie phiên `_admin_session_id` (API .json cần) chỉ được cấp
   * qua Set-Cookie ở lần mở trang admin đầu tiên. Cookie Manager dán chưa có `_admin_session_id` → mở trang admin
   * (theo tối đa 3 lần chuyển hướng cùng tên miền, không vào trang đăng nhập) để lấy, rồi mới gọi API.
   */
  let bootstrapped = false;
  async function ensureSession(force = false) {
    if (!force && (bootstrapped || /(^|;\s*)_admin_session_id=/.test(cookie))) return;
    bootstrapped = true;
    let url = base;
    for (let hop = 0; hop < 4; hop++) {
      let res: Response;
      try {
        res = await doFetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
          headers: { cookie, accept: 'text/html,application/json', referer: base, 'accept-language': 'vi' } });
      } catch { return; }
      await res.text().catch(() => '');
      const fresh = res.headers.getSetCookie?.() ?? [];
      if (fresh.length) { const next = mergeSetCookies(cookie, fresh); if (hasSapoSessionCookie(next)) cookie = next; }
      const location = res.headers.get('location') || '';
      if (/(^|;\s*)_admin_session_id=/.test(cookie) || res.status < 300 || res.status >= 400 || !location || /\/login/i.test(location)) return;
      const nextUrl = new URL(location, url);
      if (nextUrl.origin !== origin) return;
      url = nextUrl.href;
    }
  }
  async function request(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, extra: Record<string, string> = {}, retried = false): Promise<Record<string, any>> {
    await ensureSession();
    let res: Response;
    try {
      res = await doFetch(base + path, {
        method, redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs ?? (method === 'GET' ? 20_000 : 45_000)),
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          cookie, accept: 'application/json', 'x-requested-with': 'XMLHttpRequest',
          'x-sapo-client': 'sapo-frontend-v3', 'x-sapo-serviceid': 'sapo-frontend-v3', origin, referer: base, 'accept-language': 'vi',
          ...(body === undefined ? {} : { 'content-type': 'application/json; charset=UTF-8' }), ...extra,
        },
      });
    } catch { throw new AppError(504, 'Sapo chưa phản hồi. Vui lòng thử lại sau.', 'SAPO_UNREACHABLE'); }
    const text = await res.text();
    // Sapo gia hạn/đổi phiên qua Set-Cookie: giữ lại để lưu (chỉ khi phiên vẫn hợp lệ, kiểm tra bên dưới).
    const fresh = res.headers.getSetCookie?.() ?? [];
    const nextCookie = fresh.length ? mergeSetCookies(cookie, fresh) : cookie;
    const location = res.headers.get('location') || '';
    // Sapo cấp / đổi cookie phiên ngay trong câu trả lời từ chối → dùng cookie mới thử lại một lần.
    if (method === 'GET' && !retried && (res.status === 401 || (res.status >= 300 && res.status < 400)) && nextCookie !== cookie && /(^|;\s*)_admin_session_id=/.test(nextCookie)) {
      cookie = nextCookie;
      return request(method, path, body, extra, true);
    }
    // Cookie API có thể hết hạn trước cookie đăng nhập. Chỉ khôi phục/thử lại GET;
    // không gửi lại POST/PUT tạo chứng từ vì phản hồi mơ hồ có thể gây trùng.
    if (method === 'GET' && !retried && (res.status === 401 || (res.status >= 300 && res.status < 400))
      && /(^|;\s*)sapo-admin=[^;]+/.test(nextCookie)) {
      const previousCookie = cookie;
      cookie = nextCookie.split(';').map(part => part.trim())
        .filter(part => !/^(?:_admin_session_id|\.AspNetCore\.Session)=/.test(part)).join('; ');
      try {
        await ensureSession(true);
        if (/(^|;\s*)_admin_session_id=/.test(cookie)) return await request(method, path, body, extra, true);
      } catch (e) { cookie = previousCookie; throw e; }
      cookie = previousCookie; // không lưu đè phiên khi khôi phục thất bại
    }
    if (res.status === 401) throw expired(`${method} ${path.split('?')[0]} → 401`);
    if ((res.status >= 300 && res.status < 400) || /\/login/i.test(location)) throw expired(`${method} ${path.split('?')[0]} → ${res.status} ${pathOf(location)}`);
    if (res.status === 403) throw new AppError(403, method === 'GET' ? 'Tài khoản Sapo đang kết nối chưa đủ quyền xem dữ liệu này.'
      : 'Tài khoản Sapo đang kết nối chưa đủ quyền tạo đơn / khách / sản phẩm. Manager cần kết nối bằng tài khoản đủ quyền.', 'SAPO_PERMISSION_DENIED');
    if (!res.ok) throw new AppError(502, `Sapo báo lỗi (${res.status}).`, 'SAPO_HTTP_' + res.status);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw /<html|đăng nhập|login/i.test(text.slice(0, 2000)) ? expired(`${method} ${path.split('?')[0]} → trang HTML`) : new AppError(502, 'Sapo trả dữ liệu không hợp lệ.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AppError(502, 'Sapo trả dữ liệu không hợp lệ.');
    if (hasSapoSessionCookie(nextCookie)) cookie = nextCookie;
    return parsed as Record<string, any>;
  }
  const get = (path: string) => request('GET', path);
  /** Ghi vào Sapo (POST / PUT). Mỗi lần gửi kèm mã yêu cầu riêng như web cũ. */
  const send = (method: 'POST' | 'PUT', path: string, body: unknown, headers: Record<string, string> = {}) =>
    request(method, path, body, { 'x-sapo-requestid': crypto.randomUUID(), ...headers });
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
  /** Cookie hiện tại (đã gộp Set-Cookie của Sapo) và có khác bản ban đầu không. */
  return { get, send, list, base, cookie: () => cookie, refreshed: () => cookie !== o.cookie };
}
