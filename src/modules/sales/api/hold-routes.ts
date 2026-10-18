import { readCatalogStock } from '../../catalog/api/stock-source.ts';
import { and, asc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { products, productStock, warehouses } from '../../catalog/schema.ts';
import { quotations, quoteLines } from '../../quotes/schema.ts';
import { quotationPredicate } from '../../quotes/api/department-access.ts';
import { notify } from '../../notifications/api/routes.ts';
import { salesContracts, salesOrderLines, salesOrders, stockHolds } from '../schema.ts';
import { HOLD_DAYS } from '../domain/statuses.ts';

/**
 * GIỮ HÀNG CHO BÁO GIÁ (treo tồn 5 ngày) – docs/BAN-HANG.md mục "Giữ hàng".
 *  GET  /stock-holds              mọi dòng đang giữ (còn hạn): mã, số lượng, báo giá, khách, hạn – để mọi chỗ kiểm tồn trừ ra "khả dụng"
 *  GET  /quotes/:id/hold          trạng thái giữ hàng của báo giá + quyền (giữ / bỏ giữ / gia hạn)
 *  POST /quotes/:id/hold          giữ hàng: báo giá đã duyệt; mỗi mã giữ tối đa phần đang khả dụng (thiếu thì báo rõ)
 *  POST /quotes/:id/hold/release  bỏ giữ (nhân viên xem được báo giá / Manager)
 *  POST /quotes/:id/hold/extend   gia hạn thêm 5 ngày (chỉ Manager)
 * Hết hạn: dòng chuyển "expired" và báo người giữ (chạy khi có người dùng hệ thống – /pulse – và khi đọc danh sách giữ).
 * Lập đơn / HĐKT từ báo giá: tự bỏ treo của báo giá – đơn / HĐKT giữ thay (`orderHolds`, không hết hạn):
 *  giữ phần chưa giao của mỗi dòng có mã, từ lúc lập (kể cả nháp) đến khi huỷ / giao xong,
 *  hoặc khi đơn đã đẩy Sapo VÀ tồn của mã đó cập nhật sau lúc đẩy (tồn Sapo đã trừ "Đang giao dịch" – không trừ hai lần).
 */
type Ctx = RouteContext<StaffEnv>;
type Db = StaffEnv['db'] | Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const fail = (status: number, message: string, code?: string): never => { throw new AppError(status, message, code); };
const nowIso = () => new Date().toISOString();
const live = (now: string) => and(eq(stockHolds.status, 'active'), gt(stockHolds.expiresAt, now));
const dmy = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Dòng giữ hàng đã quá hạn → "expired" và báo người giữ + người phụ trách báo giá (mỗi báo giá một thông báo, chỉ một lần). */
export async function expireHolds(env: StaffEnv): Promise<number> {
  const now = nowIso();
  const done = await env.db.update(stockHolds).set({ status: 'expired', closedAt: now, notifiedAt: now })
    .where(and(eq(stockHolds.status, 'active'), lte(stockHolds.expiresAt, now))).returning({ quoteId: stockHolds.quoteId, by: stockHolds.createdBy, sku: stockHolds.sku });
  if (!done.length) return 0;
  const quotes = await env.db.select({ id: quotations.id, no: quotations.quoteNo, customer: quotations.customer, owner: sql<string>`coalesce(${quotations.assigneeId}, ${quotations.creatorId})` }).from(quotations)
    .where(inArray(quotations.id, [...new Set(done.map(d => d.quoteId))]));
  for (const q of quotes) {
    const rows = done.filter(d => d.quoteId === q.id), to = new Set([...rows.map(r => r.by), q.owner]);
    for (const member of to) await notify(env, { eventType: 'stock_hold_expired', title: 'Hết hạn giữ hàng', targetMemberId: member,
      body: `${q.no} · ${q.customer}: đã bỏ treo ${rows.length} mã. Bấm "Giữ hàng" lại nếu khách vẫn cần.`, url: `/index.html#/quotes/${q.id}` }).catch(() => {});
  }
  return done.length;
}

/** Hàng đơn / HĐKT đang giữ (theo mã): phần chưa giao, đơn còn hiệu lực, tồn Sapo chưa trừ. `skus` để lọc (không truyền = mọi mã). */
export async function orderHolds(db: Db, skus?: string[]) {
  if (skus && !skus.length) return [];
  const sapoCounted = and(sql`${salesOrders.sapoOrderId} IS NOT NULL`, or(isNull(salesOrders.sapoPushedAt), sql`EXISTS (${db.select({ one: sql`1` }).from(productStock)
    .innerJoin(warehouses, eq(warehouses.id, productStock.warehouseId))
    .where(and(eq(productStock.sku, salesOrderLines.sku), eq(warehouses.kind, 'stock'), gt(productStock.updatedAt, salesOrders.sapoPushedAt)))})`));
  return db.select({
    sku: salesOrderLines.sku, qty: sql<number>`sum(${salesOrderLines.qty} - ${salesOrderLines.deliveredQty})`.mapWith(Number),
    orderId: salesOrders.id, orderNo: salesOrders.orderNo, quoteId: salesOrders.quoteId, customer: salesOrders.customerName,
    contractNo: sql<string | null>`max(${salesContracts.contractNo})`,
  }).from(salesOrderLines).innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .leftJoin(salesContracts, and(eq(salesContracts.orderId, salesOrders.id), ne(salesContracts.status, 'cancelled')))
    .where(and(eq(salesOrders.holdsStock, true), inArray(salesOrders.status, ['draft', 'confirmed', 'delivering']), ne(salesOrderLines.sku, ''),
      gt(salesOrderLines.qty, salesOrderLines.deliveredQty), skus ? inArray(salesOrderLines.sku, skus) : undefined, sql`NOT (${sapoCounted})`))
    .groupBy(salesOrderLines.sku, salesOrders.id).orderBy(asc(salesOrderLines.sku), asc(salesOrders.orderNo)).limit(5000);
}

/** Báo giá đã lập đơn / HĐKT còn hiệu lực: hàng do đơn giữ – không giữ thêm theo báo giá (tránh giữ trùng). */
const hasActiveOrder = async (db: Db, quoteId: string) =>
  (await db.select({ id: salesOrders.id }).from(salesOrders).where(and(eq(salesOrders.quoteId, quoteId), ne(salesOrders.status, 'cancelled'))).limit(1)).length > 0;

async function loadQuote(c: Ctx, id: string) {
  const [q] = await c.env.db.select({ id: quotations.id, no: quotations.quoteNo, customer: quotations.customer, approvalStatus: quotations.approvalStatus })
    .from(quotations).where(and(eq(quotations.id, id), quotationPredicate(viewer(c)))).limit(1);
  if (!q) fail(404, 'Không tìm thấy báo giá.');
  return q!;
}

async function holdView(c: Ctx, quoteId: string) {
  const now = nowIso(), m = viewer(c), q = await loadQuote(c, quoteId);
  const rows = await c.env.db.select({ sku: stockHolds.sku, qty: stockHolds.qty, expiresAt: stockHolds.expiresAt, name: products.name, by: employees.name })
    .from(stockHolds).innerJoin(products, eq(products.sku, stockHolds.sku)).leftJoin(employees, eq(employees.id, stockHolds.createdBy))
    .where(and(eq(stockHolds.quoteId, quoteId), live(now))).orderBy(asc(stockHolds.sku));
  const active = rows.length > 0, ordered = await hasActiveOrder(c.env.db, quoteId);
  return { quoteId, holds: rows, expiresAt: active ? rows[0]!.expiresAt : null, by: active ? rows[0]!.by ?? '' : '', days: HOLD_DAYS, ordered,
    canHold: !active && !ordered && q.approvalStatus === 'approved', canRelease: active, canExtend: active && m.role === 'manager' };
}

export function registerHoldRoutes(router: Router<StaffEnv>) {
  router.get('/stock-holds', async c => {
    await expireHolds(c.env).catch(() => 0);
    const rows = await c.env.db.select({ sku: stockHolds.sku, qty: stockHolds.qty, expiresAt: stockHolds.expiresAt, quoteId: stockHolds.quoteId, quoteNo: quotations.quoteNo, customer: quotations.customer })
      .from(stockHolds).innerJoin(quotations, eq(quotations.id, stockHolds.quoteId)).where(live(nowIso())).orderBy(asc(stockHolds.sku), asc(stockHolds.expiresAt)).limit(5000);
    const orders = (await orderHolds(c.env.db)).map(o => ({ ...o, expiresAt: null }));
    return json({ holds: [...rows, ...orders] });
  }, 'business');

  router.get('/quotes/:id/hold', async c => json(await holdView(c, c.params.id!)), 'business');

  router.post('/quotes/:id/hold', async c => {
    const m = viewer(c), q = await loadQuote(c, c.params.id!), db = c.env.db;
    if (q.approvalStatus !== 'approved') fail(409, 'Chỉ giữ hàng cho báo giá đã duyệt.', 'QUOTE_NOT_APPROVED');
    if (await hasActiveOrder(db, q.id)) fail(409, 'Báo giá đã lập đơn / HĐKT – hàng đã được đơn giữ.', 'QUOTE_HAS_ORDER');
    await expireHolds(c.env).catch(() => 0);
    const result = { held: [] as { sku: string; name: string; need: number; qty: number }[], short: [] as { sku: string; name: string; need: number; qty: number }[] };
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
      const now = nowIso();
      const [mine] = await tx.select({ expiresAt: stockHolds.expiresAt }).from(stockHolds).where(and(eq(stockHolds.quoteId, q.id), live(now))).limit(1);
      if (mine) fail(409, `Báo giá đang giữ hàng đến ${dmy(mine.expiresAt)}.`, 'HOLD_ACTIVE');
      // Số cần theo mã (gộp các dòng cùng mã); chỉ mã có trong danh mục.
      const lines = await tx.select({ sku: quoteLines.sku, qty: quoteLines.qty, name: products.name }).from(quoteLines)
        .innerJoin(products, eq(products.sku, quoteLines.sku)).where(eq(quoteLines.quoteId, q.id));
      const need = new Map<string, { name: string; qty: number }>();
      for (const l of lines) if (l.qty > 0) { const x = need.get(l.sku) ?? { name: l.name, qty: 0 }; x.qty += l.qty; need.set(l.sku, x); }
      if (!need.size) fail(400, 'Báo giá chưa có mã hàng trong danh mục để giữ.');
      const skus = [...need.keys()];
      const [stock, held, ordered] = await Promise.all([
        (async () => { const [rows, whs] = await Promise.all([readCatalogStock(tx, skus), tx.select({id:warehouses.id}).from(warehouses).where(and(eq(warehouses.kind,'stock'),eq(warehouses.active,true)))]); const ids=new Set(whs.map(w=>w.id)), totals=new Map<string,number>();for(const row of rows)if(ids.has(row.warehouseId))totals.set(row.sku,(totals.get(row.sku)??0)+row.quantity);return [...totals].map(([sku,qty])=>({sku,qty})); })(),
        tx.select({ sku: stockHolds.sku, qty: sql<number>`sum(${stockHolds.qty})`.mapWith(Number) }).from(stockHolds).where(and(inArray(stockHolds.sku, skus), live(now))).groupBy(stockHolds.sku),
        orderHolds(tx, skus),
      ]);
      // Đơn / HĐKT khác đang giữ cũng trừ khỏi khả dụng (đơn lập từ chính báo giá này là hàng của mình).
      const orderedQty = (sku: string) => ordered.filter(o => o.sku === sku && o.quoteId !== q.id).reduce((t, o) => t + o.qty, 0);
      const expiresAt = new Date(Date.now() + HOLD_DAYS * 864e5).toISOString(), rows = [];
      for (const [sku, n] of need) {
        const free = Math.max(0, (stock.find(s => s.sku === sku)?.qty ?? 0) - (held.find(h => h.sku === sku)?.qty ?? 0) - orderedQty(sku)), qty = Math.min(n.qty, free);
        if (qty > 0) { rows.push({ id: crypto.randomUUID(), quoteId: q.id, sku, qty, status: 'active' as const, expiresAt, createdBy: m.id, createdAt: now }); result.held.push({ sku, name: n.name, need: n.qty, qty }); }
        if (qty < n.qty) result.short.push({ sku, name: n.name, need: n.qty, qty });
      }
      if (!rows.length) fail(409, 'Không còn tồn khả dụng để giữ cho các mã của báo giá này.', 'NOTHING_TO_HOLD');
      await tx.insert(stockHolds).values(rows);
    });
    return json({ ...result, ...(await holdView(c, q.id)) }, 201);
  }, 'business');

  router.post('/quotes/:id/hold/release', async c => {
    await readJson(c.req, 1_000).catch(() => ({}));
    const m = viewer(c), q = await loadQuote(c, c.params.id!);
    await c.env.db.update(stockHolds).set({ status: 'released', closedAt: nowIso(), closedBy: m.id }).where(and(eq(stockHolds.quoteId, q.id), eq(stockHolds.status, 'active')));
    return json(await holdView(c, q.id));
  }, 'business');

  router.post('/quotes/:id/hold/extend', async c => {
    const m = viewer(c), q = await loadQuote(c, c.params.id!);
    if (m.role !== 'manager') fail(403, 'Chỉ Manager gia hạn giữ hàng.');
    const now = nowIso(), rows = await c.env.db.select({ id: stockHolds.id, expiresAt: stockHolds.expiresAt }).from(stockHolds).where(and(eq(stockHolds.quoteId, q.id), live(now)));
    if (!rows.length) fail(409, 'Báo giá không còn giữ hàng – bấm "Giữ hàng" lại.');
    const base = Math.max(Date.now(), ...rows.map(r => Date.parse(r.expiresAt)));
    await c.env.db.update(stockHolds).set({ expiresAt: new Date(base + HOLD_DAYS * 864e5).toISOString(), notifiedAt: null }).where(inArray(stockHolds.id, rows.map(r => r.id)));
    return json(await holdView(c, q.id));
  }, 'business');
}
