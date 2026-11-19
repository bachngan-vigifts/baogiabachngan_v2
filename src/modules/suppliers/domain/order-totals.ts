import { stockInteger, numOrZero } from './quantity.ts';

/**
 * Tổng tiền đơn NCC. Port từ `supplierOrderDetail` / `supplierDepositAmount` / `supplierPaidAmount`
 * (lib/product-catalog.mjs); thứ tự phép tính giữ nguyên, kiểm chứng bằng test đối chiếu với code bản cũ.
 * Các số này là DỮ LIỆU SUY RA từ dòng hàng – không lưu cột.
 */
export interface TotalsRow {
  creditedQty?: number;
  quantity: number; price: number | null; printFee: number; taxRate: number | null;
  /** % chiết khấu manager nhập lúc duyệt. */
  purchaseDiscount: number | null;
  /** % chiết khấu NCC xác nhận (ghi đè nếu có). */
  confirmedPurchaseDiscount: number | null;
}
export interface OrderTotalsInput { rows: readonly TotalsRow[]; depositRate: number | null | undefined; paidAmount: number | null | undefined }

export interface LineTotals { quantity: number; unitPrice: number; printFee: number; taxRate: number; purchaseDiscount: number; priceAfterDiscount: number; lineTotal: number; lineVat: number }
export interface OrderTotals { rows: LineTotals[]; subtotal: number; vat: number; total: number; depositRate: number; depositAmount: number; depositPaidAmount: number; remainingAmount: number }

export const DEFAULT_DEPOSIT_RATE = 30;

/** Tỷ lệ cọc hợp lệ 0..100, làm tròn 2 chữ số; ngoài khoảng → null. */
export const normalizeDepositRate = (value: unknown): number | null => {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? Math.round(rate * 100) / 100 : null;
};

export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  let subtotal = 0, vat = 0;
  const rows = input.rows.map(row => {
    // Allocate the original rounded line value proportionally when crediting fractional stock.
    // With no credit, legacy quantity rounding and all price/CK/VAT formulas are unchanged.
    const original = numOrZero(row.quantity), remaining = Math.max(0, original - numOrZero(row.creditedQty));
    const quantity = stockInteger(original) * (original > 0 ? remaining / original : 0), unitPrice = numOrZero(row.price);
    const printFee = Math.max(0, numOrZero(row.printFee)), taxRate = numOrZero(row.taxRate);
    const confirmed = row.confirmedPurchaseDiscount === null ? NaN : Number(row.confirmedPurchaseDiscount);
    const purchaseDiscount = Math.max(0, Math.min(100, Number.isFinite(confirmed) ? confirmed : (Number(row.purchaseDiscount) || 0)));
    const priceAfterDiscount = unitPrice * (100 - purchaseDiscount) / 100, lineTotal = (priceAfterDiscount + printFee) * quantity, lineVat = lineTotal * taxRate / 100;
    subtotal += lineTotal; vat += lineVat;
    return { quantity, unitPrice, printFee, taxRate, purchaseDiscount, priceAfterDiscount, lineTotal, lineVat };
  });
  const total = subtotal + vat;
  const depositRate = (input.depositRate === null || input.depositRate === undefined ? null : normalizeDepositRate(input.depositRate)) ?? DEFAULT_DEPOSIT_RATE;
  const depositAmount = Math.round(Number(total || 0) * depositRate / 100);
  const depositPaidAmount = Math.max(0, Number(input.paidAmount ?? 0) || 0);
  return { rows, subtotal, vat, total, depositRate, depositAmount, depositPaidAmount, remainingAmount: Math.max(0, total - depositPaidAmount) };
}

/** Giá mua một đơn vị trước VAT, cùng công thức với tiền phải trả NCC. Không biến giá thiếu thành 0. */
export function purchaseUnitCost(row: Omit<TotalsRow, 'quantity'>): number | null {
  if (row.price === null || !Number.isFinite(row.price) || row.price < 0) return null;
  const t = computeOrderTotals({rows:[{...row,quantity:1}],depositRate:null,paidAmount:null}).rows[0]!;
  return t.priceAfterDiscount + t.printFee;
}

/** Nhân viên thường xem đơn NCC nhưng BỊ ẨN giá/tiền (bản cũ: `priceHidden`). */
export function hidePrices(t: OrderTotals): OrderTotals & { priceHidden: true } {
  return {
    priceHidden: true, subtotal: 0, vat: 0, total: 0, depositRate: t.depositRate, depositAmount: 0, depositPaidAmount: 0, remainingAmount: 0,
    rows: t.rows.map(r => ({ ...r, unitPrice: 0, taxRate: 0, purchaseDiscount: 0, priceAfterDiscount: 0, lineTotal: 0, lineVat: 0 })),
  };
}
