import { nextPosOrderNo } from './pos-number.ts';
import { posQrContent, reservedPosOrderNo, normalizePosReference, matchesPosQrReference, posQrOrderNumbers } from '../domain/pos-qr-reference.ts';
import { posCustomerIssue } from '../domain/pos-customer.ts';
import { filterPosOrderBoard } from '../domain/pos-order-board.ts';
import { posStockSources } from './pos-stock-sources.ts';
import { webOrderFinancials, readWebOrderFinancials } from '../domain/web-order-financials.ts';
import { invoiceTasksChanged } from './invoice-task-hooks.ts';
import { cashTasksChanged } from './invoice-task-hooks.ts';
import { notifyCashApprovers } from './cash-approval-notification.ts';
import { posExchangeAllocations } from '../return-schema.ts';
import { returnAccount, returnBalances, assertNoReturnActivity } from './pos-return-credit.ts';
import { allowedRegister, posScope } from './pos-access.ts';
import { allowedPosRegisters, assertSellRegister } from './pos-register-scope.ts';
import { canListRetailCustomers } from '../../customers/domain/customer-config.ts';
import { cashLock, nextCashOpening, closeCashShift, drawerOf, cashAudit, reconciliationFor } from './cash-store.ts';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { foldSql, matchAllWords, rankFirst, searchRank } from '../../../core/text/fold.ts';
import { matchProductWords, productOrder } from '../../catalog/api/product-query.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { can } from '../../staff/domain/permissions.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { employees, positions } from '../../staff/schema.ts';
import { defaultPosRegister } from '../domain/pos-register.ts';
import { products, productPrices, productBarcodes, pricePolicies, warehouses } from '../../catalog/schema.ts';
import { stockBalances, stockMoves } from '../../inventory/schema.ts';
import { reverseRef } from '../../inventory/api/ledger.ts';
import type { StockRefType } from '../../inventory/domain/kinds.ts';
import { customers, customerStaff } from '../../customers/schema.ts';
import { customerIdentityLock, findCustomerDuplicates, rejectDuplicate } from '../../customers/api/identity.ts';
import { customerInput } from '../../customers/domain/customer-input.ts';
import { customerPhoneKeys, identityKeys } from '../../customers/domain/identity.ts';
/** Khách chung cho người mua không để lại SĐT / MST ở quầy. */
const CONSUMER_NAME = 'Bán người tiêu dùng', CONSUMER_CODE = 'BAN-NGUOI-TIEU-DUNG';
import { customerPayments, salesOrders, salesOrderLines, deliveries, packingSlips } from '../schema.ts';
import { posRegisters, posShifts, posShiftTemplates, posPaymentRequests, webStoreOrders } from '../pos-schema.ts';
import { posMoney } from '../domain/pos-money.ts';
import { vietnamDate } from '../domain/sales.ts';
import { writeAudit } from '../../../core/audit.ts';
import { sendPosOrderToClaw } from './pos-sapo.ts';
import { sendPosShiftReport } from './pos-shift-report-webhook.ts';
import { notifyPosOrderCreated } from './pos-notifications.ts';
import ghnLocations from '../data/ghn-locations.json' with { type: 'json' };
import {
  posNow,
  posText,
  posKey,
  posPermission,
  shiftOf,
  saleShiftOf,
  sharedSaleShiftScope,
  assertOpen,
  registerOf,
  assertOpening,
  calculateCart,
  checkout,
  reservedBySku,
  shiftReport,
} from './pos-store.ts';
import { autoCreateGhnForOrder } from './pos-ghn-create.ts';
import { cancelWebOrderGhn, createWebOrderGhn, minhLongDirect, suggestedWebCod } from './web-order-ghn.ts';
import { GHN_FAILED, GHN_WAITING, webGhnOrderStatus } from '../domain/ghn-status.ts';
import { readWebBridgeResult, validWebGhnCode } from './web-order-bridge-result.ts';
const member = (c: RouteContext<StaffEnv>) => (c.state.session as SessionState).member;
const ghnLocationCache = new Map<string, { expires: number; locations: unknown[] }>();
const ghnCacheKey = (source: string, provinceId: number, districtId: number) => `${source}:${provinceId}:${districtId}`;
const cachedGhnLocations = (key: string) => { const hit = ghnLocationCache.get(key); if (!hit || hit.expires < Date.now()) { ghnLocationCache.delete(key); return null; } return hit.locations; };
const rememberGhnLocations = (key: string, locations: unknown[]) => { ghnLocationCache.set(key, { expires: Date.now() + 24 * 60 * 60 * 1000, locations }); return locations; };
const completeGhnAddress = (raw: unknown) => {
  const x = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const address = { addressLine: posText(x.addressLine, 300), provinceId: Math.max(0, Number(x.provinceId) || 0), provinceName: posText(x.provinceName, 100),
    districtId: Math.max(0, Number(x.districtId) || 0), districtName: posText(x.districtName, 100), wardCode: posText(x.wardCode, 50), wardName: posText(x.wardName, 100) };
  return address.addressLine && address.provinceId && address.provinceName && address.districtId && address.districtName && address.wardCode && address.wardName ? address : null;
};
type GhnPair = [number | string, string];
const bundledGhnLocations = (provinceId: number, districtId: number) => {
  const data = ghnLocations as unknown as { p: GhnPair[]; d: Record<string, GhnPair[]>; w: Record<string, GhnPair[]> };
  const rows = districtId ? data.w[String(districtId)] : provinceId ? data.d[String(provinceId)] : data.p;
  if (!rows) return null;
  return rows.map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
};
/** Danh mục Tỉnh / Quận / Phường trực tiếp từ GHN (cần GHN_API_TOKEN) – dùng khi bản đóng gói sẵn thiếu (vd quận mới tách). */
async function ghnMasterData(env: StaffEnv, provinceId: number, districtId: number, token = env.ghnToken || env.ghnMlToken) {
  const path = districtId ? `/master-data/ward?district_id=${districtId}` : provinceId ? '/master-data/district' : '/master-data/province';
  // Danh mục địa chỉ GHN như nhau giữa các shop: mặc định token Lock, không có thì token Minh Long.
  if (!token) throw new AppError(503, 'CRM chưa có token GHN cho cửa hàng này.');
  const init: RequestInit = { method: provinceId && !districtId ? 'POST' : 'GET', headers: { Token: token, 'content-type': 'application/json' } };
  if (provinceId && !districtId) init.body = JSON.stringify({ province_id: provinceId });
  const response = await (env.ghnFetch ?? fetch)('https://online-gateway.ghn.vn/shiip/public-api' + path, init);
  let result: Record<string, unknown> = {}; try { result = await response.json() as Record<string, unknown>; } catch { /* GHN trả text khi lỗi */ }
  if (!response.ok || !Array.isArray(result.data)) throw new AppError(502, posText(result.message, 500) || 'GHN không trả danh mục địa chỉ.');
  return (result.data as Record<string, unknown>[]).filter(x => Number(x.Status ?? 1) === 1).map(x => ({
    id: districtId ? posText(x.WardCode, 50) : Number(x.DistrictID ?? x.ProvinceID),
    name: posText(x.WardName ?? x.DistrictName ?? x.ProvinceName, 100),
  })).filter(x => x.id && x.name).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}
let lockGhnNonceCache: { nonce: string; expires: number } | null = null;
async function lockGhnCheckoutNonce() {
  if (lockGhnNonceCache && lockGhnNonceCache.expires > Date.now()) return lockGhnNonceCache.nonce;
  const cart = await fetch('https://locknlockonline.com/?add-to-cart=19320', { redirect: 'manual' }), rawCookie = cart.headers.get('set-cookie') || '';
  const cookie = [...rawCookie.matchAll(/(?:^|, )([^=;, ]+=[^;]*)/g)].map(x => x[1]).join('; ');
  const page = await fetch('https://locknlockonline.com/thanh-toan/', { headers: cookie ? { cookie } : undefined }), html = await page.text();
  const nonce = /var\s+nonce\s*=\s*["']([a-f0-9]+)["']/.exec(html)?.[1] || '';
  if (!nonce) throw new AppError(502, 'Không lấy được phiên danh mục địa chỉ từ web Lock.');
  lockGhnNonceCache = { nonce, expires: Date.now() + 6 * 60 * 60 * 1000 }; return nonce;
}
async function lockGhnLocations(provinceId: number, districtId: number) {
  const nonce = await lockGhnCheckoutNonce(), form = new URLSearchParams({ nonce });
  form.set('action', districtId ? 'lnl_ghn_checkout_communes' : provinceId ? 'lnl_ghn_checkout_districts' : 'lnl_ghn_checkout_provinces');
  if (districtId) form.set('district_id', String(districtId)); else if (provinceId) form.set('province_id', String(provinceId));
  const response = await fetch('https://locknlockonline.com/wp-admin/admin-ajax.php', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: form });
  const result = await response.json() as { success?: boolean; data?: unknown[] };
  if (!response.ok || !result.success || !Array.isArray(result.data)) { lockGhnNonceCache = null; throw new AppError(502, 'Web Lock không trả danh mục địa chỉ GHN.'); }
  return result.data;
}
function config(c: RouteContext<StaffEnv>) {
  if (!can(member(c), 'pos.configure')) throw new AppError(403, 'Chỉ người được cấp cấu hình POS thao tác.');
}
function posOrderBucket(o: { status: string; fulfillmentMode: string; packingStatus: string; deliveryStatus: string }) {
  if (o.status === 'cancelled') return 'cancelled';
  if (o.status === 'delivered') return 'completed';
  if (o.deliveryStatus === 'planned' || o.deliveryStatus === 'in_transit' || o.deliveryStatus === 'failed' || o.status === 'delivering') return 'waiting_delivery';
  if (o.packingStatus === 'draft' || o.packingStatus === 'sent') return 'packing';
  if (o.fulfillmentMode === 'cod') return 'waiting_delivery';
  return 'pending';
}
const webBucket = (status: string, ghnStatus = '') => {
  if (['refunded', 'trash'].includes(status.toLowerCase())) return 'cancelled';
  const g = ghnStatus.toLowerCase();
  if (g === 'delivered') return 'completed';
  if (GHN_FAILED.has(g)) return 'cancelled';
  if (GHN_WAITING.has(g)) return 'waiting_delivery';
  const s = status.toLowerCase();
  if (['cancelled', 'refunded', 'failed', 'trash'].includes(s)) return 'cancelled';
  if (['completed'].includes(s)) return 'completed';
  if (['shipped', 'out-for-delivery', 'delivery', 'delivering'].includes(s)) return 'waiting_delivery';
  if (['packing', 'packed'].includes(s)) return 'packing';
  return 'pending';
};
/**
 * Đơn web Minh Long khi website chưa có cầu nối: CRM tự xử lý (web-order-ghn.ts). Xác nhận = tạo vận đơn GHN Minh Long;
 * huỷ = huỷ vận đơn GHN trước rồi mới huỷ đơn; hoàn thành = ghi nhận trong CRM. Website không nhận lại trạng thái.
 */
