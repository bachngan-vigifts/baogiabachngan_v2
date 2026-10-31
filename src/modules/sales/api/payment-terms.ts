/**
 * HẠN CÔNG NỢ của đơn / HĐKT.
 *  - Phần còn lại: ngày giao xong + số ngày thanh toán. Số ngày lấy theo HĐKT; đơn không có HĐKT lấy theo báo giá nguồn,
 *    báo giá không ghi điều khoản thì theo hạn thanh toán của khách; không có gì → 0 (đến hạn ngày giao xong).
 *  - Cọc HĐKT: ngày ký + DEPOSIT_GRACE_DAYS.
 * Rà hạn cũ (Manager): xem trước kỳ phải thu còn nợ có hạn khác quy tắc trên, chọn rồi áp dụng; ghi audit từng kỳ.
 */
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import { json, readJson, type Router, type RouteContext } from '../../../core/http/router.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { customers } from '../../customers/schema.ts';
import { quotations } from '../../quotes/schema.ts';
import { customerPayments, deliveries, paymentSchedules, salesContracts, salesOrders } from '../schema.ts';
import { contractTermsFromQuote, paymentDaysOfTerm } from '../domain/contract-quote-terms.ts';
import { addDays, DEPOSIT_GRACE_DAYS } from '../domain/sales.ts';

type Db = StaffEnv['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type ReadDb = Db | Tx;
type Ctx = RouteContext<StaffEnv>;

/** Số ngày thanh toán của đơn không có HĐKT, từ dữ liệu báo giá nguồn và điều khoản khách (thuần, để kiểm thử). */
export function orderPaymentDays(quoteData: unknown, customerTerm?: string | null): number {
  const data = typeof quoteData === 'string' ? safeJson(quoteData) : quoteData && typeof quoteData === 'object' ? quoteData as Record<string, unknown> : null;
  if (data) {
    const days = contractTermsFromQuote(data).paymentDays;
    if (days !== undefined) return days;
    // Báo giá có điều kiện bằng chữ (vd "Thanh toán trước khi giao hàng") → đến hạn khi giao xong, không lấy điều khoản khách.
    const term = (data.paymentTerms as { balanceTerm?: unknown } | undefined)?.balanceTerm;
    if (typeof term === 'string' && term.trim()) return 0;
  }
  return Math.min(paymentDaysOfTerm(customerTerm) ?? 0, 3650);
}
function safeJson(text: string) { try { const v = JSON.parse(text); return v && typeof v === 'object' ? v as Record<string, unknown> : null; } catch { return null; } }

/** Số ngày thanh toán phần còn lại của đơn (HĐKT → báo giá → khách → 0). */
export async function balancePaymentDays(db: ReadDb, order: { quoteId: string | null; customerId: string | null }, contract?: { paymentDays: number } | null) {
  if (contract) return contract.paymentDays;
  if (!order.quoteId) return 0;
  const [[quote], [customer]] = await Promise.all([
    db.select({ data: quotations.data }).from(quotations).where(eq(quotations.id, order.quoteId)).limit(1),
    order.customerId ? db.select({ term: customers.paymentTerm }).from(customers).where(eq(customers.id, order.customerId)).limit(1) : Promise.resolve([]),
  ]);
  return orderPaymentDays(quote?.data ?? null, (customer as { term: string | null } | undefined)?.term);
}

/** Ngày (giờ Việt Nam) của mốc thời gian ISO. */
export const vnDay = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10);

export interface DueRepair { id: string; orderId: string; no: string; customer: string; kind: 'deposit' | 'balance'; amount: number; from: string; to: string; reason: string }

