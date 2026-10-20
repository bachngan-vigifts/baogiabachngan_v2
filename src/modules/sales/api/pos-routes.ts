import { posExchangeAllocations } from '../return-schema.ts';
import { returnAccount } from './pos-return-credit.ts';
import { allowedRegister, posScope } from './pos-access.ts';
import { canListRetailCustomers } from '../../customers/domain/customer-config.ts';
import { cashLock, nextCashOpening, closeCashShift, drawerOf, cashAudit, reconciliationFor } from './cash-store.ts';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { foldSql } from '../../../core/text/fold.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { can } from '../../staff/domain/permissions.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { employees, positions } from '../../staff/schema.ts';
import { defaultPosRegister } from '../domain/pos-register.ts';
import { products, productPrices, productBarcodes, pricePolicies, warehouses } from '../../catalog/schema.ts';
import { stockBalances } from '../../inventory/schema.ts';
import { customers, customerStaff } from '../../customers/schema.ts';
import { customerWithTaxCode } from '../../customers/api/routes.ts';
import { customerPayments, salesOrders, salesOrderLines, deliveries, packingSlips } from '../schema.ts';
import { posRegisters, posShifts, posShiftTemplates, posPaymentRequests, webStoreOrders } from '../pos-schema.ts';
import { posMoney } from '../domain/pos-money.ts';
import { vietnamDate } from '../domain/sales.ts';
import { notifyMany } from '../../notifications/api/routes.ts';
import { writeAudit } from '../../../core/audit.ts';
import { sendPosOrderToClaw } from './pos-sapo.ts';
import { sendPosShiftReport } from './pos-shift-report-webhook.ts';
import ghnLocations from '../data/ghn-locations.json';
import {
  posNow,
  posText,
  posKey,
  posPermission,
  shiftOf,
  assertOpen,
  registerOf,
  assertOpening,
  calculateCart,
  checkout,
  reservedBySku,
  shiftReport,
} from './pos-store.ts';
const member = (c: RouteContext<StaffEnv>) => (c.state.session as SessionState).member;
const ghnLocationCache = new Map<string, { expires: number; locations: unknown[] }>();
const ghnCacheKey = (source: string, provinceId: number, districtId: number) => `${source}:${provinceId}:${districtId}`;
const cachedGhnLocations = (key: string) => { const hit = ghnLocationCache.get(key); if (!hit || hit.expires < Date.now()) { ghnLocationCache.delete(key); return null; } return hit.locations; };
const rememberGhnLocations = (key: string, locations: unknown[]) => { ghnLocationCache.set(key, { expires: Date.now() + 24 * 60 * 60 * 1000, locations }); return locations; };
type GhnPair = [number | string, string];
const bundledGhnLocations = (provinceId: number, districtId: number) => {
  const data = ghnLocations as unknown as { p: GhnPair[]; d: Record<string, GhnPair[]>; w: Record<string, GhnPair[]> };
  const rows = districtId ? data.w[String(districtId)] : provinceId ? data.d[String(provinceId)] : data.p;
  if (!rows) return null;
  return rows.map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
};
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
async function allowedPosRegisters(c: RouteContext<StaffEnv>) {
  const m = member(c), db = c.env.db;
  const regs = (await db.select().from(posRegisters).where(eq(posRegisters.active, true)).orderBy(asc(posRegisters.name))).filter(r => allowedRegister(c, r.id));
  if (posScope(c)) return { regs, ids: new Set(regs.map(r => r.id)), all: false };
  if (m.role === 'manager' || can(m, 'pos.configure')) return { regs, ids: new Set(regs.map(r => r.id)), all: true };
  const [[current], [position]] = await Promise.all([
    db.select({ registerId: posShifts.registerId }).from(posShifts).where(and(eq(posShifts.memberId, m.id), isNull(posShifts.closedAt))).limit(1),
    m.positionId ? db.select({ name: positions.name }).from(positions).where(eq(positions.id, m.positionId)).limit(1) : Promise.resolve([]),
  ]);
  const id = (current && regs.some(r => r.id === current.registerId) ? current.registerId : '') || defaultPosRegister(m.positionId, position?.name, regs);
  return { regs: regs.filter(r => r.id === id), ids: new Set(id ? [id] : []), all: false };
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
  const g = ghnStatus.toLowerCase();
  if (g === 'delivered') return 'completed';
  if (['return', 'returned', 'returning', 'return_transporting', 'return_sorting', 'waiting_to_return'].includes(g)) return 'cancelled';
  if (['ready_to_pick', 'picking', 'money_collect_picking', 'picked', 'storing', 'transporting', 'sorting', 'delivering', 'delivery_fail', 'delivery_failed', 'exception'].includes(g)) return 'waiting_delivery';
  const s = status.toLowerCase();
  if (['cancelled', 'refunded', 'failed', 'trash'].includes(s)) return 'cancelled';
  if (['completed'].includes(s)) return 'completed';
  if (['shipped', 'out-for-delivery', 'delivery', 'delivering'].includes(s)) return 'waiting_delivery';
  if (['packing', 'packed'].includes(s)) return 'packing';
  return 'pending';
};
export function registerPosRoutes(router: Router<StaffEnv>) {
  router.post('/integrations/woocommerce/:source/order', async c => {
    const source = c.params.source === 'lock' ? 'lock' : c.params.source === 'minhlong' ? 'minhlong' : '';
    if (!source) throw new AppError(404, 'Nguồn website không hợp lệ.');
    const tokenHash = sha256Hex(c.url.searchParams.get('token') || '');
    const expected = source === 'lock' ? (c.env.wooLockTokenHash || '332555a87646e97c22b3496d8eaca19cbfb649b3c0fd3381ac2bd62b23311d6d') : (c.env.wooMinhLongTokenHash || 'aa30c8ef850ad067688d7e91744cab2608546aaca978018e28b9aa5e97cc1415');
    if (tokenHash !== expected) throw new AppError(401, 'Webhook không đúng website.');
    const b = await readJson(c.req, 256_000), externalId = posText(String(b.id ?? ''), 80), number = posText(String(b.number ?? b.id ?? ''), 100);
    if (!externalId || !number) throw new AppError(400, 'Đơn WooCommerce thiếu ID hoặc số đơn.');
    const wantedName = source === 'lock' ? 'CỬA HÀNG LOCKNLOCK CẦN THƠ' : 'Showroom Gốm Sứ Minh Long Cần Thơ';
    const regs = await c.env.db.select().from(posRegisters).where(eq(posRegisters.active, true));
    const register = regs.find(r => r.name.trim().toLowerCase() === wantedName.toLowerCase());
    if (!register) throw new AppError(409, `CRM chưa có quầy ${wantedName}.`);
    const billing = b.billing && typeof b.billing === 'object' ? b.billing as Record<string, unknown> : {};
    const shipping = b.shipping && typeof b.shipping === 'object' ? b.shipping as Record<string, unknown> : billing;
    const fullName = posText([billing.first_name, billing.last_name].filter(Boolean).join(' '), 200) || 'Khách lẻ';
    const address = posText([shipping.address_1, shipping.address_2, shipping.city, shipping.state].filter(Boolean).join(', '), 1000);
    const lines = Array.isArray(b.line_items) ? b.line_items.slice(0, 300).map((x: Record<string, unknown>) => ({
      sku: posText(x.sku, 100), name: posText(x.name, 500), quantity: Number(x.quantity) || 0, total: Number(x.total) || 0,
    })) : [];
    const metadata = new Map<string, unknown>();
    if (Array.isArray(b.meta_data)) for (const row of b.meta_data) {
      if (row && typeof row === 'object') metadata.set(posText((row as Record<string, unknown>).key, 200), (row as Record<string, unknown>).value);
    }
    const now = posNow(), fields = {
      orderNo: number, registerId: register.id, status: posText(b.status, 50) || 'pending',
      customerName: fullName, phone: posText(billing.phone, 60), email: posText(billing.email, 200), address,
      total: Math.max(0, Number(b.total) || 0), currency: posText(b.currency, 20) || 'VND', paymentMethod: posText(b.payment_method_title ?? b.payment_method, 200),
      lines: JSON.stringify(lines), orderedAt: posText(b.date_created_gmt ?? b.date_created, 60) || now, updatedAt: posText(b.date_modified_gmt ?? b.date_modified, 60) || now,
      ghnOrderCode: posText(metadata.get('_lnl_ghn_order_code'), 100), ghnStatus: posText(metadata.get('_lnl_ghn_last_status'), 100),
      ghnSortCode: posText(metadata.get('_lnl_ghn_sort_code'), 100), ghnFee: Math.max(0, Number(metadata.get('_lnl_ghn_total_fee')) || 0),
    };
    await c.env.db.insert(webStoreOrders).values({ id: crypto.randomUUID(), source, externalId, ...fields })
      .onConflictDoUpdate({ target: [webStoreOrders.source, webStoreOrders.externalId], set: fields });
    return json({ ok: true, source, externalId, registerId: register.id });
  }, 'web-order-sync');
  router.post(
    '/integrations/sepay/pos-payment',
    async (c) => {
      const b = await readJson(c.req, 32000);
      const transferType = posText(b.transferType ?? b.transfer_type, 20).toLowerCase();
      const amount = Number(b.transferAmount ?? b.transfer_amount ?? b.amount);
      const account = posText(b.accountNumber ?? b.account_number, 100).replace(/\s+/g, '');
      const rawCode = posText(b.code, 100), content = posText(b.content ?? b.description, 1000);
      const normalized = (rawCode || content).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      if (transferType !== 'in' || !Number.isFinite(amount) || amount <= 0 || !normalized.includes('POS'))
        throw new AppError(400, 'Giao dịch SePay không hợp lệ.');
      const rows = await c.env.db.select({ request: posPaymentRequests, bankAccount: posRegisters.bankAccount })
        .from(posPaymentRequests)
        .innerJoin(posShifts, eq(posShifts.id, posPaymentRequests.shiftId))
        .innerJoin(posRegisters, eq(posRegisters.id, posShifts.registerId))
        .orderBy(desc(posPaymentRequests.createdAt)).limit(200);
      const hit = rows.find(x => normalized.includes(('POS' + x.request.id.replaceAll('-', '').slice(0, 12)).toUpperCase()));
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
      if (!registerId) return json({ registers: scope.regs, registerId: '', counts: { all: 0, pending: 0, packing: 0, waiting_delivery: 0, completed: 0, cancelled: 0 }, orders: [] });
      const q = posText(c.url.searchParams.get('q'), 200).toLowerCase(), wanted = posText(c.url.searchParams.get('status'), 40) || 'all';
      const rows = await c.env.db.select({
        id: salesOrders.id, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, phone: salesOrders.phone,
        ownerName: employees.name, total: salesOrders.total, status: salesOrders.status, fulfillmentMode: salesOrders.fulfillmentMode,
        orderDate: salesOrders.orderDate, createdAt: salesOrders.createdAt, sapoOrderId: salesOrders.sapoOrderId, sapoOrderCode: salesOrders.sapoOrderCode,
        packingStatus: sql<string>`coalesce((select ${packingSlips.status} from ${packingSlips} where ${packingSlips.orderId}=${salesOrders.id} and ${packingSlips.status}<>'cancelled' order by ${packingSlips.updatedAt} desc limit 1),'')`,
        deliveryStatus: sql<string>`coalesce((select ${deliveries.status} from ${deliveries} where ${deliveries.orderId}=${salesOrders.id} and ${deliveries.status}<>'cancelled' order by ${deliveries.plannedDate} desc limit 1),'')`,
      }).from(salesOrders)
        .innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
        .leftJoin(employees, eq(employees.id, salesOrders.ownerId))
        .where(and(eq(salesOrders.channel, 'pos'), eq(posShifts.registerId, registerId)))
        .orderBy(desc(salesOrders.createdAt)).limit(500);
      const webRows = await c.env.db.select().from(webStoreOrders).where(eq(webStoreOrders.registerId, registerId)).orderBy(desc(webStoreOrders.updatedAt)).limit(500);
      const decorated = [
        ...rows.map(o => ({ ...o, bucket: posOrderBucket(o), source: 'crm', external: false })),
        ...webRows.map(o => ({ id: o.id, orderNo: o.orderNo, customerName: o.customerName, phone: o.phone, ownerName: o.source === 'lock' ? 'Web LocknLock' : 'Web Minh Long', total: o.total,
          status: o.status, fulfillmentMode: 'delivery', orderDate: o.orderedAt.slice(0, 10), createdAt: o.orderedAt, sapoOrderId: null, sapoOrderCode: null,
          packingStatus: '', deliveryStatus: o.ghnStatus, bucket: webBucket(o.status, o.ghnStatus), source: o.source, external: true, lines: o.lines, address: o.address,
          paymentMethod: o.paymentMethod, ghnOrderCode: o.ghnOrderCode, ghnStatus: o.ghnStatus, ghnSortCode: o.ghnSortCode, ghnFee: o.ghnFee,
          actionsAvailable: o.source === 'lock' && !!c.env.webOrderAction?.lockUrl || o.source === 'minhlong' && !!c.env.webOrderAction?.minhlongUrl })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const counts = { all: decorated.length, pending: 0, packing: 0, waiting_delivery: 0, completed: 0, cancelled: 0 };
      for (const o of decorated) counts[o.bucket as keyof typeof counts]++;
      const orders = decorated.filter(o => (wanted === 'all' || o.bucket === wanted) && (!q || [o.orderNo, o.customerName, o.phone, o.ownerName, o.sapoOrderCode].some(v => String(v || '').toLowerCase().includes(q))));
      return json({ registers: scope.regs.map(r => ({ id: r.id, name: r.name })), registerId, canViewAllRegisters: scope.all, counts, orders });
    },
    'business',
  );
  router.post('/pos/web-orders/:id/action', async c => {
    const m = member(c); posPermission(m);
    const input = await readJson(c.req, 4000);
    const action = posText(input.action, 20);
    if (!['confirm', 'cancel', 'refresh', 'locations'].includes(action)) throw new AppError(400, 'Thao tác đơn web không hợp lệ.');
    const [order] = await c.env.db.select().from(webStoreOrders).where(eq(webStoreOrders.id, c.params.id!)).limit(1);
    if (!order) throw new AppError(404, 'Không tìm thấy đơn website.');
    const scope = await allowedPosRegisters(c);
    if (!scope.ids.has(order.registerId)) throw new AppError(403, 'Bạn không được thao tác đơn của cửa hàng này.');
    if (!c.env.webOrderAction?.token) throw new AppError(503, 'Chưa cấu hình kết nối thao tác đơn website.');
    const terminal = webBucket(order.status, order.ghnStatus);
    if (action === 'confirm' && terminal !== 'pending') throw new AppError(409, 'Chỉ chốt được đơn đang chờ xử lý.');
    if (action === 'cancel' && ['completed', 'cancelled'].includes(terminal)) throw new AppError(409, terminal === 'completed' ? 'Đơn đã giao thành công, không thể huỷ.' : 'Đơn đã huỷ.');
    const url = order.source === 'lock' ? c.env.webOrderAction.lockUrl : c.env.webOrderAction.minhlongUrl;
    if (!url) throw new AppError(503, 'Website này chưa được kết nối thao tác đơn.');
    const bridgeInput: Record<string, unknown> = { orderId: order.externalId, action };
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
    }
    const response = await (c.env.webOrderAction.fetch ?? fetch)(url, { method: 'POST', headers: { authorization: `Bearer ${c.env.webOrderAction.token}`, 'content-type': 'application/json' }, body: JSON.stringify(bridgeInput) });
    const raw = await response.text(); let result: Record<string, unknown> = {};
    try { result = JSON.parse(raw); } catch {}
    if (!response.ok) throw new AppError(response.status >= 500 ? 502 : 409, posText(result.message, 500) || 'Website chưa xử lý được đơn.', posText(result.code, 80) || undefined);
    if (action === 'locations') {
      const key = ghnCacheKey(order.source, bridgeInput.provinceId as number, bridgeInput.districtId as number);
      return json({ ok: true, locations: rememberGhnLocations(key, Array.isArray(result.locations) ? result.locations : []) });
    }
    const fields = { status: posText(result.status, 50) || order.status, ghnOrderCode: posText(result.ghnOrderCode, 100) || order.ghnOrderCode,
      ghnStatus: posText(result.ghnStatus, 100), ghnSortCode: posText(result.ghnSortCode, 100) || order.ghnSortCode,
      ghnFee: Math.max(0, Number(result.ghnFee) || order.ghnFee), updatedAt: posText(result.updatedAt, 60) || posNow() };
    await c.env.db.update(webStoreOrders).set(fields).where(eq(webStoreOrders.id, order.id));
    await writeAudit(c.env.db, { actorId: m.id, module: 'sales', action: `web-order-${action}`, entityType: 'web-store-order', entityId: order.id,
      data: { source: order.source, externalId: order.externalId, orderNo: order.orderNo, status: fields.status, ghnOrderCode: fields.ghnOrderCode, ghnStatus: fields.ghnStatus } });
    return json({ ok: true, ...fields, bucket: webBucket(fields.status, fields.ghnStatus) });
  }, 'business');
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
    if (!c.env.webOrderAction?.token) throw new AppError(503, 'Chưa cấu hình kết nối GHN.');
    if (!url) throw new AppError(503, 'Quầy này chưa được kết nối dữ liệu địa chỉ GHN.');
    if (c.env.ghnToken) {
      const path = districtId ? `/master-data/ward?district_id=${districtId}` : provinceId ? '/master-data/district' : '/master-data/province';
      const init: RequestInit = { method: provinceId && !districtId ? 'POST' : 'GET', headers: { Token: c.env.ghnToken, 'content-type': 'application/json' } };
      if (provinceId && !districtId) init.body = JSON.stringify({ province_id: provinceId });
      const response = await fetch('https://online-gateway.ghn.vn/shiip/public-api' + path, init), result = await response.json() as Record<string, unknown>;
      if (!response.ok || !Array.isArray(result.data)) throw new AppError(502, posText(result.message, 500) || 'GHN không trả danh mục địa chỉ.');
      const locations = (result.data as Record<string, unknown>[]).filter(x => Number(x.Status ?? 1) === 1).map(x => ({
        id: districtId ? posText(x.WardCode, 50) : Number(x.DistrictID ?? x.ProvinceID),
        name: posText(x.WardName ?? x.DistrictName ?? x.ProvinceName, 100),
      })).filter(x => x.id && x.name).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      return json({ ok: true, locations: rememberGhnLocations(key, locations) });
    }
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
      const regs = allRegs.filter(r => allowedRegister(c, r.id));
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
      return json({
        registers: regs,
        defaultRegisterId: defaultPosRegister(m.positionId, position?.name, regs),
        templates,
        shifts,
        current: shifts.find((s) => s.memberId === m.id && !s.closedAt) ?? null,
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
      await shiftOf(c.env.db, m, r.shiftId);
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
      const r = await registerOf(c.env.db, posText(c.url.searchParams.get('registerId'))),
        policy = posText(c.url.searchParams.get('pricePolicyId')) || r.pricePolicyId,
        q = posText(c.url.searchParams.get('q'), 100);
      if (![r.pricePolicyId, r.secondPricePolicyId].includes(policy)) throw new AppError(400, 'Bảng giá không hợp lệ.');
      const [barcodeHit] = q ? await c.env.db.select().from(productBarcodes).where(eq(productBarcodes.barcode, q)).limit(1) : [];
      if (barcodeHit && barcodeHit.sku !== q) {
        const [conflict] = await c.env.db.select({ sku: products.sku }).from(products).where(eq(products.sku, q)).limit(1);
        if (conflict) throw new AppError(409, 'Mã đang trùng SKU và barcode của hai sản phẩm. Nhờ Manager kiểm tra trước khi bán.');
      }
      const offset = Math.max(0, Math.min(100000, Number(c.url.searchParams.get('offset')) || 0));
      const limit = Math.max(1, Math.min(60, Number(c.url.searchParams.get('limit')) || 60));
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
            q
              ? or(
                  eq(products.sku, q),
                  sql`exists (select 1 from ${productBarcodes} where ${productBarcodes.sku}=${products.sku} and ${productBarcodes.barcode}=${q})`,
                  sql`${foldSql(products.name)} like ${
                    '%' +
                    q
                      .normalize('NFD')
                      .replace(/[\u0300-\u036f]/g, '')
                      .replace(/đ/g, 'd')
                      .toLowerCase() +
                    '%'
                  }`,
                )
              : undefined,
          ),
        )
        .orderBy(asc(products.name), asc(products.sku))
        .limit(limit)
        .offset(offset);
      const reserved = rows.length
        ? await reservedBySku(
            c.env.db,
            rows.map((p) => p.sku),
            r.warehouseId,
          )
        : new Map<string, number>();
      return json({
        products: rows.map((p) => ({
          ...p,
          onHand: p.onHand ?? 0,
          reserved: reserved.get(p.sku) ?? 0,
          available: Math.max(0, (p.onHand ?? 0) - (reserved.get(p.sku) ?? 0)),
        })),
        nextOffset: rows.length === limit ? offset + limit : null,
      });
    },
    'business',
  );
  router.get(
    '/pos/customers',
    async (c) => {
      posPermission(member(c));
      const q = posText(c.url.searchParams.get('q'), 100);
      const list = await c.env.db
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
          address: customers.address,
        })
        .from(customers)
        .where(
          and(
            eq(customers.approvalStatus, 'approved'),
            !canListRetailCustomers(member(c)) ? eq(customers.isRetail, false) : c.url.searchParams.get('kind') === 'retail' ? eq(customers.isRetail, true) : c.url.searchParams.get('kind') === 'business' ? eq(customers.isRetail, false) : undefined,
            q
              ? or(
                  sql`${foldSql(customers.name)} like ${
                    '%' +
                    q
                      .normalize('NFD')
                      .replace(/[\u0300-\u036f]/g, '')
                      .replace(/đ/g, 'd')
                      .toLowerCase() +
                    '%'
                  }`,
                  sql`${customers.phone} like ${'%' + q + '%'}`,
                )
              : undefined,
          ),
        )
        .orderBy(asc(customers.name))
        .limit(20);
      return json({ customers: list, canListRetail: canListRetailCustomers(member(c)) });
    },
    'business',
  );
  router.post(
    '/pos/customers',
    async (c) => {
      const m = member(c);
      posPermission(m);
      const b = await readJson(c.req, 4000),
        name = posText(b.name, 200),
        phone = posText(b.phone, 40),
        taxCode = posText(b.taxCode, 50);
      if (!name || !phone) throw new AppError(400, 'Nhập tên và số điện thoại khách.');
      if (taxCode && (await customerWithTaxCode(c.env.db, taxCode)))
        throw new AppError(409, 'MST đã có khách hàng, hãy tìm khách có sẵn.');
      const id = crypto.randomUUID(),
        now = posNow();
      await c.env.db.transaction(async (tx) => {
        await tx.insert(customers).values({
          id,
          name,
          phone,
          address: posText(b.address, 1000),
          contact: name,
          email: '',
          taxCode,
          customerCode: '',
          search: [name, phone, taxCode].join(' '),
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
        await notifyMany(c.env, 'managers', {
          eventType: 'pos_shift_difference',
          title: 'Kết ca lệch tiền mặt',
          body: `${m.name}: ${result.cashDifference.toLocaleString('vi-VN')} đ. ${result.differenceReason}`,
          url: '/index.html#/pos',
          actorId: m.id,
        });
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
        s = await shiftOf(c.env.db, member(c), posText(b.shiftId));
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
      const result = await checkout(c.env, member(c), await readJson(c.req, 64000));
      if (result.replayed || c.env.sapoOrderMode !== 'n8n') return json(result, 201);
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
      await shiftOf(c.env.db, m, o.shiftId);
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
        const s = await shiftOf(tx, m, posText(b.shiftId), true);
        assertOpen(s, m);
        if (s.registerId !== posText(b.registerId)) throw new AppError(400, 'Quầy không khớp ca.');
        const calc = await calculateCart(tx, b);
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
        const now = posNow(),
          [request] = await tx
            .insert(posPaymentRequests)
            .values({
              id: crypto.randomUUID(),
              shiftId: s.id,
              requestKey: key,
              cart: JSON.stringify(calc.canonical),
              fingerprint: calc.fingerprint,
              amount: calc.payable,
              createdAt: now,
              expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
            })
            .returning();
        return { request: request!, register: calc.register };
      });
      const { request: r, register: w } = result,
        content = 'POS ' + r.id.replaceAll('-', '').slice(0, 12);
      return json({
        id: r.id,
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
      const s = await shiftOf(c.env.db, m, posText(c.url.searchParams.get('shiftId')));
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
      return json({ deliveries: (await Promise.all(rows.map(async x=>({...x,codAmount: Math.min(x.codAmount, x.paid+Math.max(0,(await returnAccount(c.env.db,x.orderId)).balance))})))).filter(x=>x.codAmount>x.paid) });
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
        const s = await shiftOf(tx, m, posText(b.shiftId), true);
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
