import { AppError } from '../../../core/errors.ts';
import type { FileStore } from '../../../core/storage/file-store.ts';
import { hashPassword, verifyPassword } from '../../../core/auth/password.ts';
import { Router, json, readJson, type RouteContext } from '../../../core/http/router.ts';
import { checkMethodAndOrigin } from '../../../core/http/security.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import { CUSTOMER_FORBIDDEN_MESSAGE, FORBIDDEN_MESSAGE, SUPPLIER_FORBIDDEN_MESSAGE, canAccessArea, type Area } from '../domain/area-policy.ts';
import { isCustomer, isSupplier } from '../domain/roles.ts';
import { parseLoginId } from '../domain/login-id.ts';
import { RATE_LIMITS, SESSION_LIFETIME_SECONDS, shouldRenewSession, clearedSessionCookie, isToken, newToken, publicMember, readSessionToken, sessionCookie, sha256Hex, tooManyAttempts, type MemberRow } from '../domain/session.ts';
import * as repo from '../repo/auth-repo.ts';
import { registerMemberRoutes } from './member-routes.ts';
import { registerAvatarRoutes } from './avatar-routes.ts';

/** Môi trường mà các route của `staff` cần. Nơi lắp ráp ứng dụng (src/app) tạo ra từ bindings của Cloudflare. */
export interface StaffEnv {
  db: AnyDb;
  /** Giây Unix hiện tại; mặc định đồng hồ hệ thống (test truyền đồng hồ giả). */
  nowSec?: () => number;
  /** Số vòng PBKDF2 khi tạo hash mới (mặc định 600.000; test hạ xuống cho nhanh). */
  passwordIterations?: number;
  /** Mã bí mật cho luồng đồng bộ Sapo (secret SAPO_SYNC_TOKEN, ≥ 32 ký tự). Thiếu thì mọi yêu cầu đồng bộ bị từ chối. */
  sapoSyncToken?: string;
  /** Địa chỉ Sapo admin (mặc định cửa hàng Bách Ngân) và hàm fetch gọi Sapo (test truyền Sapo giả). */
  sapoAdminBase?: string;
  sapoFetch?: typeof fetch;
  /** Chạy việc nền sau khi đã trả lời (Edge: EdgeRuntime.waitUntil). Không có thì việc nền được chờ xong rồi mới trả lời (test). */
  waitUntil?: (p: Promise<unknown>) => void;
  /** Hàm fetch gửi Web Push (test truyền dịch vụ push giả). */
  pushFetch?: typeof fetch;
  /** Kho file (đính kèm tin nhắn): Supabase Storage ở Edge, bộ nhớ trong khi test. Thiếu thì không gửi được file. */
  files?: FileStore;
}
type Ctx = RouteContext<StaffEnv>;
export interface SessionState { member: MemberRow & { active: boolean }; tokenHash: string }

const now = (c: Ctx) => (c.env.nowSec ?? (() => Math.floor(Date.now() / 1000)))();
const session = (c: Ctx) => c.state.session as SessionState;

async function limit(c: Ctx, key: string, max: number) {
  if (await repo.countAttempt(c.env.db, key, now(c)) > max) throw tooManyAttempts();
}
/**
 * IP người gửi để giới hạn thử: `cf-connecting-ip` do Cloudflare (đứng trước Supabase Edge) ghi đè bằng IP thật – trình duyệt
 * không giả được. Thiếu thì lấy phần tử CUỐI của x-forwarded-for (do proxy gần nhất thêm; phần đầu trình duyệt tự ghi được).
 */
export function clientIp(h: Headers): string {
  const cf = h.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const xff = (h.get('x-forwarded-for') || '').split(',').map(x => x.trim()).filter(Boolean);
  return xff.at(-1) || 'unknown';
}

/**
 * Chốt quyền cho MỌI route (gắn vào Router qua `authorize`): route 'public' đi thẳng; còn lại phải có phiên hợp lệ
 * và khu vực của route phải nằm trong quyền của người dùng. NCC đi sai khu vực nhận đúng thông báo của bản cũ.
 */
