import { snapshotPosFees } from '../domain/pos-fees.ts';
import { asc, eq } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, staffSapoLinks } from '../../staff/schema.ts';
import { warehouses } from '../../catalog/schema.ts';
import { customers } from '../../customers/schema.ts';
import { posRegisters, posShifts } from '../pos-schema.ts';
import { salesOrderLines, salesOrders } from '../schema.ts';

const DEFAULT_POS_HOOK = 'https://n8nthai.moarchvn.com/webhook/crm-pos-order-from-web-to-claw';

function target(env: StaffEnv) {
  try {
    const url = new URL(env.sapoPosOrderWebhookUrl || DEFAULT_POS_HOOK);
    if (url.protocol !== 'https:' || url.hostname !== 'n8nthai.moarchvn.com' || !url.pathname.startsWith('/webhook/') || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

/** Gửi đơn Bán hàng nhanh sau khi giao dịch CRM đã commit; lỗi hook không được làm mất bill tại quầy. */
export async function sendPosOrderToClaw(env: StaffEnv, orderId: string) {
  const url = target(env);
  if (!url) throw new AppError(503, 'Chưa cấu hình webhook POS sang Claw.', 'SAPO_POS_WEBHOOK_MISSING');
  const [row] = await env.db.select({
    order: salesOrders,
    registerId: posRegisters.id,
    registerName: posRegisters.name,
    warehouseId: warehouses.id,
    warehouseName: warehouses.name,
    employeeName: employees.name,
    employeeEmail: employees.email,
    employeePhone: employees.phone,
    sapoAccountId: staffSapoLinks.sapoId,
    customerCode: customers.customerCode,
  }).from(salesOrders)
    .innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
    .innerJoin(posRegisters, eq(posRegisters.id, posShifts.registerId))
    .innerJoin(warehouses, eq(warehouses.id, posRegisters.warehouseId))
    .innerJoin(employees, eq(employees.id, salesOrders.ownerId))
    .leftJoin(staffSapoLinks, eq(staffSapoLinks.memberId, employees.id))
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(eq(salesOrders.id, orderId)).limit(1);
  if (!row) throw new AppError(404, 'Không tìm thấy đơn POS vừa tạo.', 'POS_ORDER_NOT_FOUND');
  const lines = await env.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId)).orderBy(asc(salesOrderLines.lineNo));
  const o = row.order;
  const fees = snapshotPosFees(JSON.parse(o.posSnapshot || '{}'));
  const payload = {
    event: 'crm_pos_create_sapo_order',
    trigger_source: 'pos',
    idempotency_key: `pos:${o.orderNo}`,
    quote_number: o.orderNo,
    external_reference: o.orderNo,
    order_no: o.orderNo,
    quote_type: 'HRC',
    quote_date: o.orderDate,
    branch: { register_id: row.registerId, name: row.registerName, warehouse_id: row.warehouseId, warehouse_name: row.warehouseName },
    responsible: row.employeeName,
    responsible_email: row.employeeEmail,
    responsible_phone: row.employeePhone,
    responsible_sapo_id: /^\d+$/.test(row.sapoAccountId || '') ? Number(row.sapoAccountId) : null,
    customer: { local_id: o.customerId, customer_code: row.customerCode || '', name: o.customerName, contact: o.contact, phone: o.phone, email: o.email, tax_code: o.taxCode, address: o.address },
    items: lines.map(l => ({ line: l.lineNo, sku: l.sku, name: l.name, unit: l.unit, quantity: l.qty, unit_price: l.unitPrice, discount_type: l.discountType, discount_amount: l.discountAmount, price_after_discount: l.unitPrice, line_total: l.amount, tax_percent: l.taxRate })),
    ...(fees.total ? { additional_fees: { service: { kind: 'other_service', name: fees.service.name, quantity: fees.service.quantity, unit_price: fees.service.unitPrice, amount: fees.service.amount, subtotal: fees.service.subtotal, tax_amount: fees.service.tax, tax_percent: fees.service.taxRate, lines: fees.services.map(f => ({ name: f.name, quantity: f.quantity, unit_price: f.unitPrice, amount: f.amount, subtotal: f.subtotal, tax_amount: f.tax, tax_percent: f.taxRate })) }, shipping: { amount: fees.shippingFee, tax_percent: 0 } } } : {}),
    subtotal: o.subtotal,
    vat_amount: o.tax,
    total: o.total,
    fulfillment_mode: o.fulfillmentMode,
    notes: `Bán hàng nhanh · ${row.registerName} · ${row.employeeName}` + fees.services.filter(f => f.amount).map(f => ` · ${f.name}: ${f.quantity} × ${f.unitPrice}đ = ${f.amount}đ (VAT ${f.taxRate}%)`).join('') + (fees.shippingFee ? ` · Phí ship: ${fees.shippingFee}đ (không VAT)` : '') + (o.note ? ` · Ghi chú: ${o.note}` : ''),
  };
  let response: Response;
  try {
    response = await (env.sapoWebhookFetch ?? fetch)(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload), signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(45_000) : undefined });
  } catch { throw new AppError(504, 'Chưa kết nối được n8n; bill POS vẫn đã lưu.', 'SAPO_POS_WEBHOOK_TIMEOUT'); }
  const raw = await response.text(); let body: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* n8n có thể trả text */ }
  if (!response.ok || body.success === false || body.ok === false || body.error) throw new AppError(502, body.message || body.error || `n8n báo lỗi (${response.status}); bill POS vẫn đã lưu.`, 'SAPO_POS_WEBHOOK_FAILED');
  return { status: 'updating' as const, code: o.orderNo, runId: body.runId ?? null };
}
