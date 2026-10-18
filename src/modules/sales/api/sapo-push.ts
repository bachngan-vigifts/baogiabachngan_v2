import { asc, eq } from 'drizzle-orm';
import type { RouteContext } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, staffSapoLinks } from '../../staff/schema.ts';
import { customers } from '../../customers/schema.ts';
import { openSapoSession, withSapoSession, type SapoApi } from '../../integrations/api/sapo-pull.ts';
import { pushSapoOrder, sapoAccounts, sapoLocations, sapoOrderUrl } from '../../integrations/api/sapo-order-push.ts';
import { SAPO_DEFAULTS, matchSapoAccount, sapoPushProblems, sapoTotalMatches, type SapoPushInput, type SapoPushLine } from '../../integrations/domain/sapo-order.ts';
import { salesContracts, salesOrderLines, salesOrders } from '../schema.ts';

/**
 * ĐẨY ĐƠN SANG SAPO khi sinh đơn hàng / lập HĐKT (thay "Copy báo giá vào Sapo" của web cũ):
 *  - Mặc định có tạo đơn trên Sapo; nhân viên chọn "Không tạo đơn trên Sapo" trong popup (`pushSapo: false`) thì chỉ sinh đơn / HĐKT trên web.
 *  - Có tạo: nhân viên chọn kho Sapo trong popup; người phụ trách trên Sapo = người phụ trách báo giá.
 *  - Máy chủ tạo đơn / HĐKT và đơn nháp Sapo trong CÙNG một giao dịch: Sapo lỗi → huỷ giao dịch, không có đơn / HĐKT nào.
 *  - `env.sapoOrderPush === 'off'`: tắt (chỉ dùng cho test các luồng không liên quan Sapo).
 */
type Ctx = RouteContext<StaffEnv>;
type Db = StaffEnv['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const CLAW_HOOKS = {
  order: 'https://n8nthai.moarchvn.com/webhook/crm-order-from-web-to-claw',
  hdkt: 'https://n8nthai.moarchvn.com/webhook/crm-hdkt-sapo-order-from-web-to-claw',
} as const;

export const sapoPushViaClaw = (c: Ctx) => c.env.sapoOrderMode === 'n8n';

function clawTarget(c: Ctx, source: 'order' | 'hdkt') {
  const raw = source === 'hdkt' ? c.env.sapoHdktOrderWebhookUrl || CLAW_HOOKS.hdkt : c.env.sapoOrderWebhookUrl || CLAW_HOOKS.order;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'n8nthai.moarchvn.com' || !url.pathname.startsWith('/webhook/') || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export const sapoPushRequired = (c: Ctx) => c.env.sapoOrderPush !== 'off';
/** Lượt sinh đơn / lập HĐKT này có tạo đơn trên Sapo không: mặc định có; nhân viên bỏ chọn trong popup → `pushSapo: false`. */
export const wantsSapoPush = (c: Ctx, body: Raw) => sapoPushRequired(c) && body.pushSapo !== false;

/** Kho Sapo nhân viên chọn (bắt buộc khi đẩy). */
export function sapoLocationOf(body: Raw): number {
  const id = Number(body.sapoLocationId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Chọn kho Sapo để tạo đơn.', 'SAPO_LOCATION_REQUIRED');
  return id;
}

/** Người phụ trách + tài khoản Sapo đã liên kết (đồng bộ nhân viên) của họ. */
async function ownerOf(db: Db | Tx, memberId: string) {
  const [[owner], [link]] = await Promise.all([
    db.select({ name: employees.name, email: employees.email, phone: employees.phone }).from(employees).where(eq(employees.id, memberId)).limit(1),
    db.select({ sapoId: staffSapoLinks.sapoId }).from(staffSapoLinks).where(eq(staffSapoLinks.memberId, memberId)).limit(1),
  ]);
  return { name: owner?.name ?? '', email: owner?.email ?? '', phone: owner?.phone ?? '', linkedSapoId: link && /^\d+$/.test(link.sapoId) ? Number(link.sapoId) : null };
}
type Owner = Awaited<ReturnType<typeof ownerOf>>;

/** Tài khoản Sapo phụ trách: liên kết nhân viên ↔ Sapo, nếu chưa có thì khớp theo email / tên. */
function accountFor(accounts: Raw[], owner: Owner) {
  const linked = owner.linkedSapoId ? accounts.find(a => Number(a.id) === owner.linkedSapoId) : null;
  const a = linked ?? matchSapoAccount(accounts, owner) ?? (owner.linkedSapoId && !accounts.length ? { id: owner.linkedSapoId, full_name: owner.name } : null);
  return a ? { id: Number(a.id), name: String(a.full_name || a.name || owner.name) } : null;
}

/** Đầu vào đẩy Sapo từ đơn web (đọc trong giao dịch đang tạo đơn / HĐKT). */
async function inputFromOrder(db: Db | Tx, orderId: string) {
  const [o] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1);
  if (!o) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
  const [lines, [contract], [cust], owner] = await Promise.all([
    db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, o.id)).orderBy(asc(salesOrderLines.lineNo)),
    db.select({ no: salesContracts.contractNo }).from(salesContracts).where(eq(salesContracts.orderId, o.id)).limit(1),
    o.customerId ? db.select({ code: customers.customerCode }).from(customers).where(eq(customers.id, o.customerId)).limit(1) : Promise.resolve([]),
    ownerOf(db, o.ownerId),
  ]);
  const input: SapoPushInput = {
    code: contract?.no || o.orderNo, orderNo: o.orderNo, quoteNo: o.quoteNo, quoteType: o.quoteType, contractNo: contract?.no ?? '',
    customer: { sapoId: /^\d+$/.test(o.customerId ?? '') ? Number(o.customerId) : null, name: o.customerName, customerCode: cust?.code ?? '', taxCode: o.taxCode, phone: o.phone, email: o.email, contact: o.contact, address: o.address },
    lines: lines.map(l => ({ sku: l.sku.trim(), name: l.name, unit: l.unit, qty: l.qty, unitPrice: l.unitPrice, taxRate: l.taxRate })),
    ownerName: owner.name, ownerPhone: owner.phone, expectedDeliveryDate: o.expectedDeliveryDate, subtotal: o.subtotal, tax: o.tax, total: o.total,
  };
  return { order: o, input, owner };
}

