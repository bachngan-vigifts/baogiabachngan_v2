import {purchaseReadLevel} from './purchase-access.ts';
import { isSupplier, SALE_ADMIN_POSITION_ID, type Role } from '../../staff/domain/roles.ts';
import { can, canApprove } from '../../staff/domain/permissions.ts';
import { isIsoDate } from './quantity.ts';
import { AppError } from '../../../core/errors.ts';

/*
 * ĐƠN MUA HÀNG NCC TRÊN CRM (đợt 2) – hàm thuần: quyền, trạng thái, tiến độ nhận hàng, công nợ NCC, chống mua trùng.
 * Không đụng DB / HTTP (kiểm bằng test). API: src/modules/suppliers/api/purchase-routes.ts.
 *
 * Quyết định đã chốt với chủ dự án (14/10/2026):
 *  - Nhận/trả hàng ghi sổ kho CRM theo chứng từ; phiếu nhận có trạng thái đối soát Sapo riêng
 *    (chờ / đã nhập kèm mã phiếu Sapo / lỗi / không cần). Một phiếu chỉ "đã nhập Sapo" một lần → không cộng hai lần.
 *  - Ghi thanh toán NCC: Manager + Kế toán; chỉ Manager huỷ khoản đã ghi.
 *  - Nhận hàng: Kho + Manager + Sale Admin + Kế toán; chỉ Manager huỷ phiếu nhận (khi chưa nhập Sapo).
 *  - Bảng `supplier_stock_requests` giữ nghĩa cũ (nhân viên xin giữ hàng từ đơn sắp về) – chưa dùng ở đợt này.
 */
export interface Actor { id: string; role: Role; active: boolean; positionId?: string | null; perms?: readonly string[] | null; dataScope?: string | null; approver?: boolean | null }
const isManager = (a: Actor | null | undefined) => Boolean(a?.active && a.role === 'manager' && !isSupplier(a));
const isEmployee = (a: Actor | null | undefined) => Boolean(a?.active && a.role === 'employee' && !isSupplier(a) && a.positionId !== 'customer');
export const isWarehouseStaff = (a: Actor | null | undefined) => isEmployee(a) && a!.positionId === 'warehouse';
export const isSaleAdminStaff = (a: Actor | null | undefined) => isEmployee(a) && a!.positionId === SALE_ADMIN_POSITION_ID;
export const isAccountantStaff = (a: Actor | null | undefined) => isEmployee(a) && a!.positionId === 'accounting';

/** Ai thấy giá / tiền của đơn mua: Manager và Kế toán. Nhân viên khác và kho thấy đơn nhưng ẩn giá (giá vốn). */
// Người được duyệt đơn mua phải thấy / nhập giá mua khi duyệt.
export const canSeePrices = (a: Actor | null | undefined) => isManager(a) || isEmployee(a) && (can(a, 'purchases.prices') || canApprove(a));
/** Sale Admin được xử lý và xem đầy đủ chứng từ đã duyệt, không mở giá của đơn nháp khi chưa được cấp quyền. */
export const canSeePurchasePrices = (a: Actor | null | undefined, o: Pick<OrderFlags, 'approvalStatus'>) => canSeePrices(a) || isSaleAdminStaff(a) && o.approvalStatus === 'approved';
export const canSendEarlyRequest = (a: Actor) => isManager(a) || canUsePurchasing(a) && isEmployee(a) && can(a, 'purchases.early-request');
export const canViewEarlyRequests = (a: Actor | null | undefined) => isManager(a) || canUsePurchasing(a) && isEmployee(a) && can(a, 'purchases.early-view');
export const canUsePurchasing = (a: Actor | null | undefined) => purchaseReadLevel(a)!=='none';
export const canReceive = (a: Actor | null | undefined) => isManager(a) || isEmployee(a) && can(a, 'purchases.receive');
/** Staff record an actual supplier confirmation; this does not approve purchase prices or early requests. */
export const canRecordSupplierConfirmation = (a: Actor | null | undefined) => isManager(a) || isEmployee(a) && can(a, 'purchases.confirm');
export const canPay = (a: Actor | null | undefined) => isManager(a) || isEmployee(a) && can(a, 'purchases.pay');
/** Duyệt giá đơn mua: Manager hoặc nhân viên được Manager bật cờ "Được duyệt" (docs/PHAN-QUYEN.md). */
export const canApprovePurchase = (a: Actor | null | undefined) => isManager(a) || isEmployee(a) && canApprove(a);