/** Kỳ phải thu (cọc / phần còn lại) của đơn CRM còn nợ có hạn khác quy tắc hiện hành. `ids` = chỉ xét các kỳ này. */
export async function dueRepairs(db: ReadDb, ids?: string[]): Promise<DueRepair[]> {
  const rows = await db.select({ s: paymentSchedules, orderNo: salesOrders.orderNo, customer: salesOrders.customerName, quoteId: salesOrders.quoteId, customerId: salesOrders.customerId,
    orderStatus: salesOrders.status, total: salesOrders.total })
    .from(paymentSchedules).innerJoin(salesOrders, eq(salesOrders.id, paymentSchedules.orderId))
    .where(and(inArray(paymentSchedules.kind, ['deposit', 'balance']), isNotNull(paymentSchedules.dueDate), ne(salesOrders.status, 'cancelled'),
      sql`${salesOrders.channel} <> 'pos'`, isNotNull(salesOrders.quoteId), ...(ids ? [inArray(paymentSchedules.id, ids.length ? ids : [''])] : [])))
    .orderBy(salesOrders.orderNo).limit(5000);
  if (!rows.length) return [];
  const orderIds = [...new Set(rows.map(r => r.s.orderId))], quoteIds = [...new Set(rows.map(r => r.quoteId!).filter(Boolean))];
  const customerIds = [...new Set(rows.map(r => r.customerId).filter((v): v is string => !!v))];
  const [contracts, quotes, terms, delivered, paid, due] = await Promise.all([
    db.select().from(salesContracts).where(and(inArray(salesContracts.orderId, orderIds), ne(salesContracts.status, 'cancelled'))),
    db.select({ id: quotations.id, data: quotations.data }).from(quotations).where(inArray(quotations.id, quoteIds)),
    customerIds.length ? db.select({ id: customers.id, term: customers.paymentTerm }).from(customers).where(inArray(customers.id, customerIds)) : Promise.resolve([]),
    db.select({ orderId: deliveries.orderId, at: sql<string>`max(${deliveries.deliveredAt})` }).from(deliveries)
      .where(and(inArray(deliveries.orderId, orderIds), eq(deliveries.status, 'delivered'), isNotNull(deliveries.deliveredAt))).groupBy(deliveries.orderId),
    db.select({ orderId: customerPayments.orderId, sum: sql<number>`coalesce(sum(${customerPayments.amount}), 0)::float8` }).from(customerPayments)
      .where(and(inArray(customerPayments.orderId, orderIds), isNull(customerPayments.voidedAt))).groupBy(customerPayments.orderId),
    db.select({ orderId: paymentSchedules.orderId, sum: sql<number>`coalesce(sum(${paymentSchedules.amount}), 0)::float8` }).from(paymentSchedules)
      .where(inArray(paymentSchedules.orderId, orderIds)).groupBy(paymentSchedules.orderId),
  ]);
  const contractOf = new Map(contracts.map(k => [k.orderId, k])), quoteOf = new Map(quotes.map(q => [q.id, q.data]));
  const termOf = new Map((terms as { id: string; term: string | null }[]).map(t => [t.id, t.term])), deliveredOf = new Map(delivered.map(d => [d.orderId, d.at]));
  const paidOf = new Map(paid.map(p => [p.orderId, Number(p.sum)])), dueOf = new Map(due.map(p => [p.orderId, Number(p.sum)]));
  const out: DueRepair[] = [];
  for (const r of rows) {
    // Đơn đã thu đủ: hạn không còn ảnh hưởng quá hạn, không sửa lịch sử.
    if ((paidOf.get(r.s.orderId) ?? 0) >= (dueOf.get(r.s.orderId) ?? 0) - 0.5) continue;
    const k = contractOf.get(r.s.orderId);
    let to: string | null = null, reason = '';
    if (r.s.kind === 'deposit') {
      if (!k) continue;
      const signed = k.signedDate || vnDay(k.createdAt);
      to = addDays(signed, DEPOSIT_GRACE_DAYS);
      reason = `Cọc: ${k.signedDate ? 'ngày ký' : 'ngày lập HĐKT'} ${signed.split('-').reverse().join('/')} + ${DEPOSIT_GRACE_DAYS} ngày`;
    } else {
      const at = deliveredOf.get(r.s.orderId);
      if (r.orderStatus !== 'delivered' || !at) continue;
      const days = k ? k.paymentDays : orderPaymentDays(quoteOf.get(r.quoteId!) ?? null, r.customerId ? termOf.get(r.customerId) : null);
      to = addDays(vnDay(at), days);
      reason = `Giao xong ${vnDay(at).split('-').reverse().join('/')} + ${days} ngày (${k ? 'theo HĐKT' : 'theo báo giá / khách'})`;
    }
    if (to && to !== r.s.dueDate) out.push({ id: r.s.id, orderId: r.s.orderId, no: k?.contractNo || r.orderNo, customer: r.customer, kind: r.s.kind as 'deposit' | 'balance', amount: r.s.amount, from: r.s.dueDate!, to, reason });
  }
  return out;
}

