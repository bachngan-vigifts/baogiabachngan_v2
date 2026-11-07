/**
 * CHI PHÍ CHI NHÁNH (giai đoạn 2 · PR-D) – hàm thuần.
 * Phiếu két cửa hàng (`cash_entries`, chỉ phiếu đã ghi sổ, chưa huỷ) KHÔNG phải phiếu nào cũng là chi phí:
 *  - Chi vặt (`petty_expense`) → chi phí hoạt động của chi nhánh, TRỪ khi tên / nội dung cho thấy đã tính ở chỗ khác:
 *      · trả lương / thưởng / phụ cấp → đã ở bảng lương  · phí GHN / ship / giao hàng → có thể trùng phí GHN của đơn
 *      · trả NCC / nhập hàng → đã ở giá vốn  · hoàn tiền khách → đã trừ doanh thu
 *    Các phiếu này KHÔNG tính, liệt kê "cần xác nhận" (từ khoá là GIẢ ĐỊNH, Manager xem lại).
 *  - Chi vặt ghi "nộp quỹ / nộp két / nộp tiền về công ty / ngân hàng" (phiếu cũ trước khi có loại Nộp quỹ) → chuyển tiền, không tính.
 *  - Tạm ứng → trừ lương sau, không phải chi phí · Nộp két / rút két → chuyển tiền · Hoàn tiền khách → đã trừ doanh thu qua phiếu trả
 *  - Thu khác → không phải doanh thu bán hàng, không cộng · Điều chỉnh két (chênh lệch) → chưa tính, cần Manager xác nhận.
 */
export const CASH_CLASSES = ['operating', 'payroll', 'carrier', 'supplier', 'refund', 'advance', 'transfer', 'other_income', 'adjustment'] as const;
export type CashClass = typeof CASH_CLASSES[number];
export const CASH_CLASS_LABEL: Record<CashClass, { label: string; counted: boolean; why: string }> = {
  operating: { label: 'Chi phí hoạt động (chi vặt)', counted: true, why: 'Tính vào chi phí chi nhánh' },
  payroll: { label: 'Chi vặt ghi trả lương / thưởng', counted: false, why: 'Không – đã ở bảng lương (cần xác nhận)' },
  carrier: { label: 'Chi vặt ghi phí ship / GHN', counted: false, why: 'Không – có thể trùng phí GHN của đơn (cần xác nhận)' },
  supplier: { label: 'Chi vặt ghi trả NCC / nhập hàng', counted: false, why: 'Không – đã ở giá vốn (cần xác nhận)' },
  refund: { label: 'Hoàn tiền / trả khách', counted: false, why: 'Không – đã trừ doanh thu qua phiếu trả hàng' },
  advance: { label: 'Tạm ứng nhân viên', counted: false, why: 'Không – trừ lương sau' },
  transfer: { label: 'Nộp két / rút két', counted: false, why: 'Không – chuyển tiền, không phải chi phí' },
  other_income: { label: 'Thu khác', counted: false, why: 'Không – không phải doanh thu bán hàng' },
  adjustment: { label: 'Điều chỉnh két (chênh lệch)', counted: false, why: 'Chưa tính – cần Manager xác nhận' },
};
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const RULES: [CashClass, RegExp][] = [
  // Phiếu cũ lập bằng "chi vặt" nhưng thực chất là nộp tiền két về công ty / ngân hàng (trước khi có loại "Nộp quỹ"):
  // chuyển tiền, không phải chi phí – xét trước các từ khoá khác ("nộp quỹ lương" vẫn là nộp quỹ).
  ['transfer', /\b(nop (quy|ket)|chuyen quy|nop (tien )?(ve )?(cong ty|van phong|ke toan|ngan hang|doanh thu|tien ban hang|tien hang ngay|tien mat ve))\b/],
  ['payroll', /\b(luong|thuong|phu cap|bhxh|com xang)\b/],
  ['carrier', /\b(ghn|ship|giao hang|van chuyen|cuoc xe)\b/],
  ['supplier', /\b(ncc|nha cung cap|nhap hang|tra hang ncc)\b/],
  ['refund', /\b(hoan tien|tra khach|hoan khach)\b/],
];
export function classifyCashEntry(e: { kind: string; reason: string }): CashClass {
  switch (e.kind) {
    case 'advance': return 'advance';
    case 'cash_in': case 'cash_out': return 'transfer';
    case 'customer_refund': return 'refund';
    case 'other_income': return 'other_income';
    case 'adjustment': return 'adjustment';
  }
  const t = fold(e.reason || '');
  for (const [k, re] of RULES) if (re.test(t)) return k;
  return 'operating';
}
