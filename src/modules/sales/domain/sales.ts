/**
 * Quy tắc thuần của luồng bán hàng sau báo giá (không đụng DB/HTTP).
 * Báo giá → Đơn đặt hàng → HĐKT → Lịch giao → Công nợ.
 */
import { nextDocumentNumber } from '../../../core/document-number.ts';
import { after, rate, quoteStockSku, type QuoteDoc, type QuoteRow } from '../../quotes/domain/quote-math.ts';

const round = (n: number) => Math.round(n);
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();

// ---------------- Số chứng từ ----------------
/** Sales documents use PREFIX_NNN_DDMMYYYY; count both legacy and new numbers for the same day. */
export function nextDocNo(prefix: 'DH' | 'GH' | 'DG' | 'POS', date: string, used: readonly string[]): string {
  return nextDocumentNumber(prefix, date, used);
}

/** Pháp nhân bên bán → mã trên số HĐKT (port `normalizeLegalCode` bản cũ). */
export function legalCode(value: unknown): 'BN' | 'VG' | 'QTV' | null {
  const v = str(value).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toUpperCase();
  if (v === 'BN' || v.includes('BACH')) return 'BN';
  if (v === 'VG' || v.includes('VIGIFTS')) return 'VG';
  if (v.includes('QTV')) return 'QTV';
  return null;
}
export const compactCode = (v: unknown) => str(v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 20);

/** Ngày giờ Việt Nam (để số HĐKT đúng ngày ký ở VN dù máy chủ chạy UTC). */
export function vietnamDate(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(now).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { day: p.day!, month: p.month!, year: p.year!, iso: `${p.year}-${p.month}-${p.day}` };
}

/** Số HĐKT đúng định dạng web cũ: `MM-SS/DDMMYYYY/HĐKT/<pháp nhân>-<mã KH hoặc MST>`. */
export function contractNumber(entity: string, customerCode: string, sequence: number, now = new Date()): string {
  const { day, month, year } = vietnamDate(now);
  return `${month}-${String(sequence).padStart(2, '0')}/${day}${month}${year}/HĐKT/${entity}-${compactCode(customerCode)}`;
}

// ---------------- Đơn từ báo giá ----------------
/** Tổng tiền (gồm VAT) của báo giá từ JSON `staff_quotations.data`; dữ liệu hỏng → 0. */
export function quoteTotal(data: string): number {
  try { return orderTotals(orderLinesFromQuote(JSON.parse(data))).total; } catch { return 0; }
}
export interface OrderLineDraft { lineNo: number; sku: string; name: string; unit: string; qty: number; unitPrice: number; taxRate: number; amount: number }

/** Dòng đơn từ dữ liệu báo giá: đơn giá = giá sau CK (+ phí in nếu B2B/VIGIFTS), chưa VAT; bỏ dòng trống/số lượng 0. */
export function orderLinesFromQuote(doc: QuoteDoc): OrderLineDraft[] {
  const rows = (doc.rows || []) as (QuoteRow & { sku?: string; name?: string; unit?: string })[];
  return rows.filter(r => str(r.name) && Number(r.qty) > 0).map((r, i) => {
    const qty = Number(r.qty), unitPrice = after(r, doc);
    return { lineNo: i + 1, sku: quoteStockSku(r), name: str(r.name), unit: str(r.unit), qty, unitPrice, taxRate: rate(r, doc), amount: unitPrice * qty };
  });
}
export function orderTotals(lines: readonly Pick<OrderLineDraft, 'amount' | 'taxRate'>[]) {
  // Giữ phần lẻ khi nhân SL và cộng dòng, như báo giá; chỉ chốt tổng VNĐ ở cuối.
  const rawSubtotal = lines.reduce((s, l) => s + l.amount, 0);
  const rawTax = lines.reduce((s, l) => s + l.amount * l.taxRate / 100, 0);
  const subtotal = round(rawSubtotal), total = round(rawSubtotal + rawTax);
  return { subtotal, tax: total - subtotal, total };
}

// ---------------- Giao hàng ----------------
export type OrderStatus = 'draft' | 'confirmed' | 'delivering' | 'delivered' | 'cancelled';
/** Trạng thái đơn theo số đã giao (giữ nguyên nếu đơn đã huỷ/nháp). */
export function orderStatusFromLines(current: OrderStatus, lines: readonly { qty: number; deliveredQty: number }[]): OrderStatus {
  if (current === 'cancelled' || current === 'draft') return current;
  const delivered = lines.reduce((s, l) => s + l.deliveredQty, 0);
  if (lines.length && lines.every(l => l.deliveredQty >= l.qty)) return 'delivered';
  return delivered > 0 ? 'delivering' : 'confirmed';
}

