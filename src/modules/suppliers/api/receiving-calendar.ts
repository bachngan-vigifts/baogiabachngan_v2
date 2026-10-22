import { AppError } from '../../../core/errors.ts';
import { isIsoDate } from '../domain/quantity.ts';
import { outstandingLines } from './incoming-stock.ts';
import type { Db } from './purchase-store.ts';

/** Read-only calendar: share the same remaining quantities as incoming stock. */
export async function receivingCalendar(db: Db, params: URLSearchParams, today: string) {
  const from = params.get('from') || '', to = params.get('to') || '';
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to)) || (from && to && from > to))
    throw new AppError(400, 'Khoảng ngày nhận hàng không hợp lệ.');
  const state = params.get('state') || '', supplier = params.get('supplierId') || '';
  if (!['', 'late', 'scheduled', 'undated'].includes(state)) throw new AppError(400, 'Trạng thái lịch nhận không hợp lệ.');
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const q = fold((params.get('q') || '').trim().slice(0, 100));
  const all = await outstandingLines(db);
  const suppliers = [...new Map(all.map(l => [l.supplierId, { id: l.supplierId, name: l.supplierName }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  type Line = typeof all[number];
  const groups = new Map<string, { orderId: string; ticketNumber: string; supplierName: string; date: string | null; lines: Pick<Line, 'lineId' | 'sku' | 'name' | 'unit' | 'left'>[] }>();
  for (const l of all) {
    const date = l.promisedDate || l.arrivalDate || null;
    if (supplier && l.supplierId !== supplier) continue;
    // Undated goods stay visible with date filters, until the supplier gives a date.
    if (date && ((from && date < from) || (to && date > to))) continue;
    if (state === 'late' && (!date || date >= today)) continue;
    if (state === 'scheduled' && (!date || date < today)) continue;
    if (state === 'undated' && date) continue;
    if (q && !fold([l.ticketNumber, l.internalNo, l.supplierName, l.sku, l.name].join(' ')).includes(q)) continue;
    const key = l.orderId + ':' + (date || '');
    let group = groups.get(key);
    if (!group) {
      group = { orderId: l.orderId, ticketNumber: l.ticketNumber, supplierName: l.supplierName, date, lines: [] };
      groups.set(key, group);
    }
    group.lines.push({ lineId: l.lineId, sku: l.sku, name: l.name, unit: l.unit, left: l.left });
  }
  const rows = [...groups.values()].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.ticketNumber.localeCompare(b.ticketNumber));
  const offset = Math.max(0, Math.floor(Number(params.get('offset')) || 0)), limit = 50;
  return { suppliers, total: rows.length, orderCount: new Set(rows.map(r => r.orderId)).size,
    overdue: rows.filter(r => r.date && r.date < today).length, undated: rows.filter(r => !r.date).length,
    rows: rows.slice(offset, offset + limit), offset, limit, today };
}
