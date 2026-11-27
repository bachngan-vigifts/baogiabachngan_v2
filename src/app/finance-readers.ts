import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { AnyDb } from "../core/db/client.ts";
import { AppError } from "../core/errors.ts";
import {
  customerPayments,
  paymentSchedules,
  salesOrders,
  salesContracts,
} from "../modules/sales/schema.ts";
import { supplierPayments } from "../modules/suppliers/schema.ts";
import { posRegisters, posShifts } from "../modules/sales/pos-schema.ts";
import { cashEntries } from "../modules/sales/cash-schema.ts";
import { posReturns, posRefunds } from "../modules/sales/return-schema.ts";
import { cashEntryClasses } from "../modules/profit/schema.ts";
import {
  classifyCashEntry,
  type CashClass,
} from "../modules/profit/domain/branch-costs.ts";
import { receivable, debtAging } from "../modules/sales/domain/sales.ts";
import {
  netReturnInputs,
  returnAdjustments,
} from "../modules/sales/api/pos-return-credit.ts";
import {financeGhnSettlements} from './finance-ghn.ts';
type Db = AnyDb | Parameters<Parameters<AnyDb["transaction"]>[0]>[0];
export interface FinanceRange {
  from: string;
  to: string;
  branch: string;
}
const branchOf = sql<
  string | null
>`case when ${salesOrders.channel}<>'pos' then 'crm' else ${posShifts.registerId} end`;

/** Canonical physical money movements. Receipts/refunds appear once; internal transfers stay separate. */
export async function financeCashflow(db: Db, f: FinanceRange) {
  const start = new Date(f.from + "T00:00:00+07:00").toISOString(),
    end = new Date(
      Date.parse(f.to + "T00:00:00+07:00") + 86400000,
    ).toISOString();
  const sum = sql<number>`coalesce(sum(amount),0)`.mapWith(Number);
  const [receipts, suppliers, refunds, manual] = await Promise.all([
    db
      .select({
        branch: branchOf,
        method: customerPayments.method,
        source: customerPayments.paymentSource,
        amount: sql<number>`sum(${customerPayments.amount})`.mapWith(Number),
      })
      .from(customerPayments)
      .innerJoin(salesOrders, eq(salesOrders.id, customerPayments.orderId))
      .leftJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
      .where(
        and(
          gte(customerPayments.paidAt, f.from),
          lte(customerPayments.paidAt, f.to),
          isNull(customerPayments.voidedAt),
          ne(customerPayments.paymentSource, "pos_exchange_credit"), ne(customerPayments.paymentSource, 'ghn_fee_offset'),
        ),
      )
      .groupBy(
        branchOf,
        customerPayments.method,
        customerPayments.paymentSource,
      ),
    db
      .select({ method: supplierPayments.method, amount: sum })
      .from(supplierPayments)
      .where(
        and(
          gte(supplierPayments.paidDate, f.from),
          lte(supplierPayments.paidDate, f.to),
          isNull(supplierPayments.voidedAt),
        ),
      )
      .groupBy(supplierPayments.method),
    db
      .select({
        branch: branchOf,
        method: posRefunds.method,
        amount: sql<number>`sum(${posRefunds.amount})`.mapWith(Number),
      })
      .from(posRefunds)
      .innerJoin(posReturns, eq(posReturns.id, posRefunds.returnId))
      .innerJoin(salesOrders, eq(salesOrders.id, posReturns.orderId))
      .leftJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
      .where(
        and(
          gte(posRefunds.confirmedAt, start),
          lt(posRefunds.confirmedAt, end),
        ),
      )
      .groupBy(branchOf, posRefunds.method),
    db
      .select({
        id: cashEntries.id,
        kind: cashEntries.kind,
        reason: cashEntries.reason,
        direction: cashEntries.direction,
        amount: cashEntries.amount,
        branch: posShifts.registerId,
        classification: cashEntryClasses.cls,
      })
      .from(cashEntries)
      .innerJoin(posShifts, eq(posShifts.id, cashEntries.shiftId))
      .leftJoin(cashEntryClasses, eq(cashEntryClasses.entryId, cashEntries.id))
      .where(
        and(
          eq(cashEntries.status, "posted"),
          f.branch ? eq(posShifts.registerId, f.branch) : undefined,
          gte(cashEntries.createdAt, start),
          lt(cashEntries.createdAt, end),
          sql`not exists(select 1 from ${posRefunds} where ${posRefunds.cashEntryId}=${cashEntries.id})`,
        ),
      )
      .limit(10001),
  ]);
  if (manual.length > 10000)
    throw new AppError(
      422,
      "Phạm vi vượt 10.000 phiếu quỹ. Chọn khoảng ngày ngắn hơn.",
    );
  const methods = new Map<string, { in: number; out: number }>();
  const result = {
    in: 0,
    out: 0,
    net: 0,
    transfersIn: 0,
    transfersOut: 0,
    adjustments: 0,
    unassignedIn: 0,
    unassignedOut: 0,
    unassignedSupplier: 0,
    classificationReview: 0,
    unlinkedOut: 0,
    carrierCollected: 0,
    ghnSettled: await financeGhnSettlements(db,f),
    otherReceipts: 0,
    otherSupplier: 0,
    byMethod: [] as { method: string; in: number; out: number }[],
  };
  const add = (
    branch: string | null,
    method: string,
    direction: "in" | "out",
    amount: number,
  ) => {
    if (branch === null) {
      if (direction === "out") result.unassignedOut += amount;
      else result.unassignedIn += amount;
    }
    if (f.branch && branch !== f.branch) return;
    result[direction] += amount;
    const row = methods.get(method) || { in: 0, out: 0 };
    row[direction] += amount;
    methods.set(method, row);
  };
  for (const r of receipts) {
    if (r.source === "ghn_cod" || r.method === "other") {
      if (!f.branch || r.branch === f.branch) {
        if (r.source === "ghn_cod") result.carrierCollected += r.amount;
        else result.otherReceipts += r.amount;
      }
    } else add(r.branch, r.method, "in", r.amount);
  }
  for (const r of suppliers) {
    if (r.method === "other") {
      result.otherSupplier += r.amount;
      continue;
    }
    result.unassignedSupplier += r.amount;
    add(null, r.method, "out", r.amount);
  }
  for (const r of refunds) add(r.branch, r.method, "out", r.amount);
  for (const r of manual) {
    const inferred = classifyCashEntry(r),
      cls = (
        r.kind === "petty_expense" ? r.classification || inferred : inferred
      ) as CashClass;
    if (f.branch && r.branch !== f.branch) continue;
    if (
      !r.classification &&
      r.kind === "petty_expense" &&
      inferred !== "operating"
    )
      result.classificationReview++;
    if (cls === "transfer") {
      if (r.direction === "in") result.transfersIn += r.amount;
      else result.transfersOut += r.amount;
      continue;
    }
    if (cls === "adjustment") {
      result.adjustments += r.direction === "in" ? r.amount : -r.amount;
      continue;
    }
    // No reliable link exists between these old manual vouchers and canonical payments/refunds.
    // Return the book sum, but prevent the UI from presenting it as reconciled physical cash.
    if (r.direction === "out" && (cls === "supplier" || cls === "refund"))
      result.unlinkedOut += r.amount;
    add(r.branch, "cash", r.direction as "in" | "out", r.amount);
  }
  result.net = result.in - result.out;
  result.byMethod = [...methods].map(([method, values]) => ({
    method,
    ...values,
  }));
  return result;
}

