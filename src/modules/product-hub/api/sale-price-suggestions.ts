import { and, inArray, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, type Router } from '../../../core/http/router.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { can } from '../../staff/domain/permissions.ts';
import { salesOrders as o, salesOrderLines as l, salesContracts as k } from '../../sales/schema.ts';
import { posReturns as r, posReturnLines as rl } from '../../sales/return-schema.ts';
import { orderScopeFor } from '../../sales/api/routes.ts';

/** One bounded, scoped batch. Historical snapshots, never the 20-row movement cache or current quote prices. */
export function registerSalePriceSuggestions(router: Router<StaffEnv>) {
  router.get('/products/quote-tools/sale-price-suggestions', async c => {
    const m = (c.state.session as SessionState).member;
    if (!can(m, 'page.quotes')) throw new AppError(403, 'Chưa có quyền xem giá đề xuất báo giá.');
    const raw = c.url.searchParams.getAll('sku');
    if (!raw.length || raw.length > 300 || raw.some(s => !s.trim() || s.length > 200)) throw new AppError(400, 'Chọn từ 1 đến 300 mã sản phẩm.');
    const skus = [...new Set(raw.map(s => s.trim()))], now = new Date();
    const to = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const start = new Date(to + 'T00:00:00Z'); start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth() - 6);
    const endOfMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(Number(to.slice(8)), endOfMonth));
    const from = start.toISOString().slice(0, 10);
    const result = await c.env.db.execute(sql`
      with scoped as materialized (
        select ${l.id} id, ${l.sku} sku, ${l.orderId} order_id, ${l.qty} qty,
          case when ${o.channel} = 'crm' then
            case when ${l.listUnitPrice} is not null then greatest(0, ${l.listUnitPrice} - ${l.discountAmount} / ${l.qty}) end
            else ${l.unitPrice} end price
        from ${l} join ${o} on ${o.id} = ${l.orderId} left join ${k} on ${k.orderId} = ${o.id}
        where ${and(inArray(l.sku, skus), orderScopeFor(m), sql`${o.orderDate} >= ${from}`, sql`${o.orderDate} <= ${to}`,
          sql`${o.status} <> 'cancelled' and (${o.status} <> 'draft' or ${k.status} in ('signed', 'completed'))`)}
      ), credited as (
        select ${rl.orderLineId} line_id, sum(${rl.requestedQty}) qty
        from ${rl} join scoped s on s.id = ${rl.orderLineId} join ${r} on ${r.id} = ${rl.returnId}
        where ${r.creditEffectiveAt} is not null and ${r.creditEffectiveAt} <= ${now.toISOString()}
        group by ${rl.orderLineId}
      ), kept as (
        select s.*, greatest(0, s.qty - coalesce(c.qty, 0)) kept_qty from scoped s left join credited c on c.line_id = s.id
      )
      select sku, sum(price * kept_qty) / nullif(sum(kept_qty), 0) average,
        sum(kept_qty) quantity, count(distinct order_id)::int orders
      from kept where price is not null and kept_qty > 0 group by sku
    `);
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { sku: string; average: number; quantity: number; orders: number }[];
    return json({ from, to, basis: 'weighted-net-excluding-print', scope: 'visible-orders', prices: rows.map(row => ({ sku: row.sku, average: Number(row.average), quantity: Number(row.quantity), orders: Number(row.orders) })) });
  }, 'business');
}
