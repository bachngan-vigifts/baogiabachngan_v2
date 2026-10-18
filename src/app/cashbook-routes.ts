import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Router } from '../core/http/router.ts';
import { json } from '../core/http/router.ts';
import { AppError } from '../core/errors.ts';
import type { SessionState, StaffEnv } from '../modules/staff/api/auth-routes.ts';
import { employees } from '../modules/staff/schema.ts';
import { can } from '../modules/staff/domain/permissions.ts';
import { customerPayments, salesContracts, salesOrders } from '../modules/sales/schema.ts';
import { incomingShipments, supplierPayments } from '../modules/suppliers/schema.ts';
import { docRef } from '../modules/sales/domain/doc-ref.ts';

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const MAX_DAYS = 400;

/**
 * SỔ THU / CHI (quyền "Sổ thu / chi" – mặc định Kế toán, Sale Admin; Manager luôn có):
 * phiếu thu khách (customer_payments) + phiếu chi NCC (supplier_payments) trong khoảng ngày, xếp theo ngày – để đối soát sao kê ngân hàng.
 * Phiếu đã huỷ vẫn trả về (đánh dấu `voided`) nhưng không cộng vào tổng. `GET /cashbook?from=YYYY-MM-DD&to=YYYY-MM-DD` (tối đa ~13 tháng).
 */
export function registerCashbookRoutes(router: Router<StaffEnv>) {
  router.get('/cashbook', async c => {
    const me = (c.state.session as SessionState).member;
    if (!can(me, 'page.cashbook')) throw new AppError(403, 'Bạn không có quyền xem sổ thu / chi.');
    const p = c.url.searchParams, from = p.get('from'), to = p.get('to');
    if (!isDate(from) || !isDate(to) || to < from) throw new AppError(400, 'Chọn khoảng ngày hợp lệ.');
    if ((Date.parse(to) - Date.parse(from)) / 864e5 > MAX_DAYS) throw new AppError(400, 'Khoảng ngày tối đa khoảng 13 tháng.');
    const db = c.env.db;
    const [ins, outs] = await Promise.all([
      db.select({ p: customerPayments, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName }).from(customerPayments)
        .innerJoin(salesOrders, eq(salesOrders.id, customerPayments.orderId))
        .where(and(gte(customerPayments.paidAt, from), lte(customerPayments.paidAt, to))).orderBy(asc(customerPayments.paidAt), asc(customerPayments.createdAt)),
      db.select({ p: supplierPayments, ticketNumber: incomingShipments.ticketNumber, supplierName: incomingShipments.supplierName }).from(supplierPayments)
        .innerJoin(incomingShipments, eq(incomingShipments.id, supplierPayments.shipmentId))
        .where(and(gte(supplierPayments.paidDate, from), lte(supplierPayments.paidDate, to))).orderBy(asc(supplierPayments.paidDate), asc(supplierPayments.createdAt)),
    ]);
    const orderIds = [...new Set(ins.map(r => r.p.orderId))], people = [...new Set([...ins, ...outs].map(r => r.p.createdBy))];
    const [contracts, names] = await Promise.all([
      orderIds.length ? db.select({ orderId: salesContracts.orderId, no: salesContracts.contractNo }).from(salesContracts).where(inArray(salesContracts.orderId, orderIds)) : [],
      people.length ? db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, people)) : [],
    ]);
    const name = (id: string) => names.find(n => n.id === id)?.name ?? '';
    const entries = [
      ...ins.map(({ p: x, orderNo, customerName }) => {
        const ref = docRef(x.orderId, orderNo, contracts.find(k => k.orderId === x.orderId)?.no);
        return { id: x.id, kind: 'in' as const, date: x.paidAt, amount: x.amount, method: x.method, reference: x.reference, note: x.note, partner: customerName,
          docNo: ref.Label, link: ref.link, createdByName: name(x.createdBy), voided: !!x.voidedAt, voidReason: x.voidReason };
      }),
      ...outs.map(({ p: x, ticketNumber, supplierName }) => ({ id: x.id, kind: 'out' as const, date: x.paidDate, amount: x.amount, method: x.method, reference: x.reference, note: x.note,
        partner: supplierName, docNo: ticketNumber, link: `#/purchases/${x.shipmentId}`, createdByName: name(x.createdBy), voided: !!x.voidedAt, voidReason: x.voidReason })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
    const sum = (kind: 'in' | 'out', method?: string) => entries.filter(e => e.kind === kind && !e.voided && (!method || e.method === method)).reduce((t, e) => t + e.amount, 0);
    return json({ from, to, entries, totals: { in: sum('in'), out: sum('out'), net: sum('in') - sum('out'),
      byMethod: Object.fromEntries(['transfer', 'cash', 'other'].map(m => [m, { in: sum('in', m), out: sum('out', m) }])) } });
  }, 'business');
}