/** Same pure receivable/return rules as the receivables screen; all rows, no page-limit totals. */
export async function financeReceivables(
  db: Db,
  branch: string,
  today: string,
) {
  const orders = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .leftJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
    .where(
      and(
        ne(salesOrders.status, "cancelled"),
        or(
          ne(salesOrders.status, "draft"),
          sql`exists(select 1 from ${salesContracts} where ${salesContracts.orderId}=${salesOrders.id} and ${salesContracts.status} in ('signed','completed'))`,
        ),
        branch ? eq(branchOf, branch) : undefined,
      ),
    )
    .limit(10001);
  if (orders.length > 10000)
    throw new AppError(
      422,
      "Phạm vi công nợ vượt 10.000 đơn. Chọn một chi nhánh để xem đủ số liệu.",
    );
  const out = { orders: 0, balance: 0, overdue: 0, d30: 0, d60: 0, over60: 0 };
  if (!orders.length) return out;
  const ids = orders.map((o) => o.id);
  const [schedules, payments, adjustments] = await Promise.all([
    db
      .select({
        orderId: paymentSchedules.orderId,
        amount: paymentSchedules.amount,
        dueDate: paymentSchedules.dueDate,
      })
      .from(paymentSchedules)
      .where(inArray(paymentSchedules.orderId, ids)),
    db
      .select({
        orderId: customerPayments.orderId,
        amount: customerPayments.amount,
      })
      .from(customerPayments)
      .where(
        and(
          inArray(customerPayments.orderId, ids),
          isNull(customerPayments.voidedAt),
        ),
      ),
    returnAdjustments(db, ids),
  ]);
  const grouped = <T extends { orderId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const a = map.get(row.orderId) || [];
      a.push(row);
      map.set(row.orderId, a);
    }
    return map;
  };
  const sch = grouped(schedules),
    pay = grouped(payments);
  for (const { id } of orders) {
    const net = netReturnInputs(
      sch.get(id) || [],
      pay.get(id) || [],
      adjustments.get(id),
    );
    const r = receivable(net.schedules, net.payments, today);
    if (r.status === "none" || r.balance <= 0) continue;
    const age = debtAging(net.schedules, net.payments, today).buckets;
    out.orders++;
    out.balance += r.balance;
    out.overdue += r.overdue;
    out.d30 += age.d30;
    out.d60 += age.d60;
    out.over60 += age.over60;
  }
  return out;
}

export async function financeBranches(db: Db) {
  const regs = await db
    .select({ id: posRegisters.id, name: posRegisters.name })
    .from(posRegisters)
    .orderBy(asc(posRegisters.name));
  return [{ id: "crm", name: "Văn phòng / CRM" }, ...regs];
}

export async function assertFinanceBranch(
  db: Db,
  branch: string,
): Promise<void> {
  if (!branch || branch === "crm") return;
  const [row] = await db
    .select({ id: posRegisters.id })
    .from(posRegisters)
    .where(eq(posRegisters.id, branch))
    .limit(1);
  if (!row) throw new AppError(400, "Chi nhánh không tồn tại.");
}