export async function authorizeRoute(c: Ctx): Promise<void> {
  const area = c.meta as Area;
  if (area === 'public') return;
  if (area === 'sapo-sync') return checkSyncToken(c);
  const token = readSessionToken(c.req.headers.get('cookie'));
  const tokenHash = sha256Hex(token);
  const member = await repo.findSessionMember(c.env.db, tokenHash, now(c));
  if (!member) throw new AppError(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  if (shouldRenewSession(member.sessionExpires, now(c))) await repo.extendSession(c.env.db, tokenHash, now(c) + SESSION_LIFETIME_SECONDS);
  if (!canAccessArea(member, area)) throw new AppError(403, isSupplier(member) ? SUPPLIER_FORBIDDEN_MESSAGE : isCustomer(member) ? CUSTOMER_FORBIDDEN_MESSAGE : FORBIDDEN_MESSAGE[area]);
  c.state.session = { member, tokenHash } satisfies SessionState;
}

/**
 * Luồng đồng bộ Sapo gửi mã bí mật theo một trong ba cách như web cũ: `Authorization: Bearer <mã>`,
 * header `x-sapo-sync-token` (hoặc `x-sapo-inventory-token`), hay `?token=<mã>` (webhook Sapo không đặt được header).
 * So sánh trên mã băm để thời gian không phụ thuộc nội dung.
 */
function checkSyncToken(c: Ctx): void {
  const secret = c.env.sapoSyncToken ?? '';
  if (secret.length < 32) throw new AppError(503, 'Chưa cấu hình đồng bộ Sapo.');
  const h = c.req.headers, bearer = /^Bearer (.+)$/.exec(h.get('authorization') || '')?.[1] ?? '';
  const want = sha256Hex(secret);
  const ok = [bearer, h.get('x-sapo-sync-token') || '', h.get('x-sapo-inventory-token') || '', c.url.searchParams.get('token') || '']
    .map(t => { const got = sha256Hex(t); let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i); return d === 0; })
    .some(Boolean);
  if (!ok) throw new AppError(401, 'Không được phép đồng bộ.');
}

