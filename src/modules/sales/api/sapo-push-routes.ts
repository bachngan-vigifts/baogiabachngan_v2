import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, staffSapoLinks } from '../../staff/schema.ts';
import { customers } from '../../customers/schema.ts';
import { quotations } from '../../quotes/schema.ts';
import { withSapoSession } from '../../integrations/api/sapo-pull.ts';
import { DEFAULT_SAPO_BASE } from '../../integrations/api/sapo-client.ts';
import { pushSapoOrder, sapoAccounts, sapoLocations, sapoOrderUrl } from '../../integrations/api/sapo-order-push.ts';
import { SAPO_DEFAULTS, matchSapoAccount, sapoPushProblems, sapoTotalMatches, type SapoPushInput } from '../../integrations/domain/sapo-order.ts';
import { salesContracts, salesOrderLines, salesOrders } from '../schema.ts';
import { orderScopeFor } from './routes.ts';

/**
 * ĐẨY ĐƠN HÀNG / HĐKT SANG SAPO (thay nút "Copy báo giá vào Sapo" của web cũ):
 *  - `GET  /orders/:id/sapo`      xem trước: đã đẩy chưa, kho Sapo để chọn, người phụ trách trên Sapo, lỗi dữ liệu nếu có.
 *  - `POST /orders/:id/sapo-push` `{ locationId }` tạo đơn nháp Sapo ở kho đã chọn; người phụ trách = người phụ trách đơn / báo giá.
 * Ai xem được đơn thì đẩy được (đơn chưa huỷ, báo giá đã duyệt). Dùng phiên Sapo Manager đã kết nối.
 */
type Ctx = RouteContext<StaffEnv>;
type Order = typeof salesOrders.$inferSelect;
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
/** Đang đẩy: giữ chỗ bằng `sapo_order_code = 'pending:<thời điểm>'` để hai lần bấm cùng lúc không tạo hai đơn Sapo. */
const PENDING = 'pending:', PENDING_MS = 3 * 60_000;
const isPending = (o: Order) => !o.sapoOrderId && (o.sapoOrderCode ?? '').startsWith(PENDING) && Date.now() - Date.parse(o.sapoOrderCode!.slice(PENDING.length)) < PENDING_MS;

async function loadOrder(c: Ctx) {
  const [order] = await c.env.db.select().from(salesOrders).where(and(eq(salesOrders.id, c.params.id!), orderScopeFor(viewer(c)))).limit(1);
  if (!order) throw new AppError(404, 'Không tìm thấy đơn đặt hàng.');
  return order;
}
const base = (c: Ctx) => c.env.sapoAdminBase || DEFAULT_SAPO_BASE;
const pushed = (c: Ctx, o: Order) => o.sapoOrderId ? { id: o.sapoOrderId, code: o.sapoOrderCode ?? '', url: sapoOrderUrl(base(c), o.sapoOrderId) } : null;

/** Dữ liệu đơn web → đầu vào đẩy Sapo + người phụ trách (tên, email, tài khoản Sapo đã liên kết nếu có). */
async function pushInput(c: Ctx, o: Order) {
  const db = c.env.db;
  const [lines, [contract], [owner], [link], [cust]] = await Promise.all([
    db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, o.id)).orderBy(asc(salesOrderLines.lineNo)),
    db.select({ no: salesContracts.contractNo }).from(salesContracts).where(eq(salesContracts.orderId, o.id)).limit(1),
    db.select({ name: employees.name, email: employees.email, phone: employees.phone }).from(employees).where(eq(employees.id, o.ownerId)).limit(1),
    db.select({ sapoId: staffSapoLinks.sapoId }).from(staffSapoLinks).where(eq(staffSapoLinks.memberId, o.ownerId)).limit(1),
    o.customerId ? db.select({ code: customers.customerCode }).from(customers).where(eq(customers.id, o.customerId)).limit(1) : Promise.resolve([]),
  ]);
  const input: SapoPushInput = {
    code: o.quoteNo || o.orderNo, orderNo: o.orderNo, quoteNo: o.quoteNo, quoteType: o.quoteType, contractNo: contract?.no ?? '',
    customer: { sapoId: /^\d+$/.test(o.customerId ?? '') ? Number(o.customerId) : null, name: o.customerName, customerCode: cust?.code ?? '', taxCode: o.taxCode, phone: o.phone, email: o.email, contact: o.contact, address: o.address },
    lines: lines.map(l => ({ sku: l.sku.trim(), name: l.name, unit: l.unit, qty: l.qty, unitPrice: l.unitPrice, taxRate: l.taxRate })),
    ownerName: owner?.name ?? '', ownerPhone: owner?.phone ?? '', expectedDeliveryDate: o.expectedDeliveryDate,
    subtotal: o.subtotal, tax: o.tax, total: o.total,
  };
  return { input, owner: { name: owner?.name ?? '', email: owner?.email ?? '', linkedSapoId: link && /^\d+$/.test(link.sapoId) ? Number(link.sapoId) : null } };
}