// ---------------- Công nợ ----------------
export interface ScheduleDraft { kind: 'deposit' | 'installment' | 'balance'; amount: number; dueDate: string | null; note: string }
/** Số ngày khách được chuyển cọc kể từ ngày ký HĐKT trước khi tính quá hạn. */
export const DEPOSIT_GRACE_DAYS = 3;
/** Kỳ phải thu theo HĐKT: cọc (đến hạn ngày ký + DEPOSIT_GRACE_DAYS) + phần còn lại (đến hạn sau khi giao xong + số ngày thanh toán). */
export function contractSchedules(total: number, depositRate: number, signedDate: string): ScheduleDraft[] {
  const deposit = round(total * depositRate / 100), rest = total - deposit;
  return [
    ...(deposit > 0 ? [{ kind: 'deposit' as const, amount: deposit, dueDate: addDays(signedDate, DEPOSIT_GRACE_DAYS), note: `Đặt cọc ${depositRate}%` }] : []),
    ...(rest > 0 ? [{ kind: 'balance' as const, amount: rest, dueDate: null, note: 'Thanh toán phần còn lại sau khi giao hàng' }] : []),
  ];
}
export const addDays = (iso: string, days: number) => new Date(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Trạng thái thanh toán / đặt cọc hiển thị ở danh sách đơn và HĐKT:
 * none = chưa có kỳ phải thu · unpaid = chưa thu · deposit_due = chờ đặt cọc · deposit_paid = đã cọc · partial = đã thu một phần · overdue = quá hạn · paid = đã thu đủ.
 */
export type PayState = 'none' | 'unpaid' | 'deposit_due' | 'deposit_paid' | 'partial' | 'overdue' | 'paid';
export interface Receivable {
  due: number; paid: number; balance: number; overdue: number; nextDueDate: string | null; status: 'paid' | 'overdue' | 'open' | 'none';
  /** Tiền cọc phải thu (kỳ `deposit`) và phần cọc đã thu. */
  deposit: number; depositPaid: number; payState: PayState;
}
/**
 * Tuổi nợ: phần chưa thu của các kỳ đã quá hạn, chia theo số ngày quá hạn (1–30 / 31–60 / trên 60 = 61–90 + trên 90), và hạn quá lâu nhất.
 * Phiếu thu trừ dần vào kỳ hạn sớm nhất trước – cùng cách `receivable`.
 */
export function debtAging(schedules: readonly { amount: number; dueDate: string | null }[], payments: readonly { amount: number }[], today: string) {
  let left = payments.reduce((s, x) => s + x.amount, 0), oldestDue: string | null = null;
  const buckets = { d30: 0, d60: 0, over60: 0, d90: 0, over90: 0 }, day = (d: string) => Date.parse(d + 'T00:00:00Z');
  for (const s of [...schedules].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))) {
    const covered = Math.min(left, s.amount); left -= covered;
    const open = s.amount - covered;
    if (open <= 0 || !s.dueDate || s.dueDate >= today) continue;
    oldestDue ??= s.dueDate;
    const days = Math.round((day(today) - day(s.dueDate)) / 864e5);
    buckets[days <= 30 ? 'd30' : days <= 60 ? 'd60' : 'over60'] += open;
    if (days > 60) buckets[days <= 90 ? 'd90' : 'over90'] += open;
  }
  return { oldestDue, overdueDays: oldestDue ? Math.round((day(today) - day(oldestDue)) / 864e5) : 0, buckets };
}

/** Công nợ chỉ tính khi đơn hàng đã được xác nhận (duyệt) hoặc HĐKT của đơn đã ký; đơn nháp / đã huỷ không phát sinh công nợ. */
export function debtCounts(orderStatus: string, contractStatus?: string | null) {
  if (orderStatus === 'cancelled') return false;
  return orderStatus !== 'draft' || contractStatus === 'signed' || contractStatus === 'completed';
}

/**
 * Công nợ của một đơn: phải thu = tổng các kỳ; đã thu = tổng phiếu thu; quá hạn = phần chưa thu của các kỳ đã tới hạn
 * (phiếu thu trừ dần vào các kỳ theo hạn sớm nhất trước).
 */
export function receivable(schedules: readonly { amount: number; dueDate: string | null; kind?: string }[], payments: readonly { amount: number }[], today: string): Receivable {
  const due = schedules.reduce((s, x) => s + x.amount, 0), paid = payments.reduce((s, x) => s + x.amount, 0), balance = due - paid;
  let left = paid, overdue = 0, nextDueDate: string | null = null;
  const sorted = [...schedules].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  for (const s of sorted) {
    const covered = Math.min(left, s.amount); left -= covered;
    const open = s.amount - covered;
    if (open <= 0) continue;
    if (s.dueDate && s.dueDate < today) overdue += open;
    else if (s.dueDate && (!nextDueDate || s.dueDate < nextDueDate)) nextDueDate = s.dueDate;
  }
  const status = due === 0 ? 'none' : balance <= 0 ? 'paid' : overdue > 0 ? 'overdue' : 'open';
  const deposit = schedules.filter(x => x.kind === 'deposit').reduce((s, x) => s + x.amount, 0), depositPaid = Math.min(paid, deposit);
  const payState: PayState = status === 'none' || status === 'paid' || status === 'overdue' ? status
    : deposit > 0 ? (paid >= deposit ? 'deposit_paid' : 'deposit_due') : paid > 0 ? 'partial' : 'unpaid';
  return { due, paid, balance, overdue, nextDueDate, status, deposit, depositPaid, payState };
}
