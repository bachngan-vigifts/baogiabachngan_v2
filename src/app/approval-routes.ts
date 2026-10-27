import { orderScopeFor } from '../modules/sales/api/routes.ts';
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { Router } from '../core/http/router.ts';
import { json } from '../core/http/router.ts';
import { AppError } from '../core/errors.ts';
import type { SessionState, StaffEnv } from '../modules/staff/api/auth-routes.ts';
import { employees } from '../modules/staff/schema.ts';
import { quotations } from '../modules/quotes/schema.ts';
import { salesContracts, salesOrders } from '../modules/sales/schema.ts';
import { customers } from '../modules/customers/schema.ts';
import { products, warehouses } from '../modules/catalog/schema.ts';
import { stockTransfers } from '../modules/inventory/schema.ts';
import { incomingShipments } from '../modules/suppliers/schema.ts';
import { docRef } from '../modules/sales/domain/doc-ref.ts';
import { canApprove } from '../modules/staff/domain/permissions.ts';
import { cashEntries } from '../modules/sales/cash-schema.ts';
import { posReturns } from '../modules/sales/return-schema.ts';
import { cashAccess } from '../modules/sales/api/cash-store.ts';
import { posStoreScopeFor } from '../modules/sales/api/pos-access.ts';
import { cashEntryName } from '../modules/sales/domain/cash.ts';

/** Loại việc cần duyệt (thứ tự hiển thị). */
export const APPROVAL_KINDS = ['quote', 'order', 'contract', 'purchase', 'transfer', 'cash', 'return', 'customer', 'product'] as const;
export type ApprovalKind = typeof APPROVAL_KINDS[number];
export interface ApprovalItem { kind: ApprovalKind; id: string; title: string; sub: string; by: string; at: string; amount: number | null; link: string }

/**
 * HỘP "CẦN DUYỆT" (Manager + người được Manager bật cờ "Được duyệt", thẻ trong trang Công việc): gom mọi thứ đang chờ duyệt vào một chỗ.
 *  - Báo giá `approval_status = pending` (nhân viên lập hoặc khách gửi)
 *  - Đơn hàng nháp chưa có HĐKT · HĐKT của đơn nháp (duyệt đơn = duyệt HĐKT)
 *  - Đơn mua NCC đã gửi duyệt (chưa duyệt, chưa huỷ)
 *  - Khách hàng nhân viên tạo chờ duyệt · Sản phẩm nhân viên thêm chờ duyệt
 *  - Phiếu thu/chi Sổ quỹ chờ duyệt (vd. nộp két ≥ ngưỡng) · Yêu cầu đổi / trả hàng POS chờ duyệt – chỉ khi có quyền Sổ quỹ,
 *    đúng két / quầy của cửa hàng mình; người được chỉ định không thấy phiếu tự lập (không tự duyệt được).
 * CHỈ ĐỌC – duyệt vẫn làm ở đúng màn hình của từng loại (giữ hộp kiểm tra như hiện nay); mỗi dòng có link mở thẳng màn hình đó.
 * Cũ nhất lên trước (chờ lâu nhất xử lý trước).
 */
