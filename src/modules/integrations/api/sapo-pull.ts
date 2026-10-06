import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { sapoHealthMonitorState, sapoInventoryDocLines, sapoInventoryDocs, sapoRuntimeSessions } from '../schema.ts';
import { SAPO_DOC_KINDS, SAPO_DOC_SOURCES, mapSapoDoc, type SapoDocKind } from '../domain/sapo-docs.ts';
import { recordMovements } from '../../catalog/api/product-history.ts';
import { cleanCookie, decryptCookie, encryptCookie } from '../domain/sapo-session.ts';
import { mapSapoProduct, sapoModifiedAt } from '../domain/sapo-mapping.ts';
import { sapoClient } from './sapo-client.ts';
import { syncCustomers, syncProducts, syncStaff } from './sapo-sync-routes.ts';

type Ctx = RouteContext<StaffEnv>;
const SESSION_ID = 'active', STATE_ID = 'pull', LOCK_ID = 'pull-lock', CHECK_ID = 'session-check';
/** Mỗi lần chạy đọc tối đa ngần này trang (250 bản ghi/trang) cho mỗi loại để nằm trong giới hạn thời gian của Edge Function; lần sau đọc tiếp. */
const MAX_PAGES = 12;
/** Quét tồn kho xoay vòng toàn bộ sản phẩm (bán/nhập hàng làm đổi tồn nhưng Sapo không đổi ngày sửa sản phẩm). */
const STOCK_SWEEP_PAGES = 6;
/** Chứng từ kho (đơn nhập, điều chuyển, kiểm hàng): mỗi loại tối đa ngần này trang mỗi lần chạy. */
const DOC_PAGES = 4;
const LOCK_SECONDS = 300;

