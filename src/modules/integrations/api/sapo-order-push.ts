import { AppError } from '../../../core/errors.ts';
import type { sapoClient } from './sapo-client.ts';
import {
  buildSapoOrder, exactVariant, isSapoOrderFor, sapoCustomerMatches, sapoCustomerPayload, sapoProductPayload, sapoPushProblems,
  type SapoPushConfig, type SapoPushCustomer, type SapoPushInput, type SapoPushLine,
} from '../domain/sapo-order.ts';

/**
 * Đẩy đơn sang Sapo (port `sendSapoCopy` của web cũ), cùng thứ tự để không tạo trùng:
 *  1. Tìm đơn Sapo đã có cùng mã (số báo giá) → trả lại đơn đó, không tạo mới.
 *  2. Tìm / tạo khách hàng; tìm / tạo sản phẩm theo SKU.
 *  3. Tạo đơn nháp; Sapo đổi mã đơn thì sửa lại cho đúng số báo giá.
 *  4. Lỗi giữa chừng → tìm lại theo mã (có thể Sapo đã tạo xong) trước khi báo lỗi.
 */
type Api = ReturnType<typeof sapoClient>;
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const sapoOrderUrl = (base: string, id: unknown) => id ? `${base.replace(/\/+$/, '')}/orders/${encodeURIComponent(String(id))}` : '';

/** Kho (chi nhánh) Sapo đang hoạt động – để nhân viên chọn khi đẩy đơn. */
export async function sapoLocations(api: Api) {
  const body = await api.get('/locations.json?limit=250');
  const list: Raw[] = Array.isArray(body.locations) ? body.locations : [];
  return list.filter(l => !/inactive|deleted/i.test(String(l.status ?? ''))).map(l => ({ id: Number(l.id), name: String(l.label || l.name || l.id) })).filter(l => l.id > 0);
}

export async function sapoAccounts(api: Api): Promise<Raw[]> {
  try { const b = await api.get('/accounts.json?limit=250'); return Array.isArray(b.accounts) ? b.accounts : []; } catch (e) { if (e instanceof AppError && e.code === 'SAPO_SESSION_EXPIRED') throw e; return []; }
}

export async function findSapoOrder(api: Api, code: string): Promise<Raw | null> {
  for (const q of [...new Set([code, code.replace(/\D/g, '')].filter(x => x.length >= 3))]) {
    const body = await api.get('/orders.json?query=' + encodeURIComponent(q) + '&limit=50');
    const found = (Array.isArray(body.orders) ? body.orders : []).find((o: Raw) => isSapoOrderFor(o, code));
    if (found) return found;
  }
  return null;
}
const readOrder = async (api: Api, id: unknown) => (await api.get('/orders/' + encodeURIComponent(String(id)) + '.json')).order as Raw;

async function findCustomer(api: Api, c: SapoPushCustomer): Promise<Raw | null> {
  if (c.sapoId) {
    try { const b = await api.get('/customers/' + c.sapoId + '.json'); if (b.customer) return b.customer; }
    catch (e) { if (!(e instanceof AppError && e.code === 'SAPO_HTTP_404')) throw e; }
  }
  for (const q of [...new Set([c.customerCode, c.taxCode, c.phone, c.email, c.name].filter(Boolean))]) {
    const b = await api.get('/customers.json?query=' + encodeURIComponent(q) + '&limit=20');
    const hit = (Array.isArray(b.customers) ? b.customers : []).find((x: Raw) => sapoCustomerMatches(x, c));
    if (hit) return hit;
  }
  return null;
}
async function ensureCustomer(api: Api, c: SapoPushCustomer) {
  const found = await findCustomer(api, c);
  if (found) return { customer: found, action: 'existing' };
  try {
    const b = await api.send('POST', '/customers.json', { customer: sapoCustomerPayload(c) });
    const created = b.customer ?? b; if (created?.id) return { customer: created as Raw, action: 'created' };
  } catch (e) { if (e instanceof AppError && /SAPO_SESSION_EXPIRED|SAPO_PERMISSION_DENIED/.test(e.code ?? '')) throw e; }
  const again = await findCustomer(api, c);
  if (again) return { customer: again, action: 'existing_after_error' };
  throw new AppError(502, 'Không tạo được khách hàng trên Sapo.', 'SAPO_CUSTOMER_FAILED');
}

