import { AppError } from '../../../core/errors.ts';
type BoardOrder = {
  id: string; orderNo: string; customerName: string; phone: string; ownerId: string | null;
  ownerName: string | null; sapoOrderCode: string | null; orderDate: string;
  bucket: string; orderSource: string; paymentStatus: string; total: number;
  paid: number | null; outstanding: number | null; currency: string;
  cancelReason?: string; cancellationKind?: string;
};
/** Called after register scope is checked, on the complete server-side dataset. */
export function filterPosOrderBoard<T extends BoardOrder>(rows: T[], params: URLSearchParams, options: {analyticsFrom?:string} = {}) {
  const source = params.get('source') || 'all', payment = params.get('payment') || 'all';
  const status = params.get('status') || 'all', owner = params.get('ownerId') || '';
  const from = params.get('from') || '', to = params.get('to') || '';
  const validDate = (s: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  // `web`: đơn website còn cần xử lý (chưa hoàn thành / chưa huỷ) – thẻ "Đơn web" có số đỏ nhấp nháy ở Bán hàng nhanh.
  const statuses = ['all', 'web', 'pending', 'packing', 'waiting_delivery', 'completed', 'cancelled'];
  if (!['all', 'pos', 'web', 'cod'].includes(source) || !['all', 'paid', 'debt', 'unknown'].includes(payment) || !statuses.includes(status) || !validDate(from) || !validDate(to) || from && to && from > to)
    throw new AppError(400, 'Bộ lọc đơn hàng hoặc khoảng ngày không hợp lệ.');
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const q = fold((params.get('q') || '').trim().slice(0, 200));
  const owners = [...new Map(rows.filter(r => r.ownerId).map(r => [r.ownerId!, { id: r.ownerId!, name: r.ownerName || 'Chưa có tên' }])).values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const cohort = rows.filter(o => (source === 'all' || o.orderSource === source) && (!owner || o.ownerId === owner) &&
    (!from || o.orderDate >= from) && (!to || o.orderDate <= to) &&
    (!q || [o.orderNo, o.customerName, o.phone, o.ownerName, o.sapoOrderCode].some(v => fold(v || '').includes(q))));
  const filtered = cohort.filter(o=>payment==='all'||o.bucket!=='cancelled'&&o.paymentStatus===payment);
  const analytics = cancellationAnalytics(cohort.filter(o=>!options.analyticsFrom||o.orderDate>=options.analyticsFrom));
  const webOpen = (o: BoardOrder) => o.orderSource === 'web' && o.bucket !== 'completed' && o.bucket !== 'cancelled';
  const counts = { all: filtered.length, web: filtered.filter(webOpen).length, pending: 0, packing: 0, waiting_delivery: 0, completed: 0, cancelled: 0 };
  for (const o of filtered) if (o.bucket in counts && o.bucket !== 'all' && o.bucket !== 'web') counts[o.bucket as keyof typeof counts]++;
  const orders = filtered.filter(o => status === 'all' || (status === 'web' ? webOpen(o) : o.bucket === status));
  const totals = new Map<string, { currency: string; revenue: number; paid: number; outstanding: number; unknownPayment: number; orders: number }>();
  for (const o of orders) {
    if (o.bucket === 'cancelled') continue;
    const t = totals.get(o.currency) || { currency: o.currency, revenue: 0, paid: 0, outstanding: 0, unknownPayment: 0, orders: 0 };
    t.revenue += o.total; t.paid += o.paid ?? 0; t.outstanding += o.outstanding ?? 0; t.unknownPayment += o.paymentStatus === 'unknown' ? 1 : 0; t.orders++;
    totals.set(o.currency, t);
  }
  return { orders, counts, owners, analytics, totals: [...totals.values()] };
}


/** Full cohort, before pagination/status/payment filters. Missing reasons remain explicitly unknown. */
export function cancellationAnalytics(rows: Pick<BoardOrder,'bucket'|'cancelReason'|'cancellationKind'>[]) {
  const total=rows.length, completed=rows.filter(o=>o.bucket==='completed').length, unsuccessful=rows.filter(o=>o.bucket==='cancelled');
  const reasons=new Map<string,{reason:string;count:number}>(), kinds=new Map<string,number>();let missingReasons=0;
  for(const o of unsuccessful){
    const reason=o.cancelReason?.trim().replace(/\s+/g,' ')||'Chưa ghi nhận lý do';
    if(!o.cancelReason?.trim())missingReasons++;
    const key=reason.toLocaleLowerCase('vi'), prior=reasons.get(key);if(prior)prior.count++;else reasons.set(key,{reason,count:1});
    const kind=o.cancellationKind||'cancelled';kinds.set(kind,(kinds.get(kind)||0)+1);
  }
  const ended=completed+unsuccessful.length,percent=(a:number,b:number)=>b?Math.round(a/b*1000)/10:null;
  return {total,completed,unsuccessful:unsuccessful.length,pending:total-ended,ended,missingReasons,
    unsuccessfulRate:percent(unsuccessful.length,total),successRate:percent(completed,total),closedSuccessRate:percent(completed,ended),closedUnsuccessfulRate:percent(unsuccessful.length,ended),
    reasons:[...reasons.values()].sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason,'vi')),
    kinds:[...kinds].map(([kind,count])=>({kind,count}))};
}
