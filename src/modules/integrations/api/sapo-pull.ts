import { and, eq, lt } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { sapoHealthMonitorState, sapoRuntimeSessions } from '../schema.ts';
import { cleanCookie, decryptCookie, encryptCookie } from '../domain/sapo-session.ts';
import { mapSapoProduct, sapoModifiedAt } from '../domain/sapo-mapping.ts';
import { sapoClient } from './sapo-client.ts';
import { syncCustomers, syncProducts, syncStaff } from './sapo-sync-routes.ts';

type Ctx = RouteContext<StaffEnv>;
const SESSION_ID = 'active', STATE_ID = 'pull', LOCK_ID = 'pull-lock';
/** Mỗi lần chạy đọc tối đa ngần này trang (250 bản ghi/trang) cho mỗi loại để nằm trong giới hạn thời gian của Edge Function; lần sau đọc tiếp. */
const MAX_PAGES = 12;
const LOCK_SECONDS = 300;

export interface Cursor { since?: string; page?: number }
export interface PullState {
  startedAt?: string; finishedAt?: string; ok?: boolean; error?: string; code?: string; trigger?: string;
  results?: Record<string, Record<string, number>>;
  cursors?: Record<string, Cursor>;
}

export async function readPullState(db: AnyDb): Promise<PullState> {
  const [row] = await db.select().from(sapoHealthMonitorState).where(eq(sapoHealthMonitorState.id, STATE_ID)).limit(1);
  try { return row ? JSON.parse(row.data) as PullState : {}; } catch { return {}; }
}
const writePullState = (db: AnyDb, state: PullState) => db.insert(sapoHealthMonitorState).values({ id: STATE_ID, data: JSON.stringify(state), updatedAt: new Date().toISOString() })
  .onConflictDoUpdate({ target: sapoHealthMonitorState.id, set: { data: JSON.stringify(state), updatedAt: new Date().toISOString() } });

export async function sessionInfo(db: AnyDb) {
  const [row] = await db.select({ updatedAt: sapoRuntimeSessions.updatedAt, updatedBy: sapoRuntimeSessions.updatedBy }).from(sapoRuntimeSessions).where(eq(sapoRuntimeSessions.id, SESSION_ID)).limit(1);
  return row ?? null;
}

async function readCookie(c: Ctx): Promise<string> {
  const [row] = await c.env.db.select().from(sapoRuntimeSessions).where(eq(sapoRuntimeSessions.id, SESSION_ID)).limit(1);
  if (!row) throw new AppError(409, 'Chưa kết nối Sapo. Manager cần đăng nhập Sapo trên trang Nhân viên.', 'SAPO_SESSION_MISSING');
  const cookie = await decryptCookie(c.env.sapoSyncToken ?? '', row.encryptedCookie);
  if (!cookie) throw new AppError(409, 'Không đọc được phiên Sapo đã lưu. Manager cần đăng nhập lại Sapo.', 'SAPO_SESSION_MISSING');
  return cookie;
}
const client = (c: Ctx, cookie: string) => sapoClient({ cookie, base: c.env.sapoAdminBase, fetch: c.env.sapoFetch });
const requireKey = (c: Ctx) => { if ((c.env.sapoSyncToken ?? '').length < 32) throw new AppError(503, 'Chưa cấu hình đồng bộ Sapo (thiếu SAPO_SYNC_TOKEN).'); };

const add = (into: Record<string, number>, r: Record<string, unknown>) => { for (const [k, v] of Object.entries(r)) if (typeof v === 'number') into[k] = (into[k] ?? 0) + v; return into; };

/** Đọc một loại dữ liệu theo con trỏ: chỉ lấy bản ghi sửa sau `since` (lọc ở Sapo nếu hỗ trợ, và lọc lại ở đây). */
async function readSince(api: ReturnType<typeof sapoClient>, path: string, key: string, cursor: Cursor, runStart: number) {
  const since = cursor.since ? Date.parse(cursor.since) : NaN, page = cursor.page ?? 1;
  let res;
  if (Number.isFinite(since)) {
    try { res = await api.list(`${path}?modified_on_min=${encodeURIComponent(cursor.since!)}`, key, page, MAX_PAGES); }
    catch (e) { if (!(e instanceof AppError && /^SAPO_HTTP_4/.test(e.code ?? ''))) throw e; } // Sapo không nhận bộ lọc: đọc cả danh sách
  }
  res ??= await api.list(path, key, page, MAX_PAGES);
  const items = Number.isFinite(since) ? res.items.filter(r => !(sapoModifiedAt(r) < since)) : res.items;
  // Đọc hết thì con trỏ mới = lúc bắt đầu chạy (lùi 10 phút cho chắc); chưa hết thì lần sau đọc tiếp từ trang kế.
  const next: Cursor = res.nextPage ? { ...cursor, page: res.nextPage } : { since: new Date(runStart - 600_000).toISOString(), page: 1 };
  return { items, next };
}

/**
 * Lấy nhân viên, khách hàng, sản phẩm mới/đổi từ Sapo bằng phiên của Manager rồi ghi như luồng nhận đẩy
 * (cùng quy tắc). Khoá 5 phút để nút bấm và lịch tự động không chạy chồng nhau.
 */
