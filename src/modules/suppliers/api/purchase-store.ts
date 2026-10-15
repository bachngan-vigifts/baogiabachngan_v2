import { and, asc, desc, eq, ilike, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { seesAllAsSaleAdmin } from '../../staff/domain/roles.ts';
import { quotations, quoteLines } from '../../quotes/schema.ts';
import { quotationPredicate } from '../../quotes/api/department-access.ts';
import { salesContracts, salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { orderScopeFor } from '../../sales/api/routes.ts';
import { customerStockRequests } from '../../portal/schema.ts';
import { customers } from '../../customers/schema.ts';
import { productStock, warehouses } from '../../catalog/schema.ts';
import {
  incomingShipmentLines, incomingShipments, supplierOrderEvents, supplierOrderSources, supplierPaymentSchedules, supplierPayments,
  supplierReceiptLines, supplierReceipts, suppliers,
} from '../schema.ts';
import { computeOrderTotals, hidePrices } from '../domain/order-totals.ts';
import {
  canSeePrices, isAccountantStaff, isWarehouseStaff, purchaseActions, purchaseState, PURCHASE_STATE_LABEL, receiptProgress, remainingToOrder, supplierDebt,
  type Actor, type NeedLine,
} from '../domain/purchasing.ts';

/**
 * ĐỌC DỮ LIỆU ĐƠN MUA (dùng chung cho API, Công việc, sơ đồ). Ghi nằm ở purchase-routes.ts.
 * Quyền xem đơn mua:
 *  - Manager, Kế toán: mọi đơn (đủ giá);
 *  - Kho: mọi đơn đã duyệt (ẩn giá) để nhận hàng;
 *  - Nhân viên khác: mọi đơn đã duyệt (ẩn giá, như bản cũ) + đơn nháp do mình tạo.
 */
export type Db = StaffEnv['db'];
export type Member = SessionState['member'];
export const asActor = (m: Member): Actor => ({ id: m.id, role: m.role, active: m.active, positionId: m.positionId });
const PURCHASE = eq(incomingShipments.source, 'supplier-order');

export function purchaseScope(m: Member) {
  const a = asActor(m);
  if (a.role === 'manager' || isAccountantStaff(a) || seesAllAsSaleAdmin(a)) return PURCHASE;
  if (isWarehouseStaff(a)) return and(PURCHASE, eq(incomingShipments.approvalStatus, 'approved'));
  return and(PURCHASE, or(eq(incomingShipments.approvalStatus, 'approved'), eq(incomingShipments.createdBy, m.id)));
}

/** Toàn bộ dữ liệu một đơn mua (đúng phạm vi xem), đã tính tiến độ nhận / công nợ / nút được bấm. */
export async function loadPurchase(db: Db, m: Member, id: string, today: string) {
  const [o] = await db.select().from(incomingShipments).where(and(eq(incomingShipments.id, id), purchaseScope(m))).limit(1);
  if (!o) throw new AppError(404, 'Không tìm thấy đơn mua hàng.');
  const [lines, sources, receipts, receiptLines, schedules, payments, events, [supplier]] = await Promise.all([
    db.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId, id)).orderBy(asc(incomingShipmentLines.lineNo)),
    db.select().from(supplierOrderSources).where(eq(supplierOrderSources.shipmentId, id)).orderBy(asc(supplierOrderSources.createdAt)),
    db.select({ r: supplierReceipts, by: employees.name }).from(supplierReceipts).leftJoin(employees, eq(employees.id, supplierReceipts.receivedBy))
      .where(eq(supplierReceipts.shipmentId, id)).orderBy(asc(supplierReceipts.createdAt)),
    db.select({ l: supplierReceiptLines }).from(supplierReceiptLines).innerJoin(supplierReceipts, eq(supplierReceipts.id, supplierReceiptLines.receiptId))
      .where(eq(supplierReceipts.shipmentId, id)),
    db.select().from(supplierPaymentSchedules).where(eq(supplierPaymentSchedules.shipmentId, id)).orderBy(asc(supplierPaymentSchedules.dueDate), asc(supplierPaymentSchedules.createdAt)),
    db.select({ p: supplierPayments, by: employees.name }).from(supplierPayments).leftJoin(employees, eq(employees.id, supplierPayments.createdBy))
      .where(eq(supplierPayments.shipmentId, id)).orderBy(asc(supplierPayments.paidDate), asc(supplierPayments.createdAt)),
    db.select({ e: supplierOrderEvents, by: employees.name }).from(supplierOrderEvents).leftJoin(employees, eq(employees.id, supplierOrderEvents.actorId))
      .where(eq(supplierOrderEvents.shipmentId, id)).orderBy(desc(supplierOrderEvents.at)).limit(200),
    o.supplierId ? db.select({ id: suppliers.id, name: suppliers.name, phone: suppliers.phone, email: suppliers.email, address: suppliers.address, taxCode: suppliers.taxCode })
      .from(suppliers).where(eq(suppliers.id, o.supplierId)).limit(1) : Promise.resolve([]),
  ]);
  const live = new Set(receipts.filter(x => !x.r.cancelledAt).map(x => x.r.id));
  const progress = receiptProgress(lines.map(l => ({ id: l.id, sku: l.sku, name: l.name, quantity: l.quantity })),
    receiptLines.filter(x => live.has(x.l.receiptId)).map(x => ({ lineId: x.l.lineId, goodQty: x.l.goodQty, damagedQty: x.l.damagedQty })));
  const totals = computeOrderTotals({ rows: lines, depositRate: o.depositRate, paidAmount: 0 });
  const debt = supplierDebt(totals.total, schedules, payments.map(x => x.p), today);
  const a = asActor(m), prices = canSeePrices(a);
  const flags = { approvalStatus: o.approvalStatus, supplierStatus: o.supplierStatus, cancelledAt: o.cancelledAt, createdBy: o.createdBy };
  const state = purchaseState(flags, progress);
  const shownTotals = prices ? totals : hidePrices(totals);
  return {
    raw: { order: o, lines, totals, progress, debt },
    view: {
      id: o.id, ticketNumber: o.ticketNumber, state, stateLabel: PURCHASE_STATE_LABEL[state], supplier: supplier ?? { id: o.supplierId, name: o.supplierName },
      supplierEmail: prices ? o.supplierEmail : '', ccEmail: prices ? o.ccEmail : '', internalNo: o.supplierInternalOrderNumber,
      arrivalDate: o.arrivalDate, warehouse: o.warehouse, note: o.note, revision: o.revision, createdAt: o.createdAt, createdBy: o.createdBy,
      approvedAt: o.approvedAt, confirmedAt: o.supplierConfirmedAt, confirmedOnBehalf: o.confirmedOnBehalf,
      cancelledAt: o.cancelledAt, cancelReason: o.cancelReason, priceHidden: !prices,
      lines: lines.map((l, i) => {
        const p = progress.lines.find(x => x.lineId === l.id)!, t = shownTotals.rows[i]!;
        return { id: l.id, lineNo: l.lineNo, sku: l.sku, name: l.name, unit: l.unit, quantity: l.quantity, promisedDate: l.promisedDate, supplierNote: l.supplierNote,
          printDescription: l.printDescription, printFee: prices ? l.printFee : null,
          price: prices ? l.price : null, taxRate: prices ? l.taxRate : null, purchaseDiscount: prices ? (l.confirmedPurchaseDiscount ?? l.purchaseDiscount) : null,
          lineTotal: prices ? t.lineTotal : null, good: p.good, damaged: p.damaged, missing: p.missing,
          sources: sources.filter(s => s.lineId === l.id).map(s => ({ type: s.sourceType, id: s.sourceId, no: s.sourceNo, customerName: s.customerName, quantity: s.quantity })) };
      }),
      totals: prices ? { subtotal: totals.subtotal, vat: totals.vat, total: totals.total } : null,
      progress: { ordered: progress.ordered, good: progress.good, damaged: progress.damaged, missing: progress.missing, fullyReceived: progress.fullyReceived },
      debt: prices ? debt : null,
      schedules: prices ? schedules.map(s => ({ id: s.id, kind: s.kind, amount: s.amount, dueDate: s.dueDate, note: s.note })) : [],
      payments: prices ? payments.map(({ p, by }) => ({ id: p.id, amount: p.amount, paidDate: p.paidDate, method: p.method, reference: p.reference, note: p.note,
        hasAttachment: Boolean(p.attachmentKey), attachmentName: p.attachmentName, by, createdAt: p.createdAt, voidedAt: p.voidedAt, voidReason: p.voidReason })) : [],
      receipts: receipts.map(({ r, by }) => ({ id: r.id, receiptNo: r.receiptNo, receivedDate: r.receivedDate, by, warehouse: r.warehouse, note: r.note,
        sapoStatus: r.sapoStatus, sapoReceiptCode: r.sapoReceiptCode, sapoNote: r.sapoNote, cancelledAt: r.cancelledAt, cancelReason: r.cancelReason,
        lines: receiptLines.filter(x => x.l.receiptId === r.id).map(x => ({ lineId: x.l.lineId, sku: x.l.sku, goodQty: x.l.goodQty, damagedQty: x.l.damagedQty, note: x.l.note })) })),
      events: events.map(({ e, by }) => ({ at: e.at, by, action: e.action, summary: e.summary })),
      actions: purchaseActions(a, flags, { anyReceived: progress.anyReceived, fullyReceived: progress.fullyReceived, paid: debt.paid }),
    },
  };
}

