import { and, asc, desc, eq, getTableColumns, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, positions } from '../../staff/schema.ts';
import { can } from '../../staff/domain/permissions.ts';
import { products, warehouses } from '../../catalog/schema.ts';
import { stockMoves, warehouseSellers } from '../schema.ts';
import { STOCK_KIND_LABEL, type StockMoveKind } from '../domain/kinds.ts';
import { hiddenWarehouseIds, sellerMatrix } from './warehouse-access.ts';

/**
 * LỊCH SỬ XUẤT NHẬP (#/stock-moves, mọi nhân viên – trừ kho riêng không được xem) và CẤU HÌNH KHO BÁN (trang Phân quyền).
 *  GET /stock-moves?warehouseId=&group=&from=&to=&q=   phát sinh sổ kho mới nhất trước (tối đa 1000 dòng); `group`:
 *      sale = bán hàng (duyệt đơn / HĐKT, bán quầy, giao COD) · in = nhập (NCC, chuyển đến, khách trả) · out = xuất · transfer · adjust
 *  GET /warehouse-sellers, PUT /warehouse-sellers       kho ↔ chức vụ được bán + cờ kho riêng (Manager / quyền "Quản lý phân quyền")
 */
type Ctx = RouteContext<StaffEnv>;
const me = (c: Ctx) => (c.state.session as SessionState).member;
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const GROUPS: Record<string, readonly StockMoveKind[] | null> = {
  sale: null, // theo loại chứng từ (bên dưới)
  in: ['receipt', 'transfer_in', 'customer_return'], out: ['issue', 'sale', 'transfer_out'], transfer: ['transfer_out', 'transfer_in'], adjust: ['adjust', 'opening'],
};
const SALE_REFS = ['sales_order', 'pos_order', 'pos_delivery'] as const;

/** Link mở chứng từ gốc từ một dòng sổ kho. */
const linkOf = (refType: string, refId: string) => {
  const id = encodeURIComponent(refId.split('#')[0]!);
  switch (refType) {
    case 'sales_order': case 'pos_order': return `#/orders/${id}`;
    case 'packing_slip': return `#/packing/${id}`;
    case 'stock_transfer': return `#/transfers/${id}`;
    default: return '';
  }
};