async function guard(c: Ctx, o: Order) {
  if (o.status === 'cancelled') throw new AppError(409, 'Đơn đã huỷ, không đẩy sang Sapo.');
  if (o.quoteId) {
    const [q] = await c.env.db.select({ s: quotations.approvalStatus }).from(quotations).where(eq(quotations.id, o.quoteId)).limit(1);
    if (q && q.s !== 'approved') throw new AppError(409, 'Báo giá của đơn chưa được duyệt. Chỉ đơn từ báo giá đã duyệt mới đẩy sang Sapo.', 'QUOTE_NOT_APPROVED');
  }
}
/** Tài khoản Sapo phụ trách: liên kết nhân viên ↔ Sapo (đồng bộ nhân viên), nếu chưa có thì khớp theo email / tên. */
const accountFor = (accounts: Record<string, any>[], owner: { name: string; email: string; linkedSapoId: number | null }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const linked = owner.linkedSapoId ? accounts.find(a => Number(a.id) === owner.linkedSapoId) : null;
  const a = linked ?? matchSapoAccount(accounts, owner) ?? (owner.linkedSapoId && !accounts.length ? { id: owner.linkedSapoId, full_name: owner.name } : null);
  return a ? { id: Number(a.id), name: String(a.full_name || a.name || owner.name) } : null;
};

export function registerSapoPushRoutes(router: Router<StaffEnv>) {
  router.get('/orders/:id/sapo', async c => {
    const o = await loadOrder(c), done = pushed(c, o);
    if (done) return json({ pushed: done });
    const { input, owner } = await pushInput(c, o);
    const problems = sapoPushProblems(input);
    let sapo: { connected: boolean; message?: string; locations?: { id: number; name: string }[]; account?: { id: number; name: string } | null } = { connected: false };
    try {
      sapo = await withSapoSession(c, async api => {
        const [locations, accounts] = await Promise.all([sapoLocations(api), sapoAccounts(api)]);
        return { connected: true, locations, account: accountFor(accounts, owner) };
      });
    } catch (e) { if (!(e instanceof AppError)) throw e; sapo = { connected: false, message: e.message }; }
    return json({ pushed: null, pending: isPending(o), code: input.code, problems, owner: owner.name, ...sapo,
      summary: { customer: input.customer.name, lines: input.lines.length, total: o.total } });
  }, 'business');

  router.post('/orders/:id/sapo-push', async c => {
    const body = await readJson(c.req, 1_024), locationId = Number(body.locationId);
    if (!Number.isInteger(locationId) || locationId <= 0) throw new AppError(400, 'Chọn kho Sapo để tạo đơn.');
    const o = await loadOrder(c);
    if (o.sapoOrderId) return json({ status: 'existing', sapoOrder: pushed(c, o), message: 'Đơn đã có trên Sapo.' });
    await guard(c, o);
    const { input, owner } = await pushInput(c, o);
    const problems = sapoPushProblems(input);
    if (problems.length) throw new AppError(400, problems.join(' '), 'SAPO_PUSH_INVALID');
    // Giữ chỗ: chỉ một lượt đẩy cho mỗi đơn tại một thời điểm.
    const stamp = PENDING + new Date().toISOString();
    const claimed = await c.env.db.update(salesOrders).set({ sapoOrderCode: stamp }).where(and(eq(salesOrders.id, o.id), isNull(salesOrders.sapoOrderId),
      or(isNull(salesOrders.sapoOrderCode), sql`${salesOrders.sapoOrderCode} NOT LIKE 'pending:%'`, sql`${salesOrders.sapoOrderCode} < ${PENDING + new Date(Date.now() - PENDING_MS).toISOString()}`)))
      .returning({ id: salesOrders.id });
    if (!claimed.length) throw new AppError(409, 'Đơn đang được đẩy sang Sapo. Đợi một chút rồi tải lại.', 'SAPO_PUSH_BUSY');
    try {
      const result = await withSapoSession(c, async api => {
        const locations = await sapoLocations(api);
        if (!locations.some(l => l.id === locationId)) throw new AppError(400, 'Kho Sapo không hợp lệ hoặc đã ngừng hoạt động.');
        const account = accountFor(await sapoAccounts(api), owner);
        const r = await pushSapoOrder(api, input, { locationId, sourceId: SAPO_DEFAULTS.sourceId, priceListId: SAPO_DEFAULTS.priceListId }, account?.id ?? null);
        return { ...r, account, location: locations.find(l => l.id === locationId)!, url: sapoOrderUrl(api.base, r.order.id) };
      });
      const code = String(result.order.code || result.order.reference_number || input.code);
      await c.env.db.update(salesOrders).set({ sapoOrderId: String(result.order.id), sapoOrderCode: code }).where(eq(salesOrders.id, o.id));
      const warnings = [
        ...(result.account ? [] : [`Chưa tìm thấy tài khoản Sapo của ${owner.name || 'người phụ trách'} – đơn Sapo để người phụ trách theo phiên Sapo đang kết nối.`]),
        ...(sapoTotalMatches(result.order.total, o.total) ? [] : [`Tổng tiền trên Sapo (${Math.round(Number(result.order.total) || 0).toLocaleString('vi-VN')} đ) khác đơn web (${Math.round(o.total).toLocaleString('vi-VN')} đ) – kiểm tra lại đơn Sapo.`]),
      ];
      return json({ status: result.status, sapoOrder: { id: String(result.order.id), code, url: result.url }, location: result.location, account: result.account,
        customer: result.customer, products: result.products, warnings,
        message: result.status === 'existing' ? `Đơn ${code} đã có sẵn trên Sapo – đã liên kết với đơn web.` : `Đã tạo đơn nháp Sapo ${code} ở kho ${result.location.name}.` });
    } catch (e) {
      await c.env.db.update(salesOrders).set({ sapoOrderCode: null }).where(and(eq(salesOrders.id, o.id), eq(salesOrders.sapoOrderCode, stamp)));
      throw e;
    }
  }, 'business');
}
