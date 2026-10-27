import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { purchaseEarlyRequests as requests, purchaseEarlyRequestLines as lines, purchaseEarlyRequestAllocations as allocations } from '../early-request-schema.ts';
import { incomingShipments, incomingShipmentLines, suppliers } from '../schema.ts';
import { isIsoDate } from '../domain/quantity.ts';

/** Filter headers before pagination; lines belonging to a matching request stay complete. */
export function earlyListFilter(params: URLSearchParams, supplierId: string | null) {
  const q = (params.get('q') || '').trim(), status = params.get('status') || '', dateBy = params.get('dateBy') || 'pickup';
  const from = params.get('from') || '', to = params.get('to') || '';
  const offset = Number(params.get('offset') || 0), limit = Number(params.get('limit') || 50);
  if (q.length > 200 || !['', 'draft', 'submitted', 'pending', 'accepted', 'rejected', 'mixed'].includes(status)
    || !['pickup', 'created'].includes(dateBy) || from && !isIsoDate(from) || to && !isIsoDate(to) || from && to && from > to
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new AppError(400, 'Bộ lọc phiếu lấy hàng trước không hợp lệ.');
  const own = supplierId ? sql`and a.supplier_id=${supplierId}` : sql``;
  const hasStatus = (value: string) => sql`exists(select 1 from ${lines} l join ${allocations} a on a.request_line_id=l.id where l.request_id=${requests.id} ${own} and a.status=${value})`;
  const state = status === 'draft' || status === 'submitted' ? eq(requests.status, status)
    : status ? and(eq(requests.status, 'submitted'), status === 'pending' ? hasStatus('pending')
      : status === 'accepted' ? and(hasStatus('accepted'), sql`not (${hasStatus('pending')})`, sql`not (${hasStatus('rejected')})`)
      : status === 'rejected' ? and(hasStatus('rejected'), sql`not (${hasStatus('pending')})`, sql`not (${hasStatus('accepted')})`)
      : and(hasStatus('accepted'), hasStatus('rejected'), sql`not (${hasStatus('pending')})`)) : undefined;
  // Parameters remain bound, and user %/_ characters are literal search text.
  const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  const search = q ? sql`(${requests.id} ilike ${pattern} or ${requests.ticketNumber} ilike ${pattern} or exists(
    select 1 from ${lines} l join ${allocations} a on a.request_line_id=l.id
    join ${incomingShipmentLines} p on p.id=a.purchase_line_id
    join ${incomingShipments} o on o.id=p.shipment_id
    join ${suppliers} s on s.id=a.supplier_id
    where l.request_id=${requests.id} ${own} and (l.sku ilike ${pattern} or l.name ilike ${pattern}
      or o.ticket_number ilike ${pattern} or o.supplier_internal_order_number ilike ${pattern} or s.name ilike ${pattern})))` : undefined;
  const start = from && new Date(from + 'T00:00:00+07:00').toISOString();
  const end = to && new Date(Date.parse(to + 'T00:00:00+07:00') + 86_400_000).toISOString();
  const where = and(state, search,
    from ? dateBy === 'pickup' ? sql`${requests.pickupDate} >= ${from}` : sql`${requests.createdAt} >= ${start}` : undefined,
    to ? dateBy === 'pickup' ? sql`${requests.pickupDate} <> '' and ${requests.pickupDate} <= ${to}` : sql`${requests.createdAt} < ${end}` : undefined);
  return { where, limit, offset };
}
