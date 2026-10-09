// Điều khoản báo giá: đặt cọc và thời hạn thanh toán, số tiền bằng số.
export const defaultPaymentTerms = type => ({ depositRate: type === 'HRC' ? 0 : type === 'VIGIFTS' ? 50 : 30,
  balanceTerm: type === 'HRC' ? '30' : type === 'VIGIFTS' ? '0' : 'Thanh toán trước khi giao hàng' });
export function paymentClause(terms, total = 0, inWords = () => '') {
  const rate = Number(terms.depositRate), term = String(terms.balanceTerm || '').trim();
  const money = value => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value);
  const percent = value => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
  const deposit = Math.round(total * rate / 100), remaining = total - deposit;
  const days = /^(\d+)\s*(?:ngày)?$/i.exec(term)?.[1];
  const deadline = days !== undefined ? Number(days) > 0
    ? (rate === 0 ? 'sau ' + Number(days) + ' ngày kể từ ngày giao hàng' : 'trong vòng ' + Number(days) + ' ngày kể từ ngày giao hàng')
    : 'ngay sau khi giao hàng' : term.replace(/^thanh toán\s*/i, '').replace(/[.]+$/, '');
  const amount = value => money(value) + ' đồng';
  if (rate === 100) return 'Đặt cọc 100% giá trị hợp đồng tương ứng với số tiền là ' + amount(deposit) + ' trước khi giao hàng.';
  if (rate === 0) return 'Bên A thanh toán 100% giá trị hợp đồng tương ứng với số tiền là ' + amount(remaining) + ' ' + deadline + '.';
  return 'Đặt cọc ' + percent(rate) + '% giá trị của hợp đồng tương ứng với số tiền là ' + amount(deposit)
    + ' ngay sau khi ký hợp đồng. Thanh toán ' + percent(100 - rate) + '% giá trị còn lại tương ứng ' + amount(remaining) + ' ' + deadline + '.';
}
export function withPaymentNotes(notes, terms, total, inWords) {
  const lines = String(notes || '').split(/\r?\n/);
  const isPayment = line => /^\s*[-+–•]?\s*(?:Thanh toán:|Bên Mua sẽ tiến hành tạm ứng|(?:\d+(?:[.,]\d+)?%)\s*(?:trị giá|giá trị)\s+còn lại|Bên A thanh toán)/i.test(line);
  const first = lines.findIndex(isPayment);
  const result = lines.filter(line => !isPayment(line));
  result.splice(first < 0 ? result.findIndex(line => /Trân trọng|Hy vọng/i.test(line)) < 0 ? result.length : result.findIndex(line => /Trân trọng|Hy vọng/i.test(line)) : first, 0,
    '- Thanh toán: ' + paymentClause(terms, total, inWords));
  return result.join('\n');
}
