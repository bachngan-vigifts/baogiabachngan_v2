/**
 * Tính giá báo giá. Port từ `public/quote-math.js` (bản cũ) – THỨ TỰ PHÉP TÍNH được giữ nguyên
 * để kết quả số thực giống hệt từng bit (vd 349648.27, 14.4). `tests/quote-math.legacy-diff.test.ts`
 * chạy cả hai bản trên hàng nghìn ca ngẫu nhiên; đừng "tối ưu" biểu thức nếu chưa chạy test đó.
 * Hàm thuần: không đọc DB, không phụ thuộc môi trường.
 */
export type QuoteType = 'HRC' | 'B2B' | 'VIGIFTS';

export interface QuoteRow {
  manualLine?: boolean; manualDescription?: string;
  bundleContents?: string; printDescription?: string; packagingDescription?: string;
  sku?: string; name?: string; brand?: string; pattern?: string;
  price?: number; qty?: number;
  discount?: number; discountType?: 'percent' | 'amount';
  printFee?: number;
  /** Thuế suất riêng của dòng; không hợp lệ/thiếu thì dùng `vat` chung của báo giá. */
  taxRate?: number | null;
  costPrice?: number;
  costMode?: 'manual' | 'discount';
  purchaseDiscount?: number;
  printing?: { unitPrice?: number; workshop?: string; workshopExplicit?: boolean };
  /**
   * CK cho khách ("tiền cà phê", chỉ Manager thấy ở Lợi nhuận tạm tính): theo % hoặc số tiền mỗi sản phẩm, tính trên
   * đơn giá sau chiết khấu KHÔNG gồm phí in. `excluded`: dòng không tính CK (vd. bao bì).
   */
  commission?: { mode?: 'percent' | 'amount'; value?: number; excluded?: boolean };
}

/** One optional note for custom rows; retain meaningful descriptions from older quotes. */
export function manualLineNote(row:QuoteRow):string {
  if(row.manualDescription!==undefined)return String(row.manualDescription).trim();
  return [row.bundleContents?.trim(),row.printDescription?.trim(),row.packagingDescription?.trim()&&row.packagingDescription.trim()!=='theo tiêu chuẩn nhà sản xuất'?row.packagingDescription.trim():''].filter(Boolean).join(' · ');
}
export function manualLineDescription(row:QuoteRow):string|null {
  if(row.manualLine!==true&&String(row.sku||'').trim())return null;
  return [String(row.name||'').trim(),manualLineNote(row)].filter(Boolean).join('\n');
}

export interface QuoteDoc {
  type: QuoteType;
  vat?: number;
  rows: QuoteRow[];
  shipping?: { payer?: string };
  printing?: { totalCost?: number; workshop?: string; workshopExplicit?: boolean };
}

const num = (v: unknown): number => Number(v || 0);

export const printingWorkshops = ['Xưởng in Tiến phát', 'Thương Bé Ba', 'Trọng Tín', 'Xưởng in Hạnh Nguyên (Anh Liêm)', 'Minh Long'] as const;

export const normalize = (value: unknown): string =>
  String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

/** Thuế suất áp cho dòng. */
export const rate = (r: QuoteRow, s: Pick<QuoteDoc, 'vat'>): number =>
  Number.isFinite(r.taxRate) ? (r.taxRate as number) : Number(s.vat || 0);

/** Đơn giá sau chiết khấu (chưa gồm phí in). */
export const discounted = (r: QuoteRow): number =>
  Math.max(0, Number(r.price || 0) - (r.discountType === 'amount' ? Number(r.discount || 0) : Number(r.price || 0) * Number(r.discount || 0) / 100));

/** Đơn giá sau CK; B2B và VIGIFTS cộng thêm phí in, HRC thì không. */
export const after = (r: QuoteRow, s: Pick<QuoteDoc, 'type'>): number =>
  discounted(r) + (s.type !== 'HRC' ? Number(r.printFee || 0) : 0);

