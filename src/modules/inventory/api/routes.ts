import type {PurchaseProjectionViewer} from '../../../core/contracts/purchase-projection.ts';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { can } from '../../staff/domain/permissions.ts';
import { MAX_STOCKTAKE_LINES } from '../../../core/contracts/stocktake.ts';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { foldSql, matchAllWords } from '../../../core/text/fold.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { products, productStock, warehouses } from '../../catalog/schema.ts';
import { stockBalances, stockMoves } from '../schema.ts';
import { STOCK_KIND_LABEL } from '../domain/kinds.ts';
import { postMoves, guardInventoryOpening, type LedgerDb } from './ledger.ts';
import { hiddenWarehouseIds } from './warehouse-access.ts';
import { hiddenStockWarehouses, readCatalogStock } from '../../catalog/api/stock-source.ts';
import { registerAdjustmentRoutes } from './adjustment-routes.ts';

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

// Warehouse staff work only with the Vigifts ledger; other stock pickers retain their own scope.
const restrictedLedger = (c: Ctx) => me(c).role === 'employee' && me(c).positionId === 'warehouse';
async function ledgerWarehouses(c: Ctx) {
  const hidden = await hiddenWarehouseIds(c.env.db, me(c));
  const all = (await stockWarehouses(c.env.db)).filter(w => !hidden.has(w.id));
  return restrictedLedger(c) ? all.filter(w => w.name.toLowerCase().includes('vigifts')) : all;
}
/** Kho đã chốt tồn đầu kỳ (có dòng 'opening') trong danh sách – mỗi kho xét riêng. */
async function openedWarehouses(db: LedgerDb, ids: readonly string[]) {
  if (!ids.length) return new Set<string>();
  return new Set((await db.selectDistinct({ id: stockMoves.warehouseId }).from(stockMoves)
    .where(and(eq(stockMoves.refType, 'opening'), inArray(stockMoves.warehouseId, [...ids])))).map(w => w.id));
}
async function checkLedgerWarehouse(c: Ctx, id: string) {
  if (!(await ledgerWarehouses(c)).some(w => w.id === id)) fail(403, 'Kho không thuộc phạm vi sổ kho của bạn.');
}

/** Một dòng đơn mua NCC còn chờ về (không có giá). */
export interface IncomingLine { sku: string; orderId: string; ticketNumber: string; supplierName: string; internalNo: string; arrivalDate: string | null; left: number }
/**
 * Hàng đang về cho trang Tra tồn: module đơn mua NCC (suppliers) gắn hàm đọc khi đăng ký route – sổ kho không phụ thuộc ngược lại.
 * Chưa gắn (test riêng sổ kho) thì Tra tồn không có dòng "Hàng đang về".
 */
export const incomingLookup: {canPurchase?:(m:PurchaseProjectionViewer)=>boolean; read?: (db: StaffEnv['db'], skus: readonly string[],viewer?:PurchaseProjectionViewer) => Promise<IncomingLine[]> } = {};

