import type {StockPendingOf} from '../../../core/contracts/stock-pending.ts';
import { and, asc, desc, eq, gte, inArray, lte, or, sql,type SQL,type SQLWrapper } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, positions } from '../../staff/schema.ts';
import { can } from '../../staff/domain/permissions.ts';
import { products, warehouses } from '../../catalog/schema.ts';
import { stockMoves, warehouseSellers } from '../schema.ts';
import { STOCK_KIND_LABEL, stockMoveDescription, type StockMoveKind, type StockRefType } from '../domain/kinds.ts';
import { hiddenWarehouseIds, sellerMatrix } from './warehouse-access.ts';

/**
 * SỔ KHO (#/stock-moves – kiểu "Sổ kho" của Sapo; mọi nhân viên, trừ kho riêng không được xem) và CẤU HÌNH KHO BÁN (trang Phân quyền).
 *  GET /stock-moves?warehouseId=&group=&from=&to=&q=&brand=&status=&sku=&page=&size=  (sku = đúng một mã – lịch sử sản phẩm)
 *      mỗi dòng = một phát sinh sổ kho, mới nhất trước: Nhập / Xuất, tồn kho (của mã ở kho đó) trước / sau giao dịch, chứng từ + link.
 *      `group`: sale = bán hàng (duyệt đơn / HĐKT, bán quầy, giao COD) · in = nhập (NCC, chuyển đến, khách trả) · out = xuất · transfer · adjust · reverse
 *      `status`: active = sản phẩm đang giao dịch · inactive = ngừng giao dịch. `size` 20 / 50 / 100 / 200 (xuất Excel: tối đa 5000).
 *      Kèm `total` (số giao dịch khớp bộ lọc) và `totals` { inQty, outQty } của cả bộ lọc (không chỉ trang đang xem).
 *  GET /warehouse-sellers, PUT /warehouse-sellers       kho ↔ chức vụ được bán + cờ kho riêng (Manager / quyền "Quản lý phân quyền")
 * Tồn sau giao dịch = cộng dồn sổ kho theo (mã, kho) theo thời gian (cùng thứ tự với thẻ kho /inventory/card).
 */
type Ctx = RouteContext<StaffEnv>;
const me = (c: Ctx) => (c.state.session as SessionState).member;
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const GROUPS: Record<string, readonly StockMoveKind[] | null> = {
  sale: null, // theo loại chứng từ (bên dưới)
  in: ['receipt', 'transfer_in', 'customer_return'], out: ['issue', 'sale', 'transfer_out'], transfer: ['transfer_out', 'transfer_in'], adjust: ['adjust', 'opening'], reverse: ['reverse'],
};
const SALE_REFS = ['sales_order', 'pos_order', 'pos_delivery'] as const;
const SIZES = [20, 50, 100, 200] as const, EXPORT_MAX = 5000;

/**
 * Chứng từ của module khác (phiếu giao POS, phiếu trả, phiếu nhận NCC) → link mở chứng từ gốc.
 * Gắn ở src/app/router.ts (inventory không import sales / suppliers). Mỗi hàm nhận các refId, trả refId → "#/…".
 */
export type StockRefLinkResolver = (db: StaffEnv['db'], refIds: readonly string[],viewer?:SessionState['member']) => Promise<Map<string, string>>;
export const stockPurchaseReadHooks:{scope?:(m:SessionState['member'],refType:SQLWrapper,refId:SQLWrapper)=>SQL}={};
export const stockRefLinkHooks: Partial<Record<StockRefType, StockRefLinkResolver>> = {};

