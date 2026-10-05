import { AppError } from '../../../core/errors.ts';
import { stockInteger, isIsoDate } from './quantity.ts';
import { normalizeDepositRate } from './order-totals.ts';
import { MAX_CC_EMAILS } from './directory.ts';

/*
 * Kiểm tra dữ liệu gửi lên cho các thao tác trên đơn NCC. Port từ lib/product-catalog.mjs; GIỮ NGUYÊN thông báo lỗi
 * để đối chiếu với bản cũ. Hàm thuần: nhận dòng hàng của đơn (`expected`) và dữ liệu client gửi, trả kết quả đã chuẩn hoá
 * hoặc ném AppError(400).
 */
const fail = (message: string): never => { throw new AppError(400, message); };
const EMAIL = /^\S+@\S+\.\S+$/;
const lower = (v: unknown) => String(v ?? '').toLowerCase();

export interface ExpectedRow { sku: string; name?: string; quantity: number; promisedDate?: string }

export const MAX_INTERNAL_ORDER_NUMBER = 100;
export function cleanInternalOrderNumber(value: unknown): string {
  const v = String(value || '').trim();
  if (v.length > MAX_INTERNAL_ORDER_NUMBER) fail('Số phiếu nội bộ NCC tối đa 100 ký tự.');
  return v;
}

// ---- Duyệt đơn (Manager) ----
export interface ApprovalInput { supplierEmail: unknown; ccEmail: unknown; itemDiscounts: unknown }
export function validateApproval(expected: readonly ExpectedRow[], input: ApprovalInput): { supplierEmail: string; cc: string[]; itemDiscounts: { sku: string; purchaseDiscount: number }[] } {
  const supplierEmail = String(input.supplierEmail || '').trim(), ccEmail = String(input.ccEmail || '').trim();
  if (!EMAIL.test(supplierEmail)) fail('Thông tin phê duyệt đơn hàng không hợp lệ.');
  const cc = ccEmail ? ccEmail.split(/[;,]/).map(v => v.trim()).filter(Boolean) : [];
  if (cc.length > MAX_CC_EMAILS || cc.some(e => !EMAIL.test(e))) fail('Email CC không hợp lệ.');
  const provided = Array.isArray(input.itemDiscounts) ? input.itemDiscounts as { sku?: unknown; purchaseDiscount?: unknown }[] : [];
  if (!expected.length || provided.length !== expected.length) fail('Nhập chiết khấu cho đầy đủ từng mã hàng.');
  const discounts = new Map<string, number>();
  for (const row of provided) {
    const sku = String(row?.sku || '').trim(), value = Number(row?.purchaseDiscount), key = sku.toLowerCase();
    if (!sku || discounts.has(key) || !Number.isFinite(value) || value < 0 || value > 100) fail('Chiết khấu từng mã phải từ 0 đến 100%.');
    discounts.set(key, value);
  }
  if (expected.some(r => !discounts.has(lower(r.sku)))) fail('Danh sách mã hàng và chiết khấu không khớp đơn đặt hàng.');
  return { supplierEmail, cc, itemDiscounts: expected.map(r => ({ sku: r.sku, purchaseDiscount: discounts.get(lower(r.sku))! })) };
}

// ---- NCC xác nhận đơn ----
export interface ConfirmationRowInput { sku?: unknown; quantity?: unknown; purchaseDiscount?: unknown; promisedDate?: unknown; supplierNote?: unknown; note?: unknown; confirmed?: unknown }
export interface Confirmation { sku: string; quantity: number; purchaseDiscount: number; promisedDate: string; supplierNote: string; confirmed: true }
export interface Change { sku: string; name: string; from: string | number; to: string | number; note: string }

/**
 * `approvedDiscounts`: chiết khấu manager đã nhập lúc duyệt (khoá = sku chữ thường). `arrivalDate`: ngày về dự kiến của đơn.
 * Trả về xác nhận của từng mã cùng danh sách thay đổi ngày hẹn / chiết khấu so với đơn gốc.
 */
export function validateConfirmation(expected: readonly ExpectedRow[], approvedDiscounts: ReadonlyMap<string, number>, arrivalDate: string, rows: unknown): { confirmations: Confirmation[]; dateChanges: Change[]; discountChanges: Change[] } {
  const submitted = Array.isArray(rows) ? rows as ConfirmationRowInput[] : [];
  if (!expected.length || submitted.length !== expected.length) fail('Cần xác nhận đầy đủ từng mã hàng.');
  const byKey = new Map<string, Confirmation>();
  for (const row of submitted) {
    const sku = String(row?.sku || '').trim(), key = sku.toLowerCase(), quantity = stockInteger(Number(row?.quantity) || 0);
    const purchaseDiscount = Number(row?.purchaseDiscount), promisedDate = String(row?.promisedDate || '').trim();
    const supplierNote = String(row?.supplierNote || row?.note || '').trim().slice(0, 500);
    if (!sku || byKey.has(key) || !Number.isFinite(purchaseDiscount) || purchaseDiscount < 0 || purchaseDiscount > 100 || !isIsoDate(promisedDate) || row?.confirmed !== true)
      fail('NCC cần tick xác nhận CK, SL và ngày hẹn giao cho từng mã.');
    byKey.set(key, { sku, quantity, purchaseDiscount, promisedDate, supplierNote, confirmed: true });
  }
  const dateChanges: Change[] = [], discountChanges: Change[] = [];
  for (const e of expected) {
    const key = lower(e.sku), c = byKey.get(key);
    if (!c || c.quantity !== stockInteger(Number(e.quantity) || 0)) fail('Thông tin xác nhận không khớp đơn đã gửi NCC.');
    const originalDate = String(e.promisedDate || arrivalDate || '').trim();
    if (originalDate && c!.promisedDate && originalDate !== c!.promisedDate) dateChanges.push({ sku: e.sku, name: e.name || '', from: originalDate, to: c!.promisedDate, note: c!.supplierNote || '' });
    const originalDiscount = approvedDiscounts.get(key) || 0;
    if (c!.purchaseDiscount !== originalDiscount) discountChanges.push({ sku: e.sku, name: e.name || '', from: originalDiscount, to: c!.purchaseDiscount, note: c!.supplierNote || '' });
  }
  return { confirmations: expected.map(e => byKey.get(lower(e.sku))!), dateChanges, discountChanges };
}

