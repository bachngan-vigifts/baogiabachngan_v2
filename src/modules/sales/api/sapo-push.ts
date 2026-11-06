import { asc, eq } from 'drizzle-orm';
import type { RouteContext } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { customers } from '../../customers/schema.ts';
import { sapoPushProblems, type SapoPushInput, type SapoPushLine } from '../../integrations/domain/sapo-order.ts';
import { salesContracts, salesOrderLines, salesOrders } from '../schema.ts';

/**
 * ĐẨY ĐƠN SANG SAPO khi sinh đơn hàng / lập HĐKT – CHỈ qua n8n → OpenClaw (UI Sapo). CRM không tự đăng nhập Sapo để tạo đơn
 * (đường tạo đơn trực tiếp cũ đã gỡ: chưa từng chạy thành công trên production). Phiên Sapo + kéo dữ liệu Sapo giữ nguyên ở module integrations.
 *  - Mặc định có tạo đơn trên Sapo; nhân viên chọn "Không tạo đơn trên Sapo" trong popup (`pushSapo: false`) thì chỉ sinh đơn / HĐKT trên web.
 *  - CRM lưu chứng từ trước, rồi gửi n8n (idempotency key theo số đơn / HĐKT); OpenClaw báo kết quả về `/integrations/sapo/order-status`.
 *  - `env.sapoOrderPush === 'off'`: tắt (chỉ dùng cho test các luồng không liên quan Sapo). `env.sapoOrderMode === 'n8n'`: đã cấu hình n8n.
 */
type Ctx = RouteContext<StaffEnv>;
type Db = StaffEnv['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const CLAW_HOOKS = {
  order: 'https://n8nthai.moarchvn.com/webhook/crm-order-from-web-to-claw',
  hdkt: 'https://n8nthai.moarchvn.com/webhook/crm-hdkt-sapo-order-from-web-to-claw',
} as const;

/** Đã cấu hình gửi n8n/OpenClaw tạo đơn Sapo (production: luôn có). Chưa cấu hình → báo rõ, không lưu chứng từ nửa vời. */
export function assertSapoClawReady(c: Ctx) {
  if (c.env.sapoOrderMode !== 'n8n') throw new AppError(503, 'Chưa cấu hình n8n tạo đơn Sapo. Chọn "Không tạo đơn trên Sapo" hoặc liên hệ Manager.', 'SAPO_WEBHOOK_MISSING');
}

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

/** Người phụ trách (tên + điện thoại gửi kèm cho OpenClaw chọn NV phụ trách trên Sapo). */
async function ownerOf(db: Db | Tx, memberId: string) {
  const [owner] = await db.select({ name: employees.name, phone: employees.phone }).from(employees).where(eq(employees.id, memberId)).limit(1);
  return { name: owner?.name ?? '', phone: owner?.phone ?? '' };
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

export type SapoPushOutcome = Awaited<ReturnType<typeof sendOrderToClaw>> | null;

/**
 * Xem trước cho popup sinh đơn / HĐKT: chứng từ có đủ dữ liệu để OpenClaw tạo đơn Sapo không (dòng thiếu SKU…). Không gọi Sapo.
 */
export async function sapoPreview(c: Ctx, p: { code: string; ownerId: string; lines: Pick<SapoPushLine, 'sku'>[]; customerName: string }) {
  const owner = await ownerOf(c.env.db, p.ownerId);
  const problems = sapoPushProblems({ code: p.code, customer: { name: p.customerName }, lines: p.lines } as SapoPushInput, { requireCode: !!p.code });
  return { connected: true, viaClaw: true, required: sapoPushRequired(c), code: p.code, owner: owner.name, account: null, locations: [], problems };
}
