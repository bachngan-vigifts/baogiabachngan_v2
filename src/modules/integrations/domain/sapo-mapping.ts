/**
 * Chuyển dữ liệu Sapo (webhook gốc của Sapo hoặc luồng trung gian của web cũ) thành dữ liệu của app.
 * Hàm thuần, không đụng DB – port từ `lib/customer-sync.mjs`, `lib/staff-sync.mjs`, `lib/sapo-staff-status.mjs`
 * và `upsertSapoProductWebhook` (`lib/product-catalog.mjs`) của bản cũ.
 */

const str = (v: unknown, max = 500) => (v === undefined || v === null ? '' : String(v)).trim().slice(0, max);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, any> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : null;
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const time = (v: unknown, fallback: number) => { const t = Date.parse(str(v, 80)); return Number.isFinite(t) ? t : fallback; };
const plainFold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();

/** Lấy danh sách bản ghi từ thân yêu cầu: `{<key>s: [...]}`, `{<key>: {...}}`, `{data: ...}` hoặc chính bản ghi. */
export function records(body: Record<string, unknown>, plural: string, singular: string, extra: string[] = []): unknown[] {
  for (const k of [plural, ...extra]) if (Array.isArray(body[k])) return body[k] as unknown[];
  const one = body[singular] ?? body.data ?? body;
  return Array.isArray(one) ? one : [one];
}

/** Sapo gửi trạng thái dạng chuỗi hoặc boolean. */
export function isActiveSapoFlag(item: Record<string, any>): boolean {
  const inactive = (v: unknown) => v === false || v === 0 || ['false', '0', 'inactive', 'disabled', 'deleted', 'terminated', 'resigned'].includes(str(v).toLowerCase());
  return !inactive(item.active) && !inactive(item.is_active) && !inactive(item.status);
}

// ---------------- Khách hàng ----------------
export interface SapoCustomer { id: string; name: string; contact: string; phone: string; email: string; address: string; taxCode: string; customerCode: string; version: number; createdAt: string }

/** Chỉ nhận khách có MST và không phải "khách lẻ" (giống bản cũ). */
export const isEligibleSapoCustomer = (c: { name: string; taxCode: string }) =>
  /[1-9]/.test(c.taxCode) && !/^khach (?:hang )?le/.test(plainFold(c.name));

function addressText(c: Record<string, any>): string {
  const a = obj(c.default_address) ?? obj(c.defaultAddress) ?? obj(list(c.addresses)[0]) ?? {};
  return str(c.address || c.full_address || [a.address1 || a.address, a.ward, a.district, a.province, a.country].filter(Boolean).join(', '), 2000);
}

/** Một khách Sapo → dòng khách hàng; null nếu thiếu mã/tên. Mã Sapo là số (khách tạo trên web dùng UUID nên không bị ghi đè). */
export function mapSapoCustomer(raw: unknown, observed: number): SapoCustomer | null {
  const c = obj(raw); if (!c) return null;
  const id = str(c.id, 40), name = str(c.name || c.full_name || c.company);
  if (!/^\d{1,20}$/.test(id) || !name) return null;
  const created = time(c.createdAt || c.created_at || c.created_on, observed);
  return {
    id, name,
    contact: str(c.contact || c.contact_name || c.full_name || c.representative),
    phone: str(c.phone || c.mobile || c.phone_number, 100),
    email: str(c.email, 254).toLowerCase(),
    address: addressText(c),
    taxCode: str(c.taxCode || c.tax_code, 100),
    customerCode: str(c.customerCode || c.customer_code || c.code, 100),
    version: time(c.updatedAt || c.updated_at || c.modified_on, observed),
    createdAt: new Date(created).toISOString(),
  };
}

// ---------------- Nhân viên ----------------
export interface SapoStaff { sapoId: string; name: string; email: string; phone: string; active: boolean }

/** Một tài khoản Sapo (`/admin/accounts.json` hoặc dạng `members` của luồng web cũ) → nhân viên; null nếu thiếu mã/tên. */
export function mapSapoStaff(raw: unknown): SapoStaff | null {
  const a = obj(raw); if (!a) return null;
  const id = str(a.id, 80), email = str(a.email, 254).toLowerCase();
  const name = str(a.full_name || a.name || email, 200);
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || !name) return null;
  return { sapoId: 'SAPO-' + id.replace(/^SAPO-/, ''), name, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '', phone: str(a.phone || a.mobile_phone || a.mobile, 40), active: isActiveSapoFlag(a) };
}