export function registerApprovalRoutes(router: Router<StaffEnv>) {
  router.get('/approvals', async c => {
    if (!canApprove((c.state.session as SessionState).member)) throw new AppError(403, 'Chỉ Manager hoặc người được Manager chỉ định xem được hộp Cần duyệt.', 'APPROVER_ONLY');
    const db = c.env.db, LIMIT = 200, member = (c.state.session as SessionState).member;
    // Sổ quỹ: cùng điều kiện như nút Duyệt (quyền Sổ quỹ / bán hàng, đúng cửa hàng, không tự duyệt trừ Manager).
    let cashOk = true;
    try { cashAccess(member); } catch { cashOk = false; }
    const store = cashOk ? await posStoreScopeFor(db, member) : undefined;
    const notMine = (col: typeof cashEntries.createdBy | typeof posReturns.createdBy) => member.role === 'manager' ? undefined : ne(col, member.id);
    const inStore = (col: typeof cashEntries.drawerId | typeof posReturns.registerId, ids: string[] | undefined) => ids ? (ids.length ? inArray(col, ids) : sql`false`) : undefined;
    const returnScope = or(and(eq(posReturns.source,'pos'),cashOk?inStore(posReturns.registerId,store?.scope.registers):sql`false`),and(eq(posReturns.source,'crm'),orderScopeFor(member)));
    const pendingOrders = and(eq(salesOrders.status,'draft'),isNotNull(salesOrders.submittedAt));
    const hasContract = sql`exists(select 1 from ${salesContracts} where ${salesContracts.orderId}=${salesOrders.id})`;
    // Exact counts without transferring document details or inheriting the list's 200-row cap.
    const readCounts = async () => {
      const n = sql<number>`count(*)`.mapWith(Number);
      const [quote,orders,customer,product,purchase,transfer,cash,returned] = await Promise.all([
        db.select({n}).from(quotations).where(eq(quotations.approvalStatus,'pending')),
        db.select({order:sql<number>`count(*) filter(where not ${hasContract})`.mapWith(Number),contract:sql<number>`count(*) filter(where ${hasContract})`.mapWith(Number)}).from(salesOrders).where(pendingOrders),
        db.select({n}).from(customers).where(eq(customers.approvalStatus,'pending')),
        db.select({n}).from(products).where(eq(products.approvalStatus,'pending')),
        db.select({n}).from(incomingShipments).where(and(eq(incomingShipments.source,'supplier-order'),ne(incomingShipments.approvalStatus,'approved'),isNull(incomingShipments.cancelledAt),isNotNull(incomingShipments.submittedAt))),
        db.select({n}).from(stockTransfers).where(eq(stockTransfers.status,'pending')),
        cashOk ? db.select({n}).from(cashEntries).where(and(eq(cashEntries.status,'pending'),notMine(cashEntries.createdBy),inStore(cashEntries.drawerId,store?.scope.drawers))) : [],
        db.select({n}).from(posReturns).innerJoin(salesOrders,eq(salesOrders.id,posReturns.orderId)).where(and(eq(posReturns.status,'pending'),notMine(posReturns.createdBy),returnScope)),
      ]);
      const counts = {quote:quote[0]?.n??0,order:orders[0]?.order??0,contract:orders[0]?.contract??0,customer:customer[0]?.n??0,product:product[0]?.n??0,purchase:purchase[0]?.n??0,transfer:transfer[0]?.n??0,cash:cash[0]?.n??0,return:returned[0]?.n??0};
      return {...counts,total:Object.values(counts).reduce((sum,n)=>sum+n,0)};
    };
    if(c.url.searchParams.get('summary')==='1') return json({counts:await readCounts()});
    const [qs, os, cs, ps, pos, trs, ces, rets] = await Promise.all([
      db.select({ id: quotations.id, quoteNo: quotations.quoteNo, customer: quotations.customer, createdAt: quotations.createdAt, updatedAt: quotations.updatedAt, by: employees.name, role: employees.role })
        .from(quotations).leftJoin(employees, eq(employees.id, quotations.creatorId)).where(eq(quotations.approvalStatus, 'pending')).orderBy(desc(quotations.updatedAt)).limit(LIMIT),
      db.select({ id: salesOrders.id, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, total: salesOrders.total, createdAt: salesOrders.createdAt, by: employees.name })
        .from(salesOrders).leftJoin(employees, eq(employees.id, salesOrders.createdBy)).where(and(eq(salesOrders.status, 'draft'), isNotNull(salesOrders.submittedAt))).orderBy(desc(salesOrders.createdAt)).limit(LIMIT),
      db.select({ id: customers.id, name: customers.name, phone: customers.phone, taxCode: customers.taxCode, createdAt: customers.createdAt, by: employees.name })
        .from(customers).leftJoin(employees, eq(employees.id, customers.createdBy)).where(eq(customers.approvalStatus, 'pending')).orderBy(desc(customers.createdAt)).limit(LIMIT),
      db.select({ sku: products.sku, name: products.name, updatedAt: products.updatedAt, by: employees.name })
        .from(products).leftJoin(employees, eq(employees.id, products.createdBy)).where(eq(products.approvalStatus, 'pending')).orderBy(desc(products.updatedAt)).limit(LIMIT),
      db.select({ id: incomingShipments.id, ticketNumber: incomingShipments.ticketNumber, supplierName: incomingShipments.supplierName, submittedAt: incomingShipments.submittedAt, by: employees.name })
        .from(incomingShipments).leftJoin(employees, eq(employees.id, incomingShipments.createdBy))
        .where(and(eq(incomingShipments.source, 'supplier-order'), ne(incomingShipments.approvalStatus, 'approved'), isNull(incomingShipments.cancelledAt), isNotNull(incomingShipments.submittedAt)))
        .orderBy(desc(incomingShipments.submittedAt)).limit(LIMIT),
      db.select({ id: stockTransfers.id, no: stockTransfers.transferNo, reason: stockTransfers.reason, createdAt: stockTransfers.createdAt, by: employees.name,
        from: sql<string>`(SELECT ${warehouses.name} FROM ${warehouses} WHERE ${warehouses.id} = ${stockTransfers.fromWarehouseId})`,
        to: sql<string>`(SELECT ${warehouses.name} FROM ${warehouses} WHERE ${warehouses.id} = ${stockTransfers.toWarehouseId})` })
        .from(stockTransfers).leftJoin(employees, eq(employees.id, stockTransfers.requestedBy)).where(eq(stockTransfers.status, 'pending')).orderBy(desc(stockTransfers.createdAt)).limit(LIMIT),
      cashOk ? db.select({ e: cashEntries, by: employees.name }).from(cashEntries).leftJoin(employees, eq(employees.id, cashEntries.createdBy))
        .where(and(eq(cashEntries.status, 'pending'), notMine(cashEntries.createdBy), inStore(cashEntries.drawerId, store?.scope.drawers))).orderBy(desc(cashEntries.createdAt)).limit(LIMIT) : [],
      db.select({ r: posReturns, by: employees.name, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName }).from(posReturns)
        .innerJoin(salesOrders, eq(salesOrders.id, posReturns.orderId)).leftJoin(employees, eq(employees.id, posReturns.createdBy))
        .where(and(eq(posReturns.status, 'pending'), notMine(posReturns.createdBy), returnScope)).orderBy(desc(posReturns.createdAt)).limit(LIMIT),
    ]);
    const contracts = os.length ? await db.select({ orderId: salesContracts.orderId, contractNo: salesContracts.contractNo }).from(salesContracts)
      .where(and(inArray(salesContracts.orderId, os.map(o => o.id)))) : [];
    const contractOf = new Map(contracts.map(k => [k.orderId, k.contractNo]));
    const items: ApprovalItem[] = [
      ...qs.map(q => ({ kind: 'quote' as const, id: q.id, title: `Báo giá ${q.quoteNo}`, sub: (q.role === 'customer' ? 'Khách gửi · ' : '') + (q.customer || 'Chưa nhập khách'),
        by: q.by ?? '', at: q.updatedAt || q.createdAt, amount: null, link: `#/quotes/${q.id}` })),
      ...os.map(o => { const k = contractOf.get(o.id);
        const ref = docRef(o.id, o.orderNo, k);
        return { kind: ref.kind, id: o.id, title: ref.Label, sub: o.customerName, by: o.by ?? '', at: o.createdAt, amount: o.total, link: ref.link }; }),
      ...pos.map(p => ({ kind: 'purchase' as const, id: p.id, title: `Đơn mua NCC ${p.ticketNumber}`, sub: p.supplierName || '', by: p.by ?? '', at: p.submittedAt ?? '', amount: null,
        link: `#/purchases/${encodeURIComponent(p.id)}` })),
      ...trs.map(t => ({ kind: 'transfer' as const, id: t.id, title: `Điều chuyển kho ${t.no}`, sub: `${t.from} → ${t.to} · ${t.reason}`, by: t.by ?? '', at: t.createdAt, amount: null,
        link: `#/transfers/${encodeURIComponent(t.id)}` })),
      ...ces.map(({ e, by }) => ({ kind: 'cash' as const, id: e.id, title: `Phiếu ${e.direction === 'in' ? 'thu' : 'chi'} ${e.entryNo} · ${cashEntryName(e)}`,
        sub: e.reason.replace(/^Tên phiếu: [^\n]*\n\n/, '').slice(0, 160), by: by ?? '', at: e.createdAt, amount: e.amount,
        link: `#/cash?drawerId=${encodeURIComponent(e.drawerId)}&entryId=${encodeURIComponent(e.id)}` })),
      ...rets.map(({ r, by, orderNo, customerName }) => ({ kind: 'return' as const, id: r.id, title: `Yêu cầu ${r.kind === 'exchange' ? 'đổi' : 'trả'} hàng ${r.returnNo}`,
        sub: `${customerName} · bill ${orderNo} · ${r.reason.slice(0, 120)}`, by: by ?? '', at: r.createdAt, amount: r.total,
        link: r.source==='crm'?`#/orders/${encodeURIComponent(r.orderId)}?returns=1`:`#/cash?returnOrderId=${encodeURIComponent(r.orderId)}` })),
      ...cs.map(k => ({ kind: 'customer' as const, id: k.id, title: `Khách hàng ${k.name}`, sub: [k.phone, k.taxCode && 'MST ' + k.taxCode].filter(Boolean).join(' · '),
        by: k.by ?? '', at: k.createdAt, amount: null, link: `#/customers/${encodeURIComponent(k.id)}` })),
      ...ps.map(p => ({ kind: 'product' as const, id: p.sku, title: `Sản phẩm ${p.name}`, sub: `Mã ${p.sku}`, by: p.by ?? '', at: p.updatedAt, amount: null, link: '#/products' })),
    // Mới sinh lên trên cùng (cùng quy tắc danh sách công việc); nhiều quá giới hạn thì giữ các chứng từ mới nhất.
    ].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    const counts = Object.fromEntries(APPROVAL_KINDS.map(k => [k, items.filter(i => i.kind === k).length])) as Record<ApprovalKind, number>;
    const capped = [qs,os,cs,ps,pos,trs,ces,rets].some(rows=>rows.length===LIMIT);
    const totals = capped ? await readCounts() : { ...counts, total: items.length };
    return json({ counts: totals, items, ...(totals.total>items.length?{truncated:true}:{} ) });
  }, 'business');
}