export function registerAuthRoutes(router: Router<StaffEnv>): void {
  // ---- Công khai ----
  router.post('/activation-info', async c => {
    const body = await readJson(c.req, 4096);
    await limit(c, 'ip:' + clientIp(c.req.headers), RATE_LIMITS.ip);
    const hash = await activationHash(body);
    const found = await repo.findActivation(c.env.db, hash, now(c));
    if (!found) throw expiredLink();
    return json({ email: found.email, expiresAt: found.expires! * 1000 });
  }, 'public');

  router.post('/activate', async c => {
    const body = await readJson(c.req, 4096);
    await limit(c, 'ip:' + clientIp(c.req.headers), RATE_LIMITS.ip);
    const hash = await activationHash(body);
    const found = await repo.findActivation(c.env.db, hash, now(c));
    if (!found) throw expiredLink();
    await limit(c, 'activation:' + hash, RATE_LIMITS.activation);
    const passwordHash = await hashPassword(body.password, c.env.passwordIterations);
    const ok = await repo.completeActivation(c.env.db, { memberId: found.memberId, email: found.email, tokenHash: hash, passwordHash, now: now(c) });
    if (!ok) throw new AppError(400, 'Liên kết đã được sử dụng.');
    return json({ ok: true });
  }, 'public');

  router.post('/login', async c => {
    const body = await readJson(c.req, 4096);
    // Email (mọi tài khoản) hoặc số điện thoại (tài khoản khách hàng). Giới hạn thử tính theo định danh đã chuẩn hoá.
    const id = parseLoginId(body.email ?? body.login);
    await limit(c, 'ip:' + clientIp(c.req.headers), RATE_LIMITS.ip);
    await limit(c, 'email:' + id.value, RATE_LIMITS.email);
    const row = id.kind === 'phone' ? await repo.findLoginRowByPhone(c.env.db, id.value) : await repo.findLoginRow(c.env.db, id.value);
    // Luôn tốn thời gian băm như nhau dù email có tồn tại hay không (verifyPassword dùng hash giả khi thiếu).
    const valid = await verifyPassword(body.password, row?.passwordHash, c.env.passwordIterations);
    if (!valid || !row?.active) throw new AppError(401, id.kind === 'email' ? 'Email hoặc mật khẩu không đúng, hoặc tài khoản chưa được kích hoạt.' : 'Số điện thoại / email hoặc mật khẩu không đúng, hoặc tài khoản chưa được kích hoạt.');
    // Đăng nhập đúng: xoá bộ đếm của tài khoản – chỉ các lần SAI liên tiếp mới dẫn tới khoá 15 phút.
    await repo.clearAttempts(c.env.db, 'email:' + id.value);
    const token = newToken();
    await repo.createSession(c.env.db, { tokenHash: sha256Hex(token), memberId: row.id, version: row.version, now: now(c), lifetime: SESSION_LIFETIME_SECONDS });
    return json({ user: publicMember(row) }, 200, { 'set-cookie': sessionCookie(token) });
  }, 'public');

  // ---- Tài khoản của chính mình (mọi vai trò, kể cả NCC) ----
  router.get('/me', c => json({ user: publicMember(session(c).member) }), 'self');

  router.post('/logout', async c => {
    await repo.deleteSession(c.env.db, session(c).tokenHash);
    return json({ ok: true }, 200, { 'set-cookie': clearedSessionCookie() });
  }, 'self');

  router.post('/password', async c => {
    const body = await readJson(c.req, 4096);
    const me = session(c).member;
    await limit(c, 'password:' + me.id, RATE_LIMITS.password);
    const current = await repo.getPasswordHash(c.env.db, me.id);
    if (!await verifyPassword(body.currentPassword, current, c.env.passwordIterations)) throw new AppError(400, 'Mật khẩu hiện tại không đúng.');
    const next = await hashPassword(body.password, c.env.passwordIterations);
    await repo.changePassword(c.env.db, me.id, next);
    return json({ ok: true }, 200, { 'set-cookie': clearedSessionCookie() });
  }, 'self');
}

const expiredLink = () => new AppError(400, 'Liên kết đã hết hạn, đã sử dụng hoặc đã được thay bằng liên kết mới. Vui lòng nhờ Manager cấp lại và mở đúng liên kết mới nhất.');
async function activationHash(body: Record<string, unknown>): Promise<string> {
  if (!isToken(body.token)) throw new AppError(400, 'Liên kết kích hoạt không hợp lệ hoặc đã hết hạn.');
  return sha256Hex(body.token);
}

/** Router của module staff: đã gắn chốt Origin/phương thức và chốt quyền; mọi route BẮT BUỘC khai báo khu vực. */
/**
 * Đường dẫn đồng bộ Sapo được gọi từ máy chủ khác (không có Origin) nên bỏ qua kiểm tra Origin chống CSRF:
 * chúng không dùng cookie mà xác thực bằng mã bí mật. Test kiến trúc bắt buộc mọi route dưới đây thuộc khu vực 'sapo-sync'.
 */
export const SYNC_PREFIX = '/api/staff/integrations/';
export const isSyncPath = (url: URL) => url.pathname.startsWith(SYNC_PREFIX);

export function createStaffRouter(): Router<StaffEnv> {
  const router = new Router<StaffEnv>({ prefix: '/api/staff', requireMeta: true, beforeAll: (req, url) => { if (!isSyncPath(url)) checkMethodAndOrigin(req, url); }, authorize: authorizeRoute });
  registerAuthRoutes(router);
  registerMemberRoutes(router);
  registerAvatarRoutes(router);
  return router;
}
