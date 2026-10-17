import { AppError } from '../errors.ts';

export interface RouteContext<Env = unknown> {
  req: Request; url: URL; params: Record<string, string>; env: Env;
  /** Nơi `authorize` đặt kết quả (vd người dùng đã đăng nhập) cho handler dùng. */
  state: Record<string, unknown>;
  /** Siêu dữ liệu khai báo lúc đăng ký route (vd khu vực truy cập). */
  meta: unknown;
}
export type Handler<Env = unknown> = (ctx: RouteContext<Env>) => Response | Promise<Response>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Route<Env> = { method: Method; path: string; pattern: RegExp; keys: string[]; handler: Handler<Env>; meta: unknown };
/** Thông tin một thao tác ghi đã thành công (cho nhật ký thay đổi). */
export interface SuccessInfo { route: string; status: number; requestText: string; responseText: string }

/** Header an toàn dùng cho mọi phản hồi JSON (giống bản cũ). */
export const json = (body: unknown, status = 200, headers: HeadersInit = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff', ...headers } });

/**
 * Đọc thân JSON (phải là object). Giữ nguyên mã lỗi và thông báo của bản cũ (`readBody`):
 * 415 sai Content-Type · 400 thiếu/không hợp lệ · 413 quá lớn (chặn ngay khi đọc luồng, không tin Content-Length).
 */
export async function readJson<T extends Record<string, unknown> = Record<string, unknown>>(req: Request, maxBytes = 1_000_000): Promise<T> {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw new AppError(415, 'Yêu cầu phải dùng JSON.');
  const reader = req.body?.getReader();
  if (!reader) throw new AppError(400, 'Thiếu nội dung.');
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) { await reader.cancel(); throw new AppError(413, 'Nội dung quá lớn.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as T;
  } catch { throw new AppError(400, 'Nội dung không hợp lệ.'); }
}

export interface RouterOptions<Env> {
  /** Tiền tố đường dẫn, vd '/api/staff'. Yêu cầu ngoài tiền tố nhận 404. */
  prefix?: string;
  /** Chạy trước mọi thứ (kể cả khi không có route): kiểm Origin, phương thức... Ném AppError để từ chối. */
  beforeAll?: (req: Request, url: URL, env: Env) => void | Promise<void>;
  /** Chạy khi đã tìm thấy route, TRƯỚC handler. Ném AppError để từ chối (401/403). */
  authorize?: (ctx: RouteContext<Env>) => void | Promise<void>;
  /** Bắt buộc mọi route có `meta` (khu vực truy cập). Thiếu → lỗi ngay lúc đăng ký, không chạy được. */
  requireMeta?: boolean;
  /**
   * Sau khi một yêu cầu GHI (không phải GET) chạy thành công (2xx): vd ghi nhật ký thay đổi. Nhận bản sao thân yêu cầu / phản hồi
   * (đã cắt ngắn). Lỗi trong hàm này không làm hỏng phản hồi. Trả `false` từ `wants` để bỏ qua route (không đọc thân).
   */
  onSuccess?: { wants: (ctx: RouteContext<Env>) => boolean; run: (ctx: RouteContext<Env>, info: SuccessInfo) => Promise<void> };
  /** Chỉnh phản hồi handler trả về (vd gắn lại cookie phiên vừa gia hạn). Không chạy cho phản hồi lỗi (AppError). */
  afterRoute?: (ctx: RouteContext<Env>, res: Response) => Response;
}

/**
 * Router nhỏ: pattern dạng `/quotes/:id/confirm`. Mỗi module tự đăng ký route của mình, thay cho một hàm khổng lồ
 * toàn `if (path === ...)`. Mọi route đi qua cùng một chốt `authorize` đặt SẴN trước handler nên không route nào
 * "quên" kiểm tra quyền.
 */
export class Router<Env = unknown> {
  private routes: Route<Env>[] = [];
  constructor(private options: RouterOptions<Env> = {}) {}

  on(method: Method, pattern: string, handler: Handler<Env>, meta?: unknown): this {
    if (this.options.requireMeta && meta === undefined) throw new Error(`Route ${method} ${pattern} chưa khai báo khu vực truy cập (meta).`);
    const { pattern: re, keys } = this.compile(pattern);
    if (this.routes.some(r => r.method === method && r.pattern.source === re.source)) throw new Error(`Route ${method} ${pattern} bị đăng ký hai lần.`);
    this.routes.push({ method, path: pattern, pattern: re, keys, handler, meta });
    return this;
  }
  private compile(pattern: string) {
    const keys: string[] = [];
    const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z_]\w*)/g, (_, k: string) => { keys.push(k); return '([^/]+)'; });
    return { pattern: new RegExp(`^${source}/?$`), keys };
  }
  get = (p: string, h: Handler<Env>, meta?: unknown) => this.on('GET', p, h, meta);
  post = (p: string, h: Handler<Env>, meta?: unknown) => this.on('POST', p, h, meta);
  put = (p: string, h: Handler<Env>, meta?: unknown) => this.on('PUT', p, h, meta);
  patch = (p: string, h: Handler<Env>, meta?: unknown) => this.on('PATCH', p, h, meta);
  delete = (p: string, h: Handler<Env>, meta?: unknown) => this.on('DELETE', p, h, meta);

  /** Danh sách route đã đăng ký (dùng cho test: mọi route phải có khu vực). */
  list(): { method: string; pattern: string; meta: unknown }[] {
    return this.routes.map(r => ({ method: r.method, pattern: r.pattern.source, meta: r.meta }));
  }

  async handle(req: Request, env: Env = undefined as Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      await this.options.beforeAll?.(req, url, env);
      const prefix = this.options.prefix ?? '';
      if (prefix && url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return json({ error: 'Không tìm thấy.' }, 404);
      const path = url.pathname.slice(prefix.length) || '/';
      const allowed = new Set<string>();
      for (const r of this.routes) {
        const m = r.pattern.exec(path);
        if (!m) continue;
        if (r.method !== req.method) { allowed.add(r.method); continue; }
        const params: Record<string, string> = {};
        // URL hỏng (vd %E0) → 400 thay vì lỗi máy chủ 500.
        try { r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]!); }); }
        catch { throw new AppError(400, 'Đường dẫn không hợp lệ.'); }
        const ctx: RouteContext<Env> = { req, url, params, env, state: {}, meta: r.meta };
        await this.options.authorize?.(ctx);
        const hook = req.method !== 'GET' && this.options.onSuccess?.wants(ctx) ? this.options.onSuccess : null;
        const done = (res: Response) => this.options.afterRoute ? this.options.afterRoute(ctx, res) : res;
        if (!hook) return done(await r.handler(ctx));
        const copy = req.clone();
        const res = await r.handler(ctx);
        if (res.status >= 200 && res.status < 300) {
          try {
            const text = async (x: Request | Response) => { try { return (await x.text()).slice(0, 200_000); } catch { return ''; } };
            await hook.run(ctx, { route: `${r.method} ${r.path}`, status: res.status, requestText: await text(copy), responseText: await text(res.clone()) });
          } catch (e) { console.error('onSuccess hook failed', e instanceof Error ? e.message : e); }
        }
        return done(res);
      }
      if (allowed.size) return json({ error: 'Phương thức không được hỗ trợ.' }, 405, { allow: [...allowed].join(', ') });
      return json({ error: 'Không tìm thấy.' }, 404);
    } catch (e) {
      if (e instanceof AppError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status);
      console.error(e); // không lộ chi tiết lỗi nội bộ cho client
      return json({ error: 'Lỗi hệ thống. Vui lòng thử lại.' }, 500);
    }
  }
}
