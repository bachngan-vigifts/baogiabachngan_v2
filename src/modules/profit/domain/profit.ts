/**
 * PHÂN TÍCH LỢI NHUẬN (giai đoạn 1: lợi nhuận gộp) – hàm thuần, không DB.
 *  Lợi nhuận gộp = Doanh thu thuần (chưa VAT, trừ hàng trả) − Giá vốn − Chi phí trực tiếp (in gia công, hoa hồng / CK khách, ship mình trả).
 *  Ghi nhận theo NGÀY ĐƠN. Giá vốn: dòng báo giá (Manager nhập / CK mua vào) → không có thì giá nhập gần nhất trong sổ sản phẩm.
 *  Dòng thiếu giá vốn KHÔNG coi là 0: loại khỏi lợi nhuận, báo "thiếu giá vốn"; biên LN tính trên doanh thu đã đủ giá vốn.
 */
export type Grain = 'day' | 'week' | 'month' | 'year';
export const GRAINS: readonly Grain[] = ['day', 'week', 'month', 'year'];
import { LINE_COST_SOURCE_LABEL, purchaseCostAt as linePurchaseCostAt, type LineCostConfidence, type LineCostSource } from '../../sales/domain/line-cost.ts';
export type CostSource = LineCostSource | 'missing';
export type CostConfidence = LineCostConfidence;
export const COST_SOURCE_LABEL: Record<CostSource, string> = LINE_COST_SOURCE_LABEL;
const pad = (n: number) => String(n).padStart(2, '0');
const DAY = 86400_000;
const isoDay = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const mondayOf = (day: string) => { const t = Date.parse(day + 'T00:00:00Z'), w = new Date(t).getUTCDay(); return isoDay(t - ((w + 6) % 7) * DAY); };
/** Kỳ của một ngày đơn: ngày 'YYYY-MM-DD', tuần = thứ Hai 'YYYY-MM-DD', tháng 'YYYY-MM', năm 'YYYY'. */
export function bucketOf(day: string, grain: Grain) {
  return grain === 'day' ? day : grain === 'week' ? mondayOf(day) : grain === 'month' ? day.slice(0, 7) : day.slice(0, 4);
}
export function bucketLabel(key: string, grain: Grain) {
  if (grain === 'day') return `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
  if (grain === 'week') { const end = isoDay(Date.parse(key + 'T00:00:00Z') + 6 * DAY); return `${key.slice(8, 10)}/${key.slice(5, 7)}–${end.slice(8, 10)}/${end.slice(5, 7)}/${end.slice(0, 4)}`; }
  if (grain === 'month') return `${key.slice(5, 7)}/${key.slice(0, 4)}`;
  return key;
}

/** Giá nhập theo mã (dùng chung với snapshot lúc bán – sales/domain/line-cost.ts). */
export function purchaseCostAt(history: readonly { at: string; price: number }[] | undefined, day: string): { cost: number; source: CostSource } | null {
  const c = linePurchaseCostAt(history, day);
  return c ? { cost: c.unitCost, source: c.source } : null;
}

export interface LineInput {
  id: string; sku: string; name: string; qty: number; revenue: number; unit?: string;
  /** Giá vốn / đơn vị từ báo giá (undefined = báo giá không có). */
  quoteCost?: number; printingCost?: number; commission?: number;
  /** Giá vốn lưu lúc bán (snapshot). Không có → tính lại từ báo giá / giá nhập và gắn nhãn backfill. */
  snapshot?: { unitCost: number; source: LineCostSource; confidence: LineCostConfidence } | null;
  /** Số lượng / doanh thu chưa VAT đã trả lại (phiếu trả hàng đã ghi nhận). */
  returnedQty?: number; returnedRevenue?: number;
}
export interface LineProfit {
  id: string; sku: string; name: string; qty: number; revenue: number; unitCost: number | null; cost: number; costSource: CostSource;
  /** Mức tin cậy giá vốn; null = thiếu giá vốn. */ confidence: CostConfidence | null;
  printing: number; commission: number; gross: number | null;
}
export interface OrderProfit {
  id: string; orderNo: string; orderDate: string; ownerId: string; customerId: string | null; customerName: string; branchId: string;
  revenue: number; coveredRevenue: number; cost: number; printing: number; commission: number; shipping: number; gross: number;
  missingLines: number; lines: LineProfit[];
  /** Doanh thu theo mức tin cậy giá vốn (đối soát: tổng = revenue). */
  revenueBy: Record<CostConfidence | 'missing', number>;
  /** Giai đoạn 2: thu phí của khách (POS, chưa VAT), phí GHN trả hãng; LN sau chi phí = gross + feeRevenue − carrierFee. */
  feeRevenue: number; carrierFee: number; net: number;
  /** Có vận đơn GHN nhưng chưa biết phí. */ carrierUnknown: boolean;
  /** PR-C: lương + phụ cấp / thưởng của người phụ trách (bảng lương tháng), phân bổ theo doanh thu đủ giá vốn. */
  staffSalary: number; staffBonus: number;
}
/** Trừ chi phí nhân sự đã phân bổ vào đơn. */
export function addStaffCost(o: OrderProfit, salary: number, bonus: number) {
  o.staffSalary += salary; o.staffBonus += bonus; o.net -= salary + bonus; return o;
}
/**
 * Gắn phí cấp đơn (thu phí khách, phí GHN). Như phí ship báo giá: chỉ cộng / trừ khi mọi dòng đủ giá vốn;
 * đơn còn dòng thiếu giá vốn thì phần này nằm ở `pendingFees` để không lệch biên LN.
 */
export function applyOrderFees(o: OrderProfit, f: { feeRevenue: number; carrierFee: number; carrierUnknown?: boolean }) {
  const apply = o.missingLines === 0;
  o.feeRevenue = apply ? f.feeRevenue : 0; o.carrierFee = apply ? f.carrierFee : 0; o.carrierUnknown = !!f.carrierUnknown;
  o.net = o.gross + o.feeRevenue - o.carrierFee - o.staffSalary - o.staffBonus;
  return o;
}
/**
 * Lợi nhuận một đơn. Phí ship (nếu mình trả) chỉ trừ khi mọi dòng đủ giá vốn – tránh cộng chi phí vào phần doanh thu đã bị loại.
 * `onlyConfirmed`: chỉ tính dòng có giá vốn "chính xác"; dòng ước tính / backfill coi như thiếu giá vốn.
 */
export function orderProfit(o: Omit<OrderProfit, 'revenue' | 'coveredRevenue' | 'cost' | 'printing' | 'commission' | 'shipping' | 'gross' | 'missingLines' | 'lines' | 'revenueBy' | 'feeRevenue' | 'carrierFee' | 'net' | 'carrierUnknown' | 'staffSalary' | 'staffBonus'> & { shippingCost: number },
  lines: readonly LineInput[], purchase: (sku: string, line: LineInput) => { cost: number; source: CostSource } | null, onlyConfirmed = false): OrderProfit {
  const out: LineProfit[] = [];
  for (const l of lines) {
    const qty = Math.max(0, l.qty - (l.returnedQty ?? 0)), ratio = l.qty > 0 ? qty / l.qty : 0;
    const revenue = Math.max(0, l.revenue - (l.returnedRevenue ?? 0));
    // Snapshot lúc bán trước; không có thì tính lại (luôn gắn nhãn backfill – không coi là chính xác).
    const q = Number.isFinite(l.quoteCost) && (l.quoteCost as number) >= 0 ? { cost: l.quoteCost as number, source: 'quote' as const } : null;
    const live = q ?? (l.sku ? purchase(l.sku, l) : null);
    const found = l.snapshot ? { cost: l.snapshot.unitCost, source: l.snapshot.source as CostSource, confidence: l.snapshot.confidence }
      : live ? { ...live, confidence: 'backfill' as const } : null;
    const c = found && (!onlyConfirmed || found.confidence === 'confirmed') ? found : null;
    const printing = Math.round((l.printingCost ?? 0) * ratio), commission = Math.round((l.commission ?? 0) * ratio);
    const cost = c ? Math.round(c.cost * qty) : 0;
    out.push({ id: l.id, sku: l.sku, name: l.name, qty, revenue, unitCost: c ? c.cost : null, cost, costSource: c ? c.source : 'missing', confidence: c ? c.confidence : null, printing, commission,
      gross: c ? revenue - cost - printing - commission : null });
  }
  const covered = out.filter(l => l.gross !== null), missingLines = out.length - covered.length;
  const sum = (xs: LineProfit[], k: 'revenue' | 'cost' | 'printing' | 'commission') => xs.reduce((n, x) => n + x[k], 0);
  const shipping = missingLines ? 0 : Math.max(0, o.shippingCost || 0);
  const coveredRevenue = sum(covered, 'revenue'), cost = sum(covered, 'cost'), printing = sum(covered, 'printing'), commission = sum(covered, 'commission');
  const { shippingCost: _s, ...head } = o;
  const revenueBy = { confirmed: 0, estimate: 0, backfill: 0, missing: 0 };
  for (const l of out) revenueBy[l.confidence ?? 'missing'] += l.revenue;
  const gross = coveredRevenue - cost - printing - commission - shipping;
  return { ...head, revenue: sum(out, 'revenue'), coveredRevenue, cost, printing, commission, shipping, gross, missingLines, lines: out, revenueBy, feeRevenue: 0, carrierFee: 0, net: gross, carrierUnknown: false, staffSalary: 0, staffBonus: 0 };
}

export interface ProfitRow {
  key: string; label: string; orders: number; revenue: number; coveredRevenue: number; cost: number; direct: number; gross: number;
  /** Biên LN gộp trên doanh thu đã đủ giá vốn; null = chưa có doanh thu đủ giá vốn. */
  margin: number | null; missingOrders: number; missingRevenue: number;
  /** Doanh thu theo mức tin cậy giá vốn. */ revenueBy: Record<CostConfidence | 'missing', number>;
  feeRevenue: number; carrierFee: number; net: number; netMargin: number | null; carrierUnknownOrders: number;
  staffSalary: number; staffBonus: number;
}
export function emptyRow(key: string, label: string): ProfitRow {
  return { key, label, orders: 0, revenue: 0, coveredRevenue: 0, cost: 0, direct: 0, gross: 0, margin: null, missingOrders: 0, missingRevenue: 0, revenueBy: { confirmed: 0, estimate: 0, backfill: 0, missing: 0 },
    feeRevenue: 0, carrierFee: 0, net: 0, netMargin: null, carrierUnknownOrders: 0, staffSalary: 0, staffBonus: 0 };
}
export function addOrder(r: ProfitRow, o: OrderProfit) {
  r.orders++; r.revenue += o.revenue; r.coveredRevenue += o.coveredRevenue; r.cost += o.cost; r.direct += o.printing + o.commission + o.shipping; r.gross += o.gross;
  if (o.missingLines) { r.missingOrders++; r.missingRevenue += o.revenue - o.coveredRevenue; }
  for (const k of ['confirmed', 'estimate', 'backfill', 'missing'] as const) r.revenueBy[k] += o.revenueBy[k];
  r.feeRevenue += o.feeRevenue; r.carrierFee += o.carrierFee; r.net += o.net; if (o.carrierUnknown) r.carrierUnknownOrders++;
  r.staffSalary += o.staffSalary; r.staffBonus += o.staffBonus;
  r.margin = r.coveredRevenue > 0 ? r.gross / r.coveredRevenue : null;
  r.netMargin = r.coveredRevenue + r.feeRevenue > 0 ? r.net / (r.coveredRevenue + r.feeRevenue) : null;
  return r;
}
/** Gộp theo khoá (kỳ / chi nhánh / nhân viên / khách); sắp theo `sort`. */
export function groupBy(orders: readonly OrderProfit[], keyOf: (o: OrderProfit) => string, labelOf: (key: string) => string, sort: 'key' | 'gross' = 'gross') {
  const m = new Map<string, ProfitRow>();
  for (const o of orders) { const k = keyOf(o); addOrder(m.get(k) ?? m.set(k, emptyRow(k, labelOf(k))).get(k)!, o); }
  return [...m.values()].sort(sort === 'key' ? (a, b) => a.key.localeCompare(b.key) : (a, b) => b.gross - a.gross || b.revenue - a.revenue);
}
/** Gộp theo sản phẩm (mã) – chỉ dòng đủ giá vốn tính LN. */
export function groupByProduct(orders: readonly OrderProfit[]) {
  const m = new Map<string, ProfitRow & { qty: number }>();
  for (const o of orders) for (const l of o.lines) {
    const k = l.sku || `(không mã) ${l.name}`, r = m.get(k) ?? m.set(k, { ...emptyRow(k, l.name), qty: 0 }).get(k)!;
    r.orders++; r.qty += l.qty; r.revenue += l.revenue; r.revenueBy[l.confidence ?? 'missing'] += l.revenue;
    if (l.gross === null) { r.missingOrders++; r.missingRevenue += l.revenue; }
    else { r.coveredRevenue += l.revenue; r.cost += l.cost; r.direct += l.printing + l.commission; r.gross += l.gross; r.net += l.gross; }
    r.margin = r.coveredRevenue > 0 ? r.gross / r.coveredRevenue : null;
  }
  return [...m.values()].sort((a, b) => b.gross - a.gross || b.revenue - a.revenue);
}