/** Danh sách đơn mua (tính tiến độ / công nợ theo lô, không N+1). */
export async function listPurchases(db: Db, m: Member, filter: { q?: string; supplierId?: string; state?: string; limit?: number; openOnly?: boolean }, today: string) {
  const q = (filter.q ?? '').trim().slice(0, 80), likeQ = '%' + q.replace(/[\\%_]/g, x => '\\' + x) + '%';
  const rows = await db.select().from(incomingShipments).where(and(purchaseScope(m), filter.openOnly ? isNull(incomingShipments.cancelledAt) : undefined, filter.supplierId ? eq(incomingShipments.supplierId, filter.supplierId) : undefined,
    q ? or(ilike(incomingShipments.ticketNumber, likeQ), ilike(incomingShipments.supplierName, likeQ), ilike(incomingShipments.note, likeQ),
      sql`exists (select 1 from ${supplierOrderSources} where ${supplierOrderSources.shipmentId} = ${incomingShipments.id} and (${supplierOrderSources.sourceNo} ilike ${likeQ} or ${supplierOrderSources.customerName} ilike ${likeQ} or ${supplierOrderSources.sku} ilike ${likeQ}))`) : undefined))
    .orderBy(desc(incomingShipments.createdAt)).limit(Math.min(filter.limit ?? 300, 500));
  const ids = rows.map(r => r.id);
  if (!ids.length) return [];
  const [lines, rl, schedules, payments] = await Promise.all([
    db.select().from(incomingShipmentLines).where(inArray(incomingShipmentLines.shipmentId, ids)),
    db.select({ l: supplierReceiptLines, shipmentId: supplierReceipts.shipmentId }).from(supplierReceiptLines).innerJoin(supplierReceipts, eq(supplierReceipts.id, supplierReceiptLines.receiptId))
      .where(and(inArray(supplierReceipts.shipmentId, ids), isNull(supplierReceipts.cancelledAt))),
    db.select().from(supplierPaymentSchedules).where(inArray(supplierPaymentSchedules.shipmentId, ids)),
    db.select().from(supplierPayments).where(inArray(supplierPayments.shipmentId, ids)),
  ]);
  const prices = canSeePrices(asActor(m));
  const pendingSapo = await db.select({ shipmentId: supplierReceipts.shipmentId, n: sql<number>`count(*)`.mapWith(Number) }).from(supplierReceipts)
    .where(and(inArray(supplierReceipts.shipmentId, ids), isNull(supplierReceipts.cancelledAt), inArray(supplierReceipts.sapoStatus, ['pending', 'failed']))).groupBy(supplierReceipts.shipmentId);
  const out = rows.map(o => {
    const ls = lines.filter(l => l.shipmentId === o.id).sort((a, b) => a.lineNo - b.lineNo);
    const progress = receiptProgress(ls.map(l => ({ id: l.id, sku: l.sku, name: l.name, quantity: l.quantity })), rl.filter(x => x.shipmentId === o.id).map(x => x.l));
    const total = computeOrderTotals({ rows: ls, depositRate: o.depositRate, paidAmount: 0 }).total;
    const debt = supplierDebt(total, schedules.filter(s => s.shipmentId === o.id), payments.filter(p => p.shipmentId === o.id), today);
    const state = purchaseState({ approvalStatus: o.approvalStatus, supplierStatus: o.supplierStatus, cancelledAt: o.cancelledAt, createdBy: o.createdBy }, progress);
    const promised = ls.map(l => l.promisedDate).filter(Boolean).sort()[0] || o.arrivalDate || '';
    return { id: o.id, ticketNumber: o.ticketNumber, supplierId: o.supplierId, supplierName: o.supplierName, state, stateLabel: PURCHASE_STATE_LABEL[state],
      createdAt: o.createdAt, createdBy: o.createdBy, arrivalDate: promised, lineCount: ls.length, ordered: progress.ordered, good: progress.good, missing: progress.missing, damaged: progress.damaged,
      late: Boolean(promised && promised < today && !progress.fullyReceived && !o.cancelledAt && o.approvalStatus === 'approved'),
      sapoPending: pendingSapo.find(x => x.shipmentId === o.id)?.n ?? 0,
      total: prices ? total : null, balance: prices ? debt.balance : null, overdue: prices ? debt.overdue : null, debtStatus: prices ? debt.status : null,
      nextDueDate: prices ? debt.nextDueDate : null, nextDueAmount: prices ? debt.nextDueAmount : null, approvedAt: o.approvedAt };
  });
  return filter.state ? out.filter(r => r.state === filter.state || (filter.state === 'late' && r.late) || (filter.state === 'sapo' && r.sapoPending > 0) || (filter.state === 'debt' && (r.balance ?? 0) > 0)) : out;
}