export type PurchaseState = 'draft' | 'awaiting_confirmation' | 'confirmed' | 'partially_received' | 'received' | 'cancelled';
export const PURCHASE_STATE_LABEL: Record<PurchaseState, string> = {
  draft: 'Nháp – chờ Manager duyệt', awaiting_confirmation: 'Chờ NCC xác nhận', confirmed: 'NCC đã xác nhận',
  partially_received: 'Đã nhận một phần', received: 'Đã nhận đủ', cancelled: 'Đã huỷ',
};
/** `submittedAt`: null = nháp chưa gửi duyệt (chưa vào hàng chờ của Manager); undefined = không theo dõi (coi như đã gửi). */
export interface OrderFlags { approvalStatus: string; supplierStatus: string; cancelledAt: string | null; createdBy: string; submittedAt?: string | null }
/** Nhãn trạng thái: nháp chưa gửi duyệt tách khỏi "chờ Manager duyệt". */
export const purchaseStateLabel = (state: PurchaseState, o: Pick<OrderFlags, 'submittedAt'>) =>
  state === 'draft' && o.submittedAt === null ? 'Nháp – chưa gửi duyệt' : PURCHASE_STATE_LABEL[state];
export function purchaseState(o: OrderFlags, progress: Pick<ReceiptProgress, 'anyReceived' | 'fullyReceived'>): PurchaseState {
  if (o.cancelledAt) return 'cancelled';
  if (o.approvalStatus !== 'approved') return 'draft';
  if (progress.fullyReceived) return 'received';
  if (progress.anyReceived) return 'partially_received';
  return o.supplierStatus === 'confirmed' ? 'confirmed' : 'awaiting_confirmation';
}

export type PurchaseAction = 'reference' | 'edit' | 'submit' | 'approve' | 'confirm' | 'receive' | 'pay' | 'schedule' | 'cancel' | 'pdf';
export type Check = { ok: true } | { ok: false; status: number; message: string };
const no = (status: number, message: string): Check => ({ ok: false, status, message });
const OK: Check = { ok: true };

