/**
 * ĐẨY ĐƠN HÀNG SANG SAPO – phần nghiệp vụ thuần (port từ `lib/sapo-copy.mjs` của web cũ, nút "Copy báo giá vào Sapo").
 *  - Đơn Sapo là đơn NHÁP (`status: draft`), mã đơn = số HĐKT nếu có hợp đồng, còn lại dùng số đơn web.
 *    Số báo giá chỉ là thông tin nguồn, không dùng để đối chiếu trùng.
 *  - Kho (location) do nhân viên chọn lúc đẩy; nhân viên phụ trách trên Sapo = người phụ trách đơn / báo giá.
 *  - Dòng hàng: giá sau chiết khấu (đã cộng phí in), chưa VAT, thuế suất từng dòng – đúng như dòng đơn trên web.
 */
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface SapoPushCustomer { sapoId: number | null; name: string; customerCode: string; taxCode: string; phone: string; email: string; contact: string; address: string }
export interface SapoPushLine { sku: string; name: string; unit: string; qty: number; unitPrice: number; taxRate: number }
export interface SapoPushInput {
  code: string; orderNo: string; quoteNo: string; quoteType: string; contractNo: string;
  customer: SapoPushCustomer; lines: SapoPushLine[];
  ownerName: string; ownerPhone: string; expectedDeliveryDate: string | null;
  subtotal: number; tax: number; total: number;
}
export interface SapoPushConfig { locationId: number; sourceId: number; priceListId: number }

/** Nguồn đơn / bảng giá mặc định của web cũ (đổi bằng env SAPO_SOURCE_ID / SAPO_PRICE_LIST_ID). */
export const SAPO_DEFAULTS = { sourceId: 339582, priceListId: 146550 };