export function registerPaymentDueRepairRoutes(router: Router<StaffEnv>) {
  const manager = (c: Ctx) => {
    const me = (c.state.session as SessionState).member;
    if (me.role !== 'manager') throw new AppError(403, 'Chỉ Manager được rà và sửa hạn công nợ.');
    return me;
  };
  router.get('/payment-due-repairs', async c => { manager(c); return json({ items: await dueRepairs(c.env.db) }); }, 'business');
  /** Áp dụng các kỳ đã chọn; kỳ đã đổi so với lúc xem trước (hạn hiện tại hoặc hạn đúng khác) thì bỏ qua. */
  router.post('/payment-due-repairs', async c => {
    const me = manager(c), body = await readJson<{ items?: unknown }>(c.req);
    const picked = Array.isArray(body.items) ? body.items.filter((i): i is { id: string; from: string; to: string } =>
      !!i && typeof i === 'object' && typeof (i as any).id === 'string' && typeof (i as any).from === 'string' && typeof (i as any).to === 'string').slice(0, 500) : [];
    if (!picked.length) throw new AppError(400, 'Chọn ít nhất một kỳ cần sửa hạn.');
    const result = await c.env.db.transaction(async tx => {
      const ids = [...new Set(picked.map(i => i.id))];
      await tx.select({ id: paymentSchedules.id }).from(paymentSchedules).where(inArray(paymentSchedules.id, ids)).for('update');
      const now = new Date(Date.now()).toISOString(), current = new Map((await dueRepairs(tx, ids)).map(r => [r.id, r]));
      let applied = 0, skipped = 0;
      for (const i of picked) {
        const r = current.get(i.id);
        if (!r || r.from !== i.from || r.to !== i.to) { skipped++; continue; }
        await tx.update(paymentSchedules).set({ dueDate: r.to }).where(and(eq(paymentSchedules.id, r.id), eq(paymentSchedules.dueDate, r.from)));
        await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorId: me.id, module: 'sales', action: 'payment-due-repair', entityType: 'payment_schedules', entityId: r.id,
          data: JSON.stringify({ orderId: r.orderId, no: r.no, kind: r.kind, from: r.from, to: r.to, reason: r.reason }), createdAt: now });
        current.delete(i.id); applied++;
      }
      return { applied, skipped };
    });
    return json(result);
  }, 'business');
}

/** Đơn đã giao xong: các kỳ "còn lại" chưa có hạn nhận hạn = ngày giao xong + số ngày thanh toán. */
export async function setBalanceDueOnDelivery(tx: Tx, order: { id: string; quoteId: string | null; customerId: string | null }, deliveredOn: string) {
  const [contract] = await tx.select().from(salesContracts).where(and(eq(salesContracts.orderId, order.id), ne(salesContracts.status, 'cancelled'))).orderBy(desc(salesContracts.createdAt)).limit(1);
  const days = await balancePaymentDays(tx, order, contract);
  await tx.update(paymentSchedules).set({ dueDate: addDays(deliveredOn, days) })
    .where(and(eq(paymentSchedules.orderId, order.id), eq(paymentSchedules.kind, 'balance'), isNull(paymentSchedules.dueDate)));
}