/** Một nguồn quyết định cho cả nút trên giao diện (`purchaseActions`) và kiểm tra ở máy chủ. */
export function checkPurchase(action: PurchaseAction, a: Actor | null | undefined, o: OrderFlags, p: { anyReceived: boolean; fullyReceived: boolean; paid: number }): Check {
  if (!a?.active || (!canUsePurchasing(a)&&!(action==='receive'&&isWarehouseStaff(a)&&canReceive(a)))) return no(403, 'Bạn không có quyền với đơn mua hàng.');
  const manager = isManager(a), state = purchaseState(o, p);
  if (state === 'cancelled' && action !== 'pdf') return no(409, 'Đơn mua đã huỷ.');
  switch (action) {
    case 'reference':
      if (state === 'draft') return no(409, 'Đơn chưa duyệt; nhập số đơn NCC khi sửa nháp.');
      return manager || o.createdBy === a.id || canRecordSupplierConfirmation(a) ? OK : no(403, 'Chỉ người tạo đơn, Manager hoặc người được cấp quyền xác nhận NCC được cập nhật số đơn NCC.');
    case 'edit':
      if (state !== 'draft') return no(409, 'Đơn đã duyệt – chỉ sửa được khi còn nháp.');
      return manager || o.createdBy === a.id ? OK : no(403, 'Chỉ người tạo đơn hoặc Manager được sửa đơn nháp.');
    case 'submit':
      if (state !== 'draft') return no(409, 'Đơn đã duyệt.');
      if (o.submittedAt !== null) return no(409, 'Đơn đã gửi Manager duyệt.');
      return manager || o.createdBy === a.id ? OK : no(403, 'Chỉ người tạo đơn hoặc Manager được gửi duyệt.');
    case 'approve':
      if (!canApprovePurchase(a)) return no(403, 'Chỉ Manager hoặc người được Manager chỉ định duyệt đơn mua (giá / chiết khấu).');
      return state === 'draft' ? OK : no(409, 'Đơn này đã được duyệt.');
    case 'confirm':
      if (!canRecordSupplierConfirmation(a)) return no(403, 'Bạn chưa được cấp quyền xác nhận thay NCC.');
      if (state === 'draft') return no(409, 'Đơn chưa được duyệt.');
      return state === 'received' ? no(409, 'Đơn đã nhận đủ hàng.') : OK;
    case 'receive':
      if (!canReceive(a)) return no(403, 'Bạn chưa được cấp quyền nhận hàng NCC.');
      if (state === 'draft') return no(409, 'Đơn chưa được duyệt, chưa nhận hàng được.');
      return state === 'received' ? no(409, 'Đơn đã nhận đủ hàng.') : OK;
    case 'pay': case 'schedule':
      if (!canPay(a)) return no(403, 'Chỉ Manager hoặc Kế toán được ghi thanh toán NCC.');
      return state === 'draft' ? no(409, 'Đơn chưa được duyệt.') : OK;
    case 'cancel':
      if (p.anyReceived) return no(409, 'Đơn đã nhận hàng – không huỷ được. Huỷ các phiếu nhận trước.');
      if (p.paid > 0) return no(409, 'Đơn đã có thanh toán – dùng Trả hàng / Huỷ phần chưa nhận và đối soát tiền hoàn. Không huỷ khoản chi thật để huỷ đơn.');
      if (state === 'draft') return manager || o.createdBy === a.id ? OK : no(403, 'Chỉ người tạo đơn hoặc Manager được huỷ đơn nháp.');
      return manager || isEmployee(a) && can(a, 'purchases.cancel-approved') ? OK : no(403, 'Bạn chưa được cấp quyền huỷ đơn mua đã duyệt.');
    case 'pdf':
      return canSeePurchasePrices(a, o) ? OK : no(403, 'Chỉ người được xem giá mua tải được PDF đơn mua.');
  }
}
export const PURCHASE_ACTIONS: PurchaseAction[] = ['reference', 'edit', 'submit', 'approve', 'confirm', 'receive', 'pay', 'schedule', 'cancel', 'pdf'];
export const purchaseActions = (a: Actor | null | undefined, o: OrderFlags, p: { anyReceived: boolean; fullyReceived: boolean; paid: number }) =>
  PURCHASE_ACTIONS.filter(x => checkPurchase(x, a, o, p).ok);

// ---------------------------------------------------------------- nhận hàng từng đợt
export interface OrderedLine { id: string; sku: string; name: string; quantity: number; creditedQty?: number }
export interface ReceivedLine { lineId: string; goodQty: number; damagedQty: number; returnedGoodQty?: number }
export interface LineProgress { lineId: string; sku: string; name: string; ordered: number; good: number; damaged: number; missing: number }
export interface ReceiptProgress { lines: LineProgress[]; anyReceived: boolean; fullyReceived: boolean; ordered: number; good: number; damaged: number; missing: number }

/** Tiến độ nhận: đạt cộng dồn các phiếu chưa huỷ; còn thiếu = đặt − đạt (hàng hỏng vẫn tính là thiếu, NCC cần bù). */
export function receiptProgress(lines: readonly OrderedLine[], received: readonly ReceivedLine[]): ReceiptProgress {
  const totals=new Map<string,{good:number;damaged:number}>();
  for(const r of received){const t=totals.get(r.lineId)??{good:0,damaged:0};t.good=t.good+r.goodQty-(r.returnedGoodQty??0);t.damaged+=r.damagedQty;totals.set(r.lineId,t);}
  const out = lines.map(l => {
    const {good,damaged}=totals.get(l.id)??{good:0,damaged:0};
    return { lineId: l.id, sku: l.sku, name: l.name, ordered: l.quantity - (l.creditedQty ?? 0), good, damaged, missing: Math.max(0,Math.round((l.quantity - (l.creditedQty ?? 0) - good)*1000)/1000) };
  });
  const sum = (k: 'ordered' | 'good' | 'damaged' | 'missing') => out.reduce((s, r) => s + r[k], 0);
  return { lines: out, anyReceived: out.some(r => r.good > 0 || r.damaged > 0), fullyReceived: out.length > 0 && out.every(r => r.missing === 0),
    ordered: sum('ordered'), good: sum('good'), damaged: sum('damaged'), missing: sum('missing') };
}