/** Đơn mua chưa huỷ, nhìn với quyền Manager – cho việc tự sinh (tasks) và sơ đồ quy trình. */
export const SYSTEM_VIEWER = { id: 'system', role: 'manager', active: true, positionId: 'manager' } as unknown as Member;
export const openPurchases = (db: Db, today: string) => listPurchases(db, SYSTEM_VIEWER, { openOnly: true, limit: 500 }, today);

// ---------------------------------------------------------------- nguồn: báo giá / đơn-HĐKT / khách hỏi tồn
export type SourceType = 'quote' | 'order' | 'stock_request';
export interface SourceNeed { type: SourceType; id: string; no: string; customerName: string; lines: NeedLine[] }

/** Đọc chứng từ nguồn ĐÚNG phạm vi xem của người dùng (không thấy thì 404). */
// Cột trong select bị render không kèm tên bảng → viết rõ bảng để subquery không hiểu nhầm `id` của sales_contracts.
const contractNoOf = sql<string | null>`(select sc.contract_no from ${salesContracts} sc where sc.order_id = ${salesOrders}.id limit 1)`;

export async function loadSourceNeed(db: Db, m: Member, type: string, id: string): Promise<SourceNeed> {
  if (type === 'quote') {
    const [q] = await db.select({ id: quotations.id, no: quotations.quoteNo, customer: quotations.customer }).from(quotations).where(and(eq(quotations.id, id), quotationPredicate(m))).limit(1);
    if (!q) throw new AppError(404, 'Không tìm thấy báo giá.');
    const lines = await db.select({ sku: quoteLines.sku, name: quoteLines.name, unit: quoteLines.unit, quantity: quoteLines.qty }).from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(asc(quoteLines.lineNo));
    return { type, id, no: q.no, customerName: q.customer, lines: lines.filter(l => l.sku) };
  }
  if (type === 'order') {
    const [o] = await db.select({ id: salesOrders.id, no: salesOrders.orderNo, customer: salesOrders.customerName, status: salesOrders.status,
      contractNo: contractNoOf })
      .from(salesOrders).where(and(eq(salesOrders.id, id), orderScopeFor(m))).limit(1);
    if (!o) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
    if (o.status === 'cancelled') throw new AppError(409, 'Đơn hàng / HĐKT đã huỷ.');
    const lines = await db.select({ sku: salesOrderLines.sku, name: salesOrderLines.name, unit: salesOrderLines.unit, quantity: salesOrderLines.qty }).from(salesOrderLines).where(eq(salesOrderLines.orderId, id)).orderBy(asc(salesOrderLines.lineNo));
    return { type, id, no: o.contractNo || o.no, customerName: o.customer, lines: lines.filter(l => l.sku) };
  }
  if (type === 'stock_request') {
    const [r] = await db.select({ r: customerStockRequests, customer: customers.name }).from(customerStockRequests).innerJoin(customers, eq(customers.id, customerStockRequests.customerId))
      .where(and(eq(customerStockRequests.id, id), m.role === 'manager' || seesAllAsSaleAdmin(m) ? undefined : eq(customerStockRequests.ownerId, m.id))).limit(1);
    if (!r) throw new AppError(404, 'Không tìm thấy yêu cầu hỏi tồn.');
    const asked = JSON.parse(r.r.items) as { sku: string; name: string; unit?: string; qty: number }[];
    const answered = new Map((JSON.parse(r.r.answerItems) as { sku: string; available: number }[]).map(a => [a.sku, a.available]));
    // Cần mua = khách hỏi − số đã báo đáp ứng được (chưa trả lời thì cần đủ số khách hỏi).
    const lines = asked.map(a => ({ sku: a.sku, name: a.name, unit: a.unit ?? '', quantity: Math.max(0, a.qty - (answered.get(a.sku) ?? 0)) })).filter(l => l.quantity > 0);
    return { type, id, no: 'Hỏi tồn ' + r.r.createdAt.slice(0, 10).split('-').reverse().join('/'), customerName: r.customer, lines };
  }
  throw new AppError(400, 'Loại chứng từ nguồn không hợp lệ.');
}

