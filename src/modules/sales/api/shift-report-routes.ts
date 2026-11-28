import { and, eq, inArray, sql } from "drizzle-orm";
import type { Router } from "../../../core/http/router.ts";
import { json } from "../../../core/http/router.ts";
import { AppError } from "../../../core/errors.ts";
import { fold, foldSql } from "../../../core/text/fold.ts";
import type { StaffEnv, SessionState } from "../../staff/api/auth-routes.ts";
import {
  shiftReportFilters,
  type ShiftReportsPage,
} from "../domain/shift-report-filters.ts";
import { vietnamDate } from "../domain/sales.ts";
import { posScope } from "./pos-access.ts";
import { posPermission } from "./pos-store.ts";
import { posShifts } from "../pos-schema.ts";

/** One statement / one read snapshot. Never fetch full saved reports or call shiftReport per row. */
export function registerShiftReportRoutes(router: Router<StaffEnv>): void {
  router.get(
    "/pos/shift-reports",
    async (c) => {
      const m = (c.state.session as SessionState).member;
      posPermission(m);
      const f = shiftReportFilters(c.url.searchParams, vietnamDate().iso);
      if (m.role !== "manager" && f.memberId && f.memberId !== m.id)
        throw new AppError(403, "Bạn chỉ được xem báo cáo ca của mình.");
      const scope = posScope(c),
        asOf = new Date().toISOString();
      const access = and(
        m.role === "manager" ? undefined : eq(posShifts.memberId, m.id),
        scope
          ? scope.registers.length
            ? inArray(posShifts.registerId, scope.registers)
            : sql`false`
          : undefined,
      );
      const where = sql`business_date between ${f.from} and ${f.to}
      and (${f.registerId}='' or register_id=${f.registerId}) and (${f.memberId}='' or member_id=${f.memberId})
      and (${f.templateId}='' or template_id=${f.templateId})
      and (${f.status}='all' or (${f.status}='open' and closed_at is null) or (${f.status}='closed' and closed_at is not null))
      and (${f.difference}='all' or (closed_at is not null and
        ((${f.difference}='matched' and cash_difference=0) or (${f.difference}='shortage' and cash_difference<0) or (${f.difference}='surplus' and cash_difference>0))))
      and (${f.q}='' or position(${fold(f.q)} in ${foldSql(sql`concat_ws(' ',id,register_name,member_name,note)`)})>0)`;
      const metricKeys = [
        "billCount",
        "revenue",
        "discount",
        "returnCredit",
        "cash",
        "transfer",
        "manualIn",
        "manualOut",
        "refundCash",
        "refundTransfer",
      ] as const;
      const sums = sql.join(
        metricKeys.map(
          (key) =>
            sql`coalesce(sum(${sql.identifier(key)}),0) as ${sql.identifier(key)}`,
        ),
        sql`, `,
      );
      const totals = sql`count(*)::int as "shiftCount", count(*) filter(where closed_at is null)::int as "openCount",
      count(*) filter(where closed_at is not null)::int as "closedCount",
      count(*) filter(where cash_difference<>0)::int as "differenceCount",
      coalesce(sum(cash_difference) filter(where cash_difference<0),0) as shortage,
      coalesce(sum(cash_difference) filter(where cash_difference>0),0) as surplus, ${sums}`;
      const query = sql`with allowed as not materialized (
      select ${posShifts}.*, r.name register_name, coalesce(e.name,'Nhân viên không còn trong danh mục') member_name, t.name template_name
      from ${posShifts} join pos_registers r on r.id=register_id left join staff_members e on e.id=member_id
      left join pos_shift_templates t on t.id=template_id where ${access ?? sql`true`}
    ), filtered as materialized (
      select id,business_date,register_id,member_id,register_name,member_name,template_name,
        opened_at,closed_at,opening_cash,counted_cash,cash_difference,difference_reason,expected_cash,
        snap.bills snapshot_bills,snap.cash snapshot_cash,snap.transfer snapshot_transfer,
        snap.manual snapshot_manual,snap.returns snapshot_returns,snap."expectedCash" snapshot_expected
      from allowed left join lateral jsonb_to_record(coalesce(report_snapshot,'{}')::jsonb)
        as snap(bills jsonb,cash numeric,transfer numeric,manual jsonb,returns jsonb,"expectedCash" numeric) on true
      where ${where}
    ),
    live as (select id from filtered where closed_at is null),
    pay as (select shift_id, coalesce(sum(amount) filter(where method='cash'),0) cash,
      coalesce(sum(amount) filter(where method='transfer'),0) transfer from customer_payments
      where shift_id in(select id from live) and created_at<=${asOf} and (voided_at is null or voided_at>${asOf}) group by shift_id),
    orders as materialized (select id,shift_id,total from sales_orders where shift_id in(select id from live)
      and (status<>'cancelled' or pos_snapshot::jsonb->'quickCancellation' is not null) and created_at<=${asOf}),
    bills as (select shift_id,count(*)::int n,sum(total) revenue from orders group by shift_id),
    discounts as (select o.shift_id,sum(l.discount_amount) amount from orders o join sales_order_lines l on l.order_id=o.id group by o.shift_id),
    returns as (select received_shift_id shift_id,sum(total) amount from pos_returns where received_shift_id in(select id from live) and credit_effective_at<=${asOf} group by received_shift_id),
    refunds as (select shift_id,sum(amount) filter(where method='cash') cash,sum(amount) filter(where method='transfer') transfer from pos_refunds
      where shift_id in(select id from live) and confirmed_at<=${asOf} and (voided_at is null or voided_at>${asOf}) group by shift_id),
    manual as (select ce.shift_id,
      coalesce(sum(ce.amount) filter(where ce.kind<>'adjustment' and ce.direction='in'),0) income,
      coalesce(sum(ce.amount) filter(where ce.kind<>'adjustment' and ce.direction='out'),0) expense,
      coalesce(sum(case when ce.direction='in' then ce.amount else -ce.amount end)
        filter(where ce.kind='adjustment' and (cr.shift_id is null or cr.shift_id=ce.shift_id)),0) adjustment
      from cash_entries ce left join cash_reconciliations cr on cr.id=ce.reconciliation_id
      where ce.shift_id in(select id from live) and ce.status='posted' and ce.created_at<=${asOf} group by ce.shift_id),
    facts as (select f.id, f.business_date, f.register_id, f.member_id, f.register_name, f.member_name, f.template_name,
      f.opened_at, f.closed_at, f.opening_cash, f.counted_cash, f.cash_difference, f.difference_reason,
      case when f.closed_at is not null then coalesce((f.snapshot_bills->>'count')::numeric,0) else coalesce(b.n,0) end "billCount",
      case when f.closed_at is not null then coalesce((f.snapshot_bills->>'revenue')::numeric,0) else coalesce(b.revenue,0) end revenue,
      case when f.closed_at is not null then coalesce((f.snapshot_bills->>'discount')::numeric,0) else coalesce(d.amount,0) end discount,
      case when f.closed_at is not null then coalesce((f.snapshot_returns->>'credit')::numeric,0) else coalesce(rt.amount,0) end "returnCredit",
      case when f.closed_at is not null then coalesce(f.snapshot_cash,0) else coalesce(p.cash,0) end cash,
      case when f.closed_at is not null then coalesce(f.snapshot_transfer,0) else coalesce(p.transfer,0) end transfer,
      case when f.closed_at is not null then coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(f.snapshot_manual) x where x->>'direction'='in'),0) else coalesce(ma.income,0) end "manualIn",
      case when f.closed_at is not null then coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(f.snapshot_manual) x where x->>'direction'='out'),0) else coalesce(ma.expense,0) end "manualOut",
      case when f.closed_at is not null then coalesce((f.snapshot_returns->>'refundedCash')::numeric,0) else coalesce(rf.cash,0) end "refundCash",
      case when f.closed_at is not null then coalesce((f.snapshot_returns->>'refundedTransfer')::numeric,0) else coalesce(rf.transfer,0) end "refundTransfer",
      case when f.closed_at is not null then coalesce(f.snapshot_expected,f.expected_cash) else f.opening_cash+coalesce(p.cash,0)+coalesce(ma.income,0)-coalesce(ma.expense,0)+coalesce(ma.adjustment,0) end expected_cash
      from filtered f left join pay p on p.shift_id=f.id left join bills b on b.shift_id=f.id left join discounts d on d.shift_id=f.id
      left join returns rt on rt.shift_id=f.id left join refunds rf on rf.shift_id=f.id left join manual ma on ma.shift_id=f.id),
    grouped as (select *, case ${f.groupBy} when 'member' then member_id when 'day' then business_date else register_id end group_id,
      case ${f.groupBy} when 'member' then member_name when 'day' then business_date else register_name end group_name from facts),
    page as (select * from facts order by opened_at desc,id desc limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}),
    groups as (select group_id id,group_name name,${totals} from grouped group by group_id,group_name)
    select jsonb_build_object('summary',(select to_jsonb(s) from(select ${totals} from facts) s),
      'rows',coalesce((select jsonb_agg(to_jsonb(p) order by opened_at desc,id desc) from page p),'[]'::jsonb),
      'groups',coalesce((select jsonb_agg(to_jsonb(g) order by name,id) from groups g),'[]'::jsonb),
      'registers',coalesce((select jsonb_agg(x order by x->>'name') from(select distinct jsonb_build_object('id',register_id,'name',register_name) x from allowed) r),'[]'::jsonb),
      'members',coalesce((select jsonb_agg(x order by x->>'name') from(select distinct jsonb_build_object('id',member_id,'name',member_name) x from allowed) e),'[]'::jsonb),
      'templates',coalesce((select jsonb_agg(x order by x->>'name') from(select distinct jsonb_build_object('id',template_id,'name',template_name) x from allowed) t),'[]'::jsonb)) payload`;
      const [result] = await c.env.db
        .select({
          payload: sql<
            Omit<ShiftReportsPage, "filters" | "asOf" | "scope">
          >`payload`,
        })
        .from(sql`(${query}) report`);
      return json({
        ...result!.payload,
        filters: f,
        asOf,
        scope: m.role === "manager" ? "all" : "own",
      });
    },
    "business",
  );
}