const clean = (v: unknown) => v === undefined || v === null ? '' : String(v).trim();
const upper = (v: unknown) => clean(v).toUpperCase();
const fold = (v: unknown) => clean(v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compact = <T extends Raw>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Partial<T>;
const truncate = (v: string, max: number) => v.length <= max ? v : v.slice(0, max - 3).trimEnd() + '...';

/** Lỗi dữ liệu trước khi gọi Sapo (trả nguyên văn cho nhân viên). Rỗng = đẩy được. */
export function sapoPushProblems(input: SapoPushInput, options: { requireCode?: boolean } = {}): string[] {
  const out: string[] = [];
  if (options.requireCode !== false && !input.code) out.push('Chưa có số đơn hàng / HĐKT.');
  if (!input.customer.name && !input.customer.phone && !input.customer.email && !input.customer.customerCode) out.push('Đơn chưa có thông tin khách hàng.');
  if (!input.lines.length) out.push('Đơn chưa có sản phẩm.');
  if (input.lines.length > 300) out.push('Đơn quá 300 dòng – Sapo không nhận.');
  const noSku = input.lines.map((l, i) => l.sku ? 0 : i + 1).filter(Boolean);
  if (noSku.length) out.push(`Dòng ${noSku.join(', ')} chưa có mã SKU – Sapo cần SKU cho mỗi sản phẩm.`);
  return out;
}

/** Đơn Sapo đã có cho mã này (đúng mã đơn / mã tham chiếu / tag; không so chuỗi con để `_001` không khớp `_0012`). */
export function isSapoOrderFor(order: Raw, code: string): boolean {
  if (!code) return false;
  const tags = Array.isArray(order.tags) ? order.tags : clean(order.tags).split(',');
  return clean(order.code) === code || clean(order.reference_number) === code || tags.map(clean).includes(code);
}

/** Khách Sapo khớp khách của đơn (mã KH / MST / SĐT / email / tên, không phân biệt hoa thường). */
export function sapoCustomerMatches(candidate: Raw, c: SapoPushCustomer): boolean {
  const have = [candidate.code, candidate.customer_code, candidate.tax_code, candidate.phone, candidate.mobile, candidate.email, candidate.name].map(v => clean(v).toLowerCase()).filter(Boolean);
  return [c.customerCode, c.taxCode, c.phone, c.email, c.name].map(v => clean(v).toLowerCase()).filter(Boolean).some(v => have.includes(v));
}

export function sapoCustomerPayload(c: SapoPushCustomer) {
  const name = c.name || c.contact || c.phone || c.email || c.customerCode;
  return compact({ name, code: c.customerCode, customer_code: c.customerCode, tax_code: c.taxCode, phone: c.phone, mobile: c.phone, email: c.email, contact_name: c.contact,
    note: 'Tạo từ web báo giá Bách Ngân khi đẩy đơn.' });
}

export function sapoProductPayload(l: SapoPushLine) {
  return compact({ name: l.name || l.sku, status: 'active', product_type: 'normal', vendor: 'Web báo giá', tags: ['web-bao-gia', l.sku].join(','),
    description: 'Tạo từ web báo giá khi SKU chưa có trên Sapo.',
    variants: [compact({ sku: l.sku, barcode: l.sku, name: l.name, option1: 'Default Title', price: l.unitPrice, import_price: 0, unit: l.unit, taxable: true, inventory_management: 'sapo', inventory_policy: 'continue' })] });
}

/** Biến thể Sapo đúng SKU / mã vạch (không phân biệt hoa thường). Trùng nhiều → lỗi để không chọn nhầm. */
export function exactVariant(variants: Raw[], sku: string): Raw | null | 'duplicate' {
  const hit = variants.filter(v => upper(v.sku) === upper(sku) || upper(v.barcode) === upper(sku));
  return hit.length > 1 ? 'duplicate' : hit[0] ?? null;
}

/** Tài khoản Sapo của người phụ trách: theo email, rồi theo tên (bỏ dấu); bỏ tài khoản ngừng hoạt động. */
export function matchSapoAccount(accounts: Raw[], who: { email: string; name: string }): Raw | null {
  const active = accounts.filter(a => clean(a.status).toLowerCase() !== 'inactive');
  const email = clean(who.email).toLowerCase(), name = fold(who.name);
  return (email && active.find(a => clean(a.email).toLowerCase() === email)) || (name && active.find(a => fold(a.full_name || a.name) === name)) || null;
}

/** Đơn nháp Sapo từ đơn web (đúng các trường web cũ gửi). */
export function buildSapoOrder(input: SapoPushInput, cfg: SapoPushConfig, ids: { customerId: number | string; accountId: number | string | null; variants: Raw[] }) {
  const lines = input.lines.map((l, i) => compact({
    product_id: ids.variants[i]!.product_id, variant_id: ids.variants[i]!.id, is_freeform: false,
    price: l.unitPrice, tax_included: false, tax_rate_override: l.taxRate, quantity: l.qty,
    note: input.expectedDeliveryDate ? 'Ngày giao: ' + input.expectedDeliveryDate : '',
  }));
  const note = [
    'Tạo đơn nháp từ web báo giá Bách Ngân.',
    input.quoteNo ? 'Số báo giá: ' + input.quoteNo + '.' : '',
    // HĐKT là luồng riêng với đơn hàng: chỉ ghi số HĐKT, không ghi số đơn web.
    input.contractNo ? 'HĐKT: ' + input.contractNo + '.' : 'Số đơn web: ' + input.orderNo + '.',
    input.quoteType ? 'Loại: ' + input.quoteType + '.' : '',
    input.ownerName ? 'NV phụ trách: ' + input.ownerName + (input.ownerPhone ? ' - ' + input.ownerPhone : '') + '.' : '',
    input.customer.name ? 'Khách: ' + input.customer.name + (input.customer.taxCode ? ' MST ' + input.customer.taxCode : '') + '.' : '',
    input.expectedDeliveryDate ? 'Ngày giao dự kiến: ' + input.expectedDeliveryDate + '.' : '',
    `Tổng web: trước VAT ${Math.round(input.subtotal)}, VAT ${Math.round(input.tax)}, tổng ${Math.round(input.total)}.`,
  ].filter(Boolean).join(' ');
  return compact({
    code: input.code, reference_number: input.code, operation_system: 'web', location_id: cfg.locationId, source_id: cfg.sourceId, source_name: 'Khác',
    price_list_id: cfg.priceListId, account_id: ids.accountId ?? undefined, assignee_id: ids.accountId ?? undefined, customer_id: ids.customerId,
    tax_treatment: 'inclusive', status: 'draft', create_invoice: false, note: truncate(note, 500),
    tags: ['web-bao-gia', input.quoteType, input.code].filter(Boolean), order_line_items: lines,
    order_discount_rate: 0, order_discount_value: 0, order_discount_amount: 0, discount_items: [],
  });
}

/** Tổng Sapo khớp tổng web (lệch ≤ 1đ do làm tròn). */
export const sapoTotalMatches = (sapoTotal: unknown, webTotal: number) => Number.isFinite(Number(sapoTotal)) && Math.abs(Number(sapoTotal) - webTotal) <= 1;