/** Giao n8n/Claw tạo đơn Sapo. Chỉ nhận HTTP 2xx là đã xếp hàng; idempotency key chống gửi trùng. */
export async function sendOrderToClaw(c: Ctx, orderId: string, source: 'order' | 'hdkt') {
  const target = clawTarget(c, source);
  if (!target) throw new AppError(503, 'Chưa cấu hình webhook n8n tạo đơn Sapo.', 'SAPO_WEBHOOK_MISSING');
  const { input } = await inputFromOrder(c.env.db, orderId);
  const problems = sapoPushProblems(input);
  if (problems.length) throw new AppError(400, 'Chưa giao được Claw tạo đơn Sapo: ' + problems.join(' '), 'SAPO_PUSH_INVALID');
  const payload = {
    event: source === 'hdkt' ? 'crm_hdkt_create_sapo_order' : 'crm_create_sapo_order',
    trigger_source: source,
    idempotency_key: `${source}:${input.code}`,
    quote_number: input.code,
    quote_no: input.quoteNo,
    order_no: input.orderNo,
    contract_no: input.contractNo,
    quote_type: input.quoteType,
    responsible: input.ownerName,
    responsible_phone: input.ownerPhone,
    customer: {
      sapo_id: input.customer.sapoId,
      customer_code: input.customer.customerCode,
      name: input.customer.name,
      tax_code: input.customer.taxCode,
      contact: input.customer.contact,
      phone: input.customer.phone,
      email: input.customer.email,
      address: input.customer.address,
    },
    items: input.lines.map((line, i) => ({ line: i + 1, sku: line.sku, name: line.name, unit: line.unit, quantity: line.qty, unit_price: line.unitPrice, tax_percent: line.taxRate, delivery_date: input.expectedDeliveryDate })),
    subtotal: input.subtotal,
    vat_amount: input.tax,
    total: input.total,
  };
  let response: Response;
  try {
    response = await (c.env.sapoWebhookFetch ?? fetch)(target, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(45_000) : undefined,
    });
  } catch {
    throw new AppError(504, 'Chưa kết nối được n8n. Chứng từ CRM đã được giữ; kiểm tra trước khi gửi lại.', 'SAPO_WEBHOOK_TIMEOUT');
  }
  const raw = await response.text(); let result: Raw = {};
  try { result = raw ? JSON.parse(raw) : {}; } catch { /* n8n có thể trả text rỗng */ }
  if (!response.ok || result.success === false || result.ok === false || result.error) {
    throw new AppError(502, result.message || result.error || `n8n báo lỗi nhận yêu cầu (${response.status}).`, 'SAPO_WEBHOOK_FAILED');
  }
  return { status: 'updating' as const, code: input.code, runId: result.runId ?? null, warnings: [], message: source === 'hdkt' ? 'Đã giao Claw tạo đơn Sapo sau khi sinh HĐKT.' : 'Đã giao Claw tạo đơn Sapo sau khi sinh đơn.' };
}