const qty = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) && n >= 0 && n <= 1e7 ? Math.round(n * 1000) / 1000 : NaN; };

/** Kiểm phiếu nhận: mỗi mã thuộc đơn, số ≥ 0, ít nhất một số > 0, đạt không vượt phần còn thiếu (chống gõ nhầm / nhận trùng). */
export function validateReceipt(progress: ReceiptProgress, input: { receivedDate?: unknown; lines?: unknown }, today: string): { receivedDate: string; lines: (ReceivedLine & { sku: string; note: string })[] } {
  const date = input.receivedDate === undefined || input.receivedDate === '' ? today : input.receivedDate;
  if (!isIsoDate(date)) throw new AppError(400, 'Ngày nhận hàng không hợp lệ.');
  if (date > today) throw new AppError(400, 'Ngày nhận hàng không được sau hôm nay.');
  if (!Array.isArray(input.lines)) throw new AppError(400, 'Danh sách hàng nhận không hợp lệ.');
  const seen = new Set<string>(), out: (ReceivedLine & { sku: string; note: string })[] = [];
  for (const raw of input.lines as Record<string, unknown>[]) {
    const line = progress.lines.find(l => l.lineId === raw?.lineId);
    if (!line || seen.has(line.lineId)) throw new AppError(400, 'Có mã hàng không thuộc đơn mua này.');
    seen.add(line.lineId);
    const goodQty = qty(raw.goodQty), damagedQty = qty(raw.damagedQty), note = String(raw.note ?? '').trim().slice(0, 500);
    if (Number.isNaN(goodQty) || Number.isNaN(damagedQty)) throw new AppError(400, `Số lượng nhận của ${line.sku} không hợp lệ.`);
    if (!goodQty && !damagedQty) continue;
    if (goodQty > line.missing) throw new AppError(400, `${line.sku}: nhận đạt ${goodQty} vượt số còn thiếu ${line.missing}.`);
    // Hàng hỏng nằm trong số hàng NCC giao đợt này: đạt + hỏng không vượt số còn thiếu (gõ hỏng mà quên bớt số đạt → không ghi nhận đủ / cộng kho thừa).
    if (goodQty + damagedQty > line.missing + 1e-9)
      throw new AppError(400, `${line.sku}: đạt ${goodQty} + hỏng ${damagedQty} vượt số còn thiếu ${line.missing}. Số đạt chỉ gồm hàng tốt (VD: giao 10, hỏng 2 → đạt 8).`, 'RECEIPT_OVER');
    out.push({ lineId: line.lineId, sku: line.sku, goodQty, damagedQty, note });
  }
  if (!out.length) throw new AppError(400, 'Nhập số lượng nhận cho ít nhất một mã.');
  return { receivedDate: date, lines: out };
}

// ---------------------------------------------------------------- công nợ NCC
export interface Schedule { id?: string; kind: 'deposit' | 'installment' | 'balance'; amount: number; dueDate: string | null }
export interface Payment { amount: number; paidDate: string; voidedAt: string | null }
export interface SupplierDebt { total: number; paid: number; refunded: number; netPaid: number; supplierCredit: number; balance: number; overdue: number; nextDueDate: string | null; nextDueAmount: number; status: 'none' | 'open' | 'overdue' | 'paid' }