async function minhLongWebAction(c: RouteContext<StaffEnv>, m: ReturnType<typeof member>, order: typeof webStoreOrders.$inferSelect, action: string, input: Record<string, unknown>, reason: string) {
  const terminal = webBucket(order.status, order.ghnStatus);
  if (action === 'confirm' && terminal !== 'pending') throw new AppError(409, 'Chỉ chốt được đơn đang chờ xử lý.');
  if (action === 'cancel' && ['completed', 'cancelled'].includes(terminal)) throw new AppError(409, terminal === 'completed' ? 'Đơn đã giao thành công, không thể huỷ.' : 'Đơn đã huỷ.');
  let fields: Partial<typeof webStoreOrders.$inferInsert>;
  if (action === 'confirm') {
    const address = completeGhnAddress(input);
    if (!address) throw new AppError(400, 'Vui lòng nhập đủ địa chỉ giao hàng GHN.', 'address_invalid');
    const created = await createWebOrderGhn(c.env, order.id, address, input);
    fields = created.order;
  } else if (action === 'cancel') {
    if (order.ghnOrderCode && !['cancel', 'cancelled'].includes(order.ghnStatus.toLowerCase())) await cancelWebOrderGhn(c.env, order.ghnOrderCode);
    fields = { status: 'cancelled', ...(order.ghnOrderCode ? { ghnStatus: 'cancel' } : {}), updatedAt: posNow() };
  } else fields = {};
  if (Object.keys(fields).length && action !== 'confirm') await c.env.db.update(webStoreOrders).set(fields).where(eq(webStoreOrders.id, order.id));
  const next = { ...order, ...fields };
  await invoiceTasksChanged(c.env, { webOrderId: order.id }, m.id);
  await writeAudit(c.env.db, { actorId: m.id, module: 'sales', action: `web-order-${action}`, entityType: 'web-store-order', entityId: order.id,
    data: { source: order.source, externalId: order.externalId, orderNo: order.orderNo, status: next.status, ghnOrderCode: next.ghnOrderCode, ghnStatus: next.ghnStatus, direct: true, ...(reason ? { reason } : {}) } });
  return { ok: true, status: next.status, ghnOrderCode: next.ghnOrderCode, ghnStatus: next.ghnStatus, ghnSortCode: next.ghnSortCode, ghnFee: next.ghnFee, updatedAt: next.updatedAt,
    bucket: webBucket(next.status, next.ghnStatus) };
}
export function registerPosRoutes(router: Router<StaffEnv>) {
  router.post('/integrations/woocommerce/:source/order', async c => {
    const source = c.params.source === 'lock' ? 'lock' : c.params.source === 'minhlong' ? 'minhlong' : '';
    if (!source) throw new AppError(404, 'Nguồn website không hợp lệ.');
    const tokenHash = sha256Hex(c.url.searchParams.get('token') || '');
    // Không có mã dự phòng trong code: thiếu biến môi trường thì từ chối mọi webhook (fail closed).
    const expected = (source === 'lock' ? c.env.wooLockTokenHash : c.env.wooMinhLongTokenHash) || '';
    if (!expected || tokenHash !== expected) throw new AppError(401, 'Webhook không đúng website.');
    const b = await readJson(c.req, 256_000), externalId = posText(String(b.id ?? ''), 80), number = posText(String(b.number ?? b.id ?? ''), 100);
    if (!externalId || !number) throw new AppError(400, 'Đơn WooCommerce thiếu ID hoặc số đơn.');
    const wantedName = source === 'lock' ? 'CỬA HÀNG LOCKNLOCK CẦN THƠ' : 'Showroom Gốm Sứ Minh Long Cần Thơ';
    const regs = await c.env.db.select().from(posRegisters).where(eq(posRegisters.active, true));
    const register = regs.find(r => r.name.trim().toLowerCase() === wantedName.toLowerCase());
    if (!register) throw new AppError(409, `CRM chưa có quầy ${wantedName}.`);
    const billing = b.billing && typeof b.billing === 'object' ? b.billing as Record<string, unknown> : {};
    const rawShipping = b.shipping && typeof b.shipping === 'object' ? b.shipping as Record<string, unknown> : {};
    const hasShippingAddress = [rawShipping.address_1, rawShipping.address_2, rawShipping.city, rawShipping.state].some(x => String(x ?? '').trim());
    const shipping = hasShippingAddress ? rawShipping : billing;
    const fullName = posText([billing.first_name, billing.last_name].filter(Boolean).join(' '), 200) || 'Khách lẻ';
    const address = posText([shipping.address_1, shipping.address_2, shipping.city, shipping.state].filter(Boolean).join(', '), 1000);
    const lines = Array.isArray(b.line_items) ? b.line_items.slice(0, 300).map((x: Record<string, unknown>) => ({
      sku: posText(x.sku, 100), name: posText(x.name, 500), quantity: Number(x.quantity) || 0, total: Number(x.total) || 0,
    })) : [];
    const metadata = new Map<string, unknown>();
    if (Array.isArray(b.meta_data)) for (const row of b.meta_data) {
      if (row && typeof row === 'object') metadata.set(posText((row as Record<string, unknown>).key, 200), (row as Record<string, unknown>).value);
    }
    const meta = (...keys: string[]) => {
      for (const key of keys) { const value = metadata.get(key); if (value !== undefined && value !== null && String(value).trim()) return value; }
      return '';
    };
    // Checkout Lock lưu mã GHN theo shipping/billing. Giữ cả fallback tên cũ để các đơn trước đây vẫn tự điền được.
    const addressPrefix = hasShippingAddress ? 'shipping' : 'billing';
    const ghnAddress = {
      addressLine: posText(shipping.address_1, 300),
      provinceId: Math.max(0, Number(meta(`_lnl_ghn_${addressPrefix}_province_id`, '_lnl_ghn_province_id')) || 0),
      provinceName: posText(meta(`_lnl_ghn_${addressPrefix}_province_name`, '_lnl_ghn_province_name') || shipping.state, 100),
      districtId: Math.max(0, Number(meta(`_lnl_ghn_${addressPrefix}_district_id`, '_lnl_ghn_district_id')) || 0),
      districtName: posText(meta(`_lnl_ghn_${addressPrefix}_district_name`, '_lnl_ghn_district_name') || shipping.city, 100),
      wardCode: posText(meta(`_lnl_ghn_${addressPrefix}_ward_code`, '_lnl_ghn_ward_code'), 50),
      wardName: posText(meta(`_lnl_ghn_${addressPrefix}_ward_name`, '_lnl_ghn_ward_name') || shipping.address_2, 100),
    };
    const financials = webOrderFinancials(b);
    // Woo's paid timestamp is explicit evidence. Neither order status nor payment method proves collection.
    const hasPayment = Object.hasOwn(b, 'date_paid_gmt') || Object.hasOwn(b, 'date_paid');
    let snapshot = financials;
    if (hasPayment || financials) {
      const [previous] = await c.env.db.select({ snapshot: webStoreOrders.financialSnapshot }).from(webStoreOrders)
        .where(and(eq(webStoreOrders.source, source), eq(webStoreOrders.externalId, externalId))).limit(1);
      const old = readWebOrderFinancials(previous?.snapshot);
      snapshot = financials || old || webOrderFinancials({ shipping_total: null })!;
      if (hasPayment) {
        const raw = Object.hasOwn(b, 'date_paid_gmt') ? b.date_paid_gmt : b.date_paid;
        if (raw !== null && (typeof raw !== 'string' || !Number.isFinite(Date.parse(raw)))) throw new AppError(400, 'Ngày thanh toán đơn web không hợp lệ.');
        snapshot = { ...snapshot, payment: { paidAt: raw === null ? null : String(raw) } };
      } else if (old?.payment) snapshot = { ...snapshot, payment: old.payment };
    }
    const now = posNow(), fields = {
      orderNo: number, registerId: register.id, status: posText(b.status, 50) || 'pending',
      customerName: fullName, phone: posText(billing.phone, 60), email: posText(billing.email, 200), address,
      ghnAddressSnapshot: JSON.stringify(ghnAddress),
      total: Math.max(0, Number(b.total) || 0), currency: posText(b.currency, 20) || 'VND', paymentMethod: posText(b.payment_method_title ?? b.payment_method, 200),
      ...(snapshot ? {financialSnapshot: JSON.stringify(snapshot)} : {}),
      lines: JSON.stringify(lines), orderedAt: posText(b.date_created_gmt ?? b.date_created, 60) || now, updatedAt: posText(b.date_modified_gmt ?? b.date_modified, 60) || now,
      ghnOrderCode: posText(metadata.get('_lnl_ghn_order_code'), 100), ghnStatus: posText(metadata.get('_lnl_ghn_last_status'), 100),
      ghnSortCode: posText(metadata.get('_lnl_ghn_sort_code'), 100), ghnFee: Math.max(0, Number(metadata.get('_lnl_ghn_total_fee')) || 0),
    };
    // Some bridges send a status-only event. Do not erase the last source financial/customer details.
    const updateFields: Partial<typeof fields> = {...fields};
    if(b.number === undefined) delete updateFields.orderNo;
    if(b.status === undefined) delete updateFields.status;
    if(b.total === undefined) delete updateFields.total;
    if(b.currency === undefined) delete updateFields.currency;
    if(b.payment_method_title === undefined && b.payment_method === undefined) delete updateFields.paymentMethod;
    if(!Array.isArray(b.line_items)) delete updateFields.lines;
    if(b.date_created_gmt === undefined && b.date_created === undefined) delete updateFields.orderedAt;
    if(b.billing === undefined){delete updateFields.customerName;delete updateFields.phone;delete updateFields.email;}
    if(b.shipping === undefined && b.billing === undefined) { delete updateFields.address; delete updateFields.ghnAddressSnapshot; }
    if(!Array.isArray(b.meta_data)){delete updateFields.ghnOrderCode;delete updateFields.ghnStatus;delete updateFields.ghnSortCode;delete updateFields.ghnFee;}
    if (minhLongDirect(c.env, { source })) {
      // Web Minh Long chưa có cầu nối: vận đơn GHN do CRM tạo (website không biết) – không xoá mã GHN; đơn CRM đã huỷ / hoàn thành không bị website kéo về "chờ xử lý".
      if (!fields.ghnOrderCode) { delete updateFields.ghnOrderCode; delete updateFields.ghnStatus; delete updateFields.ghnSortCode; delete updateFields.ghnFee; }
      const [current] = await c.env.db.select({ status: webStoreOrders.status, ghnStatus: webStoreOrders.ghnStatus }).from(webStoreOrders)
        .where(and(eq(webStoreOrders.source, source), eq(webStoreOrders.externalId, externalId))).limit(1);
      const done = current && ['completed', 'cancelled'].includes(webBucket(current.status, current.ghnStatus));
      if (done && updateFields.status && !['completed', 'cancelled'].includes(webBucket(updateFields.status))) delete updateFields.status;
      if (current?.ghnStatus && updateFields.status && webBucket(updateFields.status) === 'pending') delete updateFields.status;
    }
    // Website labels/status-only events cannot overwrite the carrier's known shipping outcome.
    const [carrierState] = await c.env.db.select({ status: webStoreOrders.status, code: webStoreOrders.ghnOrderCode, ghnStatus: webStoreOrders.ghnStatus }).from(webStoreOrders)
      .where(and(eq(webStoreOrders.source, source), eq(webStoreOrders.externalId, externalId))).limit(1);
    if (carrierState?.code && !fields.ghnOrderCode) {
      delete updateFields.ghnOrderCode; delete updateFields.ghnStatus; delete updateFields.ghnSortCode; delete updateFields.ghnFee;
    }
    if (carrierState?.ghnStatus === 'delivered' && (!fields.ghnOrderCode || fields.ghnOrderCode === carrierState.code)) updateFields.ghnStatus = 'delivered';
    fields.status = webGhnOrderStatus(fields.ghnStatus, fields.status);
    const effectiveGhnStatus = updateFields.ghnStatus ?? carrierState?.ghnStatus ?? fields.ghnStatus;
    if (effectiveGhnStatus) updateFields.status = webGhnOrderStatus(effectiveGhnStatus, updateFields.status ?? carrierState?.status ?? fields.status);
    const [saved] = await c.env.db.insert(webStoreOrders).values({ id: crypto.randomUUID(), source, externalId, ...fields })
      .onConflictDoUpdate({ target: [webStoreOrders.source, webStoreOrders.externalId], set: updateFields }).returning({ id: webStoreOrders.id });
    await invoiceTasksChanged(c.env, { webOrderId: saved!.id });
    return json({ ok: true, source, externalId, registerId: register.id });
  }, 'web-order-sync');
  /** Proxy master-data GHN riêng cho checkout Minh Long; token tài khoản GHN không bao giờ đưa ra trình duyệt/WordPress. */
  router.post('/integrations/woocommerce/minhlong/ghn-locations', async c => {
    const tokenHash = sha256Hex(c.url.searchParams.get('token') || '');
    if (!c.env.wooMinhLongTokenHash || tokenHash !== c.env.wooMinhLongTokenHash) throw new AppError(401, 'Webhook không đúng website.');
    const b = await readJson(c.req, 2000), provinceId = Math.max(0, Number(b.provinceId) || 0), districtId = Math.max(0, Number(b.districtId) || 0);
    const key = ghnCacheKey('minhlong', provinceId, districtId), cached = cachedGhnLocations(key);
    if (cached) return json({ ok: true, locations: cached, cached: true });
    return json({ ok: true, locations: rememberGhnLocations(key, await ghnMasterData(c.env, provinceId, districtId, c.env.ghnMlToken)) });
  }, 'web-order-sync');
  router.post(
    '/integrations/sepay/pos-payment',
    async (c) => {
      const b = await readJson(c.req, 32000);
      const transferType = posText(b.transferType ?? b.transfer_type, 20).toLowerCase();
      const amount = Number(b.transferAmount ?? b.transfer_amount ?? b.amount);
      const account = posText(b.accountNumber ?? b.account_number, 100).replace(/\s+/g, '');
      const rawCode = posText(b.code, 100), content = posText(b.content ?? b.description, 1000);
      const normalized = normalizePosReference(rawCode + ' ' + content);
      if (transferType !== 'in' || !Number.isFinite(amount) || amount <= 0 || !normalized.includes('POS'))
        throw new AppError(400, 'Giao dịch SePay không hợp lệ.');
      const rows = await c.env.db.select({ request: posPaymentRequests, bankAccount: posRegisters.bankAccount })
        .from(posPaymentRequests)
        .innerJoin(posShifts, eq(posShifts.id, posPaymentRequests.shiftId))
        .innerJoin(posRegisters, eq(posRegisters.id, posShifts.registerId))
        .where(or(
          ...posQrOrderNumbers(normalized).map(no => sql`${posPaymentRequests.cart} like ${'%"reservedOrderNo":"' + no + '"%'} `),
          sql`position(('POS' || left(upper(replace(${posPaymentRequests.id},'-','')),12)) in ${normalized}) > 0`,
        )).orderBy(desc(posPaymentRequests.createdAt));
      const matches = rows.filter(x => matchesPosQrReference(x.request, normalized));
      if (matches.length > 1) throw new AppError(409, 'Nội dung chuyển khoản khớp nhiều yêu cầu QR.');
      const hit = matches[0];
      if (!hit) throw new AppError(404, 'Không tìm thấy yêu cầu QR POS tương ứng.');
      if (account && account !== hit.bankAccount.replace(/\s+/g, '')) throw new AppError(400, 'Tài khoản nhận tiền không thuộc quầy POS này.');
      if (Math.round(amount) !== Math.round(hit.request.amount)) throw new AppError(409, 'Số tiền SePay không khớp yêu cầu QR POS.');
      const requiresReconciliation=await c.env.db.transaction(async tx=>{
        await cashLock(tx);
        const [request]=await tx.select().from(posPaymentRequests).where(eq(posPaymentRequests.id,hit.request.id));
        const allocationId=JSON.parse(request!.cart).exchangeAllocationId;
        const [allocation]=allocationId?await tx.select().from(posExchangeAllocations).where(eq(posExchangeAllocations.id,allocationId)):[];
        const late=!!allocationId&&(!allocation||allocation.status==='cancelled');
        if(!request!.confirmedAt){
          await tx.update(posPaymentRequests).set({confirmedAt:posNow()}).where(eq(posPaymentRequests.id,request!.id));
          if(late){const [shift]=await tx.select().from(posShifts).where(eq(posShifts.id,request!.shiftId));await cashAudit(tx,shift!.memberId,'late-exchange-transfer','pos-qr',request!.id,{amount,allocationId,requiresReconciliation:true});}
        }
        return late;
      });
      return json({ success: true, paymentRequestId: hit.request.id, alreadyConfirmed: !!hit.request.confirmedAt, ...(requiresReconciliation?{requiresReconciliation:true}:{} ) });
    },
    'sepay-sync',
  );
  router.get(
    '/pos/orders',
    async (c) => {
      const m = member(c);
      posPermission(m);
      const scope = await allowedPosRegisters(c), requested = posText(c.url.searchParams.get('registerId'));
      if (requested && !scope.ids.has(requested)) throw new AppError(403, 'Bạn không được xem đơn của cửa hàng này.');
      const registerId = requested || scope.regs[0]?.id || '';
      if (!registerId) return json({ registers: scope.regs, registerId: '', counts: { all: 0, web: 0, pending: 0, packing: 0, waiting_delivery: 0, completed: 0, cancelled: 0 }, orders: [] });
      // Lọc ngay trong SQL (nguồn, nhân viên, ngày, từ khoá) để không tải toàn bộ lịch sử quầy mỗi lần mở bảng.
      // Chưa chọn ngày: đơn đã xong / đã huỷ chỉ lấy 30 ngày gần nhất; đơn còn dang dở luôn hiện dù cũ.
      const p = c.url.searchParams, source = p.get('source') || 'all', ownerId = posText(p.get('ownerId'), 80);
      const isDay = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const from = isDay(p.get('from')) ? p.get('from')! : '', to = isDay(p.get('to')) ? p.get('to')! : '';
      const windowFrom = from || to ? '' : new Date(Date.parse(vietnamDate().iso) - 30 * 86_400_000).toISOString().slice(0, 10);
      const q = posText(p.get('q'), 200);
      const crmWanted = source === 'all' || source === 'pos' || source === 'cod', webWanted = (source === 'all' || source === 'web') && !ownerId;
      const rows = !crmWanted ? [] : await c.env.db.select({
        id: salesOrders.id, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, phone: salesOrders.phone,
        ownerId: salesOrders.ownerId, ownerName: employees.name, paid: sql<number>`(select coalesce(sum(${customerPayments.amount}),0) from ${customerPayments} where ${customerPayments.orderId}=${salesOrders.id} and ${customerPayments.voidedAt} is null)`.mapWith(Number), total: salesOrders.total, status: salesOrders.status, fulfillmentMode: salesOrders.fulfillmentMode,
        orderDate: salesOrders.orderDate, createdAt: salesOrders.createdAt, sapoOrderId: salesOrders.sapoOrderId, sapoOrderCode: salesOrders.sapoOrderCode,
        packingStatus: sql<string>`coalesce((select ${packingSlips.status} from ${packingSlips} where ${packingSlips.orderId}=${salesOrders.id} and ${packingSlips.status}<>'cancelled' order by ${packingSlips.updatedAt} desc limit 1),'')`,
        deliveryStatus: sql<string>`coalesce((select ${deliveries.status} from ${deliveries} where ${deliveries.orderId}=${salesOrders.id} and ${deliveries.status}<>'cancelled' order by ${deliveries.plannedDate} desc limit 1),'')`,
        cancelledReturnQty: sql<number>`case when exists(select 1 from pos_returns r where r.order_id=${salesOrders.id} and r.status not in ('cancelled','rejected')) then 0 else greatest(0, -coalesce((select sum(m.qty) from ${stockMoves} m where
          (m.ref_type='pos_order' and m.ref_id=${salesOrders.id}) or
          (m.ref_type='packing_slip' and exists(select 1 from ${packingSlips} p where p.id=m.ref_id and p.order_id=${salesOrders.id})) or
          (m.ref_type='pos_delivery' and exists(select 1 from ${deliveries} d where d.id=m.ref_id and d.order_id=${salesOrders.id}))), 0)) end`.mapWith(Number),
      }).from(salesOrders)
        .innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
        .leftJoin(employees, eq(employees.id, salesOrders.ownerId))
        .where(and(eq(salesOrders.channel, 'pos'), eq(posShifts.registerId, registerId),
          source === 'cod' ? eq(salesOrders.fulfillmentMode, 'cod') : source === 'pos' ? ne(salesOrders.fulfillmentMode, 'cod') : undefined,
          ownerId ? eq(salesOrders.ownerId, ownerId) : undefined,
          from ? gte(salesOrders.orderDate, from) : undefined, to ? lte(salesOrders.orderDate, to) : undefined,
          windowFrom ? or(notInArray(salesOrders.status, ['delivered', 'cancelled']), gte(salesOrders.orderDate, windowFrom)) : undefined,
          matchAllWords(foldSql(salesOrders.orderNo, salesOrders.customerName, salesOrders.phone, salesOrders.sapoOrderCode, employees.name), q)))
        .orderBy(...rankFirst(searchRank([salesOrders.orderNo, salesOrders.phone, salesOrders.sapoOrderCode], salesOrders.customerName, q)), desc(salesOrders.createdAt));
      const webRows = !webWanted ? [] : await c.env.db.select().from(webStoreOrders).where(and(eq(webStoreOrders.registerId, registerId),
        from ? gte(webStoreOrders.orderedAt, from) : undefined, to ? lte(webStoreOrders.orderedAt, to + 'T23:59:59.999Z') : undefined,
        windowFrom ? or(notInArray(webStoreOrders.status, ['completed', 'cancelled', 'refunded', 'failed', 'trash']), gte(webStoreOrders.orderedAt, windowFrom)) : undefined))
        .orderBy(desc(webStoreOrders.updatedAt));
      const decorated = [
        ...rows.map(o => ({ ...o, bucket: posOrderBucket(o), source: 'crm', external: false, currency: 'VND', orderSource: o.fulfillmentMode === 'cod' ? 'cod' : 'pos', paymentStatus: o.paid >= o.total ? 'paid' : 'debt', outstanding: Math.max(0, o.total-o.paid) })),
        ...webRows.map(o => {
          const payment = readWebOrderFinancials(o.financialSnapshot)?.payment;
          const paid = payment ? (payment.paidAt ? o.total : 0) : null;
          return ({ ownerId: '', orderSource: 'web', paymentStatus: paid === null ? 'unknown' : paid >= o.total ? 'paid' : 'debt', paid, outstanding: paid === null ? null : Math.max(0, o.total-paid), id: o.id, orderNo: o.orderNo, customerName: o.customerName, phone: o.phone, ownerName: o.source === 'lock' ? 'Web LocknLock' : 'Web Minh Long', total: o.total,
          status: o.status, fulfillmentMode: 'delivery', orderDate: o.orderedAt.slice(0, 10), createdAt: o.orderedAt, sapoOrderId: null, sapoOrderCode: null,
          packingStatus: '', warehouseReconciliationRequired:true, deliveryStatus: o.ghnStatus, bucket: webBucket(o.status, o.ghnStatus), source: o.source, external: true, lines: o.lines, address: o.address,
          ghnAddress: (() => { try { return JSON.parse(o.ghnAddressSnapshot || '{}'); } catch { return {}; } })(),
          paymentMethod: o.paymentMethod, currency: o.currency, financials: readWebOrderFinancials(o.financialSnapshot), ghnOrderCode: o.ghnOrderCode, ghnStatus: o.ghnStatus, ghnSortCode: o.ghnSortCode, ghnFee: o.ghnFee,
          actionsAvailable: o.source === 'lock' && !!c.env.webOrderAction?.lockUrl || o.source === 'minhlong' && (!!c.env.webOrderAction?.minhlongUrl || !!c.env.ghnMlToken),
          // Minh Long chưa có cầu nối: CRM tự tạo vận đơn GHN – giao diện hỏi thêm tiền thu hộ / khối lượng.
          ghnDirect: minhLongDirect(c.env, o), suggestedCod: minhLongDirect(c.env, o) ? suggestedWebCod(o) : null }); }),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const board = filterPosOrderBoard(decorated, c.url.searchParams);
      // Danh sách nhân viên cho bộ lọc lấy riêng, không bị thu hẹp bởi chính bộ lọc / khoảng ngày.
      board.owners = (await c.env.db.selectDistinct({ id: salesOrders.ownerId, name: employees.name }).from(salesOrders)
        .innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId)).leftJoin(employees, eq(employees.id, salesOrders.ownerId))
        .where(and(eq(salesOrders.channel, 'pos'), eq(posShifts.registerId, registerId))))
        .filter((o): o is { id: string; name: string | null } => !!o.id).map(o => ({ id: o.id, name: o.name || 'Chưa có tên' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      // Số đếm và tổng tiền tính trên toàn bộ kết quả lọc; danh sách trả theo trang 100 đơn.
      const offset = Math.max(0, Math.min(1_000_000, Number(p.get('offset')) || 0)), pageSize = 100;
      const orders = board.orders.slice(offset, offset + pageSize);
      return json({ registers: scope.regs.map(r => ({ id: r.id, name: r.name })), registerId, canViewAllRegisters: scope.all, ...board, orders,
        totalOrders: board.orders.length, nextOffset: offset + pageSize < board.orders.length ? offset + pageSize : null, windowFrom: windowFrom || null });
    },
    'business',
  );
  // Cùng quyền/quầy với thao tác nhận hoàn; dùng tại chi tiết đơn, không phụ thuộc bộ lọc bảng POS.
  router.get('/pos/orders/:id/cancelled-stock', async c => {
    const m = member(c); posPermission(m);
    const scope = await allowedPosRegisters(c), orderId = c.params.id!;
    const [found] = await c.env.db.select({ order: salesOrders, registerId: posShifts.registerId })
      .from(salesOrders).innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
      .where(and(eq(salesOrders.id, orderId), eq(salesOrders.channel, 'pos'))).limit(1);
    if (!found) throw new AppError(404, 'Không tìm thấy đơn POS.');
    if (!scope.ids.has(found.registerId)) throw new AppError(403, 'Bạn không được nhận hàng của cửa hàng này.');
    if (found.order.status !== 'cancelled') return json({ lines: [], blockedReason: '' });
    try { await assertNoReturnActivity(c.env.db, orderId); }
    catch (e) { if (e instanceof AppError) return json({ lines: [], blockedReason: e.message }); throw e; }
    const lines = await c.env.db.select({ sku: stockMoves.sku, warehouseId: stockMoves.warehouseId,
      warehouseName: warehouses.name, qty: sql<number>`greatest(0,-sum(${stockMoves.qty}))`.mapWith(Number) })
      .from(stockMoves).innerJoin(warehouses, eq(warehouses.id, stockMoves.warehouseId))
      .where(sql`(${stockMoves.refType}='pos_order' and ${stockMoves.refId}=${orderId}) or
        (${stockMoves.refType}='packing_slip' and exists(select 1 from ${packingSlips} p where p.id=${stockMoves.refId} and p.order_id=${orderId})) or
        (${stockMoves.refType}='pos_delivery' and exists(select 1 from ${deliveries} d where d.id=${stockMoves.refId} and d.order_id=${orderId}))`)
      .groupBy(stockMoves.sku, stockMoves.warehouseId, warehouses.name);
    return json({ lines: lines.filter(l => l.qty > 0.0005), blockedReason: '' });
  }, 'business');
  router.post('/pos/orders/:id/receive-cancelled-stock', async c => {
    const m = member(c); posPermission(m);
    const scope = await allowedPosRegisters(c), orderId = c.params.id!;
    const [found] = await c.env.db.select({ order: salesOrders, registerId: posShifts.registerId })
      .from(salesOrders).innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
      .where(and(eq(salesOrders.id, orderId), eq(salesOrders.channel, 'pos'))).limit(1);
    if (!found) throw new AppError(404, 'Không tìm thấy đơn POS.');
    if (!scope.ids.has(found.registerId)) throw new AppError(403, 'Bạn không được nhận hàng của cửa hàng này.');
    if (found.order.status !== 'cancelled') throw new AppError(409, 'Chỉ nhận hàng hoàn của đơn đã huỷ.');
    const result = await c.env.db.transaction(async tx => {
      await cashLock(tx);
      await assertNoReturnActivity(tx,orderId);
      const [locked] = await tx.select({ status: salesOrders.status, orderNo: salesOrders.orderNo }).from(salesOrders)
        .where(eq(salesOrders.id, orderId)).for('update');
      if (locked?.status !== 'cancelled') throw new AppError(409, 'Đơn không còn ở trạng thái đã huỷ. Tải lại danh sách.');
      const before = await tx.select({ sku: stockMoves.sku, qty: sql<number>`greatest(0,-sum(${stockMoves.qty}))`.mapWith(Number) })
        .from(stockMoves).where(sql`(${stockMoves.refType}='pos_order' and ${stockMoves.refId}=${orderId}) or
          (${stockMoves.refType}='packing_slip' and exists(select 1 from ${packingSlips} p where p.id=${stockMoves.refId} and p.order_id=${orderId})) or
          (${stockMoves.refType}='pos_delivery' and exists(select 1 from ${deliveries} d where d.id=${stockMoves.refId} and d.order_id=${orderId}))`)
        .groupBy(stockMoves.sku, stockMoves.warehouseId);
      const pending = before.filter(x => x.qty > 0);
      if (!pending.length) return { received: false, replayed: true, lines: [] as { sku: string; qty: number }[] };
      const refs = await tx.selectDistinct({ refType: stockMoves.refType, refId: stockMoves.refId }).from(stockMoves)
        .where(and(ne(stockMoves.kind, 'reverse'), sql`(${stockMoves.refType}='pos_order' and ${stockMoves.refId}=${orderId}) or
          (${stockMoves.refType}='packing_slip' and exists(select 1 from ${packingSlips} p where p.id=${stockMoves.refId} and p.order_id=${orderId})) or
          (${stockMoves.refType}='pos_delivery' and exists(select 1 from ${deliveries} d where d.id=${stockMoves.refId} and d.order_id=${orderId}))`));
      const at = new Date().toISOString();
      for (const ref of refs) await reverseRef(tx, m.id, ref.refType as StockRefType, ref.refId, `Nhận hàng hoàn đơn đã huỷ ${locked.orderNo}`, at);
      const after = await tx.select({ sku: stockMoves.sku, qty: sql<number>`greatest(0,-sum(${stockMoves.qty}))`.mapWith(Number) })
        .from(stockMoves).where(sql`(${stockMoves.refType}='pos_order' and ${stockMoves.refId}=${orderId}) or
          (${stockMoves.refType}='packing_slip' and exists(select 1 from ${packingSlips} p where p.id=${stockMoves.refId} and p.order_id=${orderId})) or
          (${stockMoves.refType}='pos_delivery' and exists(select 1 from ${deliveries} d where d.id=${stockMoves.refId} and d.order_id=${orderId}))`)
        .groupBy(stockMoves.sku, stockMoves.warehouseId);
      if (after.some(x => x.qty > 1e-9)) throw new AppError(409, 'Chưa hoàn đủ bút toán kho. Tải lại và kiểm tra sổ kho.', 'CANCELLED_STOCK_RETURN_INCOMPLETE');
      return { received: true, replayed: false, lines: pending };
    });
    return json({ ok: true, ...result });
  }, 'business');
  router.post('/pos/web-orders/:id/action', async c => {
    const m = member(c); posPermission(m);
    const input = await readJson(c.req, 4000);
    const action = posText(input.action, 20);
    // complete: nhân viên xác nhận đơn web đã xong (website chuyển "Hoàn thành"); cancel: bắt buộc lý do (gửi website + nhật ký).
    if (!['confirm', 'complete', 'cancel', 'refresh', 'locations'].includes(action)) throw new AppError(400, 'Thao tác đơn web không hợp lệ.');
    const reason = posText(input.reason, 500);
    if (action === 'cancel' && reason.length < 3) throw new AppError(400, 'Nhập lý do huỷ đơn (ít nhất 3 ký tự).', 'reason_required');
    const [order] = await c.env.db.select().from(webStoreOrders).where(eq(webStoreOrders.id, c.params.id!)).limit(1);
    if (!order) throw new AppError(404, 'Không tìm thấy đơn website.');
    const scope = await allowedPosRegisters(c);
    if (!scope.ids.has(order.registerId)) throw new AppError(403, 'Bạn không được thao tác đơn của cửa hàng này.');
    // Danh mục GHN trong CRM không phụ thuộc các hàm PHP checkout của website.
    if (action === 'locations' && (order.source === 'lock' || minhLongDirect(c.env, order))) {
      const provinceId = Math.max(0, Number(input.provinceId) || 0), districtId = Math.max(0, Number(input.districtId) || 0);
      const key = ghnCacheKey(order.source, provinceId, districtId), known = cachedGhnLocations(key) ?? bundledGhnLocations(provinceId, districtId);
      if (known) return json({ ok: true, locations: rememberGhnLocations(key, known) });
      if (c.env.ghnToken || c.env.ghnMlToken) return json({ ok: true, locations: rememberGhnLocations(key, await ghnMasterData(c.env, provinceId, districtId)) });
      throw new AppError(503, 'CRM chưa có danh mục địa chỉ GHN này.');
    }
    if (action === 'complete' && order.ghnOrderCode) throw new AppError(409,'Đơn có vận đơn GHN chỉ hoàn thành theo trạng thái giao thành công của GHN.','GHN_STATUS_MANAGED');
    // Website mirrors have no verified CRM warehouse issue link. Carrier truth remains
    // authoritative, but a manual completion must never fabricate warehouse completion.
    if(action==='complete')throw new AppError(409,'Đơn website chưa có chứng từ xuất kho đã đối soát trong CRM. Hoàn tất nhập/xuất kho trước khi xác nhận hoàn thành.','WAREHOUSE_EXPORT_REQUIRED');
    if (minhLongDirect(c.env, order)) return json(await minhLongWebAction(c, m, order, action, input, reason));
    if(action==='confirm'&&order.ghnOrderCode){
      if(!validWebGhnCode(order.ghnOrderCode))throw new AppError(409,'CRM đang lưu mã GHN cần đối soát. Không tạo lại vận đơn.','ghn_reconcile_failed');
      return json({ok:true,existing:true,status:order.status,ghnOrderCode:order.ghnOrderCode,ghnStatus:order.ghnStatus,ghnSortCode:order.ghnSortCode,ghnFee:order.ghnFee,bucket:webBucket(order.status,order.ghnStatus)});
    }
    if (!c.env.webOrderAction?.token) throw new AppError(503, 'Chưa cấu hình kết nối thao tác đơn website (secret WEB_ORDER_ACTION_TOKEN).');
    const terminal = webBucket(order.status, order.ghnStatus);
    if (action === 'confirm' && terminal !== 'pending') throw new AppError(409, 'Chỉ chốt được đơn đang chờ xử lý.');
    if (action === 'cancel' && ['completed', 'cancelled'].includes(terminal)) throw new AppError(409, terminal === 'completed' ? 'Đơn đã giao thành công, không thể huỷ.' : 'Đơn đã huỷ.');
    if (action === 'complete' && ['completed', 'cancelled'].includes(terminal)) throw new AppError(409, terminal === 'completed' ? 'Đơn đã hoàn thành.' : 'Đơn đã huỷ, không hoàn thành được.');
    const url = order.source === 'lock' ? c.env.webOrderAction.lockUrl : c.env.webOrderAction.minhlongUrl;
    if (!url) throw new AppError(503, 'Website này chưa được kết nối thao tác đơn.');
    const bridgeInput: Record<string, unknown> = { orderId: order.externalId, action, ...(action === 'cancel' ? { reason, actor: m.name } : action === 'complete' ? { actor: m.name } : {}) };
    if (action === 'locations') {
      bridgeInput.provinceId = Math.max(0, Number(input.provinceId) || 0);
      bridgeInput.districtId = Math.max(0, Number(input.districtId) || 0);
      const key = ghnCacheKey(order.source, bridgeInput.provinceId as number, bridgeInput.districtId as number), cached = cachedGhnLocations(key);
      if (cached) return json({ ok: true, locations: cached, cached: true });
    } else if (action === 'confirm' && input.addressLine !== undefined) {
      bridgeInput.addressLine = posText(input.addressLine, 300);
      bridgeInput.provinceId = Math.max(0, Number(input.provinceId) || 0);
      bridgeInput.provinceName = posText(input.provinceName, 100);
      bridgeInput.districtId = Math.max(0, Number(input.districtId) || 0);
      bridgeInput.districtName = posText(input.districtName, 100);
      bridgeInput.wardCode = posText(input.wardCode, 50);
      bridgeInput.wardName = posText(input.wardName, 100);
      if (!bridgeInput.addressLine || !bridgeInput.provinceId || !bridgeInput.districtId || !bridgeInput.wardCode) throw new AppError(400, 'Vui lòng nhập đủ địa chỉ giao hàng GHN.', 'address_invalid');
      if(order.source==='lock'){
        // Use live master-data when a token is configured. Never turn a lookup outage into an address error.
        const lookup=async(province:number,district:number)=>{
          try{return c.env.ghnToken||c.env.ghnMlToken?await ghnMasterData(c.env,province,district):bundledGhnLocations(province,district);}
          catch{throw new AppError(502,'Chưa đối chiếu được danh mục GHN. Giữ nguyên địa chỉ; kiểm tra kết nối GHN trước khi gửi lại.','ghn_reconcile_failed');}
        };
        const districts=await lookup(Number(bridgeInput.provinceId),0);
        const wards=await lookup(0,Number(bridgeInput.districtId));
        if(!districts||!wards)throw new AppError(503,'Chưa đối chiếu được danh mục GHN. Giữ nguyên địa chỉ; không tạo vận đơn khi chưa xác minh được.','ghn_reconcile_failed');
        if(!districts.some(d=>String(d.id)===String(bridgeInput.districtId))||!wards.some(w=>String(w.id)===bridgeInput.wardCode))
          throw new AppError(400,'Quận/Huyện hoặc Phường/Xã không thuộc địa bàn đã chọn theo danh mục GHN.','address_invalid');
      }
    }
    let response:Response;
    try{response=await (c.env.webOrderAction.fetch ?? fetch)(url,{method:'POST',headers:{authorization:`Bearer ${c.env.webOrderAction.token}`,'content-type':'application/json'},body:JSON.stringify(bridgeInput),signal:AbortSignal.timeout(30_000)});}
    catch{throw new AppError(502,'Mất kết nối website; chưa rõ kết quả xử lý. Tra cứu vận đơn trên website/GHN trước khi gửi lại.','ghn_reconcile_failed');}
    const result=await readWebBridgeResult(response,action,{orderId:order.externalId,source:order.source},[c.env.webOrderAction.token,c.env.ghnToken,c.env.ghnMlToken]);
    if (action === 'locations') {
      const key = ghnCacheKey(order.source, bridgeInput.provinceId as number, bridgeInput.districtId as number);
      return json({ ok: true, locations: rememberGhnLocations(key, Array.isArray(result.locations) ? result.locations : []) });
    }
    const confirmedAddress = action === 'confirm' && bridgeInput.addressLine ? {
      addressLine: bridgeInput.addressLine, provinceId: bridgeInput.provinceId, provinceName: bridgeInput.provinceName,
      districtId: bridgeInput.districtId, districtName: bridgeInput.districtName, wardCode: bridgeInput.wardCode, wardName: bridgeInput.wardName,
    } : completeGhnAddress(result.ghnAddress);
    const fields = { status: posText(result.status, 50) || (action === 'complete' ? 'completed' : action === 'cancel' ? 'cancelled' : order.status), ghnOrderCode: validWebGhnCode(result.ghnOrderCode) ? result.ghnOrderCode : order.ghnOrderCode,
      ghnStatus: posText(result.ghnStatus, 100) || order.ghnStatus, ghnSortCode: posText(result.ghnSortCode, 100) || order.ghnSortCode,
      ghnFee: Math.max(0, Number(result.ghnFee) || order.ghnFee), updatedAt: posText(result.updatedAt, 60) || posNow(),
      ...(confirmedAddress ? { address: [confirmedAddress.addressLine, confirmedAddress.wardName, confirmedAddress.districtName, confirmedAddress.provinceName].filter(Boolean).join(', '), ghnAddressSnapshot: JSON.stringify(confirmedAddress) } : {}) };
    if (order.ghnStatus === 'delivered' && fields.ghnOrderCode === order.ghnOrderCode) fields.ghnStatus = 'delivered';
    fields.status = webGhnOrderStatus(fields.ghnStatus, fields.status);
    await c.env.db.update(webStoreOrders).set(fields).where(eq(webStoreOrders.id, order.id));
    await invoiceTasksChanged(c.env, { webOrderId: order.id }, m.id);
    await writeAudit(c.env.db, { actorId: m.id, module: 'sales', action: `web-order-${action}`, entityType: 'web-store-order', entityId: order.id,
      data: { source: order.source, externalId: order.externalId, orderNo: order.orderNo, status: fields.status, ghnOrderCode: fields.ghnOrderCode, ghnStatus: fields.ghnStatus, ...(reason ? { reason } : {}) } });
    return json({ ok: true, ...fields, bucket: webBucket(fields.status, fields.ghnStatus) });
  }, 'business');
  router.post('/integrations/woocommerce/lock/backfill-addresses', async c => {
    if (!c.env.webOrderAction?.token || !c.env.webOrderAction.lockUrl) throw new AppError(503, 'Chưa cấu hình kết nối Web Lock.');
    const rows = await c.env.db.select().from(webStoreOrders).where(eq(webStoreOrders.source, 'lock')).orderBy(desc(webStoreOrders.updatedAt));
    let updated = 0, skipped = 0; const errors: { orderNo: string; error: string }[] = [];
    for (const order of rows.slice(0, 1000)) {
      try {
        const response = await (c.env.webOrderAction.fetch ?? fetch)(c.env.webOrderAction.lockUrl, { method: 'POST', headers: { authorization: `Bearer ${c.env.webOrderAction.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ orderId: order.externalId, action: 'refresh' }) });
        const result = await response.json() as Record<string, unknown>;
        if (!response.ok) throw new Error(posText(result.message, 300) || `HTTP ${response.status}`);
        const address = completeGhnAddress(result.ghnAddress);
        if (!address) { skipped++; continue; }
        await c.env.db.update(webStoreOrders).set({ address: [address.addressLine, address.wardName, address.districtName, address.provinceName].join(', '), ghnAddressSnapshot: JSON.stringify(address), updatedAt: posText(result.updatedAt, 60) || order.updatedAt }).where(eq(webStoreOrders.id, order.id));
        updated++;
      } catch (e) { errors.push({ orderNo: order.orderNo, error: e instanceof Error ? e.message.slice(0, 300) : 'Lỗi không xác định' }); }
    }
    return json({ ok: errors.length === 0, checked: Math.min(rows.length, 1000), updated, skipped, errors });
  }, 'sapo-sync');
  router.post('/pos/ghn/locations', async c => {
    const m = member(c); posPermission(m);
    const input = await readJson(c.req, 2000), registerId = posText(input.registerId, 100);
    const scope = await allowedPosRegisters(c);
    const register = scope.regs.find(r => r.id === registerId);
    if (!register || !scope.ids.has(register.id)) throw new AppError(403, 'Bạn không được dùng quầy này.');
    const isLock = /lock/i.test(register.name), source = isLock ? 'lock' : 'minhlong', url = isLock ? c.env.webOrderAction?.lockUrl : c.env.webOrderAction?.minhlongUrl;
    const provinceId = Math.max(0, Number(input.provinceId) || 0), districtId = Math.max(0, Number(input.districtId) || 0), key = ghnCacheKey(source, provinceId, districtId);
    const cached = cachedGhnLocations(key); if (cached) return json({ ok: true, locations: cached, cached: true });
    const bundled = bundledGhnLocations(provinceId, districtId);
    if (bundled) return json({ ok: true, locations: rememberGhnLocations(key, bundled), bundled: true });
    // Có token GHN: lấy thẳng danh mục địa chỉ của GHN (dùng chung mọi shop) – không phụ thuộc kết nối website.
    if (c.env.ghnToken) return json({ ok: true, locations: rememberGhnLocations(key, await ghnMasterData(c.env, provinceId, districtId)) });
    if (!c.env.webOrderAction?.token) throw new AppError(503, 'Chưa cấu hình kết nối GHN (thiếu secret GHN_API_TOKEN).');
    if (!url) throw new AppError(503, 'Quầy này chưa được kết nối dữ liệu địa chỉ GHN.');
    if (source === 'lock') return json({ ok: true, locations: rememberGhnLocations(key, await lockGhnLocations(provinceId, districtId)) });
    let [contextOrder] = await c.env.db.select({ externalId: webStoreOrders.externalId }).from(webStoreOrders)
      .where(and(eq(webStoreOrders.registerId, register.id), eq(webStoreOrders.source, source))).orderBy(desc(webStoreOrders.updatedAt)).limit(1);
    if (!contextOrder) [contextOrder] = await c.env.db.select({ externalId: webStoreOrders.externalId }).from(webStoreOrders)
      .where(eq(webStoreOrders.source, source)).orderBy(desc(webStoreOrders.updatedAt)).limit(1);
    if (!contextOrder) throw new AppError(409, 'Chưa có đơn web của cửa hàng để kết nối danh mục GHN.');
    const bridgeInput = { orderId: contextOrder.externalId, action: 'locations', provinceId, districtId };
    const response = await (c.env.webOrderAction.fetch ?? fetch)(url, { method: 'POST', headers: { authorization: `Bearer ${c.env.webOrderAction.token}`, 'content-type': 'application/json' }, body: JSON.stringify(bridgeInput) });
    const raw = await response.text(); let result: Record<string, unknown> = {};
    try { result = JSON.parse(raw); } catch {}
    if (!response.ok) throw new AppError(response.status >= 500 ? 502 : 409, posText(result.message, 500) || 'Không tải được địa chỉ GHN.', posText(result.code, 80) || undefined);
    return json({ ok: true, locations: rememberGhnLocations(key, Array.isArray(result.locations) ? result.locations : []) });
  }, 'business');
  router.get(
    '/pos/options',
    async (c) => {
      const m = member(c);
      const canConfigure = can(m, 'pos.configure') && !posScope(c);
      if (!can(m, 'pos.sell') && !can(m, 'pos.configure')) throw new AppError(403, 'Chưa được cấp quyền POS.');
      const [allRegs, templates, shiftRows] = await Promise.all([
        c.env.db.select().from(posRegisters).where(eq(posRegisters.active, true)).orderBy(asc(posRegisters.name)),
        c.env.db.select().from(posShiftTemplates).where(eq(posShiftTemplates.active, true)),
        c.env.db
          .select({ shift: posShifts, memberName: employees.name })
          .from(posShifts)
          .leftJoin(employees, eq(employees.id, posShifts.memberId))
          .where(m.role === 'manager' ? undefined : eq(posShifts.memberId, m.id))
          .orderBy(desc(posShifts.openedAt))
          .limit(50),
      ]);
      const sellScope = await allowedPosRegisters(c);
      const regs = allRegs.filter(r => allowedRegister(c, r.id) && (sellScope.all || sellScope.ids.has(r.id)));
      const shifts = shiftRows.filter(x => allowedRegister(c, x.shift.registerId)).map(x => ({ ...x.shift, memberName: x.memberName || 'Nhân viên không còn trong danh mục' }));
      const policies = await c.env.db
        .select()
        .from(pricePolicies)
        .where(
          canConfigure
            ? undefined
            : inArray(pricePolicies.id, [...new Set(regs.flatMap((r) => [r.pricePolicyId, r.secondPricePolicyId]))]),
        )
        .orderBy(asc(pricePolicies.sortOrder));
      const stores = canConfigure
        ? await c.env.db
            .select()
            .from(warehouses)
            .where(and(eq(warehouses.kind, 'stock'), eq(warehouses.active, true)))
        : [];
      const [position] = m.positionId
        ? await c.env.db.select({ name: positions.name }).from(positions).where(eq(positions.id, m.positionId)).limit(1)
        : [];
      const sharedScope = await sharedSaleShiftScope(c.env.db, m);
      const sharedRows = sharedScope ? await c.env.db.select({ shift: posShifts, memberName: employees.name }).from(posShifts)
        .leftJoin(employees, eq(employees.id, posShifts.memberId)).where(and(sharedScope, inArray(posShifts.registerId, regs.map(r => r.id)), isNull(posShifts.closedAt))) : [];
      const defaultRegisterId = defaultPosRegister(m.positionId, position?.name, regs);
      const sharedCurrent = sharedRows.find(x => x.shift.registerId === defaultRegisterId && allowedRegister(c, x.shift.registerId))
        ?? sharedRows.find(x => allowedRegister(c, x.shift.registerId)) ?? null;
      const ownCurrent = shifts.find(s => s.memberId === m.id && !s.closedAt) ?? null;
      const requestedRegister = c.url.searchParams.get('registerId');
      if (requestedRegister && !regs.some(r => r.id === requestedRegister)) throw new AppError(403, 'Không được sử dụng quầy này.');
      const selected = requestedRegister ? sharedRows.find(x => x.shift.registerId === requestedRegister) : sharedCurrent;
      const current = (requestedRegister ? ownCurrent?.registerId === requestedRegister ? ownCurrent : null : ownCurrent) ?? (selected ? {
        id: selected.shift.id, registerId: selected.shift.registerId, memberId: selected.shift.memberId,
        templateId: selected.shift.templateId, businessDate: selected.shift.businessDate,
        openedAt: selected.shift.openedAt, closedAt: selected.shift.closedAt, memberName: selected.memberName,
      } : null);
      return json({
        registers: regs,
        defaultRegisterId,
        templates,
        shifts,
        current,
        canChooseOpenRegister: m.role === 'manager',
        canCloseCurrent: !!current && current.memberId === m.id,
        orderFlowVersion:1,
        canConfigure,
        policies,
        warehouses: stores,
      });
    },
    'business',
  );
  router.post(
    '/pos/registers',
    async (c) => {
      config(c);
      const b = await readJson(c.req, 8000),
        db = c.env.db,
        id = posText(b.id) || crypto.randomUUID(),
        name = posText(b.name, 100),
        warehouseId = posText(b.warehouseId),
        policy = posText(b.pricePolicyId),
        second = posText(b.secondPricePolicyId),
        taxRate = Number(b.taxRate ?? 8);
      if (
        !name ||
        !warehouseId ||
        !policy ||
        !second ||
        policy === second ||
        !Number.isFinite(taxRate) ||
        taxRate < 0 ||
        taxRate > 100
      )
        throw new AppError(400, 'Chọn tên quầy, kho và hai bảng giá khác nhau, VAT hợp lệ.');
      const [[wh], prices] = await Promise.all([
        db
          .select()
          .from(warehouses)
          .where(and(eq(warehouses.id, warehouseId), eq(warehouses.kind, 'stock'), eq(warehouses.active, true))),
        db
          .select()
          .from(pricePolicies)
          .where(inArray(pricePolicies.id, [policy, second])),
      ]);
      if (!wh || prices.length !== 2) throw new AppError(400, 'Kho hoặc bảng giá không hợp lệ.');
      const fields = {
        name,
        warehouseId,
        pricePolicyId: policy,
        secondPricePolicyId: second,
        taxRate,
        priceIncludesVat: true,
        bankCode: posText(b.bankCode, 40),
        bankAccount: posText(b.bankAccount, 40),
        bankAccountName: posText(b.bankAccountName, 100),
        address: posText(b.address, 1000),
        phone: posText(b.phone, 40),
        updatedAt: posNow(),
        updatedBy: member(c).id,
      };
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'pos-register:' + id}))`);
        const [open] = await tx
          .select({ id: posShifts.id })
          .from(posShifts)
          .where(and(eq(posShifts.registerId, id), isNull(posShifts.closedAt)));
        if (open) throw new AppError(409, 'Quầy đang mở ca, kết ca trước khi sửa cấu hình.');
        await tx
          .insert(posRegisters)
          .values({ id, ...fields, createdAt: posNow() })
          .onConflictDoUpdate({ target: posRegisters.id, set: fields });
      });
      return json({ id });
    },
    'business',
  );
  router.get(
    '/pos/qr/:id/status',
    async (c) => {
      const m = member(c);
      posPermission(m);
      const [r] = await c.env.db.select().from(posPaymentRequests).where(eq(posPaymentRequests.id, c.params.id!));
      if (!r) throw new AppError(404, 'Không tìm thấy yêu cầu QR.');
      await saleShiftOf(c.env.db, m, r.shiftId);
      const [order] = await c.env.db.select({ id: salesOrders.id, orderNo: salesOrders.orderNo }).from(salesOrders).where(eq(salesOrders.posPaymentRequestId, r.id));
      const allocationId=JSON.parse(r.cart).exchangeAllocationId;
      const [allocation]=allocationId?await c.env.db.select().from(posExchangeAllocations).where(eq(posExchangeAllocations.id,allocationId)):[];
      return json({ paid: !!r.confirmedAt, confirmedAt: r.confirmedAt, consumed: !!order, order: order ?? null, ...(r.confirmedAt && allocationId && (!allocation||allocation.status==='cancelled')?{requiresReconciliation:true}:{} ) });
    },
    'business',
  );
  router.post(
    '/pos/templates',
    async (c) => {
      config(c);
      const b = await readJson(c.req, 3000),
        id = posText(b.id) || crypto.randomUUID(),
        name = posText(b.name, 100),
        startsAt = posText(b.startsAt),
        endsAt = posText(b.endsAt);
      if (!name || ![startsAt, endsAt].every((x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x)) || startsAt === endsAt)
        throw new AppError(400, 'Nhập tên và giờ ca hợp lệ.');
      await c.env.db.insert(posShiftTemplates).values({ id, name, startsAt, endsAt }).onConflictDoUpdate({
        target: posShiftTemplates.id,
        set: { name, startsAt, endsAt },
      });
      return json({ id });
    },
    'business',
  );
  router.post(
    '/pos/barcodes',
    async (c) => {
      config(c);
      const b = await readJson(c.req, 2000),
        sku = posText(b.sku, 100),
        barcode = posText(b.barcode, 100);
      if (!barcode || !/^[\x21-\x7e]+$/.test(barcode)) throw new AppError(400, 'Mã vạch không hợp lệ.');
      const [p] = await c.env.db.select({ sku: products.sku }).from(products).where(eq(products.sku, sku));
      if (!p) throw new AppError(404, 'Không có mã hàng.');
      const [otherSku] = barcode !== sku ? await c.env.db.select({ sku: products.sku }).from(products).where(eq(products.sku, barcode)).limit(1) : [];
      if (otherSku) throw new AppError(409, 'Barcode trùng SKU của sản phẩm khác.');
      const [used] = await c.env.db.select().from(productBarcodes).where(eq(productBarcodes.barcode, barcode));
      if (used && used.sku !== sku) throw new AppError(409, 'Mã vạch đã gắn sản phẩm khác.');
      await c.env.db.insert(productBarcodes).values({ barcode, sku }).onConflictDoNothing();
      return json({ ok: true });
    },
    'business',
  );
  router.get(
    '/pos/catalog',
    async (c) => {
      posPermission(member(c));
      await assertSellRegister(c, posText(c.url.searchParams.get('registerId')));
      const r = await registerOf(c.env.db, posText(c.url.searchParams.get('registerId'))),
        policy = posText(c.url.searchParams.get('pricePolicyId')) || r.pricePolicyId,
        q = posText(c.url.searchParams.get('q'), 100);
      if (![r.pricePolicyId, r.secondPricePolicyId].includes(policy)) throw new AppError(400, 'Bảng giá không hợp lệ.');
      const [barcodeHit] = q ? await c.env.db.select().from(productBarcodes).where(eq(productBarcodes.barcode, q)).limit(1) : [];
      if (barcodeHit && barcodeHit.sku !== q) {
        const [conflict] = await c.env.db.select({ sku: products.sku }).from(products).where(eq(products.sku, q)).limit(1);
        if (conflict) throw new AppError(409, 'Mã đang trùng SKU và barcode của hai sản phẩm. Nhờ Manager kiểm tra trước khi bán.');
      }
      // `skus=a,b,c`: trình duyệt đã lọc + xếp hạng trên danh mục tải sẵn – máy chủ chỉ trả giá / tồn của đúng các mã đó, giữ thứ tự gửi lên.
      const skuList = [...new Set((c.url.searchParams.get('skus') || '').split(',').map(x => x.trim()).filter(Boolean))].slice(0, 60);
      const offset = skuList.length ? 0 : Math.max(0, Math.min(100000, Number(c.url.searchParams.get('offset')) || 0));
      const limit = skuList.length ? skuList.length : Math.max(1, Math.min(60, Number(c.url.searchParams.get('limit')) || 60));
      const rows = await c.env.db
        .select({
          sku: products.sku,
          name: products.name,
          unit: products.unit,
          imageUrl: products.imageUrl,
          brand: products.brand,
          price: productPrices.price,
          onHand: stockBalances.qty,
        })
        .from(products)
        .innerJoin(productPrices, and(eq(productPrices.sku, products.sku), eq(productPrices.policyId, policy)))
        .leftJoin(stockBalances, and(eq(stockBalances.sku, products.sku), eq(stockBalances.warehouseId, r.warehouseId)))
        .where(
          and(
            eq(products.active, true),
            eq(products.approvalStatus, 'approved'),
            sql`${productPrices.price} is not null`,
            barcodeHit ? eq(products.sku, barcodeHit.sku) : undefined,
            skuList.length ? inArray(products.sku, skuList) : undefined,
            // Cùng quy tắc tìm với trang Sản phẩm (không dấu, nhiều từ, mã gõ thiếu dấu câu) + đúng mã / mã vạch.
            q && !skuList.length
              ? or(
                  eq(products.sku, q),
                  sql`exists (select 1 from ${productBarcodes} where ${productBarcodes.sku}=${products.sku} and ${productBarcodes.barcode}=${q})`,
                  matchProductWords(q),
                )
              : undefined,
          ),
        )
        .orderBy(...productOrder(skuList.length ? null : q))
        .limit(limit)
        .offset(offset);
      if (skuList.length) rows.sort((a, b) => skuList.indexOf(a.sku) - skuList.indexOf(b.sku));
      const reserved = rows.length
        ? await reservedBySku(
            c.env.db,
            rows.map((p) => p.sku),
            r.warehouseId,
          )
        : new Map<string, number>();
      const sources = await posStockSources(c.env.db, member(c), r.warehouseId, rows.map(p => p.sku));
      return json({
        products: rows.map((p) => ({
          ...p,
          onHand: p.onHand ?? 0,
          stockSources: sources.get(p.sku),
          reserved: reserved.get(p.sku) ?? 0,
          available: Math.max(0, (p.onHand ?? 0) - (reserved.get(p.sku) ?? 0)),
        })),
        nextOffset: rows.length === limit ? offset + limit : null,
        // Khớp chính xác mã vạch / SKU (không phân biệt hoa thường): quầy chỉ tự thêm vào giỏ khi có mã này (Enter / quét mã).
        exactSku: q && !skuList.length ? barcodeHit?.sku ?? rows.find(p => p.sku.toLowerCase() === q.toLowerCase())?.sku ?? null : null,
      });
    },
    'business',
  );
  router.get(
    '/pos/customers',
    async (c) => {
      posPermission(member(c));
      const q = posText(c.url.searchParams.get('q'), 100), focusedId = posText(c.url.searchParams.get('id'), 100);
      const kind = c.url.searchParams.get('kind') || '', offset = Number(c.url.searchParams.get('offset') || 0);
      const canRetail = canListRetailCustomers(member(c));
      const hasTaxCode = sql`regexp_replace(coalesce(${customers.taxCode},''),'[[:space:]]','','g') <> ''`;
      if (!['', 'retail', 'business'].includes(kind) || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw new AppError(400, 'Bộ lọc hoặc trang khách hàng không hợp lệ.');
      const list = await c.env.db
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
          taxCode: customers.taxCode,
          address: customers.address,
        })
        .from(customers)
        .where(
          and(
            eq(customers.approvalStatus, 'approved'),
            focusedId ? eq(customers.id, focusedId) : undefined,
            // Tax-code presence defines POS tabs; retain the existing restricted-customer visibility gate.
            !canRetail ? and(eq(customers.isRetail, false), hasTaxCode) : undefined,
            kind === 'retail' ? (canRetail ? sql`not (${hasTaxCode})` : sql`false`) : kind === 'business' ? hasTaxCode : undefined,
            matchAllWords(foldSql(customers.name, customers.phone, customers.contact, customers.customerCode, customers.taxCode), q),
          ),
        )
        .orderBy(...rankFirst(searchRank([customers.phone, customers.customerCode, customers.taxCode], customers.name, q)), desc(customers.createdAt), asc(customers.name), asc(customers.id))
        .offset(focusedId ? 0 : offset).limit(focusedId ? 1 : 21);
      return json({ customers: list.slice(0,20), nextOffset: !focusedId && list.length > 20 ? offset + 20 : null, canListRetail: canListRetailCustomers(member(c)) });
    },
    'business',
  );
  router.get('/pos/customers/duplicates/check', async c => {
    const m = member(c); posPermission(m);
    const p = c.url.searchParams;
    const matches = await findCustomerDuplicates(c.env.db, {name:(p.get('name')||'').slice(0,500),phone:(p.get('phone')||'').slice(0,40),taxCode:(p.get('taxCode')||'').slice(0,500)});
    return json({matches:matches.map(x=>({id:x.isRetail&&!canListRetailCustomers(m)?null:x.id,name:x.isRetail&&!canListRetailCustomers(m)?'Khách hàng trong danh mục hạn chế':x.name,reasons:x.reasons}))});
  }, 'business');
  router.post(
    '/pos/customers',
    async (c) => {
      const m = member(c);
      posPermission(m);
      const b = await readJson(c.req, 16_384),{fields,terms}=customerInput(b),{name,phone}=fields;
      const customerIssue = posCustomerIssue({id: 'new', name});
      if (customerIssue) throw new AppError(400, customerIssue, 'POS_CUSTOMER_REQUIRED');

      const id = crypto.randomUUID(),
        now = posNow();
      // Không SĐT và không MST: không tạo hồ sơ mới, dùng khách chung "Bán người tiêu dùng" (tên vừa nhập trình duyệt ghi vào ghi chú đơn).
      if (!customerPhoneKeys(phone).length && !identityKeys(fields).taxCode) {
        const shared = await c.env.db.transaction(async (tx) => {
          await customerIdentityLock(tx);
          const [hit] = await tx.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.customerCode, CONSUMER_CODE)).limit(1);
          if (hit) return hit;
          await tx.insert(customers).values({ id, name: CONSUMER_NAME, customerCode: CONSUMER_CODE, contact: '', phone: '', email: '', address: '', taxCode: '', isRetail: true,
            search: CONSUMER_NAME + ' ' + CONSUMER_CODE, sourceVersion: 0, syncedAt: now, createdAt: now, createdBy: m.id, approvalStatus: 'approved', approvedAt: now, approvedBy: m.id });
          return { id, name: CONSUMER_NAME };
        });
        return json({ ...shared, phone: '', shared: true }, 200);
      }
      await c.env.db.transaction(async (tx) => {
        await customerIdentityLock(tx);
        rejectDuplicate(await findCustomerDuplicates(tx, fields), canListRetailCustomers(m));
        await tx.insert(customers).values({
          id,
          ...fields,...terms,
          search: Object.values(fields).join(' '),
          sourceVersion: 0,
          syncedAt: now,
          createdAt: now,
          createdBy: m.id,
          approvalStatus: 'approved',
          approvedAt: now,
          approvedBy: m.id,
        });
        await tx.insert(customerStaff).values({
          customerId: id,
          memberId: m.id,
          role: 'owner',
          createdAt: now,
        });
      });
      return json({ id, name, phone }, 201);
    },
    'business',
  );
  router.get(
    '/pos/opening-counts',
    async (c) => {
      posPermission(member(c));
      await assertSellRegister(c, posText(c.url.searchParams.get('registerId')));
      const r = await registerOf(c.env.db, posText(c.url.searchParams.get('registerId')));
      await assertOpening(c.env.db, r.warehouseId);
      const rows = await c.env.db
        .select({
          sku: products.sku,
          name: products.name,
          qty: stockBalances.qty,
        })
        .from(stockBalances)
        .innerJoin(products, eq(products.sku, stockBalances.sku))
        .where(and(eq(stockBalances.warehouseId, r.warehouseId), eq(products.active, true)))
        .orderBy(desc(stockBalances.qty), asc(products.sku))
        .limit(3);
      return json({ counts: rows, scope: 'partial', maxCount: 3 });
    },
    'business',
  );
  router.post(
    '/pos/shifts/open',
    async (c) => {
      const m = member(c);
      posPermission(m);
      const b = await readJson(c.req, 12000),
        key = posKey(b.key),
        registerId = posText(b.registerId),
        requestedOpening = b.openingCash;
      if ((typeof requestedOpening !== 'number' && typeof requestedOpening !== 'string') || String(requestedOpening).trim() === '')
        throw new AppError(400, 'Nhập tiền thực đếm đầu ca.');
      const countedOpening = posMoney(requestedOpening, 'Tiền thực đếm đầu ca');
      await assertSellRegister(c, registerId);
      const result = await c.env.db.transaction(async (tx) => {
        await cashLock(tx);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'pos-register:' + registerId}))`);
        const [prior] = await tx.select().from(posShifts).where(eq(posShifts.openKey, key));
        if (prior) {
          if (prior.memberId !== m.id || prior.registerId !== registerId || prior.openingCash !== countedOpening) throw new AppError(409, 'Mã mở ca đã dùng.');
          return prior;
        }
        const r = await registerOf(tx, registerId);
        const inheritance = await nextCashOpening(tx, r.cashDrawerId);
        const openingCash = countedOpening, expectedOpeningCash = inheritance.openingCash;
        await assertOpening(tx, r.warehouseId);
        const [open] = await tx
          .select({ id: posShifts.id })
          .from(posShifts)
          .where(
            and(or(eq(posShifts.memberId, m.id), eq(posShifts.registerId, registerId)), isNull(posShifts.closedAt)),
          );
        if (open) throw new AppError(409, 'Nhân viên hoặc quầy đã có ca đang mở.');
        let templateId = posText(b.templateId);
        if (!templateId) {
          const templates = await tx.select().from(posShiftTemplates).where(eq(posShiftTemplates.active, true));
          if (!templates.length) {
            await tx
              .insert(posShiftTemplates)
              .values({
                id: 'morning',
                name: 'Ca sáng',
                startsAt: '08:00',
                endsAt: '14:00',
              })
              .onConflictDoNothing();
            templateId = 'morning';
          } else templateId = templates[0]!.id;
        }
        const [template] = await tx
          .select()
          .from(posShiftTemplates)
          .where(and(eq(posShiftTemplates.id, templateId), eq(posShiftTemplates.active, true)));
        if (!template) throw new AppError(400, 'Ca làm việc không hợp lệ.');
        const id = crypto.randomUUID(),
          now = posNow(),
          [s] = await tx
            .insert(posShifts)
            .values({
              id,
              registerId,
              memberId: m.id,
              templateId,
              businessDate: vietnamDate().iso,
              openKey: key,
              openedAt: now,
              openingCash,
              cashDrawerId: inheritance.cashDrawerId,
              previousShiftId: inheritance.previousShiftId,
              note: posText(b.note, 2000),
            })
            .returning();
        const openingReconciliationId = openingCash !== expectedOpeningCash
          ? await reconciliationFor(tx, s!, m.id, 'opening_cash', posText(b.note, 2000) || 'Tiền thực đếm đầu ca khác tiền bàn giao.', { expectedCash: expectedOpeningCash, countedCash: openingCash })
          : null;
        await cashAudit(tx, m.id, 'open', 'pos-shifts', id, {
          openingCash,
          expectedOpeningCash,
          openingDifference: openingCash - expectedOpeningCash,
          openingReconciliationId,
          previousShiftId: inheritance.previousShiftId,
        });
        return { ...s!, openingReconciliationId };
      });
      // Lệch tiền đầu ca so với bàn giao: báo người duyệt két ngay (trước đây chỉ lặng lẽ tạo tra soát).
      const openingReconciliationId = 'openingReconciliationId' in result ? result.openingReconciliationId : null;
      if (openingReconciliationId)
        await notifyCashApprovers(c.env, result.cashDrawerId, m.id, {
          eventType: 'pos_opening_difference',
          title: 'Mở ca lệch tiền bàn giao',
          body: `${m.name}: đếm ${result.openingCash.toLocaleString('vi-VN')} đ, khác tiền bàn giao. Đã tạo tra soát.`,
          url: '/index.html#/cash?drawerId=' + encodeURIComponent(result.cashDrawerId),
          data: { shiftId: result.id, reconciliationId: openingReconciliationId },
        }).catch(error => console.warn('opening difference notification failed', error instanceof Error ? error.message : 'unknown error'));
      return json(result, 201);
    },
    'business',
  );
  router.get(
    '/pos/shifts/:id',
    async (c) => {
      posPermission(member(c));
      const s = await shiftOf(c.env.db, member(c), c.params.id!);
      return json(s.reportSnapshot ? JSON.parse(s.reportSnapshot) : await shiftReport(c.env.db, s));
    },
    'business',
  );
  router.post(
    '/pos/shifts/:id/close',
    async (c) => {
      const m = member(c);
      posPermission(m);
      const b = await readJson(c.req, 5000);
      const result = await c.env.db.transaction((tx) => closeCashShift(tx, m, c.params.id!, b, shiftReport));
      if (!result.replayed && result.cashDifference)
        await notifyCashApprovers(c.env, result.shift.cashDrawerId, m.id, {
          eventType: 'pos_shift_difference',
          title: 'Kết ca lệch tiền mặt',
          body: `${m.name}: ${result.cashDifference.toLocaleString('vi-VN')} đ. ${result.differenceReason}`,
          url: '/index.html#/cash?drawerId=' + encodeURIComponent(result.shift.cashDrawerId),
          data: { shiftId: result.shift.id },
        }).catch(error => console.warn('shift difference notification failed', error instanceof Error ? error.message : 'unknown error'));
      else if (!result.replayed) await cashTasksChanged(c.env);
      if (!result.replayed && c.env.posShiftReportWebhook) {
        const task = sendPosShiftReport(c.env, result).catch((error) =>
          console.error('POS_SHIFT_REPORT_WEBHOOK_FAILED', result.shift?.id, error instanceof Error ? error.message : error),
        );
        if (c.env.waitUntil) c.env.waitUntil(task); else await task;
      }
      return json(result);
    },
    'business',
  );
  router.post(
    '/pos/preview',
    async (c) => {
      posPermission(member(c));
      const b = await readJson(c.req, 64000),
        s = await saleShiftOf(c.env.db, member(c), posText(b.shiftId));
      assertOpen(s, member(c));
      if (s.registerId !== posText(b.registerId)) throw new AppError(400, 'Quầy không khớp ca.');
      const calc = await calculateCart(c.env.db, b);
      return json({
        ...calc,
        temporary: true,
        memberName: member(c).name,
        createdAt: posNow(),
      });
    },
    'business',
  );
  router.post(
    '/pos/checkout',
    async (c) => {
      const actor = member(c);
      const checkoutResult = await checkout(c.env, actor, await readJson(c.req, 64000));
      // Ship COD quầy Lock: tạo vận đơn GHN ngay (lỗi GHN không làm mất đơn – giao diện hiện nút "Tạo lại vận đơn GHN").
      const ghn = checkoutResult.replayed || checkoutResult.method !== 'cod' ? null : await autoCreateGhnForOrder(c.env, checkoutResult.id);
      // `ghnShipment` (không dùng `ghn`: tên đó là thông tin giao trong posSnapshot đã trải vào kết quả).
      const result = ghn ? { ...checkoutResult, ghnShipment: ghn, ...(ghn.ok ? { ghnOrderCode: ghn.orderCode } : {}) } : checkoutResult;
      await invoiceTasksChanged(c.env, { orderId: result.id }, actor.id);
      await notifyPosOrderCreated(c.env, actor, result);
      if (result.replayed || result.saleFlow || c.env.sapoOrderMode !== 'n8n') return json(result, 201);
      try { return json({ ...result, sapo: await sendPosOrderToClaw(c.env, result.id) }, 201); }
      catch (e) { return json({ ...result, sapo: { status: 'error', message: e instanceof Error ? e.message : 'Không gửi được đơn sang Claw.' } }, 201); }
    },
    'business',
  );
  router.get(
    '/pos/bills/:id',
    async (c) => {
      const m = member(c);
      posPermission(m);
      const [o] = await c.env.db
        .select()
        .from(salesOrders)
        .where(and(eq(salesOrders.id, c.params.id!), eq(salesOrders.channel, 'pos')));
      if (!o?.shiftId) throw new AppError(404, 'Không có bill POS.');
      if (o.ownerId !== m.id && m.role !== 'manager') await saleShiftOf(c.env.db, m, o.shiftId);
      return json({
        id: o.id,
        orderNo: o.orderNo,
        ...JSON.parse(o.posSnapshot ?? '{}'),
      });
    },
    'business',
  );
  router.post(
    '/pos/qr',
    async (c) => {
      const m = member(c);
      posPermission(m);
      const b = await readJson(c.req, 64000),
        key = posKey(b.key);
      const result = await c.env.db.transaction(async (tx) => {
        await cashLock(tx);
        const s = await saleShiftOf(tx, m, posText(b.shiftId), true);
        assertOpen(s, m);
        if (s.registerId !== posText(b.registerId)) throw new AppError(400, 'Quầy không khớp ca.');
        const calc = await calculateCart(tx, b);
        const customerIssue = posCustomerIssue(calc.customer);
        if (customerIssue) throw new AppError(400, customerIssue, 'POS_CUSTOMER_REQUIRED');
        if (!calc.register.bankCode || !calc.register.bankAccount)
          throw new AppError(409, 'Manager cần cấu hình ngân hàng cho quầy.');
        if (calc.payable <= 0) throw new AppError(400, 'Số tiền QR phải lớn hơn 0.');
        const [existing] = await tx.select().from(posPaymentRequests).where(eq(posPaymentRequests.requestKey, key));
        if (existing) {
          if (existing.shiftId !== s.id || existing.fingerprint !== calc.fingerprint)
            throw new AppError(409, 'Yêu cầu đã gắn giỏ hàng khác.');
          if (existing.expiresAt < posNow() || existing.confirmedAt) throw new AppError(409, 'QR hết hạn hoặc đã thu.');
          return { request: existing, register: calc.register };
        }
        const reservedOrderNo = await nextPosOrderNo(tx, vietnamDate().iso);
        const now = posNow(),
          [request] = await tx
            .insert(posPaymentRequests)
            .values({
              id: crypto.randomUUID(),
              shiftId: s.id,
              requestKey: key,
              cart: JSON.stringify({ ...calc.canonical, reservedOrderNo }),
              fingerprint: calc.fingerprint,
              amount: calc.payable,
              createdAt: now,
              expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
            })
            .returning();
        return { request: request!, register: calc.register };
      });
      const { request: r, register: w } = result,
        content = posQrContent(r);
      return json({
        id: r.id,
        orderNo: reservedPosOrderNo(r.cart),
        amount: r.amount,
        expiresAt: r.expiresAt,
        content,
        url: `https://img.vietqr.io/image/${encodeURIComponent(w.bankCode)}-${encodeURIComponent(w.bankAccount)}-compact2.png?amount=${r.amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(w.bankAccountName)}`,
      });
    },
    'business',
  );
  router.get(
    '/pos/cod',
    async (c) => {
      const m = member(c);
      posPermission(m);
      const s = await saleShiftOf(c.env.db, m, posText(c.url.searchParams.get('shiftId')));
      assertOpen(s, m);
      const rows = await c.env.db
        .select({
          id: deliveries.id,
          orderId: salesOrders.id,
          deliveryNo: deliveries.deliveryNo,
          status: deliveries.status,
          deliveredAt: deliveries.deliveredAt,
          codAmount: deliveries.codAmount,
          orderNo: salesOrders.orderNo,
          customer: salesOrders.customerName,
          trackingCode: deliveries.trackingCode,
          trackingStatus: deliveries.trackingStatus,
          snapshot: salesOrders.posSnapshot,
          paid: sql<number>`(select coalesce(sum(${customerPayments.amount}),0) from ${customerPayments} where ${customerPayments.deliveryId}=${deliveries.id} and ${customerPayments.voidedAt} is null)`.mapWith(
            Number,
          ),
        })
        .from(deliveries)
        .innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
        .innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
        .where(
          and(
            eq(posShifts.cashDrawerId, s.cashDrawerId),
            sql`${deliveries.codAmount}>0`,
            ne(deliveries.status, 'cancelled'),
          ),
        )
        .orderBy(desc(deliveries.plannedDate))
        .limit(200);
      const balances = await returnBalances(c.env.db, rows.map(x => x.orderId));
      // canCreateGhn: chuyến chờ giao của quầy Lock chưa có mã vận đơn → nút "Tạo vận đơn GHN" (POST /pos/cod/:id/ghn).
      return json({ deliveries: rows.map(({ snapshot, ...x }) => {
        const snap = JSON.parse(snapshot || '{}');
        return { ...x, codAmount: Math.min(x.codAmount, x.paid + Math.max(0, balances.get(x.orderId) ?? 0)),
          canCreateGhn: !x.trackingCode && x.status === 'planned' && /lock|minh\s*long|gốm\s*sứ/i.test(String(snap.register?.name ?? '')) && !!snap.ghn?.districtId };
      }).filter(x => x.codAmount > x.paid) });
    },
    'business',
  );
  router.post(
    '/pos/cod/:id/collect',
    async (c) => {
      const m = member(c);
      posPermission(m);
      const b = await readJson(c.req, 4000),
        key = posKey(b.key),
        method = b.method === 'cash' ? 'cash' : b.method === 'transfer' ? 'transfer' : null;
      if (!method || b.confirmed !== true)
        throw new AppError(400, 'Chọn hình thức và xác nhận cửa hàng đã thực nhận tiền COD.');
      const result = await c.env.db.transaction(async (tx) => {
        await cashLock(tx);
        const s = await saleShiftOf(tx, m, posText(b.shiftId), true);
        const [prior] = await tx.select().from(customerPayments).where(eq(customerPayments.requestKey, key));
        if (prior) {
          if (prior.shiftId !== s.id || prior.deliveryId !== c.params.id || prior.method !== method)
            throw new AppError(409, 'Mã thu tiền đã dùng.');
          return { id: prior.id, replayed: true };
        }
        assertOpen(s, m);
        const [d] = await tx
          .select({
            d: deliveries,
            registerId: posShifts.registerId,
            customerId: salesOrders.customerId,
            total: salesOrders.total,
          })
          .from(deliveries)
          .innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
          .innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
          .where(and(eq(deliveries.id, c.params.id!), eq(posShifts.cashDrawerId, s.cashDrawerId)))
          .for('update');
        if (!d || d.d.status !== 'delivered' || d.d.codAmount <= 0)
          throw new AppError(409, 'Chỉ thu COD của chuyến đã giao thuộc quầy.');
        const [paid] = await tx
          .select({
            n: sql<number>`coalesce(sum(${customerPayments.amount}),0)`.mapWith(Number),
          })
          .from(customerPayments)
          .where(and(eq(customerPayments.deliveryId, d.d.id), isNull(customerPayments.voidedAt)));
        const account=await returnAccount(tx,d.d.orderId);
        const amount = Math.min(d.d.codAmount - (paid?.n ?? 0), Math.max(0,account.balance));
        if (amount <= 0) throw new AppError(409, 'COD đã thu đủ.');
        const [allPaid] = await tx
          .select({
            n: sql<number>`coalesce(sum(${customerPayments.amount}),0)`.mapWith(Number),
          })
          .from(customerPayments)
          .where(and(eq(customerPayments.orderId, d.d.orderId), isNull(customerPayments.voidedAt)));
        if (amount > d.total - (allPaid?.n ?? 0))
          throw new AppError(409, 'Đơn đã có khoản thu khác. Kiểm tra công nợ trước.');
        const id = crypto.randomUUID();
        await tx.insert(customerPayments).values({
          id,
          orderId: d.d.orderId,
          customerId: d.customerId,
          deliveryId: d.d.id,
          shiftId: s.id,
          requestKey: key,
          amount,
          method,
          paymentSource: 'cod',
          paidAt: vietnamDate().iso,
          createdBy: m.id,
          createdAt: posNow(),
        });
        await cashAudit(tx, m.id, 'collect-cod', 'payments', id, {
          shiftId: s.id,
          deliveryId: d.d.id,
          amount,
          method,
        });
        return { id, amount, replayed: false };
      });
      return json(result, 201);
    },
    'business',
  );
}