export interface Totals { subtotal: number; tax: number; total: number; label: string }
export function totals(s: QuoteDoc): Totals {
  let subtotal = 0, tax = 0;
  const rates = new Set<number>();
  for (const r of s.rows) {
    const line = after(r, s) * Number(r.qty || 0), vat = rate(r, s);
    subtotal += line;
    tax += line * vat / 100;
    rates.add(vat);
  }
  return { subtotal, tax, total: subtotal + tax, label: rates.size > 1 ? 'Thuế VAT theo sản phẩm' : `Thuế VAT ${rates.size ? [...rates][0] : s.vat || 0}%` };
}

export function printingInfo(s: Pick<QuoteDoc, 'type' | 'rows'>): { enabled: boolean; defaultWorkshop: string } {
  const rows = (s.rows || []).filter(row => Number(row.printFee) > 0 && Number(row.qty) > 0);
  const enabled = ['B2B', 'VIGIFTS'].includes(s.type) && rows.length > 0;
  const minhLong = rows.length > 0 && rows.every(row => /minh long|healthy cook|su duong sinh/.test(normalize(`${row.brand || ''} ${row.name || ''}`)));
  return { enabled, defaultWorkshop: minhLong ? printingWorkshops[0] : printingWorkshops[1] };
}

/** Tiền CK cho khách của một dòng: % × đơn giá sau CK (không phí in) × SL, hoặc số tiền/SP × SL. Dòng bị loại → 0. */
export function commissionOf(r: QuoteRow): number {
  const c = r.commission, qty = Math.max(0, num(r.qty)), value = Math.max(0, num(c?.value));
  if (!c || c.excluded || !value || !qty) return 0;
  return Math.round(c.mode === 'amount' ? value * qty : discounted(r) * value / 100 * qty);
}

export interface Profit { revenue: number; cost: number; commission: number; shippingCost: number; printingCost: number; gross: number; margin: number }
export function profit(s: QuoteDoc, shippingFee: number | null = null): Profit {
  const revenue = totals(s).subtotal;
  const cost = s.rows.reduce((sum, row) => sum + (Number(row.costPrice) || 0) * Number(row.qty || 0), 0);
  const shippingCost = s.shipping?.payer === 'sender' && Number.isFinite(shippingFee) ? Math.max(0, shippingFee as number) : 0;
  const hasLineCosts = s.rows.some(row => row.printing && Number.isFinite(row.printing.unitPrice));
  const printingCost = printingInfo(s).enabled
    ? (hasLineCosts
      ? s.rows.reduce((sum, row) => sum + Math.round(Math.max(0, Number(row.printing?.unitPrice) || 0) * Math.max(0, Number(row.qty) || 0)), 0)
      : Math.max(0, Number(s.printing?.totalCost) || 0))
    : 0;
  const commission = s.rows.reduce((sum, row) => sum + commissionOf(row), 0);
  const gross = revenue - cost - commission - shippingCost - printingCost;
  return { revenue, cost, commission, shippingCost, printingCost, gross, margin: revenue ? gross / revenue * 100 : 0 };
}

/** Giá chưa thuế từ giá đã/chưa gồm thuế. */
export const netPrice = (raw: number, tax: number, included: boolean): number => included ? raw / (1 + tax / 100) : raw;

/** % CK mua vào theo thương hiệu/dòng sản phẩm; Hoàng Cung và Đài Các 27%. */
export function defaultCostDiscount(product?: Pick<QuoteRow, 'brand' | 'name' | 'sku' | 'pattern'> | null): number | null {
  const text = normalize([product?.brand, product?.name, product?.sku, product?.pattern].filter(Boolean).join(' '));
  if (!text) return null;
  if (text.includes('healthy cook')) return 15;
  if (/\blys\b/.test(text) || text.includes('minh long - lys')) return 19;
  if (/\blocknlock\b/.test(text) || /\block n lock\b/.test(text) || text.includes('lock&lock') || text.includes('lock & lock') || /\block\b/.test(text)) return 58;
  if (/(?:^|[^a-z0-9đ])(?:hoang cung|[dđ]ai cac)(?=$|[^a-z0-9đ])/.test(text)) return 27;
  if (text.includes('minh long')) return 25;
  return null;
}

