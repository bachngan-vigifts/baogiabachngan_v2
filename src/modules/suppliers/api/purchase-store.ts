import { and, asc, desc, eq, ilike, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { foldSql, matchAllWords, rankFirst, searchRank } from '../../../core/text/fold.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { quotations, quoteLines } from '../../quotes/schema.ts';
import { quotationPredicate } from '../../quotes/api/department-access.ts';
import { salesContracts, salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { orderScopeFor } from '../../sales/api/routes.ts';
import { customerStockRequests } from '../../portal/schema.ts';
import { customers } from '../../customers/schema.ts';
import { products, warehouses } from '../../catalog/schema.ts';
import { readCatalogStock } from '../../catalog/api/stock-source.ts';
import {
  incomingShipmentLines, incomingShipments, supplierOrderEvents, supplierOrderSources, supplierPaymentSchedules, supplierPayments,
  supplierReceiptLines, supplierReceipts, suppliers, receiptJobs,
} from '../schema.ts';
import { computeOrderTotals, hidePrices } from '../domain/order-totals.ts';
import {
  canSeePrices, canSeePurchasePrices, canPay, canApprovePurchase, isWarehouseStaff, purchaseActions, purchaseState, purchaseStateLabel, receiptProgress, remainingToOrder, supplierDebt,
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
export const asActor = (m: Member): Actor => ({ id: m.id, role: m.role, active: m.active, positionId: m.positionId, perms: m.perms, dataScope: m.dataScope, approver: m.approver });
const PURCHASE = eq(incomingShipments.source, 'supplier-order');

export function purchaseScope(m: Member) {
  const a = asActor(m);
  // Xem mọi đơn mua (kể cả nháp): Manager, người được duyệt, người ghi trả / xem giá NCC (trang Phân quyền – Kế toán, Sale Admin).
  if (a.role === 'manager' || canSeePrices(a) || canPay(a) || canApprovePurchase(a)) return PURCHASE;
  if (isWarehouseStaff(a)) return and(PURCHASE, eq(incomingShipments.approvalStatus, 'approved'));
  return and(PURCHASE, or(eq(incomingShipments.approvalStatus, 'approved'), eq(incomingShipments.createdBy, m.id)));
}

/** Related drafts/orders are still filtered by purchasing visibility, even when reached through a sales order. */
export async function purchaseLinksForOrder(db: Db, m: Member, order: { id: string; quoteId: string | null }) {
  return db.selectDistinct({ id: incomingShipments.id, number: incomingShipments.ticketNumber, internalNo: incomingShipments.supplierInternalOrderNumber, supplierName: incomingShipments.supplierName })
    .from(supplierOrderSources).innerJoin(incomingShipments, eq(incomingShipments.id, supplierOrderSources.shipmentId))
    .where(and(purchaseScope(m), isNull(incomingShipments.cancelledAt), or(
      and(eq(supplierOrderSources.sourceType, 'order'), eq(supplierOrderSources.sourceId, order.id)),
      order.quoteId ? and(eq(supplierOrderSources.sourceType, 'quote'), eq(supplierOrderSources.sourceId, order.quoteId)) : undefined)));
}

const MONEY_EVENT_LABEL: Record<string, string> = { approve: 'Manager duyệt đơn', import: 'Nhập từ file đơn NCC', prices: 'Lưu giá nhập', schedule: 'Sửa lịch trả NCC',
  pay: 'Ghi trả NCC', void_payment: 'Huỷ khoản trả NCC' }; // 'update' (sửa nháp) chỉ có số lượng / NCC – không ẩn
const MONEY_EVENTS = new Set(Object.keys(MONEY_EVENT_LABEL));
/** Toàn bộ dữ liệu một đơn mua (đúng phạm vi xem), đã tính tiến độ nhận / công nợ / nút được bấm. */
export async function loadPurchase(db: Db, m: Member, id: string, today: string) {
  const [o] = await db.select().from(incomingShipments).where(and(eq(incomingShipments.id, id), purchaseScope(m))).limit(1);
  if (!o) throw new AppError(404, 'Không tìm thấy đơn mua hàng.');
  const [storedLines, sources, receipts, receiptLines, schedules, payments, events, [supplier]] = await Promise.all([
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
  // Đơn cũ có thể lưu tên gọn từ báo giá (vd "Bộ trà 0.5"): hiện, in PDF và gửi NCC theo tên đầy đủ trong danh mục.
  const fullNames = await catalogNames(db, storedLines.map(l => l.sku));
  const lines = storedLines.map(l => ({ ...l, name: fullNames.get(l.sku.toLowerCase()) ?? l.name }));
  const live = new Set(receipts.filter(x => !x.r.cancelledAt).map(x => x.r.id));
  const progress = receiptProgress(lines.map(l => ({ id: l.id, sku: l.sku, name: l.name, quantity: l.quantity })),
    receiptLines.filter(x => live.has(x.l.receiptId)).map(x => ({ lineId: x.l.lineId, goodQty: x.l.goodQty, damagedQty: x.l.damagedQty })));
  const jobs = receipts.length ? await db.select({receiptId:receiptJobs.receiptId,status:receiptJobs.status,action:receiptJobs.action,lastError:receiptJobs.lastError,attempts:receiptJobs.attempts,updatedAt:receiptJobs.updatedAt}).from(receiptJobs).where(inArray(receiptJobs.receiptId,receipts.map(x=>x.r.id))) : [];
  const totals = computeOrderTotals({ rows: lines, depositRate: o.depositRate, paidAmount: 0 });
  const debt = supplierDebt(totals.total, schedules, payments.map(x => x.p), today);
  const a = asActor(m), prices = canSeePurchasePrices(a, o);
  const flags = { approvalStatus: o.approvalStatus, supplierStatus: o.supplierStatus, cancelledAt: o.cancelledAt, createdBy: o.createdBy, submittedAt: o.submittedAt };
  const state = purchaseState(flags, progress);
  const shownTotals = prices ? totals : hidePrices(totals);
  return {
    raw: { order: o, lines, totals, progress, debt },
    view: {
      id: o.id, ticketNumber: o.ticketNumber, state, stateLabel: purchaseStateLabel(state, flags), submittedAt: o.submittedAt, supplier: supplier ?? { id: o.supplierId, name: o.supplierName },
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
      receipts: receipts.map(({ r, by }) => ({ id: r.id, shipmentId:r.shipmentId, receiptNo: r.receiptNo, receivedDate: r.receivedDate, by, warehouse: r.warehouse, note: r.note,
        historicalImport:r.clientKey.startsWith('import:'), sapoPurchaseOrderId:r.sapoPurchaseOrderId, sapoReceiptId:r.sapoReceiptId, sapoReceiptUrl:r.sapoReceiptUrl, sapoVerifiedAt:r.sapoVerifiedAt, sapoUpdatedAt:r.sapoUpdatedAt, job:jobs.find(j=>j.receiptId===r.id) ?? null,
        createSapo:r.createSapo,sapoStatus: r.sapoStatus, sapoReceiptCode: r.sapoReceiptCode, sapoNote: r.sapoNote, cancelledAt: r.cancelledAt, cancelReason: r.cancelReason,
        lines: receiptLines.filter(x => x.l.receiptId === r.id).map(x => ({ lineId: x.l.lineId, sku: x.l.sku, goodQty: x.l.goodQty, damagedQty: x.l.damagedQty, note: x.l.note })) })),
      // Nội dung lịch sử có số tiền (duyệt, nhập file, giá nhập, lịch trả, trả / huỷ trả, sửa nháp): người không xem được giá chỉ thấy tên thao tác.
      events: events.map(({ e, by }) => ({ at: e.at, by, action: e.action, summary: prices || !MONEY_EVENTS.has(e.action) ? e.summary : MONEY_EVENT_LABEL[e.action] ?? 'Cập nhật đơn mua' })),
      actions: purchaseActions(a, flags, { anyReceived: progress.anyReceived, fullyReceived: progress.fullyReceived, paid: debt.paid }),
    },
  };
}

export interface PurchaseListFilter { q?: string; supplierId?: string; state?: string; limit?: number; openOnly?: boolean }
function purchaseListScope(m: Member, filter: PurchaseListFilter) {
  const q = (filter.q ?? '').trim().slice(0, 80);
  return and(purchaseScope(m), filter.openOnly ? isNull(incomingShipments.cancelledAt) : undefined, filter.supplierId ? eq(incomingShipments.supplierId, filter.supplierId) : undefined,
    // Tìm chung (không dấu, nhiều từ, mã gõ thiếu dấu câu – core/text/fold.ts): trên đơn mua hoặc trên nguồn (báo giá / đơn bán / mã hàng).
    q ? or(matchAllWords(foldSql(incomingShipments.ticketNumber, incomingShipments.supplierInternalOrderNumber, incomingShipments.supplierName, incomingShipments.note), q),
      sql`exists (select 1 from ${supplierOrderSources} where ${supplierOrderSources.shipmentId} = ${incomingShipments.id} and ${matchAllWords(foldSql(supplierOrderSources.sourceNo, supplierOrderSources.customerName, supplierOrderSources.sku), q)})`) : undefined);
}

/** Danh sách đơn mua (tính tiến độ / công nợ theo lô, không N+1). */
export async function listPurchases(db: Db, m: Member, filter: PurchaseListFilter, today: string) {
  const rows = await db.select().from(incomingShipments).where(and(purchaseListScope(m, filter), filter.state==='sapo'?sql`exists(select 1 from ${supplierReceipts} where ${supplierReceipts.shipmentId}=${incomingShipments.id} and ${supplierReceipts.cancelledAt} is null and ${supplierReceipts.sapoStatus} in ('pending','failed'))`:undefined))
    .orderBy(...rankFirst(searchRank([incomingShipments.ticketNumber, incomingShipments.supplierInternalOrderNumber], incomingShipments.supplierName, filter.q)), desc(incomingShipments.createdAt))
    .limit(Math.min(filter.limit ?? 300, filter.openOnly ? 5000 : 500));
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
  const creatorIds = [...new Set(rows.map(r => r.createdBy).filter((x): x is string => !!x))];
  const creators = new Map((creatorIds.length ? await db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, creatorIds)) : []).map(e => [e.id, e.name]));
  const pendingSapo = await db.select({ shipmentId: supplierReceipts.shipmentId, n: sql<number>`count(*)`.mapWith(Number) }).from(supplierReceipts)
    .where(and(inArray(supplierReceipts.shipmentId, ids), isNull(supplierReceipts.cancelledAt), inArray(supplierReceipts.sapoStatus, ['pending', 'failed']))).groupBy(supplierReceipts.shipmentId);
  const out = rows.map(o => {
    const ls = lines.filter(l => l.shipmentId === o.id).sort((a, b) => a.lineNo - b.lineNo);
    const progress = receiptProgress(ls.map(l => ({ id: l.id, sku: l.sku, name: l.name, quantity: l.quantity })), rl.filter(x => x.shipmentId === o.id).map(x => x.l));
    const total = computeOrderTotals({ rows: ls, depositRate: o.depositRate, paidAmount: 0 }).total;
    const debt = supplierDebt(total, schedules.filter(s => s.shipmentId === o.id), payments.filter(p => p.shipmentId === o.id), today);
    const state = purchaseState({ approvalStatus: o.approvalStatus, supplierStatus: o.supplierStatus, cancelledAt: o.cancelledAt, createdBy: o.createdBy }, progress), submitted = o.submittedAt !== null;
    const promised = ls.map(l => l.promisedDate).filter(Boolean).sort()[0] || o.arrivalDate || '';
    return { id: o.id, ticketNumber: o.ticketNumber, internalNo: o.supplierInternalOrderNumber, supplierId: o.supplierId, supplierName: o.supplierName, state, stateLabel: purchaseStateLabel(state, o), submitted,
      createdAt: o.createdAt, createdBy: o.createdBy, createdByName: (o.createdBy && creators.get(o.createdBy)) || '', arrivalDate: promised, lineCount: ls.length, ordered: progress.ordered, good: progress.good, missing: progress.missing, damaged: progress.damaged,
      late: Boolean(promised && promised < today && !progress.fullyReceived && !o.cancelledAt && o.approvalStatus === 'approved'),
      sapoPending: pendingSapo.find(x => x.shipmentId === o.id)?.n ?? 0,
      total: prices ? total : null, balance: prices ? debt.balance : null, overdue: prices ? debt.overdue : null, debtStatus: prices ? debt.status : null,
      nextDueDate: prices ? debt.nextDueDate : null, nextDueAmount: prices ? debt.nextDueAmount : null, approvedAt: o.approvedAt };
  });
  return filter.state ? out.filter(r => r.state === filter.state || (filter.state === 'late' && r.late) || (filter.state === 'sapo' && r.sapoPending > 0) || (filter.state === 'debt' && (r.balance ?? 0) > 0 && r.state !== 'cancelled' && r.state !== 'draft')) : out;
}

/**
 * CÔNG NỢ NCC theo nhà cung cấp (chỉ người xem được giá NCC): mọi đơn mua đã duyệt, chưa huỷ, còn phải trả.
 * Mỗi NCC: tổng giá trị, đã trả, còn nợ, quá hạn, kỳ sắp tới; kèm từng đơn để xuất Excel chi tiết.
 */
export async function supplierPayables(db: Db, m: Member, today: string) {
  if (!canSeePrices(asActor(m))) throw new AppError(403, 'Bạn không có quyền xem công nợ NCC.');
  const rows = await db.select().from(incomingShipments)
    .where(and(purchaseScope(m), eq(incomingShipments.approvalStatus, 'approved'), isNull(incomingShipments.cancelledAt)));
  const ids = rows.map(r => r.id);
  if (!ids.length) return { suppliers: [], orders: [] };
  const [lines, schedules, payments] = await Promise.all([
    db.select().from(incomingShipmentLines).where(inArray(incomingShipmentLines.shipmentId, ids)),
    db.select().from(supplierPaymentSchedules).where(inArray(supplierPaymentSchedules.shipmentId, ids)),
    db.select().from(supplierPayments).where(inArray(supplierPayments.shipmentId, ids)),
  ]);
  const orders = rows.map(o => {
    const total = computeOrderTotals({ rows: lines.filter(l => l.shipmentId === o.id), depositRate: o.depositRate, paidAmount: 0 }).total;
    const debt = supplierDebt(total, schedules.filter(x => x.shipmentId === o.id), payments.filter(x => x.shipmentId === o.id), today);
    return { id: o.id, ticketNumber: o.ticketNumber, internalNo: o.supplierInternalOrderNumber, supplierId: o.supplierId, supplierName: o.supplierName, approvedAt: o.approvedAt, ...debt };
  }).filter(o => o.balance > 0).sort((a, b) => (a.nextDueDate ?? '9999').localeCompare(b.nextDueDate ?? '9999'));
  const bySupplier = new Map<string, { supplierId: string | null; supplierName: string; orders: number; total: number; paid: number; balance: number; overdue: number; nextDueDate: string | null; nextDueAmount: number }>();
  for (const o of orders) {
    const key = o.supplierId ?? 'name:' + o.supplierName;
    const x = bySupplier.get(key) ?? { supplierId: o.supplierId, supplierName: o.supplierName, orders: 0, total: 0, paid: 0, balance: 0, overdue: 0, nextDueDate: null, nextDueAmount: 0 };
    x.orders++; x.total += o.total; x.paid += o.paid; x.balance += o.balance; x.overdue += o.overdue;
    if (o.nextDueDate && (!x.nextDueDate || o.nextDueDate < x.nextDueDate)) { x.nextDueDate = o.nextDueDate; x.nextDueAmount = o.nextDueAmount; }
    else if (o.nextDueDate && o.nextDueDate === x.nextDueDate) x.nextDueAmount += o.nextDueAmount;
    bySupplier.set(key, x);
  }
  return { suppliers: [...bySupplier.values()].sort((a, b) => b.overdue - a.overdue || b.balance - a.balance), orders };
}

/** Badge counts cover the entire scoped search, independently of selected state and list limits. */
export async function purchaseCounts(db: Db, m: Member, filter: PurchaseListFilter, today: string) {
  const l = incomingShipmentLines, r = supplierReceipts, rl = supplierReceiptLines;
  const received = sql`coalesce((select sum(${rl.goodQty}) from ${rl} inner join ${r} on ${r.id} = ${rl.receiptId}
    where ${rl.lineId} = ${l.id} and ${r.cancelledAt} is null), 0)`;
  const hasLines = sql`exists (select 1 from ${l} where ${l.shipmentId} = ${incomingShipments.id})`;
  const fullyReceived = sql<boolean>`${hasLines} and not exists (select 1 from ${l}
    where ${l.shipmentId} = ${incomingShipments.id} and ${l.quantity} > ${received})`;
  const anyReceived = sql<boolean>`exists (select 1 from ${r} inner join ${rl} on ${rl.receiptId} = ${r.id}
    where ${r.shipmentId} = ${incomingShipments.id} and ${r.cancelledAt} is null and (${rl.goodQty} > 0 or ${rl.damagedQty} > 0))`;
  const amount = sql`(coalesce(${l.price}, 0) * (100 - greatest(0, least(100,
    coalesce(${l.confirmedPurchaseDiscount}, ${l.purchaseDiscount}, 0)))) / 100 + greatest(0, ${l.printFee})) * floor(${l.quantity} + 0.5)`;
  const total = sql`coalesce((select sum(${amount}) + sum(${amount} * coalesce(${l.taxRate}, 0) / 100)
    from ${l} where ${l.shipmentId} = ${incomingShipments.id}), 0)`;
  const paid = sql`floor(coalesce((select sum(${supplierPayments.amount}) from ${supplierPayments}
    where ${supplierPayments.shipmentId} = ${incomingShipments.id} and ${supplierPayments.voidedAt} is null), 0) + 0.5)`;
  // Nested SQL keeps correlated columns qualified in Drizzle single-table selections.
  const promised = sql`coalesce((select min(${l.promisedDate}) from ${l} where ${l.shipmentId} = ${incomingShipments.id}
    and ${l.promisedDate} <> ''), ${incomingShipments.arrivalDate}, '')`;
  const sapoPending = sql`exists (select 1 from ${r} where ${r.shipmentId} = ${incomingShipments.id}
    and ${r.cancelledAt} is null and ${r.sapoStatus} in ('pending', 'failed'))`;
  const data = db.$with('purchase_badge_data').as(db.select({
    state: sql<string>`case when ${incomingShipments.cancelledAt} is not null then 'cancelled'
      when ${incomingShipments.approvalStatus} <> 'approved' then 'draft'
      when ${fullyReceived} then 'received' when ${anyReceived} then 'partially_received'
      when ${incomingShipments.supplierStatus} = 'confirmed' then 'confirmed' else 'awaiting_confirmation' end`.as('state'),
    late: sql<boolean>`${incomingShipments.approvalStatus} = 'approved' and ${incomingShipments.cancelledAt} is null
      and not (${fullyReceived}) and ${promised} <> '' and ${promised} < ${today}`.as('late'),
    sapo: sql<boolean>`${sapoPending}`.as('sapo'),
    // Còn nợ NCC: chỉ đơn đã duyệt, chưa huỷ (đơn nháp / đã huỷ không phát sinh công nợ).
    debt: (canSeePrices(asActor(m)) ? sql<boolean>`${incomingShipments.approvalStatus} = 'approved' and ${incomingShipments.cancelledAt} is null
      and floor((${total} - ${paid}) + 0.5) > 0` : sql<boolean>`false`).as('debt'),
  }).from(incomingShipments).where(purchaseListScope(m, filter)));
  const count = (condition: ReturnType<typeof sql>) => sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
  const query = db.with(data).select({
    all: sql<number>`count(*)`.mapWith(Number), draft: count(sql`${data.state} = 'draft'`),
    awaiting_confirmation: count(sql`${data.state} = 'awaiting_confirmation'`), confirmed: count(sql`${data.state} = 'confirmed'`),
    partially_received: count(sql`${data.state} = 'partially_received'`), received: count(sql`${data.state} = 'received'`),
    cancelled: count(sql`${data.state} = 'cancelled'`), late: count(sql`${data.late}`), sapo: count(sql`${data.sapo}`), debt: count(sql`${data.debt}`),
  }).from(data);
  const [out] = await query;
  return out!;
}

/** Đơn mua chưa huỷ, nhìn với quyền Manager – cho việc tự sinh (tasks) và sơ đồ quy trình. */
export const SYSTEM_VIEWER = { id: 'system', role: 'manager', active: true, positionId: 'manager' } as unknown as Member;
/** Việc tự động (nhận hàng, trả tiền NCC…): mọi đơn chưa huỷ – giới hạn rộng để đơn cũ còn nợ / chưa nhận đủ không bị bỏ sót. */
export const openPurchases = (db: Db, today: string) => listPurchases(db, SYSTEM_VIEWER, { openOnly: true, limit: 5000 }, today);

// ---------------------------------------------------------------- nguồn: báo giá / đơn-HĐKT / khách hỏi tồn
export type SourceType = 'quote' | 'order' | 'stock_request';
export interface SourceNeed { type: SourceType; id: string; no: string; customerName: string; lines: NeedLine[] }

/** Đọc chứng từ nguồn ĐÚNG phạm vi xem của người dùng (không thấy thì 404). */
// Cột trong select bị render không kèm tên bảng → viết rõ bảng để subquery không hiểu nhầm `id` của sales_contracts.
const contractNoOf = sql<string | null>`(select sc.contract_no from ${salesContracts} sc where sc.order_id = ${salesOrders}.id limit 1)`;

/**
 * Tên đầy đủ trong danh mục theo mã (không phân biệt hoa thường). Dòng báo giá / đơn có thể được gõ gọn (vd "Bộ trà 0.5")
 * – đơn mua NCC luôn hiện và ghi tên danh mục để NCC nhận đúng hàng; mã không có trong danh mục giữ tên của dòng.
 */
export async function catalogNames(db: Db, skus: readonly string[]): Promise<Map<string, string>> {
  const keys = [...new Set(skus.map(s => s.trim().toLowerCase()).filter(Boolean))];
  if (!keys.length) return new Map();
  const rows = await db.select({ sku: products.sku, name: products.name }).from(products).where(inArray(sql`lower(${products.sku})`, keys));
  return new Map(rows.filter(r => r.name.trim()).map(r => [r.sku.toLowerCase(), r.name]));
}
const withCatalogNames = async <T extends { sku: string; name: string }>(db: Db, lines: T[]): Promise<T[]> => {
  const names = await catalogNames(db, lines.map(l => l.sku));
  return lines.map(l => ({ ...l, name: names.get(l.sku.toLowerCase()) ?? l.name }));
};

export async function loadSourceNeed(db: Db, m: Member, type: string, id: string): Promise<SourceNeed> {
  if (type === 'quote') {
    const [q] = await db.select({ id: quotations.id, no: quotations.quoteNo, customer: quotations.customer }).from(quotations).where(and(eq(quotations.id, id), quotationPredicate(m))).limit(1);
    if (!q) throw new AppError(404, 'Không tìm thấy báo giá.');
    const lines = await db.select({ sku: quoteLines.sku, name: quoteLines.name, unit: quoteLines.unit, quantity: quoteLines.qty }).from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(asc(quoteLines.lineNo));
    return { type, id, no: q.no, customerName: q.customer, lines: await withCatalogNames(db, lines.filter(l => l.sku)) };
  }
  if (type === 'order') {
    const [o] = await db.select({ id: salesOrders.id, no: salesOrders.orderNo, customer: salesOrders.customerName, status: salesOrders.status,
      contractNo: contractNoOf })
      .from(salesOrders).where(and(eq(salesOrders.id, id), orderScopeFor(m))).limit(1);
    if (!o) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
    if (o.status === 'cancelled') throw new AppError(409, 'Đơn hàng / HĐKT đã huỷ.');
    const lines = await db.select({ sku: salesOrderLines.sku, name: salesOrderLines.name, unit: salesOrderLines.unit, quantity: salesOrderLines.qty }).from(salesOrderLines).where(eq(salesOrderLines.orderId, id)).orderBy(asc(salesOrderLines.lineNo));
    return { type, id, no: o.contractNo || o.no, customerName: o.customer, lines: await withCatalogNames(db, lines.filter(l => l.sku)) };
  }
  if (type === 'stock_request') {
    const [r] = await db.select({ r: customerStockRequests, customer: customers.name }).from(customerStockRequests).innerJoin(customers, eq(customers.id, customerStockRequests.customerId))
      .where(and(eq(customerStockRequests.id, id), m.role === 'manager' ? undefined : eq(customerStockRequests.ownerId, m.id))).limit(1);
    if (!r) throw new AppError(404, 'Không tìm thấy yêu cầu hỏi tồn.');
    const asked = JSON.parse(r.r.items) as { sku: string; name: string; unit?: string; qty: number }[];
    const answered = new Map((JSON.parse(r.r.answerItems) as { sku: string; available: number }[]).map(a => [a.sku, a.available]));
    // Cần mua = khách hỏi − số đã báo đáp ứng được (chưa trả lời thì cần đủ số khách hỏi).
    const lines = asked.map(a => ({ sku: a.sku, name: a.name, unit: a.unit ?? '', quantity: Math.max(0, a.qty - (answered.get(a.sku) ?? 0)) })).filter(l => l.quantity > 0);
    return { type, id, no: 'Hỏi tồn ' + r.r.createdAt.slice(0, 10).split('-').reverse().join('/'), customerName: r.customer, lines: await withCatalogNames(db, lines) };
  }
  throw new AppError(400, 'Loại chứng từ nguồn không hợp lệ.');
}

/** A quote and its converted orders/contracts represent the same purchasing demand. */
export async function sourceFamilies(db: Db, keys: { type: string; id: string }[]) {
  const orderIds = keys.filter(k=>k.type==='order').map(k=>k.id);
  const orders = orderIds.length ? await db.select({id:salesOrders.id,quoteId:salesOrders.quoteId}).from(salesOrders).where(inArray(salesOrders.id,orderIds)) : [];
  const quotes = [...new Set([...keys.filter(k=>k.type==='quote').map(k=>k.id),...orders.map(o=>o.quoteId).filter((id):id is string=>!!id)])];
  const related = quotes.length ? await db.select({id:salesOrders.id,quoteId:salesOrders.quoteId}).from(salesOrders).where(inArray(salesOrders.quoteId,quotes)) : [];
  const byKey=new Map<string,string>(), aliases=new Map<string,{type:string;id:string}[]>();
  for(const key of keys){const original=key.type+':'+key.id,quote=key.type==='quote'?key.id:key.type==='order'?orders.find(o=>o.id===key.id)?.quoteId:undefined;
    const family=quote?'quote:'+quote:original;byKey.set(original,family);
    if(!aliases.has(family))aliases.set(family,quote?[{type:'quote',id:quote},...related.filter(o=>o.quoteId===quote).map(o=>({type:'order',id:o.id}))]:[key]);
  }
  return {byKey,aliases};
}
/** All uncancelled purchase allocations across the source family, returned under each requested key. */
export async function orderedBySource(db: Db, keys: { type: string; id: string }[], exceptShipmentId?: string, knownFamilies?: Awaited<ReturnType<typeof sourceFamilies>>) {
  const out = new Map<string, Map<string, number>>();
  if (!keys.length) return out;
  const families=knownFamilies??await sourceFamilies(db,keys), aliasToFamily=new Map<string,string>();
  for(const [family,members]of families.aliases)for(const k of members)aliasToFamily.set(k.type+':'+k.id,family);
  const aliases=[...families.aliases.values()].flat();
  const rows = await db.select({ type: supplierOrderSources.sourceType, id: supplierOrderSources.sourceId, sku: supplierOrderSources.sku, qty: supplierOrderSources.quantity })
    .from(supplierOrderSources).innerJoin(incomingShipments, eq(incomingShipments.id, supplierOrderSources.shipmentId))
    .where(and(isNull(incomingShipments.cancelledAt), or(...aliases.map(k => and(eq(supplierOrderSources.sourceType, k.type as SourceType), eq(supplierOrderSources.sourceId, k.id)))),
      exceptShipmentId ? sql`${incomingShipments.id} <> ${exceptShipmentId}` : undefined));
  const totals=new Map<string,Map<string,number>>();
  for (const r of rows) {
    const k=aliasToFamily.get(r.type+':'+r.id)!,m=totals.get(k)??new Map<string,number>();
    m.set(r.sku.toLowerCase(),(m.get(r.sku.toLowerCase())??0)+r.qty);totals.set(k,m);
  }
  for(const [key,family]of families.byKey)out.set(key,totals.get(family)??new Map());
  return out;
}

/** Legacy duplicate purchase orders must be reviewed before receiving more against a converted demand. */
export async function ensureReceiptSourceBudget(db: Db, shipmentId: string, skus: string[]) {
  const sources=await db.select({type:supplierOrderSources.sourceType,id:supplierOrderSources.sourceId,sku:supplierOrderSources.sku}).from(supplierOrderSources)
    .where(and(eq(supplierOrderSources.shipmentId,shipmentId),inArray(supplierOrderSources.sku,skus),inArray(supplierOrderSources.sourceType,['quote','order'])));
  if(!sources.length)return;
  const keys=[...new Map(sources.map(s=>[s.type+':'+s.id,{type:s.type,id:s.id}])).values()],families=await sourceFamilies(db,keys);
  const quoteIds=[...families.aliases].filter(([family,aliases])=>family.startsWith('quote:')&&aliases.length>1).map(([family])=>family.slice(6));
  if(!quoteIds.length)return;
  const [ordered,lines]=await Promise.all([orderedBySource(db,keys,undefined,families),db.select({quoteId:quoteLines.quoteId,sku:quoteLines.sku,qty:quoteLines.qty}).from(quoteLines).where(inArray(quoteLines.quoteId,quoteIds))]);
  for(const source of sources){const family=families.byKey.get(source.type+':'+source.id),quoteId=family?.startsWith('quote:')?family.slice(6):'';
    if(!quoteIds.includes(quoteId))continue;
    const sku=source.sku.toLowerCase(),need=lines.filter(l=>l.quoteId===quoteId&&l.sku.toLowerCase()===sku).reduce((sum,l)=>sum+l.qty,0);
    if(need>0&&(ordered.get(source.type+':'+source.id)?.get(sku)??0)>need+0.0005)
      throw new AppError(409,`${source.sku}: nhu cầu đang bị đặt trùng giữa báo giá và đơn hàng/HĐKT. Manager cần đối soát các đơn mua trước khi nhận thêm.`,'PURCHASE_SOURCE_DUPLICATE');
  }
}

export async function sourceWithRemaining(db: Db, m: Member, type: string, id: string) {
  const need = await loadSourceNeed(db, m, type, id);
  const ordered = (await orderedBySource(db, [{ type, id }])).get(type + ':' + id) ?? new Map();
  const lines = remainingToOrder(need.lines, ordered), stock = await stockOf(db, lines.map(l => l.sku));
  return { source: { type: need.type, id: need.id, no: need.no, customerName: need.customerName }, lines: lines.map(l => ({ ...l, stock: stock.get(l.sku.toLowerCase()) ?? null })) };
}

/**
 * Tồn kho thật (tổng các kho loại `stock` đang dùng) theo mã; mã chưa có số liệu tồn thì không có trong map.
 * Đọc như trang Sản phẩm: kho đã chốt đầu kỳ lấy sổ kho CRM, kho chưa chốt lấy số đồng bộ Sapo (trước đây luôn lấy số Sapo).
 */
export async function stockOf(db: Db, skus: string[]) {
  const out = new Map<string, number>();
  if (!skus.length) return out;
  const [rows, stores] = await Promise.all([readCatalogStock(db, [...new Set(skus)]),
    db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.kind, 'stock'), eq(warehouses.active, true)))]);
  const ids = new Set(stores.map(w => w.id));
  for (const r of rows) if (ids.has(r.warehouseId)) out.set(r.sku.toLowerCase(), (out.get(r.sku.toLowerCase()) ?? 0) + r.quantity);
  return out;
}