/**
 * Đẩy đơn vừa tạo (trong giao dịch `tx`) sang Sapo rồi ghi liên kết vào đơn. Lỗi → ném ra để giao dịch huỷ.
 * Đơn Sapo cùng mã đã có (vd. lần trước Sapo tạo xong nhưng web lỗi) → chỉ liên kết, không tạo trùng.
 */
export async function pushOrderInTx(api: SapoApi, tx: Tx, orderId: string, locationId: number) {
  const { order, input, owner } = await inputFromOrder(tx, orderId);
  if (order.sapoOrderId) return null; // đã đẩy (vd. lập HĐKT cho đơn đã có trên Sapo)
  const problems = sapoPushProblems(input);
  if (problems.length) throw new AppError(400, 'Chưa đẩy được sang Sapo: ' + problems.join(' '), 'SAPO_PUSH_INVALID');
  const r = await (async () => {
    const locations = await sapoLocations(api), location = locations.find(l => l.id === locationId);
    if (!location) throw new AppError(400, 'Kho Sapo không hợp lệ hoặc đã ngừng hoạt động.', 'SAPO_LOCATION_INVALID');
    const account = accountFor(await sapoAccounts(api), owner);
    const res = await pushSapoOrder(api, input, { locationId, sourceId: SAPO_DEFAULTS.sourceId, priceListId: SAPO_DEFAULTS.priceListId }, account?.id ?? null);
    return { ...res, account, location, url: sapoOrderUrl(api.base, res.order.id) };
  })();
  const code = String(r.order.code || r.order.reference_number || input.code);
  await tx.update(salesOrders).set({ sapoOrderId: String(r.order.id), sapoOrderCode: code, sapoPushedAt: new Date().toISOString() }).where(eq(salesOrders.id, orderId));
  const warnings = [
    ...(r.account ? [] : [`Chưa tìm thấy tài khoản Sapo của ${owner.name || 'người phụ trách'} – đơn Sapo để người phụ trách theo phiên Sapo đang kết nối.`]),
    ...(sapoTotalMatches(r.order.total, order.total) ? [] : [`Tổng tiền trên Sapo (${Math.round(Number(r.order.total) || 0).toLocaleString('vi-VN')} đ) khác đơn web (${Math.round(order.total).toLocaleString('vi-VN')} đ) – kiểm tra lại đơn Sapo.`]),
  ];
  return { status: r.status, id: String(r.order.id), code, url: r.url, location: r.location.name, account: r.account?.name ?? null, warnings };
}
export type SapoPushOutcome = Awaited<ReturnType<typeof pushOrderInTx>> | Awaited<ReturnType<typeof sendOrderToClaw>>;

/**
 * Chuẩn bị đẩy Sapo cho một lượt tạo đơn / HĐKT: đọc phiên Sapo TRƯỚC khi mở giao dịch (không giữ giao dịch chờ DB khác),
 * trả `push(tx, orderId)` để gọi cuối giao dịch và `done()` để lưu cookie Sapo gia hạn sau đó.
 */
export async function prepareSapoPush(c: Ctx, locationId: number) {
  const s = await openSapoSession(c);
  return { push: (tx: Tx, orderId: string) => pushOrderInTx(s.api, tx, orderId, locationId), done: s.save };
}

/**
 * Xem trước cho popup chọn kho: kết nối Sapo, danh sách kho, NV phụ trách trên Sapo, lỗi dữ liệu (dòng thiếu SKU…).
 * Không ghi gì vào Sapo.
 */
export async function sapoPreview(c: Ctx, p: { code: string; ownerId: string; lines: Pick<SapoPushLine, 'sku'>[]; customerName: string }) {
  const owner = await ownerOf(c.env.db, p.ownerId);
  const problems = sapoPushProblems({ code: p.code, customer: { name: p.customerName }, lines: p.lines } as SapoPushInput, { requireCode: !!p.code });
  if (sapoPushViaClaw(c)) return { connected: true, viaClaw: true, required: sapoPushRequired(c), code: p.code, owner: owner.name, account: null, locations: [], problems };
  try {
    return await withSapoSession(c, async api => {
      const [locations, accounts] = await Promise.all([sapoLocations(api), sapoAccounts(api)]);
      return { connected: true, required: sapoPushRequired(c), code: p.code, owner: owner.name, account: accountFor(accounts, owner), locations, problems };
    });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return { connected: false, required: sapoPushRequired(c), message: e.message, code: p.code, owner: owner.name, account: null, locations: [], problems };
  }
}
