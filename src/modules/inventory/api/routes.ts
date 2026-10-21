import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { can } from '../../staff/domain/permissions.ts';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { foldSql, matchAllWords } from '../../../core/text/fold.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { products, productStock, warehouses } from '../../catalog/schema.ts';
import { stockBalances, stockMoves } from '../schema.ts';
import { STOCK_KIND_LABEL } from '../domain/kinds.ts';
import { postMoves, inventoryOpeningHooks } from './ledger.ts';
import { hiddenStockWarehouses, readCatalogStock } from '../../catalog/api/stock-source.ts';

/**
 * SỔ KHO – giai đoạn 1, chạy song song với Sapo (docs/SO-KHO.md).
 *  GET  /stock-warehouses                kho thật đang dùng (chọn kho nhận / kho xuất) – mọi nhân viên
 *  GET  /inventory/lookup?q=            Tra tồn (trang kho): tìm mã / tên → tồn từng kho thật, KHÔNG có giá – mọi nhân viên
 *  GET  /inventory/status                đã chốt tồn đầu kỳ chưa, số dòng phát sinh – Manager / Kho
 *  GET  /inventory/compare               tồn sổ kho ↔ tồn Sapo theo (mã, kho); ?warehouseId=&q=&diff=1
 *  GET  /inventory/card?sku=&warehouseId= thẻ kho: các dòng phát sinh + tồn luỹ kế
 *  POST /inventory/opening               Manager chốt tồn đầu kỳ = tồn Sapo hiện tại (ghi chênh lệch, không xoá lịch sử)
 *  POST /inventory/adjustments           Manager lập phiếu điều chỉnh (kiểm kê lệch, hỏng, mẫu…) – bắt buộc lý do
 */
type Ctx = RouteContext<StaffEnv>;
const me = (c: Ctx) => (c.state.session as SessionState).member;
const fail = (status: number, message: string): never => { throw new AppError(status, message); };
const isManager = (m: { role: string }) => m.role === 'manager';
const canView = (m: { role: string; positionId?: string | null }) => can(m, 'inventory.view');
const canManage = (m: { role: string; positionId?: string | null }) => can(m, 'inventory.manage');
const guard = (c: Ctx) => { if (!canView(me(c))) fail(403, 'Chức vụ của bạn chưa được cấp quyền xem sổ kho.'); };
const num = (v: unknown) => Math.round(Number(v) * 1000) / 1000;

const stockWarehouses = (db: StaffEnv['db']) => db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses)
  .where(and(eq(warehouses.kind, 'stock'), eq(warehouses.active, true))).orderBy(asc(warehouses.sortOrder), asc(warehouses.name));

/** Một dòng đơn mua NCC còn chờ về (không có giá). */
export interface IncomingLine { sku: string; orderId: string; ticketNumber: string; supplierName: string; internalNo: string; arrivalDate: string | null; left: number }
/**
 * Hàng đang về cho trang Tra tồn: module đơn mua NCC (suppliers) gắn hàm đọc khi đăng ký route – sổ kho không phụ thuộc ngược lại.
 * Chưa gắn (test riêng sổ kho) thì Tra tồn không có dòng "Hàng đang về".
 */
export const incomingLookup: { read?: (db: StaffEnv['db'], skus: readonly string[]) => Promise<IncomingLine[]> } = {};

