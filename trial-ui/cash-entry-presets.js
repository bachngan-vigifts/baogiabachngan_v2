export const CASH_EXPENSE_PRESETS = [
  'Tiền thuê mặt bằng', 'Tiền điện, nước', 'Internet, điện thoại', 'Văn phòng phẩm',
  'Vệ sinh cửa hàng', 'Sửa chữa, bảo trì', 'Tiếp khách', 'Phí gửi xe',
  'Phí vận chuyển', 'Phí GHN', 'Tạm ứng lương', 'Chi khác',
];
const folded = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').trim().toLowerCase().replace(/\s+/g, ' ');
const transfers = new Set(['nop quy', 'nop ket', 'chuyen quy', 'nop ngan hang', 'nop quy cong ty']);
export function cashEntryKind(name, direction, remittance = false) {
  if (!['in', 'out'].includes(direction) || remittance && direction !== 'out') throw new RangeError('Chiều phiếu không hợp lệ.');
  const title = folded(name);
  if (remittance || direction === 'out' && transfers.has(title)) return 'cash_out';
  if (direction === 'in') return ['rut ket', 'rut quy', 'bo sung tien ket', ...transfers].includes(title) ? 'cash_in' : 'other_income';
  return ['tam ung', 'tam ung luong'].includes(title) ? 'advance' : 'petty_expense';
}
export function cashNamePresets(direction) {
  return direction === 'out' ? CASH_EXPENSE_PRESETS : ['Thu khác', 'Thu công nợ', 'Hoàn tạm ứng', 'Thu phí khác', 'Bổ sung tiền két'];
}