/** Đã đặt (đơn mua chưa huỷ) cho từng mã của các chứng từ nguồn: khoá `type:id` → (sku thường → số lượng). */
export async function orderedBySource(db: Db, keys: { type: string; id: string }[], exceptShipmentId?: string) {
  const out = new Map<string, Map<string, number>>();
  if (!keys.length) return out;
  const rows = await db.select({ type: supplierOrderSources.sourceType, id: supplierOrderSources.sourceId, sku: supplierOrderSources.sku, qty: supplierOrderSources.quantity })
    .from(supplierOrderSources).innerJoin(incomingShipments, eq(incomingShipments.id, supplierOrderSources.shipmentId))
    .where(and(isNull(incomingShipments.cancelledAt), or(...keys.map(k => and(eq(supplierOrderSources.sourceType, k.type as SourceType), eq(supplierOrderSources.sourceId, k.id)))),
      exceptShipmentId ? sql`${incomingShipments.id} <> ${exceptShipmentId}` : undefined));
  for (const r of rows) {
    const k = r.type + ':' + r.id, m = out.get(k) ?? new Map<string, number>();
    m.set(r.sku.toLowerCase(), (m.get(r.sku.toLowerCase()) ?? 0) + r.qty); out.set(k, m);
  }
  return out;
}