export async function runPull(c: Ctx, trigger: string) {
  requireKey(c);
  const db = c.env.db, nowIso = new Date().toISOString();
  const lock = await db.insert(sapoHealthMonitorState).values({ id: LOCK_ID, data: trigger, updatedAt: nowIso })
    .onConflictDoUpdate({ target: sapoHealthMonitorState.id, set: { data: trigger, updatedAt: nowIso }, setWhere: lt(sapoHealthMonitorState.updatedAt, new Date(Date.now() - LOCK_SECONDS * 1000).toISOString()) })
    .returning({ id: sapoHealthMonitorState.id });
  if (!lock.length) throw new AppError(409, 'Đang đồng bộ Sapo, vui lòng đợi vài phút.', 'SAPO_PULL_RUNNING');
  const runStart = Date.now(), previous = await readPullState(db);
  const state: PullState = { startedAt: nowIso, trigger, cursors: { ...previous.cursors }, results: {} };
  try {
    const api = client(c, await readCookie(c));
    // Nhân viên: danh sách nhỏ, đọc hết mỗi lần.
    const accounts = await api.list('/accounts.json', 'accounts', 1, 4);
    state.results!.staff = await syncStaff(db, { accounts: accounts.items });
    // Khách hàng: theo lô 500.
    const cus = await readSince(api, '/customers.json', 'customers', state.cursors!.customers ?? {}, runStart);
    const cr: Record<string, number> = {};
    for (let i = 0; i < cus.items.length; i += 500) add(cr, await syncCustomers(db, { customers: cus.items.slice(i, i + 500) }));
    state.results!.customers = cr; state.cursors!.customers = cus.next;
    // Sản phẩm: tên chi nhánh để ghép tồn kho; gửi theo lô ≤ 400 mã.
    const locations = new Map<string, string>();
    try { for (const l of (await api.list('/locations.json', 'locations', 1, 2)).items) locations.set(String(l.id), String(l.name ?? l.label ?? '')); } catch { /* không bắt buộc */ }
    const prod = await readSince(api, '/products.json', 'products', state.cursors!.products ?? {}, runStart);
    const pr: Record<string, number> = {}, unknown = { policies: new Set<string>(), warehouses: new Set<string>() };
    let batch: unknown[] = [], count = 0;
    const flush = async () => {
      if (!batch.length) return;
      const r = await syncProducts(db, { products: batch }, locations) as Record<string, unknown>;
      add(pr, r); for (const n of (r.unknownPolicies as string[] ?? [])) unknown.policies.add(n); for (const n of (r.unknownWarehouses as string[] ?? [])) unknown.warehouses.add(n);
      batch = []; count = 0;
    };
    for (const p of prod.items) {
      const n = mapSapoProduct(p, locations).variants.length; if (!n) continue;
      if (count + n > 400) await flush();
      batch.push(p); count += n;
    }
    await flush();
    state.results!.products = pr; state.cursors!.products = prod.next;
    Object.assign(state, { ok: true, unknownPolicies: [...unknown.policies], unknownWarehouses: [...unknown.warehouses] });
  } catch (e) {
    state.ok = false;
    state.error = e instanceof AppError ? e.message : 'Lỗi khi đồng bộ Sapo.';
    state.code = e instanceof AppError ? e.code : 'SAPO_PULL_ERROR';
    if (!(e instanceof AppError)) console.error('Sapo pull failed');
  } finally {
    state.finishedAt = new Date().toISOString();
    await writePullState(db, state);
    await db.update(sapoHealthMonitorState).set({ updatedAt: '1970-01-01T00:00:00.000Z' }).where(and(eq(sapoHealthMonitorState.id, LOCK_ID), eq(sapoHealthMonitorState.updatedAt, nowIso)));
  }
  return state;
}

export function registerSapoPullRoutes(router: Router<StaffEnv>) {
  /**
   * Manager kết nối Sapo bằng phiên đăng nhập (cookie). App thử đọc Sapo trước, chỉ lưu khi phiên dùng được;
   * cookie được mã hoá và không bao giờ trả lại cho trình duyệt.
   */
  router.post('/admin/sapo-session', async c => {
    requireKey(c);
    const cookie = cleanCookie((await readJson(c.req, 40_000)).cookie);
    if (!cookie) throw new AppError(400, 'Phiên Sapo không hợp lệ: cần chuỗi cookie có _admin_session_id.');
    await client(c, cookie).get('/accounts.json?limit=1');
    const now = new Date().toISOString(), by = (c.state.session as SessionState).member.id, enc = await encryptCookie(c.env.sapoSyncToken!, cookie);
    await c.env.db.insert(sapoRuntimeSessions).values({ id: SESSION_ID, encryptedCookie: enc, updatedAt: now, updatedBy: by })
      .onConflictDoUpdate({ target: sapoRuntimeSessions.id, set: { encryptedCookie: enc, updatedAt: now, updatedBy: by } });
    return json({ connected: true, updatedAt: now });
  }, 'admin');

  router.delete('/admin/sapo-session', async c => {
    await c.env.db.delete(sapoRuntimeSessions).where(eq(sapoRuntimeSessions.id, SESSION_ID));
    return json({ connected: false });
  }, 'admin');

  router.post('/admin/sapo-pull', async c => {
    const state = await runPull(c, 'manager:' + (c.state.session as SessionState).member.id);
    if (!state.ok) throw new AppError(/^SAPO_SESSION_/.test(state.code ?? '') ? 409 : 502, state.error!, state.code);
    return json(state);
  }, 'admin');

  // Lịch tự động (GitHub Actions mỗi 30 phút) gọi bằng mã bí mật; luôn trả 200 kèm ok=false để lịch không báo lỗi liên tục khi phiên hết hạn.
  router.post('/integrations/sapo/pull', async c => json(await runPull(c, 'schedule')), 'sapo-sync');
}

/** Gộp vào trang tình trạng. */
export async function pullStatus(db: AnyDb) {
  const [session, state] = await Promise.all([sessionInfo(db), readPullState(db)]);
  const { cursors: _c, ...pull } = state;
  return { session: session ? { connected: true, ...session, expired: state.code === 'SAPO_SESSION_EXPIRED' && (state.startedAt ?? '') > session.updatedAt } : { connected: false }, pull };
}
