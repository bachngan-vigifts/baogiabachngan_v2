import { and, count, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { Router } from '../core/http/router.ts';
import { json } from '../core/http/router.ts';
import { AppError } from '../core/errors.ts';
import type { SessionState, StaffEnv } from '../modules/staff/api/auth-routes.ts';
import { salesOrders } from '../modules/sales/schema.ts';
import { hrPayslips } from '../modules/hr/schema.ts';

/** Inclusive month range, limited to 12 months to bound report work. */
export function reportMonths(params: URLSearchParams) {
  const from = params.get('from') ?? '', to = params.get('to') ?? '';
  const valid = (v: string) => /^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(v);
  if (!valid(from) || !valid(to)) throw new AppError(400, 'from và to phải có dạng YYYY-MM.');
  const ordinal = (v: string) => Number(v.slice(0, 4)) * 12 + Number(v.slice(5)) - 1;
  const start = ordinal(from), end = ordinal(to);
  if (end < start || end - start >= 12) throw new AppError(400, 'Kỳ báo cáo phải từ 1 đến 12 tháng.');
  const format = (n: number) => `${Math.floor(n / 12).toString().padStart(4, '0')}-${(n % 12 + 1).toString().padStart(2, '0')}`;
  return { from, to, next: format(end + 1), months: Array.from({ length: end - start + 1 }, (_, i) => format(start + i)) };
}

/** Internal management report: order value and confirmed payroll, never bank details. */
export function registerReportRoutes(router: Router<StaffEnv>) {
  router.get('/reports/business', async c => {
    const me = (c.state.session as SessionState | undefined)?.member;
    if (!me) throw new AppError(401, 'Vui lòng đăng nhập.');
    if (me.role !== 'manager') throw new AppError(403, 'Chỉ Manager được xem báo cáo nội bộ.');
    const f = reportMonths(c.url.searchParams);
    const rows = await c.env.db.transaction(async db => {
      const month = sql<string>`substr(${salesOrders.orderDate}, 1, 7)`;
      // Aggregate independently: joining orders to payslips would multiply both totals.
      const sales = await db.select({ month, orders: count(),
        subtotal: sql<number>`sum(${salesOrders.subtotal})`.mapWith(Number),
        total: sql<number>`sum(${salesOrders.total})`.mapWith(Number),
      }).from(salesOrders).where(and(gte(salesOrders.orderDate, f.from + '-01'),
        lt(salesOrders.orderDate, f.next + '-01'), inArray(salesOrders.status, ['confirmed', 'delivering', 'delivered'])))
        .groupBy(month);
      const payroll = await db.select({ month: hrPayslips.month, payslips: count(),
        gross: sql<number>`sum(${hrPayslips.gross})`.mapWith(Number),
        deductions: sql<number>`sum(${hrPayslips.deductionTotal})`.mapWith(Number),
        net: sql<number>`sum(${hrPayslips.net})`.mapWith(Number),
        paid: sql<number>`coalesce(sum(${hrPayslips.net}) filter (where ${hrPayslips.status} = 'paid'), 0)`.mapWith(Number),
      }).from(hrPayslips).where(and(gte(hrPayslips.month, f.from), lte(hrPayslips.month, f.to)))
        .groupBy(hrPayslips.month);
      return f.months.map(month => {
        const s = sales.find(r => r.month === month), p = payroll.find(r => r.month === month);
        return { month, sales: { orders: s?.orders ?? 0, subtotal: s?.subtotal ?? 0, total: s?.total ?? 0 },
          payroll: { payslips: p?.payslips ?? 0, gross: p?.gross ?? 0, deductions: p?.deductions ?? 0, net: p?.net ?? 0, paid: p?.paid ?? 0 } };
      });
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    return json({ from: f.from, to: f.to, rows });
  }, 'admin');
}