export async function sourceWithRemaining(db: Db, m: Member, type: string, id: string) {
  const need = await loadSourceNeed(db, m, type, id);
  const ordered = (await orderedBySource(db, [{ type, id }])).get(type + ':' + id) ?? new Map();
  const lines = remainingToOrder(need.lines, ordered), stock = await stockOf(db, lines.map(l => l.sku));
  return { source: { type: need.type, id: need.id, no: need.no, customerName: need.customerName }, lines: lines.map(l => ({ ...l, stock: stock.get(l.sku.toLowerCase()) ?? null })) };
}

/** Tồn kho thật (tổng các kho loại `stock` đang dùng, số đồng bộ từ Sapo) theo mã; mã chưa có số liệu tồn thì không có trong map. */
export async function stockOf(db: Db, skus: string[]) {
  const out = new Map<string, number>();
  if (!skus.length) return out;
  const rows = await db.select({ sku: productStock.sku, qty: productStock.quantity }).from(productStock).innerJoin(warehouses, eq(warehouses.id, productStock.warehouseId))
    .where(and(inArray(productStock.sku, [...new Set(skus)]), eq(warehouses.kind, 'stock'), eq(warehouses.active, true)));
  for (const r of rows) out.set(r.sku.toLowerCase(), (out.get(r.sku.toLowerCase()) ?? 0) + r.qty);
  return out;
}