export function registerInventoryRoutes(router: Router<StaffEnv>) {
  router.get('/stock-warehouses', async c => json({ warehouses: await stockWarehouses(c.env.db) }), 'business');

  // Tra tồn: số lượng theo từng kho thật. Đã chốt tồn đầu kỳ → lấy tồn sổ kho, chưa chốt → tồn Sapo (đồng bộ gần nhất).
  // Kèm "Hàng đang về" từ đơn mua NCC đã duyệt (số còn chờ, từng đơn: số đơn, NCC, ngày hẹn) – không có giá.
  router.get('/inventory/lookup', async c => {
    const db = c.env.db, raw = (c.url.searchParams.get('q') || '').trim().slice(0, 80);
    if (raw.length < 2) return json({ products: [], warehouses: [], source: 'sapo' });
    let whs = await stockWarehouses(db);
    // Mã quét từ máy quét / camera: khớp đúng mã trước, không có thì tìm theo chữ.
    const cols = { sku: products.sku, name: products.name, unit: products.unit, imageUrl: products.imageUrl, brand: products.brand };
    let found = await db.select(cols).from(products).where(sql`lower(${products.sku}) = ${raw.toLowerCase()}`).limit(1);
    if (!found.length) found = await db.select(cols).from(products).where(and(eq(products.active, true), matchAllWords(foldSql(products.sku, products.name, products.brand), raw)))
      .orderBy(asc(products.sku)).limit(30);
    const skus = found.map(p => p.sku);
    // Tồn theo cùng nguồn với danh mục: kho đã chốt đầu kỳ = sổ kho, kho chưa chốt = tồn Sapo. Kho riêng (Hoá đơn) ẩn với người không bán kho đó.
    const [[open], rows, incoming, hidden] = await Promise.all([
      db.select({ id: stockMoves.id }).from(stockMoves).where(eq(stockMoves.refType, 'opening')).limit(1),
      readCatalogStock(db, skus),
      skus.length && incomingLookup.read ? incomingLookup.read(db, skus).catch(() => [] as IncomingLine[]) : [] as IncomingLine[],
      hiddenStockWarehouses(db, me(c)),
    ]);
    whs = whs.filter(w => !hidden.has(w.id));
    const at = (sku: string, wh: string) => num(rows.find(r => r.sku === sku && r.warehouseId === wh)?.quantity ?? 0);
    return json({ source: open ? 'ledger' : 'sapo', warehouses: whs, products: found.map(p => {
      const stock = whs.map(w => ({ warehouseId: w.id, warehouse: w.name, qty: at(p.sku, w.id) }));
      // Hàng đang về: đơn mua NCC đã duyệt còn chờ (không cộng vào tổng tồn); đơn hẹn sớm lên trước.
      const orders = incoming.filter(l => l.sku === p.sku).sort((a, b) => (a.arrivalDate || '9') < (b.arrivalDate || '9') ? -1 : 1)
        .map(l => ({ orderId: l.orderId, ticketNumber: l.ticketNumber, supplierName: l.supplierName, internalNo: l.internalNo, arrivalDate: l.arrivalDate, qty: num(l.left) }));
      return { ...p, stock, total: num(stock.reduce((t, x) => t + x.qty, 0)), incoming: { qty: num(orders.reduce((t, o) => t + o.qty, 0)), orders } };
    }) });
  }, 'business');

  router.get('/inventory/status', async c => {
    guard(c);
    const db = c.env.db;
    const [[open], [cnt]] = await Promise.all([
      db.select({ at: stockMoves.createdAt, by: employees.name }).from(stockMoves).leftJoin(employees, eq(employees.id, stockMoves.createdBy))
        .where(eq(stockMoves.refType, 'opening')).orderBy(desc(stockMoves.createdAt)).limit(1),
      db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(stockMoves),
    ]);
    return json({ openedAt: open?.at ?? null, openedBy: open?.by ?? '', moveCount: cnt?.n ?? 0, canManage: canManage(me(c)), warehouses: await stockWarehouses(db) });
  }, 'business');

  router.get('/inventory/compare', async c => {
    guard(c);
    const db = c.env.db, p = c.url.searchParams, wh = p.get('warehouseId') || '', q = (p.get('q') || '').trim().slice(0, 80), onlyDiff = p.get('diff') !== '0';
    const whs = await stockWarehouses(db), ids = wh ? whs.filter(w => w.id === wh).map(w => w.id) : whs.map(w => w.id);
    if (!ids.length) return json({ rows: [], total: 0, diffCount: 0 });
    // Ghép tồn sổ kho và tồn Sapo theo (mã, kho); thiếu bên nào coi như 0.
    const res = await db.execute(sql`
      with b as (select sku, warehouse_id, qty from ${stockBalances} where warehouse_id in ${ids}),
           s as (select sku, warehouse_id, quantity as qty from ${productStock} where warehouse_id in ${ids}),
           j as (select coalesce(b.sku, s.sku) as sku, coalesce(b.warehouse_id, s.warehouse_id) as warehouse_id, coalesce(b.qty, 0) as ledger, coalesce(s.qty, 0) as sapo
                 from b full outer join s on b.sku = s.sku and b.warehouse_id = s.warehouse_id)
      select j.sku, j.warehouse_id, j.ledger, j.sapo, j.ledger - j.sapo as diff, coalesce(p.name, '') as name, coalesce(p.unit, '') as unit
      from j left join ${products} p on p.sku = j.sku
      where (${!onlyDiff} or abs(j.ledger - j.sapo) > 0.0005)
        and (${q === ''} or j.sku ilike ${'%' + q + '%'} or p.name ilike ${'%' + q + '%'})
      order by abs(j.ledger - j.sapo) desc, j.sku limit 500`);
    const rows = (res as unknown as { rows?: Record<string, unknown>[] }).rows ?? (res as unknown as Record<string, unknown>[]);
    const [d] = await db.execute(sql`select count(*)::int as n from (select coalesce(b.sku, s.sku) from ${stockBalances} b full outer join ${productStock} s on b.sku = s.sku and b.warehouse_id = s.warehouse_id
      where coalesce(b.warehouse_id, s.warehouse_id) in ${ids} and abs(coalesce(b.qty, 0) - coalesce(s.quantity, 0)) > 0.0005) x`).then(r => (r as unknown as { rows?: unknown[] }).rows ?? (r as unknown as unknown[]));
    const names = new Map(whs.map(w => [w.id, w.name]));
    return json({ rows: rows.map(r => ({ sku: String(r.sku), name: String(r.name), unit: String(r.unit), warehouseId: String(r.warehouse_id), warehouse: names.get(String(r.warehouse_id)) ?? '',
      ledger: num(r.ledger), sapo: num(r.sapo), diff: num(r.diff) })), diffCount: Number((d as { n?: number } | undefined)?.n ?? 0) });
  }, 'business');

  router.get('/inventory/card', async c => {
    guard(c);
    const db = c.env.db, sku = (c.url.searchParams.get('sku') || '').trim(), wh = c.url.searchParams.get('warehouseId') || '';
    if (!sku || !wh) fail(400, 'Chọn mã hàng và kho.');
    const [moves, [bal], [sapo], [prod]] = await Promise.all([
      db.select({ m: stockMoves, by: employees.name }).from(stockMoves).leftJoin(employees, eq(employees.id, stockMoves.createdBy))
        .where(and(eq(stockMoves.sku, sku), eq(stockMoves.warehouseId, wh))).orderBy(asc(stockMoves.createdAt), asc(stockMoves.id)).limit(1000),
      db.select({ qty: stockBalances.qty }).from(stockBalances).where(and(eq(stockBalances.sku, sku), eq(stockBalances.warehouseId, wh))).limit(1),
      db.select({ qty: productStock.quantity }).from(productStock).where(and(eq(productStock.sku, sku), eq(productStock.warehouseId, wh))).limit(1),
      db.select({ name: products.name, unit: products.unit }).from(products).where(eq(products.sku, sku)).limit(1),
    ]);
    let run = 0;
    const lines = moves.map(({ m, by }) => { run = num(run + m.qty); return { at: m.createdAt, kind: m.kind, kindLabel: STOCK_KIND_LABEL[m.kind], qty: m.qty, balance: run, refType: m.refType, refId: m.refId, refNo: m.refNo, note: m.note, by: by ?? '' }; });
    return json({ sku, name: prod?.name ?? '', unit: prod?.unit ?? '', warehouseId: wh, balance: num(bal?.qty ?? 0), sapo: num(sapo?.qty ?? 0), lines: lines.reverse() });
  }, 'business');

  router.post('/inventory/opening', async c => {
    const m = me(c);
    if (!canManage(m)) fail(403, 'Chức vụ của bạn chưa được cấp quyền chốt tồn đầu kỳ.');
    const body = await readJson(c.req, 2_000);
    if (body.confirm !== true) fail(400, 'Xác nhận chốt tồn đầu kỳ.');
    const db = c.env.db, ids = (await stockWarehouses(db)).map(w => w.id);
    if (!ids.length) fail(409, 'Chưa có kho thật nào (đồng bộ danh sách kho từ Sapo trước).');
    const refId = crypto.randomUUID(), refNo = 'ĐK-' + new Date().toISOString().slice(0, 10).replaceAll('-', '');
    let written = 0;
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_ledger_opening'))`);
      await inventoryOpeningHooks.guard?.(tx, ids);
      const [bal, sapo] = await Promise.all([
        tx.select().from(stockBalances).where(inArray(stockBalances.warehouseId, ids)),
        tx.select({ sku: productStock.sku, warehouseId: productStock.warehouseId, qty: productStock.quantity }).from(productStock).where(inArray(productStock.warehouseId, ids)),
      ]);
      const target = new Map<string, { sku: string; warehouseId: string; want: number; have: number }>();
      for (const b of bal) target.set(b.sku + '\u0000' + b.warehouseId, { sku: b.sku, warehouseId: b.warehouseId, want: 0, have: b.qty });
      for (const s of sapo) { const k = s.sku + '\u0000' + s.warehouseId, t = target.get(k); if (t) t.want = s.qty; else target.set(k, { sku: s.sku, warehouseId: s.warehouseId, want: s.qty, have: 0 }); }
      written = await postMoves(tx, m.id, [...target.values()].map(t => ({ sku: t.sku, warehouseId: t.warehouseId, qty: t.want - t.have, kind: 'opening' as const, refType: 'opening' as const, refId, refNo, note: 'Chốt tồn đầu kỳ theo tồn Sapo' })));
    });
    return json({ ok: true, refNo, lines: written });
  }, 'business');

  router.post('/inventory/adjustments', async c => {
    const m = me(c);
    if (!canManage(m)) fail(403, 'Chức vụ của bạn chưa được cấp quyền lập phiếu điều chỉnh kho.');
    const db = c.env.db, body = await readJson(c.req, 100_000), reason = String(body.reason ?? '').trim().slice(0, 500), wh = String(body.warehouseId ?? '');
    if (reason.length < 3) fail(400, 'Nhập lý do điều chỉnh.');
    if (!(await stockWarehouses(db)).some(w => w.id === wh)) fail(400, 'Chọn kho điều chỉnh.');
    const lines = (Array.isArray(body.lines) ? body.lines as Record<string, unknown>[] : []).slice(0, 300)
      .map(l => ({ sku: String(l.sku ?? '').trim(), qty: num(l.qty) })).filter(l => l.sku && Number.isFinite(l.qty) && l.qty !== 0);
    if (!lines.length) fail(400, 'Nhập ít nhất một mã với số lượng tăng (+) hoặc giảm (−).');
    const known = new Set((await db.select({ sku: products.sku }).from(products).where(inArray(products.sku, [...new Set(lines.map(l => l.sku))]))).map(p => p.sku));
    const unknown = lines.filter(l => !known.has(l.sku)).map(l => l.sku);
    if (unknown.length) fail(400, 'Mã không có trong danh mục: ' + [...new Set(unknown)].slice(0, 10).join(', '));
    const refId = crypto.randomUUID(), refNo = 'ĐC-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + refId.slice(0, 4).toUpperCase();
    const written = await db.transaction(tx => postMoves(tx, m.id, lines.map(l => ({ ...l, warehouseId: wh, kind: 'adjust' as const, refType: 'adjustment' as const, refId, refNo, note: reason }))));
    return json({ ok: true, refNo, lines: written }, 201);
  }, 'business');
}