/** Tìm nhanh chứng từ nguồn để lập đơn mua (đúng phạm vi xem). */
export async function sourceCandidates(db: Db, m: Member, q: string, offset = 0) {
  const term = q.trim().slice(0, 60);
  const [qs, os, rs] = await Promise.all([
    db.select({ id: quotations.id, no: quotations.quoteNo, customer: quotations.customer, at: quotations.updatedAt }).from(quotations)
      .where(and(quotationPredicate(m), matchAllWords(foldSql(quotations.quoteNo, quotations.customer), term)))
      .orderBy(...rankFirst(searchRank([quotations.quoteNo], quotations.customer, term)), desc(quotations.createdAt), quotations.id).limit(8).offset(offset),
    db.select({ id: salesOrders.id, no: salesOrders.orderNo, customer: salesOrders.customerName, at: salesOrders.createdAt,
      contractNo: contractNoOf }).from(salesOrders)
      .where(and(orderScopeFor(m), sql`${salesOrders.status} <> 'cancelled'`, matchAllWords(foldSql(salesOrders.orderNo, salesOrders.customerName, contractNoOf), term)))
      .orderBy(...rankFirst(searchRank([salesOrders.orderNo, contractNoOf], salesOrders.customerName, term)), desc(salesOrders.createdAt), salesOrders.id).limit(8).offset(offset),
    db.select({ id: customerStockRequests.id, customer: customers.name, at: customerStockRequests.createdAt }).from(customerStockRequests)
      .innerJoin(customers, eq(customers.id, customerStockRequests.customerId))
      .where(and(m.role === 'manager' ? undefined : eq(customerStockRequests.ownerId, m.id), matchAllWords(foldSql(customers.name), term)))
      .orderBy(desc(customerStockRequests.createdAt), customerStockRequests.id).limit(8).offset(offset),
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

/**
 * Email nhân viên phụ trách đơn mua (để CC khi gửi đơn cho NCC): người lập đơn mua + người phụ trách các chứng từ nguồn
 * (người lập báo giá, người phụ trách đơn hàng / HĐKT, người phụ trách yêu cầu hỏi tồn) + mọi Manager. Chỉ nhân viên nội bộ còn hoạt động.
 */
export async function responsibleEmails(db: Db, shipmentId: string, createdBy: string): Promise<string[]> {
  const src = await db.select({ type: supplierOrderSources.sourceType, id: supplierOrderSources.sourceId }).from(supplierOrderSources).where(eq(supplierOrderSources.shipmentId, shipmentId));
  const ids = (t: string) => [...new Set(src.filter(s => s.type === t && s.id).map(s => s.id))];
  const [q, o, r] = await Promise.all([
    ids('quote').length ? db.select({ id: quotations.creatorId }).from(quotations).where(inArray(quotations.id, ids('quote'))) : [],
    ids('order').length ? db.select({ id: salesOrders.ownerId }).from(salesOrders).where(inArray(salesOrders.id, ids('order'))) : [],
    ids('stock_request').length ? db.select({ id: customerStockRequests.ownerId }).from(customerStockRequests).where(inArray(customerStockRequests.id, ids('stock_request'))) : [],
  ]);
  const people = [...new Set([createdBy, ...q.map(x => x.id), ...o.map(x => x.id), ...r.map(x => x.id)].filter(Boolean))];
  const rows = await db.select({ id: employees.id, email: employees.email, role: employees.role }).from(employees)
    .where(and(or(people.length ? inArray(employees.id, people) : undefined, eq(employees.role, 'manager')), eq(employees.active, true), isNull(employees.deletedAt), inArray(employees.role, ['employee', 'manager'])));
  // Thứ tự: người lập đơn, người phụ trách chứng từ, rồi các Manager.
  const managers = rows.filter(x => x.role === 'manager' && !people.includes(x.id)).sort((a, b) => a.email.localeCompare(b.email)).map(x => x.id);
  return [...people, ...managers].map(id => rows.find(x => x.id === id)?.email ?? '').filter(Boolean);
}