// ---- Yêu cầu đặt cọc ----
export function validateDepositRequest(expected: readonly ExpectedRow[], rows: unknown, depositRateInput: { provided: boolean; value?: unknown }, currentRate: number | null | undefined): { depositRate: number } {
  const msg1 = 'Tick chọn đầy đủ từng sản phẩm trước khi yêu cầu đặt cọc.', submitted = Array.isArray(rows) ? rows as ConfirmationRowInput[] : [];
  if (!expected.length || submitted.length !== expected.length) fail(msg1);
  const checked = new Map<string, number>();
  for (const row of submitted) {
    const sku = String(row?.sku || '').trim(), key = sku.toLowerCase();
    if (!sku || checked.has(key) || row?.confirmed !== true) fail(msg1);
    checked.set(key, stockInteger(Number(row?.quantity) || 0));
  }
  for (const e of expected) {
    const q = checked.get(lower(e.sku));
    if (q === undefined || q !== stockInteger(Number(e.quantity) || 0)) fail('Danh sách sản phẩm chọn không khớp đơn đã gửi NCC.');
  }
  const rate = normalizeDepositRate(depositRateInput.provided ? depositRateInput.value : (currentRate ?? 30));
  if (rate === null) fail('Tỷ lệ cọc phải từ 0 đến 100%.');
  return { depositRate: rate! };
}

// ---- Báo sẵn sàng giao ----
export interface DeliveryReadyInput { mode?: unknown; deliveryDate?: unknown; date?: unknown; rows?: unknown }
export function validateDeliveryReady(expected: readonly ExpectedRow[], input: DeliveryReadyInput): { mode: 'full' | 'partial'; deliveryDate: string; rows: { sku: string; name: string; quantity: number }[] } {
  const mode = String(input.mode || 'full').trim().toLowerCase() === 'partial' ? 'partial' : 'full';
  const deliveryDate = String(input.deliveryDate || input.date || '').trim();
  if (!isIsoDate(deliveryDate)) fail('Chọn ngày muốn giao hợp lệ.');
  const bySku = new Map(expected.map(r => [lower(r.sku), r]));
  let rows = expected.map(r => ({ sku: r.sku, name: r.name || '', quantity: stockInteger(Number(r.quantity) || 0) }));
  if (mode === 'partial') {
    const given = Array.isArray(input.rows) ? input.rows as { sku?: unknown; quantity?: unknown }[] : [];
    if (!given.length) fail('Chọn ít nhất 1 mã hàng khi giao một phần.');
    const seen = new Set<string>();
    rows = given.map(row => {
      const sku = String(row?.sku || '').trim(), key = sku.toLowerCase(), e = bySku.get(key), quantity = stockInteger(Number(row?.quantity) || 0);
      if (!sku || !e || seen.has(key)) fail('Mã hàng giao một phần không khớp đơn NCC.');
      seen.add(key);
      if (quantity <= 0 || quantity > stockInteger(Number(e!.quantity) || 0)) fail('Số lượng giao một phần phải lớn hơn 0 và không vượt quá số lượng trong đơn.');
      return { sku: e!.sku, name: e!.name || '', quantity };
    });
  }
  return { mode, deliveryDate, rows };
}

// ---- Ghi nhận thanh toán cọc (Manager) ----
export function validatePaidAmount(input: unknown, defaultAmount: number): number {
  const amount = input === undefined || input === null || input === '' ? defaultAmount : Number(input);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) fail('Số tiền cọc không hợp lệ.');
  return amount;
}

// ---- Upload bản ký ----
export const SIGNATURE_MAX_BYTES = 6 * 1024 * 1024;
export const SIGNATURE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export function validateSignatureUpload(input: { fileName: unknown; mimeType: unknown; sizeBytes: number }): { fileName: string; mimeType: (typeof SIGNATURE_MIME)[number]; extension: string } {
  const fileName = String(input.fileName || '').trim().slice(0, 180), type = String(input.mimeType || '').trim().toLowerCase();
  if (!fileName || !/^(image\/(?:jpeg|jpg|png|webp)|application\/pdf)$/.test(type)) fail('Chỉ upload ảnh hoặc file PDF bản ký xác nhận.');
  if (!input.sizeBytes || input.sizeBytes > SIGNATURE_MAX_BYTES) fail('File ký xác nhận tối đa 6MB.');
  const mimeType = (type === 'image/jpg' ? 'image/jpeg' : type) as (typeof SIGNATURE_MIME)[number]; // bản mới lưu dạng chuẩn
  return { fileName, mimeType, extension: type === 'application/pdf' ? '.pdf' : type.endsWith('png') ? '.png' : type.endsWith('webp') ? '.webp' : '.jpg' };
}