/** Link mở chứng từ gốc có sẵn từ refId (không cần tra thêm). */
const directLink = (refType: string, refId: string) => {
  const id = encodeURIComponent(refId);
  switch (refType) {
    case 'sales_order': case 'pos_order': return `#/orders/${id}`;
    case 'packing_slip': return `#/packing/${id}`;
    case 'stock_transfer': return `#/transfers/${id}`;
    default: return '';
  }
};
/** Quyền trang đích của link (khớp `linkAllowed` ở trial-ui/app.js) – người xem không mở được trang thì không trả link. */
const LINK_PERMS: Record<string, readonly string[]> = {
  orders: ['page.orders', 'page.contracts', 'page.receivables'], contracts: ['page.orders', 'page.contracts', 'page.receivables'], purchases: ['page.purchases'],
};
const linkVisible = (m: SessionState['member'], link: string) => { const need = LINK_PERMS[link.replace(/^#\//, '').split(/[/?]/)[0]!]; return !need || need.some(k => can(m, k)); };
/** refId của dòng đảo / sửa đơn có hậu tố "#xxxx" (mỗi lần đồng bộ một mã riêng) – chứng từ gốc là phần trước "#". */
const baseRef = (refId: string) => refId.split('#')[0]!;

export function registerStockHistoryRoutes(router: Router<StaffEnv>, deps:{pendingOf?:StockPendingOf}={}) {
  router.get('/stock-moves', async c => {
    const db = c.env.db, p = c.url.searchParams, wh = p.get('warehouseId') || '', group = p.get('group') || '', q = (p.get('q') || '').trim().slice(0, 80).replace(/[\\%_]/g, ''), sku = (p.get('sku') || '').trim().slice(0, 200);
    const from = p.get('from'), to = p.get('to'), brand = (p.get('brand') || '').trim().slice(0, 120), status = p.get('status') || '';
    for (const date of [from, to]) if (date && (!isDate(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date))
      throw new AppError(400, 'Ngày lọc không hợp lệ.');
    const exporting = p.get('export') === '1', sizeAsked = Number(p.get('size')) || 20;
    const size = exporting ? EXPORT_MAX : (SIZES as readonly number[]).includes(sizeAsked) ? sizeAsked : 20, page = exporting ? 1 : Math.max(1, Math.floor(Number(p.get('page')) || 1));
    const hidden = await hiddenWarehouseIds(db, me(c));
    const whs = (await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.kind, 'stock')).orderBy(asc(warehouses.sortOrder), asc(warehouses.name)))
      .filter(w => !hidden.has(w.id));
    const ids = wh ? whs.filter(w => w.id === wh).map(w => w.id) : whs.map(w => w.id);
    // Nhãn hiệu có phát sinh ở các kho được xem (không theo kho đang lọc – ô chọn giữ nguyên khi đổi chi nhánh).
    const brands = whs.length ? (await db.selectDistinct({ brand: products.brand }).from(stockMoves).innerJoin(products, eq(products.sku, stockMoves.sku))
      .where(inArray(stockMoves.warehouseId, whs.map(w => w.id))).orderBy(asc(products.brand))).map(b => b.brand).filter(Boolean) : [];
    const pendingAsOf=new Date().toISOString();
    const empty = { pendingAsOf,pendingAvailable:!!deps.pendingOf,warehouses: whs, brands, kinds: STOCK_KIND_LABEL, moves: [], total: 0, totals: { inQty: 0, outQty: 0 }, page, size };
    if (!ids.length) return json(empty);
    // Ngày lọc theo giờ Việt Nam (như trang Đơn hàng): giao dịch 6h sáng 22/10 thuộc ngày 22/10, không lùi về 21/10 theo UTC.
    const kinds = GROUPS[group], fromStart = isDate(from) ? new Date(from + 'T00:00:00+07:00').toISOString() : null, toEnd = isDate(to) ? new Date(to + 'T23:59:59.999+07:00').toISOString() : null;
    const where = and(inArray(stockMoves.warehouseId, ids), sku ? eq(stockMoves.sku, sku) : undefined,
      group === 'sale' ? inArray(stockMoves.refType, [...SALE_REFS]) : kinds ? inArray(stockMoves.kind, [...kinds]) : undefined,
      fromStart ? gte(stockMoves.createdAt, fromStart) : undefined, toEnd ? lte(stockMoves.createdAt, toEnd) : undefined,
      brand ? eq(products.brand, brand) : undefined, status === 'active' ? eq(products.active, true) : status === 'inactive' ? eq(products.active, false) : undefined,
      q ? or(sql`${stockMoves.sku} ILIKE ${'%' + q + '%'}`, and(stockPurchaseReadHooks.scope?.(me(c),stockMoves.refType,stockMoves.refId)??sql`${stockMoves.refType} not in ('supplier_receipt','supplier_return')`,sql`${stockMoves.refNo} ILIKE ${'%' + q + '%'}`), sql`${products.name} ILIKE ${'%' + q + '%'}`, and(stockPurchaseReadHooks.scope?.(me(c),stockMoves.refType,stockMoves.refId)??sql`${stockMoves.refType} not in ('supplier_receipt','supplier_return')`,sql`${stockMoves.note} ILIKE ${'%' + q + '%'}`)) : undefined);
    // Tồn sau giao dịch: cộng dồn toàn bộ sổ kho của (mã, kho) tới dòng đó – tính trước khi lọc (lọc theo loại / ngày không làm sai số tồn).
    const ledger = db.select({ id: stockMoves.id,
      balanceAfter: sql<number>`sum(${stockMoves.qty}) over (partition by ${stockMoves.sku}, ${stockMoves.warehouseId} order by ${stockMoves.createdAt}, ${stockMoves.id} rows between unbounded preceding and current row)`.mapWith(Number).as('balance_after') })
      .from(stockMoves).where(and(inArray(stockMoves.warehouseId, ids), sku ? eq(stockMoves.sku, sku) : undefined, toEnd ? lte(stockMoves.createdAt, toEnd) : undefined)).as('ledger');
    const [rows, [sum]] = await Promise.all([
      db.select({ m: stockMoves, balanceAfter: ledger.balanceAfter, by: employees.name, name: products.name, unit: products.unit, brand: products.brand, active: products.active }).from(stockMoves)
        .innerJoin(ledger, eq(ledger.id, stockMoves.id)).leftJoin(employees, eq(employees.id, stockMoves.createdBy)).leftJoin(products, eq(products.sku, stockMoves.sku))
        .where(where).orderBy(desc(stockMoves.createdAt), desc(stockMoves.id)).limit(size).offset((page - 1) * size),
      db.select({ n: sql<number>`count(*)`.mapWith(Number), inQty: sql<number>`coalesce(sum(case when ${stockMoves.qty} > 0 then ${stockMoves.qty} else 0 end), 0)`.mapWith(Number),
        outQty: sql<number>`coalesce(sum(case when ${stockMoves.qty} < 0 then -${stockMoves.qty} else 0 end), 0)`.mapWith(Number) })
        .from(stockMoves).leftJoin(products, eq(products.sku, stockMoves.sku)).where(where),
    ]);
    let pendingAvailable=!!deps.pendingOf,pending:Awaited<ReturnType<StockPendingOf>>=[];
    if(deps.pendingOf&&rows.length)try{pending=await deps.pendingOf(db,[...new Set(rows.map(r=>r.m.sku))],ids,pendingAsOf);}catch{pendingAvailable=false;console.warn('stock-pending source unavailable');}
    const pendingByKey=new Map(pending.map(r=>[JSON.stringify([r.sku,r.warehouseId]),r]));
    // Link chứng từ của module khác: tra một lần cho cả trang.
    const resolved = new Map<string, string>();
    for (const [refType, resolve] of Object.entries(stockRefLinkHooks) as [StockRefType, StockRefLinkResolver][]) {
      const refIds = [...new Set(rows.filter(r => r.m.refType === refType).map(r => baseRef(r.m.refId)))];
      if (refIds.length) for (const [id, link] of await resolve(db, refIds,me(c))) resolved.set(refType + '\u0000' + id, link);
    }
    const viewer = me(c), linkOf = (refType: string, ref: string) => { const l = directLink(refType, ref) || resolved.get(refType + '\u0000' + ref) || ''; return l && linkVisible(viewer, l) ? l : ''; };
    const wName = new Map(whs.map(w => [w.id, w.name])), round = (v: number) => Math.round(v * 1000) / 1000;
    return json({ ...empty,pendingAvailable, total: sum?.n ?? 0, totals: { inQty: round(sum?.inQty ?? 0), outQty: round(sum?.outQty ?? 0) },
      moves: rows.map(({ m, balanceAfter, by, name, unit, brand, active }) => {
        const ref = baseRef(m.refId),privatePurchase=['supplier_receipt','supplier_return'].includes(m.refType)&&!linkOf(m.refType,ref),pending=pendingByKey.get(JSON.stringify([m.sku,m.warehouseId]))??{packed:0,returning:0,held:0,unassignedHeld:pendingByKey.get(JSON.stringify([m.sku,'']))?.unassignedHeld??0,uncertain:false};
        return { pending,pendingQty:pendingAvailable?round(pending.packed+pending.returning+pending.held):null,id: m.id, at: m.createdAt, sku: m.sku, name: name ?? '', unit: unit ?? '', brand: brand ?? '', active: active ?? true,
          warehouseId: m.warehouseId, warehouse: wName.get(m.warehouseId) ?? '', qty: m.qty, inQty: m.qty > 0 ? m.qty : 0, outQty: m.qty < 0 ? -m.qty : 0, balanceBefore: round(balanceAfter - m.qty), balanceAfter: round(balanceAfter),
          kind: m.kind, kindLabel: STOCK_KIND_LABEL[m.kind as StockMoveKind] ?? m.kind, description: stockMoveDescription(m.kind as StockMoveKind, m.refType as StockRefType),
          refType: m.refType, refNo: privatePurchase?'':m.refNo, note: privatePurchase?'':m.note, by: by ?? '', link: linkOf(m.refType, ref) };
      }) });
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