export function registerInventoryRoutes(router: Router<StaffEnv>, deps: {
  heldQuantitiesOf?: (db: StaffEnv['db'], skus: string[], warehouseIds: string[]) => Promise<{ sku: string; warehouseId: string | null; qty: number }[]>;
} = {}) {
  registerAdjustmentRoutes(router,ledgerWarehouses);
  router.get('/stock-warehouses', async c => {
    const hidden = await hiddenWarehouseIds(c.env.db, me(c));
    return json({ warehouses: (await stockWarehouses(c.env.db)).filter(w => !hidden.has(w.id)) });
  }, 'business');

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
    const hidden = await hiddenStockWarehouses(db, me(c));
    whs = whs.filter(w => !hidden.has(w.id));
    // Tồn theo cùng nguồn với danh mục: kho đã chốt đầu kỳ = sổ kho, kho chưa chốt = tồn Sapo. Kho riêng (Hoá đơn) ẩn với người không bán kho đó.
    const [opened, rows, incoming, held] = await Promise.all([
      openedWarehouses(db, whs.map(w => w.id)),
      readCatalogStock(db, skus),
      skus.length && incomingLookup.read ? incomingLookup.read(db, skus,me(c)).catch(() => [] as IncomingLine[]) : [] as IncomingLine[],
      deps.heldQuantitiesOf ? deps.heldQuantitiesOf(db, skus, whs.map(w => w.id)) : [],
    ]);
    const at = (sku: string, wh: string) => num(rows.find(r => r.sku === sku && r.warehouseId === wh)?.quantity ?? 0);
    // Nguồn theo TỪNG kho: kho đã chốt = sổ kho, kho chưa chốt = Sapo; `source` chung = 'mixed' khi các kho khác nguồn.
    const sourceOf = (id: string) => opened.has(id) ? 'ledger' as const : 'sapo' as const, sources = new Set(whs.map(w => sourceOf(w.id)));
    return json({ source: sources.size > 1 ? 'mixed' : [...sources][0] ?? 'sapo', warehouses: whs.map(w => ({ ...w, source: sourceOf(w.id) })), products: found.map(p => {
      const stock = whs.map(w => ({ warehouseId: w.id, warehouse: w.name, qty: at(p.sku, w.id), source: sourceOf(w.id) }));
      // Hàng đang về: đơn mua NCC đã duyệt còn chờ (không cộng vào tổng tồn); đơn hẹn sớm lên trước.
      const orders = incoming.filter(l => l.sku === p.sku).sort((a, b) => (a.arrivalDate || '9') < (b.arrivalDate || '9') ? -1 : 1)
        .map(l => ({ orderId: l.orderId, ticketNumber: l.ticketNumber, supplierName: l.supplierName, internalNo: l.internalNo, arrivalDate: l.arrivalDate, qty: num(l.left) }));
      const reservations = held.filter(h => h.sku === p.sku);
      return { ...p, stock, total: num(stock.reduce((t, x) => t + x.qty, 0)),
        held: deps.heldQuantitiesOf ? { qty: num(reservations.reduce((sum, h) => sum + h.qty, 0)),
          unassigned: num(reservations.filter(h => h.warehouseId === null).reduce((sum, h) => sum + h.qty, 0)),
          stock: whs.map(w => ({ warehouseId: w.id, qty: num(reservations.filter(h => h.warehouseId === w.id).reduce((sum, h) => sum + h.qty, 0)) })) } : undefined,
        incoming: { qty: num(orders.reduce((t, o) => t + o.qty, 0)), orders } };
    }) });
  }, 'business');

  // Trạng thái THEO KHO: ?warehouseId= → ngày chốt / người chốt / số dòng của đúng kho đó. Không chọn kho → mỗi kho trong
  // `warehouses[]` mang trạng thái riêng; openedAt chung chỉ có khi MỌI kho trong phạm vi đã chốt (không lấy kho này báo cho kho khác).
  router.get('/inventory/status', async c => {
    guard(c);
    const db = c.env.db, all = await ledgerWarehouses(c), wh = c.url.searchParams.get('warehouseId') || '';
    if (wh) await checkLedgerWarehouse(c, wh);
    const ids = all.map(w => w.id), scope = ids.length ? inArray(stockMoves.warehouseId, ids) : sql`false`;
    const [opens, counts] = await Promise.all([
      db.selectDistinctOn([stockMoves.warehouseId], { id: stockMoves.warehouseId, at: stockMoves.createdAt, by: employees.name }).from(stockMoves).leftJoin(employees, eq(employees.id, stockMoves.createdBy))
        .where(and(eq(stockMoves.refType, 'opening'), scope)).orderBy(stockMoves.warehouseId, desc(stockMoves.createdAt)),
      db.select({ id: stockMoves.warehouseId, n: sql<number>`count(*)`.mapWith(Number) }).from(stockMoves).where(scope).groupBy(stockMoves.warehouseId),
    ]);
    const whs = all.map(w => { const o = opens.find(x => x.id === w.id); return { ...w, openedAt: o?.at ?? null, openedBy: o?.by ?? '', moveCount: counts.find(x => x.id === w.id)?.n ?? 0 }; });
    const one = wh ? whs.find(w => w.id === wh) : null, latest = whs.reduce<typeof whs[number] | null>((a, w) => w.openedAt && (!a || w.openedAt > a.openedAt!) ? w : a, null);
    const allOpened = whs.length > 0 && whs.every(w => w.openedAt);
    return json({ warehouseId: one?.id ?? null, openedAt: one ? one.openedAt : allOpened ? latest?.openedAt ?? null : null, openedBy: one ? one.openedBy : allOpened ? latest?.openedBy ?? '' : '',
      moveCount: one ? one.moveCount : whs.reduce((t, w) => t + w.moveCount, 0), openedCount: whs.filter(w => w.openedAt).length,
      canManage: canManage(me(c)), canApproveAdjustment:isManager(me(c)), stocktakeLimit:MAX_STOCKTAKE_LINES, warehouses: whs, warehouseRestricted: restrictedLedger(c), defaultWarehouseId: restrictedLedger(c) ? whs[0]?.id ?? null : null });
  }, 'business');

  router.get('/inventory/compare', async c => {
    guard(c);
    const db = c.env.db, p = c.url.searchParams, wh = p.get('warehouseId') || '', q = (p.get('q') || '').trim().slice(0, 80), onlyDiff = p.get('diff') !== '0';
    if (wh) await checkLedgerWarehouse(c, wh);
    const whs = await ledgerWarehouses(c), scoped = wh ? whs.filter(w => w.id === wh) : whs;
    // Kho chưa chốt tồn đầu kỳ: sổ kho chưa có số để so → không đưa vào bảng / số dòng lệch, báo riêng trong `unopened`.
    const opened = await openedWarehouses(db, scoped.map(w => w.id)), ids = scoped.filter(w => opened.has(w.id)).map(w => w.id);
    const unopened = scoped.filter(w => !opened.has(w.id)).map(w => ({ warehouseId: w.id, name: w.name }));
    if (!ids.length) return json({ rows: [], total: 0, diffCount: 0, unopened });
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
      ledger: num(r.ledger), sapo: num(r.sapo), diff: num(r.diff) })), diffCount: Number((d as { n?: number } | undefined)?.n ?? 0), unopened });
  }, 'business');

  router.get('/inventory/card', async c => {
    guard(c);
    const db = c.env.db, sku = (c.url.searchParams.get('sku') || '').trim(), wh = c.url.searchParams.get('warehouseId') || '';
    if (!sku || !wh) fail(400, 'Chọn mã hàng và kho.');
    await checkLedgerWarehouse(c, wh);
    return db.transaction(async tx => {
    const [moves, [bal], [sapo], [prod]] = await Promise.all([
      tx.select({ m: stockMoves, by: employees.name }).from(stockMoves).leftJoin(employees, eq(employees.id, stockMoves.createdBy))
        .where(and(eq(stockMoves.sku, sku), eq(stockMoves.warehouseId, wh))).orderBy(asc(stockMoves.createdAt), asc(stockMoves.id)),
      tx.select({ qty: stockBalances.qty }).from(stockBalances).where(and(eq(stockBalances.sku, sku), eq(stockBalances.warehouseId, wh))).limit(1),
      tx.select({ qty: productStock.quantity }).from(productStock).where(and(eq(productStock.sku, sku), eq(productStock.warehouseId, wh))).limit(1),
      tx.select({ name: products.name, unit: products.unit }).from(products).where(eq(products.sku, sku)).limit(1),
    ]);
    let run = 0;
    const lines = moves.map(({ m, by }) => { run = num(run + m.qty); return { at: m.createdAt, kind: m.kind, kindLabel: STOCK_KIND_LABEL[m.kind], qty: m.qty, balance: run, refType: m.refType, refId: m.refId, refNo: m.refNo, note: m.note, by: by ?? '' }; });
    return json({ sku, name: prod?.name ?? '', unit: prod?.unit ?? '', warehouseId: wh, balance: num(bal?.qty ?? 0), sapo: num(sapo?.qty ?? 0), lines: lines.reverse() });
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }, 'business');

  // Chốt tồn đầu kỳ THEO TỪNG KHO: mỗi kho một giao dịch riêng – kho lỗi (Sapo âm, không có tồn, đã có phát sinh) không chặn kho khác.
  // Chọn một kho: lỗi → 409 như cũ; kho đã chốt được "chốt lại" (chỉ khi chưa có phát sinh khác). "Tất cả kho": chỉ chốt kho CHƯA chốt
  // (kho đã chốt → skipped, muốn chốt lại phải chọn đúng kho), luôn 200 kèm `results` [{ warehouseId, name, status: opened|skipped|failed, lines, message, code }].
  router.post('/inventory/opening', async c => {
    const m = me(c);
    if (!isManager(m)) fail(403, 'Chỉ Manager được chốt tồn đầu kỳ.');
    const body = await readJson(c.req, 2_000);
    if (body.confirm !== true) fail(400, 'Xác nhận chốt tồn đầu kỳ.');
    if (body.warehouseId !== undefined && typeof body.warehouseId !== 'string') fail(400,'Chọn kho chốt tồn hợp lệ.');
    const selected = String(body.warehouseId || '').trim();
    if (selected) await checkLedgerWarehouse(c,selected);
    const db = c.env.db, openingWarehouses = (await ledgerWarehouses(c)).filter(w=>!selected||w.id===selected);
    if (!openingWarehouses.length) fail(409, 'Chưa có kho thật nào (đồng bộ danh sách kho từ Sapo trước).');
    const refId = crypto.randomUUID(), refNo = 'ĐK-' + new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const results: { warehouseId: string; name: string; status: 'opened' | 'skipped' | 'failed'; lines: number; message: string; code?: string }[] = [];
    for (const w of openingWarehouses) {
      try {
        const lines = await db.transaction(async tx => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_ledger_opening'))`);
          if (!selected && (await openedWarehouses(tx, [w.id])).size) return null;
          await guardInventoryOpening(tx, [w.id]);
          const [bal, sapo, [opened]] = await Promise.all([
            tx.select({ sku: stockBalances.sku, qty: stockBalances.qty }).from(stockBalances).where(eq(stockBalances.warehouseId, w.id)),
            tx.select({ sku: productStock.sku, qty: productStock.quantity }).from(productStock).where(eq(productStock.warehouseId, w.id)),
            tx.select({ id: stockMoves.id }).from(stockMoves).where(and(eq(stockMoves.warehouseId, w.id), eq(stockMoves.refType, 'opening'))).limit(1),
          ]);
          const negative = sapo.filter(s => s.qty < 0);
          if (negative.length) throw new AppError(409, `Kho "${w.name}" có ${negative.length} mã tồn Sapo âm, chưa chốt được: ` + negative.slice(0, 10).map(s => `${s.sku} (${s.qty})`).join('; ')
            + (negative.length > 10 ? ` và ${negative.length - 10} mã khác` : '') + '. Sửa tồn trên Sapo rồi đồng bộ lại.', 'OPENING_NEGATIVE_STOCK');
          const target = new Map<string, { sku: string; want: number; have: number }>();
          for (const b of bal) target.set(b.sku, { sku: b.sku, want: 0, have: b.qty });
          for (const s of sapo) { const t = target.get(s.sku); if (t) t.want = s.qty; else target.set(s.sku, { sku: s.sku, want: s.qty, have: 0 }); }
          const changes = [...target.values()].filter(t => Math.abs(t.want - t.have) > 0.0005);
          if (!opened && !changes.length) throw new AppError(409, `Kho "${w.name}" không có tồn Sapo để chốt. Kiểm tra lại danh mục tồn Sapo của kho này.`, 'WAREHOUSE_OPENING_EMPTY');
          return postMoves(tx, m.id, changes.map(t => ({ sku: t.sku, warehouseId: w.id, qty: t.want - t.have, kind: 'opening' as const, refType: 'opening' as const, refId, refNo, note: 'Chốt tồn đầu kỳ theo tồn Sapo' })));
        });
        if (lines === null) results.push({ warehouseId: w.id, name: w.name, status: 'skipped', lines: 0, message: 'Kho đã chốt tồn đầu kỳ trước đó. Muốn chốt lại, chọn đúng kho này.' });
        else results.push(lines ? { warehouseId: w.id, name: w.name, status: 'opened', lines, message: `Đã chốt ${lines} dòng tồn đầu kỳ.` }
          : { warehouseId: w.id, name: w.name, status: 'skipped', lines: 0, message: 'Sổ kho đã khớp tồn Sapo, không cần ghi thêm.' });
      } catch (e) {
        if (selected) throw e;
        if (!(e instanceof AppError)) console.error('inventory opening', w.id, e);
        results.push({ warehouseId: w.id, name: w.name, status: 'failed', lines: 0, message: e instanceof AppError ? e.message : `Lỗi khi chốt kho "${w.name}", thử lại sau.`, code: e instanceof AppError ? e.code : undefined });
      }
    }
    return json({ ok: results.every(r => r.status !== 'failed'), refNo, lines: results.reduce((t, r) => t + r.lines, 0), results });
  }, 'business');

}