async function findVariant(api: Api, sku: string, locationId: number): Promise<Raw | null> {
  const b = await api.get(`/variants/search.json?query=${encodeURIComponent(sku)}&limit=20&location_id=${locationId}`);
  const v = exactVariant(Array.isArray(b.variants) ? b.variants : [], sku);
  if (v === 'duplicate') throw new AppError(409, `SKU ${sku} bị trùng trên Sapo – sửa trên Sapo rồi đẩy lại.`, 'SAPO_SKU_DUPLICATE');
  return v;
}
async function ensureVariant(api: Api, l: SapoPushLine, locationId: number) {
  const found = await findVariant(api, l.sku, locationId);
  if (found) return { variant: found, action: 'existing' };
  try {
    const b = await api.send('POST', '/products.json', { product: sapoProductPayload(l) });
    const p = b.product ?? b, v = (Array.isArray(p.variants) ? p.variants : []).find((x: Raw) => String(x.sku).toUpperCase() === l.sku.toUpperCase());
    if (v?.id) return { variant: { ...v, product_id: v.product_id ?? p.id } as Raw, action: 'created' };
  } catch (e) { if (e instanceof AppError && /SAPO_SESSION_EXPIRED|SAPO_PERMISSION_DENIED/.test(e.code ?? '')) throw e; }
  const again = await findVariant(api, l.sku, locationId);
  if (again) return { variant: again, action: 'existing_after_error' };
  throw new AppError(502, `Không tạo được sản phẩm Sapo cho SKU ${l.sku}.`, 'SAPO_PRODUCT_FAILED');
}

/** Sapo tự cấp mã đơn khác: sửa lại mã = số báo giá (như web cũ). */
async function keepCode(api: Api, id: unknown, code: string) {
  let order = await readOrder(api, id);
  if (order.code === code && order.reference_number === code) return order;
  await api.send('PUT', '/orders/' + encodeURIComponent(String(id)) + '.json', { order: { id, code, reference_number: code } });
  order = await readOrder(api, id);
  if (order.code !== code && order.reference_number !== code) throw new AppError(502, 'Sapo đã tạo đơn nhưng chưa giữ đúng số báo giá – kiểm tra trên Sapo.', 'SAPO_CODE_MISMATCH');
  return order;
}

export interface SapoPushResult { status: 'created' | 'existing'; order: Raw; customer?: { id: unknown; name: string; action: string }; products?: { sku: string; action: string }[]; errors?: string[] }

export async function pushSapoOrder(api: Api, input: SapoPushInput, cfg: SapoPushConfig, accountId: number | null): Promise<SapoPushResult> {
  const problems = sapoPushProblems(input);
  if (problems.length) throw new AppError(400, problems.join(' '), 'SAPO_PUSH_INVALID');
  const existing = await findSapoOrder(api, input.code);
  if (existing) return { status: 'existing', order: existing.id ? await readOrder(api, existing.id) : existing };

  const customer = await ensureCustomer(api, input.customer), variants: Raw[] = [], products: { sku: string; action: string }[] = [];
  for (const l of input.lines) { const r = await ensureVariant(api, l, cfg.locationId); variants.push(r.variant); products.push({ sku: l.sku, action: r.action }); }
  const order = buildSapoOrder(input, cfg, { customerId: customer.customer.id, accountId, variants });
  const summary = { customer: { id: customer.customer.id, name: String(customer.customer.name ?? ''), action: customer.action }, products };
  const errors: string[] = [];
  // Sapo từng nhận dòng hàng dưới tên `order_line_items` hoặc `line_items` (web cũ thử cả hai).
  for (const body of [{ order }, { order: { ...order, line_items: order.order_line_items } }]) {
    try {
      const b = await api.send('POST', '/orders.json', body), created = b.order ?? b;
      if (!created?.id) throw new AppError(502, 'Sapo chưa xác nhận mã đơn hàng.');
      return { status: 'created', order: await keepCode(api, created.id, input.code), ...summary, errors };
    } catch (e) {
      if (e instanceof AppError && /SAPO_SESSION_EXPIRED|SAPO_PERMISSION_DENIED|SAPO_CODE_MISMATCH/.test(e.code ?? '')) throw e;
      errors.push(e instanceof Error ? e.message : String(e));
      const made = await findSapoOrder(api, input.code);
      if (made) return { status: 'created', order: await readOrder(api, made.id), ...summary, errors };
    }
  }
  throw new AppError(502, 'Không tạo được đơn nháp Sapo. Kiểm tra trên Sapo trước khi thử lại để tránh tạo trùng.', 'SAPO_ORDER_FAILED');
}
