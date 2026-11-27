import { and, eq, gte, inArray, isNull, like, lt, ne, sql } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { customerPayments, salesOrders } from '../../sales/schema.ts';
import { supplierPayments } from '../../suppliers/schema.ts';
import { cashEntries } from '../../sales/cash-schema.ts';
import { webNotifications } from '../../notifications/schema.ts';
import { netReceivables } from '../../sales/api/pos-return-credit.ts';
import { notifyMany } from '../../notifications/api/routes.ts';
import { tasks } from '../schema.ts';
import { OPEN_STATUSES, addDaysIso } from '../domain/task-config.ts';
type Db = StaffEnv['db'];

export const DAILY_SUMMARY_EVENT = 'accounting_daily_summary';
/** Khoảng giờ UTC của một ngày Việt Nam (UTC+7): [D-1 17:00Z, D 17:00Z). */
const vnDayRange = (date: string) => [addDaysIso(date, -1) + 'T17:00:00.000Z', date + 'T17:00:00.000Z'] as const;

/**
 * TÓM TẮT CUỐI NGÀY (Kế toán / Manager) – chỉ đọc. Số liệu của ngày `date` (giờ Việt Nam):
 * thu khách theo hình thức, trả NCC, tiền vào / ra két, hoá đơn đã xuất trong ngày và còn chờ xuất,
 * nợ quá hạn đang theo dõi (việc "Thu nợ" đang mở – cùng số trên trang Việc kế toán), kỳ trả NCC sắp đến hạn.
 */
export async function dailySummary(db: Db, date: string, today = date) {
  const [from, to] = vnDayRange(date);
  const pay = await db.select({ method: customerPayments.method, amount: sql<number>`coalesce(sum(${customerPayments.amount}),0)::float8`, n: sql<number>`count(*)::int` })
    .from(customerPayments).where(and(ne(customerPayments.paymentSource, 'ghn_fee_offset'), eq(customerPayments.paidAt, date), isNull(customerPayments.voidedAt))).groupBy(customerPayments.method);
  const [sup] = await db.select({ amount: sql<number>`coalesce(sum(${supplierPayments.amount}),0)::float8`, n: sql<number>`count(*)::int` })
    .from(supplierPayments).where(and(eq(supplierPayments.paidDate, date), isNull(supplierPayments.voidedAt)));
  const cash = await db.select({ direction: cashEntries.direction, amount: sql<number>`coalesce(sum(${cashEntries.amount}),0)::float8`, n: sql<number>`count(*)::int` })
    .from(cashEntries).where(and(ne(cashEntries.status, 'voided'), gte(cashEntries.createdAt, from), lt(cashEntries.createdAt, to))).groupBy(cashEntries.direction);
  const [issued] = await db.select({ n: sql<number>`count(*)::int` }).from(salesOrders).where(and(eq(salesOrders.invoiceStatus, 'issued'), gte(salesOrders.invoiceIssuedAt, from), lt(salesOrders.invoiceIssuedAt, to)));
  const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(salesOrders).where(and(eq(salesOrders.invoiceStatus, 'requested'), ne(salesOrders.status, 'cancelled')));
  const open = and(inArray(tasks.status, [...OPEN_STATUSES]));
  const debtIds = [...new Set((await db.select({ id: tasks.sourceId }).from(tasks).where(and(open, like(tasks.autoKey, 'debt-overdue-acc:%')))).map(r => r.id).filter((x): x is string => !!x))];
  const net = debtIds.length ? await netReceivables(db, debtIds, today) : new Map();
  const overdue = [...net.values()].reduce((s, r) => s + (r.overdue || 0), 0);
  const [supplierDue] = await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(open, like(tasks.autoKey, 'po-pay:%')));
  const byMethod = Object.fromEntries(pay.map(p => [p.method, { amount: Number(p.amount), count: p.n }]));
  const cashIn = cash.find(x => x.direction === 'in'), cashOut = cash.find(x => x.direction === 'out');
  return {
    date,
    customerReceipts: { amount: pay.reduce((s, p) => s + Number(p.amount), 0), count: pay.reduce((s, p) => s + p.n, 0), byMethod },
    supplierPayments: { amount: Number(sup?.amount ?? 0), count: sup?.n ?? 0 },
    cash: { in: Number(cashIn?.amount ?? 0), out: Number(cashOut?.amount ?? 0), count: (cashIn?.n ?? 0) + (cashOut?.n ?? 0) },
    invoices: { issuedToday: issued?.n ?? 0, pending: pending?.n ?? 0 },
    overdue: { amount: overdue, orders: [...net.values()].filter(r => r.overdue > 0).length },
    supplierDue: supplierDue?.n ?? 0,
  };
}
const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN') + ' đ';
export function dailySummaryText(s: Awaited<ReturnType<typeof dailySummary>>) {
  const m = s.customerReceipts.byMethod, part = (k: string, label: string) => m[k]?.amount ? `${label} ${vnd(m[k].amount)}` : '';
  const split = [part('transfer', 'CK'), part('cash', 'TM'), part('other', 'khác')].filter(Boolean).join(' · ');
  return [
    `Thu khách ${vnd(s.customerReceipts.amount)}${split ? ` (${split})` : ''}`,
    `Trả NCC ${vnd(s.supplierPayments.amount)}`,
    `Két: vào ${vnd(s.cash.in)}, ra ${vnd(s.cash.out)}`,
    `Hoá đơn: đã xuất ${s.invoices.issuedToday}, chờ xuất ${s.invoices.pending}`,
    `Nợ quá hạn ${vnd(s.overdue.amount)} (${s.overdue.orders} đơn)` + (s.supplierDue ? ` · ${s.supplierDue} kỳ trả NCC sắp đến hạn` : ''),
  ].join('\n');
}
/** Gửi Manager một lần mỗi ngày (cron chạy lại / chạy trùng không gửi lần hai). Trả `sent: false` nếu hôm đó đã gửi. */
export async function sendDailySummary(env: StaffEnv, date: string) {
  const [prior] = await env.db.select({ id: webNotifications.id }).from(webNotifications)
    .where(and(eq(webNotifications.eventType, DAILY_SUMMARY_EVENT), like(webNotifications.dataJson, `%"date":"${date}"%`))).limit(1);
  if (prior) return { sent: false, recipients: 0 };
  const summary = await dailySummary(env.db, date);
  const recipients = await notifyMany(env, 'managers', { eventType: DAILY_SUMMARY_EVENT, title: `Tóm tắt thu chi ngày ${date.split('-').reverse().join('/')}`,
    body: dailySummaryText(summary), url: '/index.html#/tasks', data: { date } });
  return { sent: true, recipients, summary };
}