export interface Cursor { since?: string; page?: number }
export interface PullState {
  startedAt?: string; finishedAt?: string; ok?: boolean; error?: string; code?: string; trigger?: string;
  results?: Record<string, Record<string, number>>;
  /** Phần không đọc được nhưng không làm hỏng lượt chạy (vd tài khoản Sapo thiếu quyền xem phiếu kiểm hàng). */
  warnings?: string[];
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

async function readCookie(c: Ctx): Promise<{ cookie: string; savedAt: string }> {
  const [row] = await c.env.db.select().from(sapoRuntimeSessions).where(eq(sapoRuntimeSessions.id, SESSION_ID)).limit(1);
  if (!row) throw new AppError(409, 'Chưa kết nối Sapo. Manager cần đăng nhập Sapo trên trang Nhân viên.', 'SAPO_SESSION_MISSING');
  const cookie = await decryptCookie(c.env.sapoSyncToken ?? '', row.encryptedCookie);
  if (!cookie) throw new AppError(409, 'Không đọc được phiên Sapo đã lưu. Manager cần đăng nhập lại Sapo.', 'SAPO_SESSION_MISSING');
  return { cookie, savedAt: row.updatedAt };
}
const client = (c: Ctx, cookie: string) => sapoClient({ cookie, base: c.env.sapoAdminBase, fetch: c.env.sapoFetch });
type Api = ReturnType<typeof sapoClient>;

/**
 * Sapo gia hạn/đổi phiên qua Set-Cookie: lưu lại cookie mới (mã hoá). Chỉ ghi khi Manager chưa kết nối lại
 * trong lúc đó (so `updated_at`), để không đè phiên mới hơn.
 */
async function saveRefreshed(c: Ctx, api: Api | undefined, savedAt: string) {
  if (!api?.refreshed()) return false;
  const enc = await encryptCookie(c.env.sapoSyncToken!, api.cookie());
  const done = await c.env.db.update(sapoRuntimeSessions).set({ encryptedCookie: enc })
    .where(and(eq(sapoRuntimeSessions.id, SESSION_ID), eq(sapoRuntimeSessions.updatedAt, savedAt))).returning({ id: sapoRuntimeSessions.id });
  return done.length > 0;
}

interface SessionCheck { checkedAt: string; ok: boolean; code?: string; error?: string; refreshed?: boolean }
async function readCheck(db: AnyDb): Promise<SessionCheck | null> {
  const [row] = await db.select().from(sapoHealthMonitorState).where(eq(sapoHealthMonitorState.id, CHECK_ID)).limit(1);
  try { return row ? JSON.parse(row.data) as SessionCheck : null; } catch { return null; }
}

/**
 * Giữ phiên Sapo "đang dùng": gọi nhẹ Sapo (1 nhân viên) để Sapo gia hạn phiên, và lưu cookie mới nếu Sapo cấp.
 * Lịch gọi mỗi 10 phút. Hết hạn thì ghi nhận để trang Nhân viên báo Manager kết nối lại.
 */
export async function keepAlive(c: Ctx): Promise<SessionCheck> {
  requireKey(c);
  const check: SessionCheck = { checkedAt: new Date().toISOString(), ok: false };
  let api: Api | undefined, savedAt = '';
  try {
    const s = await readCookie(c); savedAt = s.savedAt;
    api = client(c, s.cookie);
    await api.get('/accounts.json?limit=1');
    check.ok = true;
  } catch (e) {
    check.code = e instanceof AppError ? e.code : 'SAPO_CHECK_ERROR';
    check.error = e instanceof AppError ? e.message : 'Lỗi khi kiểm tra phiên Sapo.';
  }
  check.refreshed = await saveRefreshed(c, api, savedAt);
  const data = JSON.stringify(check);
  await c.env.db.insert(sapoHealthMonitorState).values({ id: CHECK_ID, data, updatedAt: check.checkedAt })
    .onConflictDoUpdate({ target: sapoHealthMonitorState.id, set: { data, updatedAt: check.checkedAt } });
  return check;
}
const requireKey = (c: Ctx) => { if ((c.env.sapoSyncToken ?? '').length < 32) throw new AppError(503, 'Chưa cấu hình đồng bộ Sapo (thiếu SAPO_SYNC_TOKEN).'); };

const add = (into: Record<string, number>, r: Record<string, unknown>) => { for (const [k, v] of Object.entries(r)) if (typeof v === 'number') into[k] = (into[k] ?? 0) + v; return into; };

/** Đọc một loại dữ liệu theo con trỏ: chỉ lấy bản ghi sửa sau `since` (lọc ở Sapo nếu hỗ trợ, và lọc lại ở đây). */
async function readSince(api: ReturnType<typeof sapoClient>, path: string, key: string, cursor: Cursor, runStart: number, maxPages = MAX_PAGES) {
  const since = cursor.since ? Date.parse(cursor.since) : NaN, page = cursor.page ?? 1;
  let res;
  if (Number.isFinite(since)) {
    try { res = await api.list(`${path}?modified_on_min=${encodeURIComponent(cursor.since!)}`, key, page, maxPages); }
    catch (e) { if (!(e instanceof AppError && /^SAPO_HTTP_4/.test(e.code ?? ''))) throw e; } // Sapo không nhận bộ lọc: đọc cả danh sách
  }
  res ??= await api.list(path, key, page, maxPages);
  const items = Number.isFinite(since) ? res.items.filter(r => !(sapoModifiedAt(r) < since)) : res.items;
  // Đọc hết thì con trỏ mới = lúc bắt đầu chạy (lùi 10 phút cho chắc); chưa hết thì lần sau đọc tiếp từ trang kế.
  const next: Cursor = res.nextPage ? { ...cursor, page: res.nextPage } : { since: new Date(runStart - 600_000).toISOString(), page: 1 };
  return { items, next };
}

const SAPO_MOVE_KIND = { purchase_order: 'purchase', stock_transfer: 'transfer', stock_adjustment: 'adjustment', order_return: 'customer_return', purchase_return: 'supplier_return' } as const;
/** Ghi chứng từ kho Sapo: thêm mới hoặc cập nhật theo (loại, id Sapo); dòng hàng được thay toàn bộ. */
export async function syncSapoDocs(db: AnyDb, kind: SapoDocKind, raws: Record<string, any>[], locations: Map<string, string>) {
  const docs = raws.map(r => mapSapoDoc(kind, r, locations)).filter(d => d !== null);
  const r = { received: raws.length, created: 0, updated: 0, skipped: raws.length - docs.length };
  if (!docs.length) return r;
  const now = new Date().toISOString();
  await db.transaction(async tx => {
    const existing = new Set((await tx.select({ id: sapoInventoryDocs.id }).from(sapoInventoryDocs).where(inArray(sapoInventoryDocs.id, docs.map(d => d.id)))).map(x => x.id));
    for (const { lines, ...d } of docs) {
      const row = { ...d, syncedAt: now };
      await tx.insert(sapoInventoryDocs).values(row).onConflictDoUpdate({ target: sapoInventoryDocs.id, set: row });
      await tx.delete(sapoInventoryDocLines).where(eq(sapoInventoryDocLines.docId, d.id));
      if (lines.length) await tx.insert(sapoInventoryDocLines).values(lines.map(l => ({ ...l, docId: d.id })));
      existing.has(d.id) ? r.updated++ : r.created++;
    }
  });
  // Lịch sử sản phẩm: mỗi dòng chứng từ = một biến động của mã hàng (khoá `sapo:<chứng từ>:<dòng>`, đồng bộ lại thì cập nhật).
  await recordMovements(db, docs.flatMap(d => d.lines.map(l => ({
    refKey: `sapo:${d.id}:${l.lineNo}`, sku: l.sku, kind: SAPO_MOVE_KIND[d.kind], name: l.name, unitPrice: l.price,
    // Cân bằng kho: số chênh lệch (có dấu) nếu Sapo trả; không có thì ghi số đếm thực tế kèm ghi chú.
    qty: d.kind === 'stock_adjustment' && l.diffQty !== null ? l.diffQty : l.qty,
    note: d.kind === 'stock_adjustment' && l.diffQty === null ? `Số lượng kiểm thực tế ${l.qty}` : '',
    partner: d.partnerName, location: d.kind === 'stock_transfer' ? `${d.locationName} → ${d.toLocationName}` : d.locationName,
    refCode: d.code, status: d.status, occurredAt: d.createdOn || now,
  }))));
  return r;
}

/** Ghi sản phẩm (giá, tồn) theo lô ≤ 400 mã như luồng nhận đẩy. */
async function syncProductPages(db: AnyDb, items: Record<string, any>[], locations: Map<string, string>, unknown: { policies: Set<string>; warehouses: Set<string> }) {
  const pr: Record<string, number> = {};
  let batch: unknown[] = [], count = 0;
  const flush = async () => {
    if (!batch.length) return;
    const r = await syncProducts(db, { products: batch }, locations) as Record<string, unknown>;
    add(pr, r); for (const n of (r.unknownPolicies as string[] ?? [])) unknown.policies.add(n); for (const n of (r.unknownWarehouses as string[] ?? [])) unknown.warehouses.add(n);
    batch = []; count = 0;
  };
  for (const p of items) {
    const n = mapSapoProduct(p, locations).variants.length; if (!n) continue;
    if (count + n > 400) await flush();
    batch.push(p); count += n;
  }
  await flush();
  return pr;
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
  let api: Api | undefined, savedAt = '';
  try {
    const s = await readCookie(c); savedAt = s.savedAt;
    api = client(c, s.cookie);
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
    const unknown = { policies: new Set<string>(), warehouses: new Set<string>() };
    const prod = await readSince(api, '/products.json', 'products', state.cursors!.products ?? {}, runStart);
    state.results!.products = await syncProductPages(db, prod.items, locations, unknown); state.cursors!.products = prod.next;
    // Tồn kho: quét xoay vòng mọi sản phẩm (không lọc ngày sửa), mỗi lần vài trang, hết vòng thì quay lại trang 1.
    const sweepFrom = state.cursors!.stock?.page ?? 1, sweep = await api.list('/products.json', 'products', sweepFrom, STOCK_SWEEP_PAGES);
    state.results!.stock = { ...await syncProductPages(db, sweep.items, locations, unknown), fromPage: sweepFrom, wrapped: sweep.nextPage ? 0 : 1 };
    state.cursors!.stock = { page: sweep.nextPage ?? 1 };
    // Chứng từ kho: đơn nhập hàng, đơn điều chuyển, phiếu kiểm hàng (mới/đổi). Loại nào Sapo không cho đọc thì ghi nhận, không làm hỏng lượt chạy.
    for (const kind of SAPO_DOC_KINDS) {
      const src = SAPO_DOC_SOURCES[kind];
      try {
        const docs = await readSince(api, src.path, src.key, state.cursors![kind] ?? {}, runStart, DOC_PAGES);
        state.results![kind] = await syncSapoDocs(db, kind, docs.items, locations); state.cursors![kind] = docs.next;
      } catch (e) {
        if (!(e instanceof AppError) || /^SAPO_SESSION_/.test(e.code ?? '')) throw e;
        state.results![kind] = { unavailable: 1 };
        (state.warnings ??= []).push(`${src.label}: ${e.message}`);
      }
    }
    Object.assign(state, { ok: true, unknownPolicies: [...unknown.policies], unknownWarehouses: [...unknown.warehouses] });
  } catch (e) {
    state.ok = false;
    state.error = e instanceof AppError ? e.message : 'Lỗi khi đồng bộ Sapo.';
    state.code = e instanceof AppError ? e.code : 'SAPO_PULL_ERROR';
    if (!(e instanceof AppError)) console.error('Sapo pull failed');
  } finally {
    state.finishedAt = new Date().toISOString();
    await saveRefreshed(c, api, savedAt);
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
  router.post('/integrations/sapo/keepalive', async c => json(await keepAlive(c)), 'sapo-sync');
}

/** Gộp vào trang tình trạng. */
export async function pullStatus(db: AnyDb) {
  const [session, state, check] = await Promise.all([sessionInfo(db), readPullState(db), readCheck(db)]);
  const { cursors: _c, ...pull } = state;
  if (!session) return { session: { connected: false }, pull, check };
  // Hết hạn = lần gọi Sapo gần nhất (đồng bộ hoặc giữ phiên) SAU lần kết nối báo phiên hết hạn.
  const latest = [{ at: state.startedAt ?? '', code: state.code }, { at: check?.checkedAt ?? '', code: check?.code }]
    .filter(x => x.at > session.updatedAt).sort((a, b) => b.at.localeCompare(a.at))[0];
  // Lần đồng bộ trước khi Manager kết nối lại là chuyện cũ: không hiện lỗi của nó nữa.
  const stale = !!pull.startedAt && pull.startedAt <= session.updatedAt;
  return { session: { connected: true, ...session, expired: latest?.code === 'SAPO_SESSION_EXPIRED', checkedAt: check?.checkedAt ?? null }, pull: { ...pull, stale }, check };
}