// ---------------- Sản phẩm ----------------
export interface SapoVariant {
  sku: string; productId: string; active: boolean;
  name: string; brand: string; pattern: string; unit: string; imageUrl: string;
  taxBasis: string | null; taxable: boolean | null; taxIn: number | null; taxOut: number | null;
  /** Giá theo tên bảng giá Sapo; `retail` = giá bán lẻ mặc định của biến thể. */
  prices: Record<string, number | null>; retail: number | null;
  /** Tồn theo tên chi nhánh/kho Sapo. */
  stock: Record<string, number>;
}

const SAPO_IMAGE = /^https:\/\/(sapo|bizweb)\.dktcdn\.net\//;
function imageOf(p: Record<string, any>, v: Record<string, any>): string {
  for (const img of [...list(v.images), ...list(p.images)]) {
    const i = obj(img), url = str(i?.full_path || i?.src || i?.url || i?.path, 4000);
    if (SAPO_IMAGE.test(url)) return url;
  }
  const url = str(p.image_path || p.image, 4000);
  return SAPO_IMAGE.test(url) ? url : '';
}
const clampTax = (v: unknown) => { const n = num(v); return n !== null && n >= 0 && n <= 100 ? n : null; };

/** Một sản phẩm Sapo (kèm biến thể) → các biến thể có SKU. Biến thể/sản phẩm ngừng bán vẫn trả về với `active: false` để ẩn. */
export function mapSapoProduct(raw: unknown): { variants: SapoVariant[]; skipped: number } {
  const p = obj(raw); if (!p) return { variants: [], skipped: 1 };
  const productActive = !str(p.status) || str(p.status) === 'active';
  const variants: SapoVariant[] = []; let skipped = 0;
  const source = list(p.variants).length ? list(p.variants) : [p.variant ?? p];
  const productOpts = [p.opt1, p.opt2, p.opt3].map(x => str(x));
  for (const rawV of source) {
    const v = obj(rawV); if (!v) { skipped++; continue; }
    const sku = str(v.sku || v.barcode || v.code || p.sku || p.barcode, 500);
    if (!sku) { skipped++; continue; }
    const base = str(v.name || v.product_name || p.name || sku, 2000);
    const prices: Record<string, number | null> = {};
    for (const row of [...list(v.variant_prices), ...list(v.prices)]) {
      const r = obj(row), name = str(r?.price_list_name || r?.name || obj(r?.price_list)?.name, 200);
      const value = num(r?.value ?? r?.price);
      if (name) prices[name] = value !== null && value >= 0 ? value : null;
    }
    const stock: Record<string, number> = {};
    for (const row of list(v.inventories)) {
      const r = obj(row), name = str(r?.location_name || obj(r?.location)?.name || r?.location_label || r?.warehouse || r?.warehouse_name, 200);
      const value = num(r?.available ?? r?.on_hand ?? r?.amount ?? r?.quantity);
      if (name && value !== null) stock[name] = Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
    }
    const retail = num(v.price ?? v.retail_price ?? v.retailPrice);
    variants.push({
      sku, productId: str(p.id, 80), active: productActive && (!str(v.status) || str(v.status) === 'active'),
      name: base.includes(sku) ? base : `${base} (${sku})`,
      brand: str(p.brand || v.brand, 4000), unit: str(v.unit || p.unit, 4000),
      pattern: [v.opt1, v.opt2, v.opt3].map(x => str(x)).filter((x, i) => x && x !== productOpts[i] && x !== str(p.name)).join(' · '),
      imageUrl: imageOf(p, v),
      taxBasis: v.tax_included === true ? 'Giá đã bao gồm thuế' : null,
      taxable: typeof v.taxable === 'boolean' ? v.taxable : null,
      taxIn: clampTax(v.input_vat_rate), taxOut: clampTax(v.output_vat_rate),
      prices, retail: retail !== null && retail >= 0 ? retail : null, stock,
    });
  }
  return { variants, skipped };
}