/** Thanh toán áp vào kỳ đến hạn sớm nhất trước. Quá hạn = phần của các kỳ có hạn < hôm nay chưa trả đủ. */
export function supplierDebt(total: number, schedules: readonly Schedule[], payments: readonly Payment[], today: string, refunded = 0): SupplierDebt {
  const paid = round(payments.filter(p => !p.voidedAt).reduce((s, p) => s + p.amount, 0));
  const netPaid = round(paid - refunded), supplierCredit = Math.max(0, round(netPaid - total));
  const balance = Math.max(0, round(total - netPaid));
  let left = netPaid, overdue = 0, nextDueDate: string | null = null, nextDueAmount = 0;
  const ordered = [...schedules].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  for (const s of ordered) {
    const covered = Math.min(left, s.amount); left -= covered;
    const open = round(s.amount - covered);
    if (open <= 0) continue;
    if (s.dueDate && s.dueDate < today) overdue += open;
    else if (!nextDueDate && s.dueDate) { nextDueDate = s.dueDate; nextDueAmount = open; }
  }
  overdue = Math.min(round(overdue), balance);
  nextDueAmount=Math.min(nextDueAmount,Math.max(0,balance-overdue));
  if(!nextDueAmount)nextDueDate=null;
  return { total: round(total), paid, refunded, netPaid, supplierCredit, balance, overdue, nextDueDate, nextDueAmount, status: total <= 0 ? 'none' : balance <= 0 ? 'paid' : overdue > 0 ? 'overdue' : 'open' };
}
const round = (n: number) => Math.round(n);

/**
 * Lịch trả mặc định khi duyệt: không cọc (một kỳ "phần còn lại") hoặc cọc theo % / số tiền + phần còn lại;
 * có thể thêm nhiều đợt (installments). Tổng các kỳ phải đúng bằng tổng đơn.
 */
export function buildSchedules(total: number, input: { deposit?: { mode?: unknown; value?: unknown; dueDate?: unknown }; installments?: unknown; balanceDueDate?: unknown }): Schedule[] {
  const bad = (m: string) => new AppError(400, m);
  const date = (v: unknown) => { if (v === undefined || v === null || v === '') return null; if (!isIsoDate(v)) throw bad('Ngày hạn trả không hợp lệ.'); return v; };
  const out: Schedule[] = [];
  const mode = input.deposit?.mode ?? 'none';
  if (mode !== 'none') {
    const v = Number(input.deposit?.value);
    const amount = mode === 'percent' ? (v >= 0 && v <= 100 ? Math.round(total * v / 100) : NaN) : mode === 'amount' ? (v >= 0 ? Math.round(v) : NaN) : NaN;
    if (!Number.isFinite(amount) || amount > total) throw bad('Tiền cọc không hợp lệ.');
    if (amount > 0) out.push({ kind: 'deposit', amount, dueDate: date(input.deposit?.dueDate) });
  }
  for (const it of Array.isArray(input.installments) ? input.installments as Record<string, unknown>[] : []) {
    const amount = Math.round(Number(it?.amount));
    if (!(amount > 0)) throw bad('Số tiền đợt trả không hợp lệ.');
    out.push({ kind: 'installment', amount, dueDate: date(it.dueDate) });
  }
  const used = out.reduce((s, x) => s + x.amount, 0);
  if (used > total) throw bad('Tổng cọc và các đợt trả vượt tổng đơn.');
  if (total - used > 0) out.push({ kind: 'balance', amount: Math.round(total - used), dueDate: date(input.balanceDueDate) });
  return out;
}

// ---------------------------------------------------------------- chống mua trùng
export interface NeedLine { sku: string; name: string; unit: string; quantity: number }
/** Còn cần đặt cho từng mã của một chứng từ nguồn = cần − đã đặt (các đơn mua chưa huỷ). */
export function remainingToOrder(need: readonly NeedLine[], ordered: ReadonlyMap<string, number>): (NeedLine & { ordered: number; remaining: number })[] {
  const merged = new Map<string, NeedLine>();
  for (const l of need) {
    const key = l.sku.trim(); if (!key) continue;
    const cur = merged.get(key.toLowerCase());
    merged.set(key.toLowerCase(), cur ? { ...cur, quantity: cur.quantity + l.quantity } : { ...l, sku: key });
  }
  return [...merged.values()].map(l => { const done = ordered.get(l.sku.toLowerCase()) ?? 0; return { ...l, ordered: done, remaining: Math.max(0, l.quantity - done) }; });
}
