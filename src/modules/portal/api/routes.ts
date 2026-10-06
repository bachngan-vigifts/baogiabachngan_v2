import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { fold } from '../../../core/text/fold.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { credentials, employees, sessions } from '../../staff/schema.ts';
import { ACTIVATION_TTL_SECONDS } from '../../staff/domain/members.ts';
import { newToken, sha256Hex } from '../../staff/domain/session.ts';
import { CUSTOMER_POSITION_ID } from '../../staff/domain/roles.ts';
import { customers } from '../../customers/schema.ts';
import { pricePolicies, productPrices, products } from '../../catalog/schema.ts';
import { snapshotVersion } from '../../catalog/api/routes.ts';
import { quotations, quoteLines } from '../../quotes/schema.ts';
import { cleanQuotation } from '../../quotes/domain/quotation-schema.ts';
import { quoteHeaderIndex, quoteLineRows } from '../../quotes/domain/quote-index.ts';
import { customerDiscount, totals } from '../../quotes/domain/quote-math.ts';
import { customerPayments, deliveries, paymentSchedules, salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { createOrderFromQuote } from '../../sales/api/routes.ts';
import { receivable, vietnamDate } from '../../sales/domain/sales.ts';
import { customerAccounts } from '../schema.ts';
import { cleanDiscounts, nextQuoteNo, parseDiscounts, publicQuote } from '../domain/portal.ts';

type Ctx = RouteContext<StaffEnv>;
const member = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Liên kết đặt mật khẩu của khách: mở thẳng trang khách hàng (token sau dấu #, không đi qua máy chủ/log). */
const customerLink = (origin: string, email: string, token: string) => `${origin}/customer.html#email=${encodeURIComponent(email)}&token=${token}`;
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)).trim().slice(0, max);

/** Tài khoản khách đang đăng nhập + khách hàng Sapo gắn với nó. */
async function myAccount(c: Ctx) {
  const [row] = await c.env.db.select({ account: customerAccounts, customer: customers }).from(customerAccounts)
    .innerJoin(customers, eq(customers.id, customerAccounts.customerId)).where(eq(customerAccounts.memberId, member(c).id)).limit(1);
  if (!row) throw new AppError(403, 'Tài khoản chưa được gắn với khách hàng. Vui lòng liên hệ nhân viên phụ trách.');
  return { ...row, discounts: parseDiscounts(row.account.discounts) };
}
/** Bảng giá dùng cho khách: "Giá bán lẻ" (hoặc bảng giá đầu tiên). */
async function retailPolicy(db: StaffEnv['db']) {
  const list = await db.select().from(pricePolicies).orderBy(asc(pricePolicies.sortOrder), asc(pricePolicies.name));
  return list.find(p => fold(p.name).includes('ban le')) ?? list[0] ?? null;
}
/** Báo giá khách được xem: của chính khách hàng này, và (đã duyệt hoặc do chính tài khoản này gửi). */
const visibleQuotes = (customerId: string, me: string) => and(
  sql`(${quotations.data}::jsonb ->> 'customerId') = ${customerId}`,
  or(eq(quotations.approvalStatus, 'approved'), eq(quotations.creatorId, me)),
);
const ORDER_FIELDS = { id: salesOrders.id, orderNo: salesOrders.orderNo, quoteId: salesOrders.quoteId, quoteNo: salesOrders.quoteNo, status: salesOrders.status,
  orderDate: salesOrders.orderDate, expectedDeliveryDate: salesOrders.expectedDeliveryDate, subtotal: salesOrders.subtotal, tax: salesOrders.tax, total: salesOrders.total, note: salesOrders.note };

