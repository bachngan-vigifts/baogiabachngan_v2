const money = (n) => Number(n ?? 0).toLocaleString('vi-VN') + ' đ';
export const cashKindLabel = (kind) => ({
  other_income: 'Thu khác', cash_in: 'Rút két', petty_expense: 'Chi vặt',
  advance: 'Tạm ứng', cash_out: 'Nộp két', adjustment: 'Điều chỉnh két',
}[kind] || 'Thu/chi khác');
/** Cùng nhãn và cùng số liệu trên popup, Sổ quỹ và bản in; giá trị đơn không phải tiền thu. */
export function shiftSummaryRows(d) {
  return [
    ['Số bill', d.bills.count],
    ['Giá trị đơn đã lập (gồm COD)', money(d.bills.revenue)],
    ['Chiết khấu', money(d.bills.discount)],
    ['Tiền mặt thực thu', money(d.cash)],
    ['Chuyển khoản đã xác nhận', money(d.transfer)],
    ['Tiền đầu ca thực đếm', money(d.shift.openingCash)],
    ...(d.openingComparison ? [
      ['Tiền bàn giao tham chiếu', money(d.openingComparison.expectedCash)],
      ['Chênh lệch khi mở ca (tra soát riêng)', money(d.openingComparison.difference)],
    ] : []),
    ...(d.manual || []).map(x => [(x.direction === 'in' ? '+ ' : '− ') + cashKindLabel(x.kind), money(x.direction === 'in' ? x.amount : -x.amount)]),
    ['Tiền két hệ thống', money(d.expectedCash)],
  ];
}
export function shiftCodRows(d) {
  return [
    ['Đã giao & đã thu trong ca', d.cod.receivedInShift],
    ['Thu COD từ ca trước', d.cod.receivedFromPrevious],
    ['Đã giao, chưa thu (cùng két)', d.cod.pending],
  ].map(([label, value]) => [label, `${value.count} đơn · ${money(value.amount)}`]);
}
