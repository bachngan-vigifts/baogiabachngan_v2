import { AppError } from '../../../core/errors.ts';
import { fold } from '../../../core/text/fold.ts';
import { isIsoDate } from '../domain/quantity.ts';
import { outstandingLines } from './incoming-stock.ts';
import type { Db } from './purchase-store.ts';

const plusDays = (day: string, count: number) => new Date(Date.parse(day + 'T00:00:00Z') + count * 86400000).toISOString().slice(0, 10);
/** Read only. Aggregate every eligible purchase line BEFORE pagination; never select customer/source names or prices. */
export async function incomingBySku(db: Db, query: URLSearchParams, today: string, paginate = true) {
  const from = query.get('from') || '', to = query.get('to') || '', status = query.get('status') || 'all';
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to)) || (from && to && from > to)) throw new AppError(400, 'Khoảng ngày hẹn không hợp lệ.');
  if (!['all', 'late', 'week'].includes(status)) throw new AppError(400, 'Bộ lọc hàng đang về không hợp lệ.');
  const int = (key: string, fallback: number, max: number) => {
    const raw = query.get(key); if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) throw new AppError(400, 'Phân trang không hợp lệ.');
    return Number(raw);
  };
  const limit = int('limit', 50, 100), offset = int('offset', 0, 1000000);
  if (!limit) throw new AppError(400, 'Số dòng mỗi trang phải lớn hơn 0.');
  const q = fold((query.get('q') || '').trim().slice(0, 200)), supplierId = query.get('supplierId') || '';
  const all = await outstandingLines(db);
  const selected = query.getAll('sku');
  if (selected.length > 300 || selected.some(s => !s || s.length > 200)) throw new AppError(400, 'Danh sách mã đã chọn không hợp lệ.');
  const suppliers = [...new Map(all.filter(l => l.supplierId).map(l => [l.supplierId!, { id: l.supplierId!, name: l.supplierName }])).values()].sort((a,b) => a.name.localeCompare(b.name, 'vi'));
  const lines = all.map(l => ({ ...l, due: l.promisedDate || l.arrivalDate || '' })).filter(l =>
    (query.get('selected') !== '1' || selected.includes(l.sku)) &&
    (!supplierId || l.supplierId === supplierId) && (!q || fold(l.sku + ' ' + l.name).includes(q)) &&
    (!from || !!l.due && l.due >= from) && (!to || !!l.due && l.due <= to) &&
    (status !== 'late' || !!l.due && l.due < today) &&
    (status !== 'week' || !!l.due && l.due >= today && l.due <= plusDays(today, 7)));
  type Line = typeof lines[number];
  const grouped = new Map<string, Line[]>();
  for (const line of lines) { const group = grouped.get(line.sku) || []; group.push(line); grouped.set(line.sku, group); }
  const rows = [...grouped].map(([sku, group]) => {
    const units = [...new Set(group.map(l => l.unit.trim()))];
    const orders = group.map(l => ({ id: l.orderId, lineId: l.lineId, ticketNumber: l.ticketNumber, internalNo: l.internalNo, supplierId: l.supplierId,
      supplierName: l.supplierName, quantity: l.left, due: l.due, unit: l.unit, supplierStatus: l.supplierStatus,
      importedMissingSource: l.imported && l.missingSource }));
    orders.sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999') || a.ticketNumber.localeCompare(b.ticketNumber));
    return { sku, name: group.find(l => l.name)?.name || '', unit: units.length === 1 ? units[0]! : '', unitConflict: units.length > 1,
      quantity: group.reduce((sum,l) => sum + l.left, 0), earliestDue: orders.find(o => o.due)?.due || '',
      late: orders.some(o => !!o.due && o.due < today), orderCount: new Set(group.map(l => l.orderId)).size,
      supplierNames: [...new Set(group.map(l => l.supplierName))], importedMissingSource: orders.some(o => o.importedMissingSource),
      confirmed: group.every(l => l.supplierStatus === 'confirmed'), orders };
  }).sort((a,b) => a.sku.localeCompare(b.sku, 'vi'));
  return { today, rows: paginate ? rows.slice(offset, offset + limit) : rows, total: rows.length, limit, offset, suppliers,
    kpis: { skus: rows.length, quantity: rows.reduce((sum,l) => sum + l.quantity, 0),
      suppliers: new Set(lines.map(l => l.supplierId).filter(Boolean)).size,
      overdueOrders: new Set(lines.filter(l => !!l.due && l.due < today).map(l => l.orderId)).size } };
}