export function registerPortalRoutes(router: Router<StaffEnv>) {
  // ======================= TRANG KHÁCH HÀNG (chỉ tài khoản khách) =======================
  router.get('/portal/me', async c => {
    const { account, customer, discounts } = await myAccount(c);
    const [owner] = await c.env.db.select({ name: employees.name, phone: employees.phone, email: employees.email }).from(employees).where(eq(employees.id, account.ownerId)).limit(1);
    return json({
      user: { name: member(c).name, email: member(c).email },
      customer: { id: customer.id, name: customer.name, contact: customer.contact, phone: customer.phone, email: customer.email, address: customer.address, taxCode: customer.taxCode },
      discounts, owner: owner ?? null,
    });
  }, 'customer-portal');

  /** Danh mục cho khách: giá bán lẻ và chiết khấu riêng theo nhãn hàng. KHÔNG có tồn kho, giá nhập. */
  router.get('/portal/catalog', async c => {
    const { account, discounts } = await myAccount(c), db = c.env.db;
    const version = (await snapshotVersion(db)).version + '.' + sha256Hex(account.discounts).slice(0, 8);
    if (c.url.searchParams.get('v') === version) return json({ version, unchanged: true });
    const policy = await retailPolicy(db);
    const [rows, prices] = await Promise.all([
      db.select({ sku: products.sku, name: products.name, brand: products.brand, pattern: products.pattern, unit: products.unit, imageUrl: products.imageUrl, taxOut: products.taxOut, taxable: products.taxable })
        .from(products).where(eq(products.active, true)).orderBy(asc(products.sku)),
      policy ? db.select({ sku: productPrices.sku, price: productPrices.price }).from(productPrices).where(eq(productPrices.policyId, policy.id)) : Promise.resolve([]),
    ]);
    const priceOf = new Map(prices.map(p => [p.sku, p.price]));
    return json({
      version, policy: policy?.name ?? '', columns: ['sku', 'name', 'brand', 'pattern', 'unit', 'imageUrl', 'taxOut', 'taxable', 'price', 'discount'],
      products: rows.map(r => [r.sku, r.name, r.brand, r.pattern, r.unit, r.imageUrl, r.taxOut, r.taxable, priceOf.get(r.sku) ?? null, customerDiscount(r.brand, discounts)]),
    });
  }, 'customer-portal');

  router.get('/portal/quotes', async c => {
    const { customer } = await myAccount(c), me = member(c).id;
    const rows = await c.env.db.select().from(quotations).where(visibleQuotes(customer.id, me)).orderBy(desc(quotations.updatedAt)).limit(200);
    const orders = rows.length ? await c.env.db.select(ORDER_FIELDS).from(salesOrders).where(and(inArray(salesOrders.quoteId, rows.map(r => r.id)), ne(salesOrders.status, 'cancelled'))) : [];
    return json({ quotes: rows.map(r => {
      const d = JSON.parse(r.data), o = orders.find(x => x.quoteId === r.id);
      return { id: r.id, quoteNo: r.quoteNo, date: r.quoteDate, total: totals(d).total, lineCount: d.rows.length, approvalStatus: r.approvalStatus, mine: r.creatorId === me,
        updatedAt: r.updatedAt, order: o ? { id: o.id, orderNo: o.orderNo, status: o.status } : null };
    }) });
  }, 'customer-portal');

  router.get('/portal/quotes/:id', async c => {
    const { customer } = await myAccount(c), me = member(c).id;
    const [r] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, c.params.id!), visibleQuotes(customer.id, me))).limit(1);
    if (!r) throw new AppError(404, 'Không tìm thấy báo giá.');
    const [o] = await c.env.db.select(ORDER_FIELDS).from(salesOrders).where(and(eq(salesOrders.quoteId, r.id), ne(salesOrders.status, 'cancelled'))).limit(1);
    const data = publicQuote(JSON.parse(r.data));
    return json({ id: r.id, quoteNo: r.quoteNo, approvalStatus: r.approvalStatus, mine: r.creatorId === me, data, totals: totals(data as Parameters<typeof totals>[0]), order: o ?? null });
  }, 'customer-portal');

  /**
   * Khách tạo báo giá (yêu cầu báo giá) hoặc đơn mua hàng từ danh mục. Giá tính tại máy chủ: giá bán lẻ − CK riêng theo nhãn.
   * Báo giá chờ nhân viên phụ trách duyệt. `order: true` = đặt hàng luôn: tạo kèm đơn "Chờ xác nhận".
   */
  router.post('/portal/quotes', async c => {
    const { account, customer, discounts } = await myAccount(c), db = c.env.db, me = member(c);
    const body = await readJson(c.req, 200_000);
    const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
    if (!items.length || items.length > 300) throw new AppError(400, 'Chọn từ 1 đến 300 sản phẩm.');
    const want = new Map<string, number>();
    for (const it of items) {
      const sku = str(it.sku, 500), qty = Number(it.qty);
      if (!sku || !(qty > 0 && qty <= 1e6)) throw new AppError(400, 'Mã hàng hoặc số lượng không hợp lệ.');
      want.set(sku, (want.get(sku) ?? 0) + qty);
    }
    const policy = await retailPolicy(db);
    const found = await db.select().from(products).where(and(inArray(products.sku, [...want.keys()]), eq(products.active, true)));
    const prices = policy ? await db.select().from(productPrices).where(and(eq(productPrices.policyId, policy.id), inArray(productPrices.sku, [...want.keys()]))) : [];
    const missing = [...want.keys()].filter(s => !found.some(p => p.sku === s) || !Number.isFinite(prices.find(p => p.sku === s)?.price));
    if (missing.length) throw new AppError(400, `Sản phẩm chưa có giá hoặc đã ngừng bán: ${missing.slice(0, 5).join(', ')}. Vui lòng liên hệ nhân viên phụ trách.`);
    const [owner] = await db.select({ name: employees.name, phone: employees.phone }).from(employees).where(eq(employees.id, account.ownerId)).limit(1);
    const today = vietnamDate().iso, ymd = today.replaceAll('-', ''), deliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(str(body.deliveryDate)) ? str(body.deliveryDate) : undefined;
    const note = str(body.note, 2000), wantsOrder = body.order === true;
    const rows = [...want].map(([sku, qty]) => {
      const p = found.find(x => x.sku === sku)!;
      return { sku, name: p.name, unit: p.unit, brand: p.brand, pattern: p.pattern, image: p.imageUrl, qty, price: prices.find(x => x.sku === sku)!.price!,
        discount: customerDiscount(p.brand, discounts), discountType: 'percent', printFee: 0, ...(p.taxable && Number.isFinite(p.taxOut) ? { taxRate: p.taxOut } : {}) };
    });
    const id = crypto.randomUUID(), now = nowIso();
    let quote!: typeof quotations.$inferSelect;
    await db.transaction(async tx => {
      const used = (await tx.select({ n: quotations.quoteNo }).from(quotations).where(sql`${quotations.quoteNo} LIKE ${'B2B_BG' + ymd + '_%'}`)).map(r => r.n);
      const data = cleanQuotation({
        type: 'B2B', quoteNo: nextQuoteNo('B2B_BG', ymd, used), date: today, vat: 8, ...(deliveryDate ? { deliveryDate } : {}),
        customer: customer.name, customerId: customer.id, contact: customer.contact, phone: customer.phone, email: customer.email,
        customerTaxCode: customer.taxCode, customerAddress: customer.address, customerCode: customer.customerCode,
        owner: owner?.name ?? '', ownerPhone: owner?.phone ?? '',
        notes: [`${wantsOrder ? 'Đơn mua hàng' : 'Yêu cầu báo giá'} khách gửi từ trang khách hàng (${me.name}).`, note && 'Ghi chú của khách: ' + note].filter(Boolean).join('\n'),
        rows,
      });
      const [ins] = await tx.insert(quotations).values({ id, creatorId: me.id, assigneeId: account.ownerId, quoteNo: data.quoteNo, quoteType: 'B2B', customer: customer.name,
        ...quoteHeaderIndex(data), data: JSON.stringify(data), revision: 1, approvalStatus: 'pending', approvedAt: null, approvedBy: null, createdAt: now, updatedAt: now }).returning();
      quote = ins!;
      await tx.insert(quoteLines).values(quoteLineRows(id, data));
    });
    const orderId = wantsOrder ? await createOrderFromQuote(db, quote, { createdBy: me.id, status: 'draft', note }) : null;
    return json({ id, quoteNo: quote.quoteNo, orderId }, 201);
  }, 'customer-portal');

  /** Khách xác nhận đặt hàng từ báo giá ĐÃ DUYỆT → đơn "Chờ xác nhận" để nhân viên phụ trách xác nhận. */
  router.post('/portal/quotes/:id/order', async c => {
    const { customer } = await myAccount(c), me = member(c);
    const [q] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, c.params.id!), visibleQuotes(customer.id, me.id))).limit(1);
    if (!q) throw new AppError(404, 'Không tìm thấy báo giá.');
    if (q.approvalStatus !== 'approved') throw new AppError(409, 'Báo giá đang chờ nhân viên xác nhận, chưa đặt hàng được.', 'QUOTE_NOT_APPROVED');
    const body = await readJson(c.req, 4_000);
    const orderId = await createOrderFromQuote(c.env.db, q, { createdBy: me.id, status: 'draft', note: str(body.note, 2000) });
    return json({ orderId }, 201);
  }, 'customer-portal');

  router.get('/portal/orders', async c => {
    const { customer } = await myAccount(c), db = c.env.db;
    const orders = await db.select(ORDER_FIELDS).from(salesOrders).where(eq(salesOrders.customerId, customer.id)).orderBy(desc(salesOrders.orderDate), desc(salesOrders.orderNo)).limit(200);
    const ids = orders.map(o => o.id);
    const [lines, ships, sch, pay] = ids.length ? await Promise.all([
      db.select({ orderId: salesOrderLines.orderId, lineNo: salesOrderLines.lineNo, sku: salesOrderLines.sku, name: salesOrderLines.name, unit: salesOrderLines.unit, qty: salesOrderLines.qty, deliveredQty: salesOrderLines.deliveredQty, unitPrice: salesOrderLines.unitPrice, amount: salesOrderLines.amount })
        .from(salesOrderLines).where(inArray(salesOrderLines.orderId, ids)).orderBy(asc(salesOrderLines.lineNo)),
      db.select({ orderId: deliveries.orderId, deliveryNo: deliveries.deliveryNo, plannedDate: deliveries.plannedDate, timeSlot: deliveries.timeSlot, status: deliveries.status })
        .from(deliveries).where(and(inArray(deliveries.orderId, ids), ne(deliveries.status, 'cancelled'))).orderBy(asc(deliveries.plannedDate)),
      db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, ids)),
      db.select({ orderId: customerPayments.orderId, amount: customerPayments.amount }).from(customerPayments).where(inArray(customerPayments.orderId, ids)),
    ]) : [[], [], [], []];
    const today = vietnamDate().iso;
    return json({ orders: orders.map(o => ({
      ...o, lines: lines.filter(l => l.orderId === o.id), deliveries: ships.filter(d => d.orderId === o.id),
      receivable: o.status === 'cancelled' ? null : receivable(sch.filter(s => s.orderId === o.id), pay.filter(p => p.orderId === o.id), today),
    })) });
  }, 'customer-portal');

  /** Khách huỷ đơn khi nhân viên chưa xác nhận. */
  router.post('/portal/orders/:id/cancel', async c => {
    const { customer } = await myAccount(c);
    const done = await c.env.db.update(salesOrders).set({ status: 'cancelled', updatedAt: nowIso() })
      .where(and(eq(salesOrders.id, c.params.id!), eq(salesOrders.customerId, customer.id), eq(salesOrders.status, 'draft'))).returning({ id: salesOrders.id });
    if (!done.length) throw new AppError(409, 'Đơn đã được xác nhận hoặc không tồn tại, không huỷ được. Vui lòng liên hệ nhân viên phụ trách.');
    return json({ ok: true });
  }, 'customer-portal');

  // ======================= NHÂN VIÊN: cấp & quản lý tài khoản khách =======================
  /** Tài khoản khách của một khách hàng. */
  router.get('/customers/:id/accounts', async c => {
    const rows = await c.env.db.select({ account: customerAccounts, name: employees.name, email: employees.email, phone: employees.phone, active: employees.active, passwordHash: credentials.passwordHash })
      .from(customerAccounts).innerJoin(employees, eq(employees.id, customerAccounts.memberId)).leftJoin(credentials, eq(credentials.memberId, employees.id))
      .where(eq(customerAccounts.customerId, c.params.id!)).orderBy(asc(customerAccounts.createdAt));
    const owners = rows.length ? await c.env.db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, rows.map(r => r.account.ownerId))) : [];
    return json({ accounts: rows.map(r => ({
      memberId: r.account.memberId, name: r.name, email: r.email, phone: r.phone, active: r.active, activated: !!r.passwordHash,
      owner: owners.find(o => o.id === r.account.ownerId) ?? { id: r.account.ownerId, name: '' }, discounts: parseDiscounts(r.account.discounts),
      canManage: member(c).role === 'manager' || r.account.ownerId === member(c).id,
    })) });
  }, 'business');

  /**
   * Cấp tài khoản cho khách: nhân viên cấp cho khách mình phụ trách (người phụ trách = mình, chiết khấu 0);
   * Manager chọn được người phụ trách và đặt chiết khấu riêng theo nhãn. Trả liên kết đặt mật khẩu (15 phút) để gửi khách.
   */
  router.post('/customer-accounts', async c => {
    const body = await readJson(c.req, 8_000), me = member(c), mgr = me.role === 'manager', db = c.env.db;
    const customerId = str(body.customerId, 80), name = str(body.name, 200), email = str(body.email, 254).toLowerCase(), phone = str(body.phone, 40);
    if (!name || !EMAIL.test(email)) throw new AppError(400, 'Nhập tên và email hợp lệ của người dùng phía khách hàng.');
    const [cust] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!cust) throw new AppError(404, 'Không tìm thấy khách hàng.');
    const ownerId = mgr && body.ownerId ? str(body.ownerId, 80) : me.id;
    const [owner] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, ownerId), eq(employees.active, true), inArray(employees.role, ['manager', 'employee']))).limit(1);
    if (!owner) throw new AppError(400, 'Nhân viên phụ trách không hợp lệ.');
    const discounts = mgr ? cleanDiscounts(body.discounts) : {};
    if (!mgr && body.discounts && Object.keys(cleanDiscounts(body.discounts)).length) throw new AppError(403, 'Chỉ Manager được đặt chiết khấu riêng cho khách.');
    if ((await db.select({ id: employees.id }).from(employees).where(sql`lower(${employees.email}) = ${email}`).limit(1)).length) throw new AppError(409, 'Email này đã có tài khoản.');
    const id = 'KH-' + crypto.randomUUID(), token = newToken(), now = nowIso(), nowSec = (c.env.nowSec ?? (() => Math.floor(Date.now() / 1000)))();
    await db.transaction(async tx => {
      await tx.insert(employees).values({ id, email, name, phone, role: 'customer', positionId: CUSTOMER_POSITION_ID, active: true, createdAt: now });
      await tx.insert(credentials).values({ memberId: id, activationHash: sha256Hex(token), activationExpires: nowSec + ACTIVATION_TTL_SECONDS, version: 0 });
      await tx.insert(customerAccounts).values({ memberId: id, customerId, ownerId, discounts: JSON.stringify(discounts), createdBy: me.id, createdAt: now, updatedAt: now });
    });
    return json({ memberId: id, url: customerLink(c.url.origin, email, token) }, 201);
  }, 'business');

  async function manageable(c: Ctx) {
    const [row] = await c.env.db.select().from(customerAccounts).where(eq(customerAccounts.memberId, c.params.memberId!)).limit(1);
    if (!row) throw new AppError(404, 'Không tìm thấy tài khoản khách.');
    if (member(c).role !== 'manager' && row.ownerId !== member(c).id) throw new AppError(403, 'Chỉ Manager hoặc nhân viên phụ trách được quản lý tài khoản này.');
    return row;
  }
  /** Đổi chiết khấu / người phụ trách (Manager) hoặc khoá – mở tài khoản (Manager, nhân viên phụ trách). */
  router.put('/customer-accounts/:memberId', async c => {
    const row = await manageable(c), body = await readJson(c.req, 8_000), mgr = member(c).role === 'manager', db = c.env.db;
    const set: Partial<typeof customerAccounts.$inferInsert> = { updatedAt: nowIso() };
    if (body.discounts !== undefined) { if (!mgr) throw new AppError(403, 'Chỉ Manager được đặt chiết khấu riêng cho khách.'); set.discounts = JSON.stringify(cleanDiscounts(body.discounts)); }
    if (body.ownerId !== undefined) {
      if (!mgr) throw new AppError(403, 'Chỉ Manager được đổi nhân viên phụ trách.');
      const [o] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, str(body.ownerId, 80)), eq(employees.active, true), inArray(employees.role, ['manager', 'employee']))).limit(1);
      if (!o) throw new AppError(400, 'Nhân viên phụ trách không hợp lệ.');
      set.ownerId = o.id;
    }
    await db.transaction(async tx => {
      await tx.update(customerAccounts).set(set).where(eq(customerAccounts.memberId, row.memberId));
      if (typeof body.active === 'boolean') {
        await tx.update(employees).set({ active: body.active }).where(eq(employees.id, row.memberId));
        if (!body.active) await tx.delete(sessions).where(eq(sessions.memberId, row.memberId));
      }
    });
    return json({ ok: true });
  }, 'business');

  /** Cấp lại liên kết đặt mật khẩu cho khách (quên mật khẩu / link hết hạn). */
  router.post('/customer-accounts/:memberId/reset', async c => {
    const row = await manageable(c), db = c.env.db, token = newToken(), nowSec = (c.env.nowSec ?? (() => Math.floor(Date.now() / 1000)))();
    const [m] = await db.select({ email: employees.email }).from(employees).where(eq(employees.id, row.memberId)).limit(1);
    await db.transaction(async tx => {
      await tx.update(credentials).set({ activationHash: sha256Hex(token), activationExpires: nowSec + ACTIVATION_TTL_SECONDS, passwordHash: null, version: sql`${credentials.version} + 1` }).where(eq(credentials.memberId, row.memberId));
      await tx.delete(sessions).where(eq(sessions.memberId, row.memberId));
    });
    return json({ url: customerLink(c.url.origin, m!.email, token) });
  }, 'business');
}
