import { AppError } from '../../../core/errors.ts';
type BoardOrder = {
  id: string; orderNo: string; customerName: string; phone: string; ownerId: string | null;
  ownerName: string | null; sapoOrderCode: string | null; orderDate: string;
  bucket: string; orderSource: string; paymentStatus: string; total: number;
  paid: number | null; outstanding: number | null; currency: string;
};
/** Called after register scope is checked, on the complete server-side dataset. */
export function filterPosOrderBoard<T extends BoardOrder>(rows: T[], params: URLSearchParams) {
  const source = params.get('source') || 'all', payment = params.get('payment') || 'all';
  const status = params.get('status') || 'all', owner = params.get('ownerId') || '';
  const from = params.get('from') || '', to = params.get('to') || '';
  const validDate = (s: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  const statuses = ['all', 'pending', 'packing', 'waiting_delivery', 'completed', 'cancelled'];
  if (!['all', 'pos', 'web', 'cod'].includes(source) || !['all', 'paid', 'debt', 'unknown'].includes(payment) || !statuses.includes(status) || !validDate(from) || !validDate(to) || from && to && from > to)
    throw new AppError(400, 'Bộ lọc đơn hàng hoặc khoảng ngày không hợp lệ.');
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const q = fold((params.get('q') || '').trim().slice(0, 200));
  const owners = [...new Map(rows.filter(r => r.ownerId).map(r => [r.ownerId!, { id: r.ownerId!, name: r.ownerName || 'Chưa có tên' }])).values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const filtered = rows.filter(o => (source === 'all' || o.orderSource === source) && (!owner || o.ownerId === owner) &&
    (payment === 'all' || o.bucket !== 'cancelled' && o.paymentStatus === payment) &&
    (!from || o.orderDate >= from) && (!to || o.orderDate <= to) &&
    (!q || [o.orderNo, o.customerName, o.phone, o.ownerName, o.sapoOrderCode].some(v => fold(v || '').includes(q))));
  const counts = { all: filtered.length, pending: 0, packing: 0, waiting_delivery: 0, completed: 0, cancelled: 0 };
  for (const o of filtered) if (o.bucket in counts && o.bucket !== 'all') counts[o.bucket as keyof typeof counts]++;
  const orders = filtered.filter(o => status === 'all' || o.bucket === status);
  const totals = new Map<string, { currency: string; revenue: number; paid: number; outstanding: number; unknownPayment: number; orders: number }>();
  for (const o of orders) {
    if (o.bucket === 'cancelled') continue;
    const t = totals.get(o.currency) || { currency: o.currency, revenue: 0, paid: 0, outstanding: 0, unknownPayment: 0, orders: 0 };
    t.revenue += o.total; t.paid += o.paid ?? 0; t.outstanding += o.outstanding ?? 0; t.unknownPayment += o.paymentStatus === 'unknown' ? 1 : 0; t.orders++;
    totals.set(o.currency, t);
  }
  return { orders, counts, owners, totals: [...totals.values()] };
}