export function registerStockHistoryRoutes(router: Router<StaffEnv>) {
  router.get('/stock-moves', async c => {
    const db = c.env.db, p = c.url.searchParams, wh = p.get('warehouseId') || '', group = p.get('group') || '', q = (p.get('q') || '').trim().slice(0, 80);
    const from = p.get('from'), to = p.get('to');
    for (const date of [from, to]) if (date && (!isDate(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date))
      throw new AppError(400, 'Ngày lọc không hợp lệ.');
    const hidden = await hiddenWarehouseIds(db, me(c));
    const whs = (await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.kind, 'stock')).orderBy(asc(warehouses.sortOrder), asc(warehouses.name)))
      .filter(w => !hidden.has(w.id));
    const ids = wh ? whs.filter(w => w.id === wh).map(w => w.id) : whs.map(w => w.id);
    if (!ids.length) return json({ warehouses: whs, moves: [], kinds: STOCK_KIND_LABEL });
    const kinds = GROUPS[group];
    // Calculate against the complete visible SKU/warehouse ledger BEFORE filtering or limiting.
    // Otherwise a date/category/search filter would incorrectly reset the displayed stock to zero.
    const ledger = db.$with('stock_history_ledger').as(db.select({
      ...getTableColumns(stockMoves),
      balanceAfter: sql<number>`sum(${stockMoves.qty}) over (partition by ${stockMoves.sku}, ${stockMoves.warehouseId} order by ${stockMoves.createdAt}, ${stockMoves.id} rows between unbounded preceding and current row)`.mapWith(Number).as('balance_after'),
    }).from(stockMoves).where(inArray(stockMoves.warehouseId, ids)));
    const rows = await db.with(ledger).select({ m: {
      id: ledger.id, createdAt: ledger.createdAt, sku: ledger.sku, warehouseId: ledger.warehouseId, qty: ledger.qty, balanceAfter: ledger.balanceAfter,
      kind: ledger.kind, refType: ledger.refType, refId: ledger.refId, refNo: ledger.refNo, note: ledger.note,
    }, by: employees.name, name: products.name, unit: products.unit }).from(ledger)
      .leftJoin(employees, eq(employees.id, ledger.createdBy)).leftJoin(products, eq(products.sku, ledger.sku))
      .where(and(inArray(ledger.warehouseId, ids),
        group === 'sale' ? inArray(ledger.refType, [...SALE_REFS]) : kinds ? inArray(ledger.kind, [...kinds]) : undefined,
        isDate(from) ? gte(ledger.createdAt, new Date(from + 'T00:00:00.000+07:00').toISOString()) : undefined, isDate(to) ? lte(ledger.createdAt, new Date(to + 'T23:59:59.999+07:00').toISOString()) : undefined,
        q ? or(sql`${ledger.sku} ILIKE ${'%' + q.replace(/[\\%_]/g, '') + '%'}`, sql`${ledger.refNo} ILIKE ${'%' + q.replace(/[\\%_]/g, '') + '%'}`,
          sql`${products.name} ILIKE ${'%' + q.replace(/[\\%_]/g, '') + '%'}`, sql`${ledger.note} ILIKE ${'%' + q.replace(/[\\%_]/g, '') + '%'}`) : undefined))
      .orderBy(desc(ledger.createdAt), desc(ledger.id)).limit(1000);
    const wName = new Map(whs.map(w => [w.id, w.name]));
    return json({ warehouses: whs, kinds: STOCK_KIND_LABEL, moves: rows.map(({ m, by, name, unit }) => ({ id: m.id, at: m.createdAt, sku: m.sku, name: name ?? '', unit: unit ?? '',
      warehouseId: m.warehouseId, warehouse: wName.get(m.warehouseId) ?? '', qty: m.qty, balanceAfter: m.balanceAfter, kind: m.kind, kindLabel: STOCK_KIND_LABEL[m.kind as StockMoveKind] ?? m.kind,
      refType: m.refType, refNo: m.refNo, note: m.note, by: by ?? '', link: linkOf(m.refType, m.refId) })) });
  }, 'business');

  const canConfig = (c: Ctx) => { if (!can(me(c), 'perm.manage')) throw new AppError(403, 'Chỉ Manager hoặc người có quyền "Quản lý phân quyền" cấu hình kho bán.'); };
  router.get('/warehouse-sellers', async c => {
    canConfig(c);
    const db = c.env.db;
    const pos = await db.select({ id: positions.id, name: positions.name }).from(positions).orderBy(asc(positions.name));
    return json({ warehouses: await sellerMatrix(db), positions: pos.filter(x => !['manager', 'supplier', 'customer'].includes(x.id)) });
  }, 'business');

  /** Thay toàn bộ cấu hình của các kho gửi lên: `{ warehouses: [{ id, positions: [positionId…], stockPrivate }] }`. */
  router.put('/warehouse-sellers', async c => {
    canConfig(c);
    const db = c.env.db, body = await readJson(c.req, 50_000);
    const list = (Array.isArray(body.warehouses) ? body.warehouses as Record<string, unknown>[] : []).slice(0, 100);
    const [whs, pos] = await Promise.all([
      db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.kind, 'stock')),
      db.select({ id: positions.id }).from(positions),
    ]);
    const okWh = new Set(whs.map(w => w.id)), okPos = new Set(pos.map(x => x.id).filter(x => !['manager', 'supplier', 'customer'].includes(x)));
    await db.transaction(async tx => {
      for (const w of list) {
        const id = String(w.id ?? '');
        if (!okWh.has(id)) throw new AppError(400, 'Kho không hợp lệ.');
        const wanted = [...new Set((Array.isArray(w.positions) ? w.positions : []).map(String))];
        const bad = wanted.filter(x => !okPos.has(x));
        if (bad.length) throw new AppError(400, 'Chức vụ không hợp lệ: ' + bad.join(', '));
        await tx.delete(warehouseSellers).where(eq(warehouseSellers.warehouseId, id));
        if (wanted.length) await tx.insert(warehouseSellers).values(wanted.map(positionId => ({ warehouseId: id, positionId })));
        if (typeof w.stockPrivate === 'boolean') await tx.update(warehouses).set({ stockPrivate: w.stockPrivate }).where(eq(warehouses.id, id));
      }
    });
    return json({ warehouses: await sellerMatrix(db) });
  }, 'business');
}