export const purchasePrice = (price: unknown, discount: unknown): number => {
  const value = Number(price) || 0, percent = Number(discount);
  return value <= 0 || !Number.isFinite(percent) ? 0 : Math.round(value * (100 - Math.min(100, Math.max(0, percent))) / 100);
};

type CostRow = Pick<QuoteRow, 'price' | 'costMode' | 'costPrice' | 'purchaseDiscount'>;
/** Dòng cũ chỉ có costPrice là giá thủ công; dòng có CK giữ cách tính hiện tại. */
export const costModeOf = (row: CostRow): 'manual' | 'discount' => row.costMode ??
  (!Number.isFinite(row.purchaseDiscount) && Number.isFinite(row.costPrice) ? 'manual' : 'discount');

/** Nhập 160k / 160.000 / 160,000 đ hoặc 58%; số không có hậu tố dùng chế độ đang chọn. */
export function parsePurchaseCost(input: string, mode: 'manual' | 'discount'): { mode: 'manual' | 'discount'; value: number | null } | null {
  let s = input.trim().replace(/\s+/g, ''), factor = 1;
  if (!s) return { mode, value: null };
  if (s.endsWith('%')) { mode = 'discount'; s = s.slice(0, -1); }
  else if (/k$/i.test(s)) { mode = 'manual'; factor = 1000; s = s.slice(0, -1); }
  else if (/(?:đ|₫|vnd)$/i.test(s)) { mode = 'manual'; s = s.replace(/(?:đ|₫|vnd)$/i, ''); }
  if (/^\d{1,3}(?:[.]\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else if (/^\d{1,3}(?:,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const value = Number(s) * factor;
  if (!Number.isFinite(value) || value < 0 || value > (mode === 'discount' ? 100 : 1e12)) return null;
  return { mode, value };
}

export function syncPurchaseCost(row: CostRow): void {
  if (costModeOf(row) === 'discount') {
    if (Number.isFinite(row.purchaseDiscount)) row.costPrice = purchasePrice(row.price, row.purchaseDiscount);
    else delete row.costPrice;
  }
}

export function applyPurchaseCost(row: CostRow, entry: NonNullable<ReturnType<typeof parsePurchaseCost>>): void {
  row.costMode = entry.mode;
  if (entry.mode === 'manual') {
    delete row.purchaseDiscount;
    if (entry.value === null) delete row.costPrice; else row.costPrice = entry.value;
  } else {
    if (entry.value === null) delete row.purchaseDiscount; else row.purchaseDiscount = entry.value;
    syncPurchaseCost(row);
  }
}

export const defaultCostPrice = (product: Parameters<typeof defaultCostDiscount>[0], price: unknown): number => {
  const discount = defaultCostDiscount(product);
  return discount === null ? 0 : purchasePrice(price, discount);
};

export type CustomerDiscounts = Partial<Record<'lys' | 'minhLong' | 'lock', number>>;
/**
 * Thương hiệu → nhóm CK của khách: Lys ("Minh Long - Lys", "LYS"…), Lock&Lock ("Lock&Lock", "LocknLock", "LOCK & LOCK"…),
 * Minh Long (gồm dòng Healthy Cook / sứ dưỡng sinh). Không thuộc ba nhóm → null (không áp CK của khách).
 */
export function brandDiscountKey(brand: unknown): 'lys' | 'minhLong' | 'lock' | null {
  const n = normalize(brand), words = n.split(/[^a-z0-9&]+/).filter(Boolean);
  if (words.includes('lys')) return 'lys';
  if (/lock\s*(&|n|and)?\s*lock/.test(n) || words.includes('lock')) return 'lock';
  if (/minh long|healthy cook|su duong sinh/.test(n)) return 'minhLong';
  return null;
}
/** Chiết khấu của khách cho một thương hiệu (dạng % hoặc số tiền trên `price`). Giá trị ngoài 0..100 bị bỏ qua. */
export function customerDiscount(brand: unknown, discounts: CustomerDiscounts | null | undefined = {}, mode: 'percent' | 'amount' = 'percent', price = 0): number {
  const n = normalize(brand);
  const key = brandDiscountKey(n);
  const percent = key && discounts?.[key];
  return typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? (mode === 'amount' ? price * percent / 100 : percent) : 0;
}