/** Tìm nhanh chứng từ nguồn để lập đơn mua (đúng phạm vi xem). */
export async function sourceCandidates(db: Db, m: Member, q: string) {
  const term = q.trim().slice(0, 60), likeQ = '%' + term.replace(/[\\%_]/g, x => '\\' + x) + '%';
  const [qs, os, rs] = await Promise.all([
    db.select({ id: quotations.id, no: quotations.quoteNo, customer: quotations.customer, at: quotations.updatedAt }).from(quotations)
      .where(and(quotationPredicate(m), term ? or(ilike(quotations.quoteNo, likeQ), ilike(quotations.customer, likeQ)) : undefined)).orderBy(desc(quotations.updatedAt)).limit(8),
    db.select({ id: salesOrders.id, no: salesOrders.orderNo, customer: salesOrders.customerName, at: salesOrders.createdAt,
      contractNo: contractNoOf }).from(salesOrders)
      .where(and(orderScopeFor(m), sql`${salesOrders.status} <> 'cancelled'`, term ? or(ilike(salesOrders.orderNo, likeQ), ilike(salesOrders.customerName, likeQ),
        sql`exists (select 1 from ${salesContracts} where ${salesContracts.orderId} = ${salesOrders.id} and ${salesContracts.contractNo} ilike ${likeQ})`) : undefined))
      .orderBy(desc(salesOrders.createdAt)).limit(8),
    db.select({ id: customerStockRequests.id, customer: customers.name, at: customerStockRequests.createdAt }).from(customerStockRequests)
      .innerJoin(customers, eq(customers.id, customerStockRequests.customerId))
      .where(and(m.role === 'manager' || seesAllAsSaleAdmin(m) ? undefined : eq(customerStockRequests.ownerId, m.id), term ? ilike(customers.name, likeQ) : undefined))
      .orderBy(desc(customerStockRequests.createdAt)).limit(8),
  ]);
  return [
    ...qs.map(x => ({ type: 'quote', id: x.id, no: x.no, customerName: x.customer, at: x.at })),
    ...os.map(x => ({ type: 'order', id: x.id, no: x.contractNo || x.no, customerName: x.customer, at: x.at })),
    ...rs.map(x => ({ type: 'stock_request', id: x.id, no: 'Hỏi tồn ' + x.at.slice(0, 10).split('-').reverse().join('/'), customerName: x.customer, at: x.at })),
  ];
}

/** Số chứng từ theo ngày: `PREFIX_YYYYMMDD_NNN`. */
export async function nextNumber(db: Db, prefix: 'DMH' | 'PNH', today: string) {
  const head = `${prefix}_${today.replaceAll('-', '')}_`;
  const used = prefix === 'DMH'
    ? (await db.select({ n: incomingShipments.ticketNumber }).from(incomingShipments).where(like(incomingShipments.ticketNumber, head + '%'))).map(r => r.n)
    : (await db.select({ n: supplierReceipts.receiptNo }).from(supplierReceipts).where(like(supplierReceipts.receiptNo, head + '%'))).map(r => r.n);
  const max = Math.max(0, ...used.map(n => parseInt(n.slice(head.length), 10) || 0));
  return head + String(max + 1).padStart(3, '0');
}
