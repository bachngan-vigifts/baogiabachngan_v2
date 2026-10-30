import { AppError } from '../../../core/errors.ts';
import { validDeliveryDate } from '../../quotes/domain/quotation-schema.ts';
import { quoteNoteTerms } from './order-notes.ts';

export interface ContractQuoteTerms { depositRate?: number; paymentDays?: number; deliveryTime?: string; deliveryAddress?: string }
type Data = Record<string, any>;
const nonempty = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : undefined;
/** Prefer current quotation terms; historical quotes can still use their document fields / notes. */
export function contractTermsFromQuote(data: Data): ContractQuoteTerms {
  const saved = data.contractDocument?.details || {}, notes = quoteNoteTerms(data.notes);
  const payment = notes.payment;
  const rateMatch = /(?:tạm ứng|đặt cọc|thanh toán trước)[^\d]{0,50}(\d+(?:[.,]\d+)?)\s*%/i.exec(payment)
    || /(?:Bên A thanh toán(?: cho Bên B)?)[^\d]{0,30}(\d+(?:[.,]\d+)?)\s*%[^.]{0,250}ngay sau khi ký/i.exec(payment);
  const noteRate = rateMatch ? Number(rateMatch[1]!.replace(',', '.'))
    : /thanh toán\s+100%[^.]{0,250}trước khi giao hàng/i.test(payment) ? 100
    : /thanh toán\s+100%[^.]{0,250}(?:sau|ngay sau|trong vòng)\s/i.test(payment) ? 0 : undefined;
  const noteDays = /(?:trong(?: vòng)?|sau)\s+(\d+)\s*ngày\s+kể từ ngày giao hàng/i.exec(payment)?.[1];
  const rate = data.paymentTerms?.depositRate ?? noteRate ?? saved.depositRate;
  const term = data.paymentTerms?.balanceTerm ?? noteDays ?? saved.paymentDays;
  const days = /^\d+\s*(?:ngày)?$/i.test(String(term ?? '').trim()) ? parseInt(String(term), 10) : undefined;
  const date = validDeliveryDate(data.deliveryDate || data.delivery_date);
  return {
    ...(typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 100 ? { depositRate: rate } : {}),
    ...(days !== undefined && days <= 3650 ? { paymentDays: days } : {}),
    deliveryTime: date ? 'Giao hàng ngày ' + date.split('-').reverse().join('/') : nonempty(notes.time) || nonempty(saved.deliveryTime),
    deliveryAddress: nonempty(notes.address) || nonempty(saved.deliveryAddress) || nonempty(data.customerAddress),
  };
}
export function deliveryDateFromTerm(value: string) {
  const date = value.match(/(?:^|\s)(\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{4})(?:[.]?$|\s*$)/)?.[1];
  return date ? validDeliveryDate(date) : '';
}
/** Patch only explicitly changed terms. Products, costs, VAT, customer and unrelated notes stay intact. */
export function quoteWithContractTerms(data: Data, changes: ContractQuoteTerms): Data {
  const next = structuredClone(data), previous = contractTermsFromQuote(data);
  const changed = Object.fromEntries(Object.entries(changes).filter(([k, v]) => v !== undefined && v !== previous[k as keyof ContractQuoteTerms])) as ContractQuoteTerms;
  if (!Object.keys(changed).length) return next;
  const lines = String(next.notes || '').split(/\r?\n/);
  const replace = (pattern: RegExp, label: string, value: string) => {
    let first = lines.findIndex(line => pattern.test(line));
    if (first < 0) first = lines.length;
    // Remove continuation lines of this term too, retaining all other note sections.
    for (let i = lines.length - 1; i >= 0; i--) if (pattern.test(lines[i]!)) {
      let end = i + 1;
      while (end < lines.length && lines[end]!.trim() && !/^\s*[-+–•]|^[^:：]{1,70}[:：]|^\s*(?:Trân trọng|Hy vọng|Kính chào)/i.test(lines[end]!)) end++;
      lines.splice(i, end - i);
    }
    lines.splice(Math.min(first, lines.length), 0, '- ' + label + ': ' + value);
  };
  if (changed.depositRate !== undefined || changed.paymentDays !== undefined) {
    const rate = changed.depositRate ?? previous.depositRate ?? 0;
    const balanceTerm = changed.paymentDays !== undefined ? String(changed.paymentDays) : String(next.paymentTerms?.balanceTerm ?? previous.paymentDays ?? 'Theo thỏa thuận');
    next.paymentTerms = { ...next.paymentTerms, depositRate: rate, balanceTerm };
    const days = /^\d+\s*(?:ngày)?$/i.test(balanceTerm) ? parseInt(balanceTerm, 10) : null;
    const deadline = days === null ? balanceTerm : days > 0 ? `trong vòng ${days} ngày kể từ ngày giao hàng` : 'ngay sau khi giao hàng';
    const clause = rate === 100 ? 'Bên A thanh toán 100% giá trị hợp đồng trước khi giao hàng.' : rate === 0 ? `Bên A thanh toán 100% giá trị hợp đồng ${deadline}.` : `Bên A thanh toán ${rate}% giá trị hợp đồng ngay sau khi ký. Thanh toán ${100 - rate}% giá trị còn lại ${deadline}.`;
    replace(/^\s*[-+–•]?\s*(?:Thanh toán:|Điều (?:khoản|kiện) thanh toán:|Bên Mua sẽ tiến hành tạm ứng|\d+(?:[.,]\d+)?%\s*(?:trị giá|giá trị)\s+còn lại|Bên A thanh toán)/i, 'Thanh toán', clause);
    next.paymentNotesManual = false;
  }
  if (changed.deliveryTime !== undefined) {
    replace(/^\s*[-+–•]?\s*Thời gian giao hàng\s*[:：]/i, 'Thời gian giao hàng', changed.deliveryTime);
    const date = deliveryDateFromTerm(changed.deliveryTime);
    if (date) next.deliveryDate = date; else delete next.deliveryDate;
    delete next.delivery_date;
  }
  if (changed.deliveryAddress !== undefined) replace(/^\s*[-+–•]?\s*Địa (?:chỉ|điểm) giao hàng\s*[:：]/i, 'Địa chỉ giao hàng', changed.deliveryAddress);
  next.notes = lines.join('\n');
  if (next.notes.length > 20000) throw new AppError(400, 'Ghi chú báo giá vượt 20.000 ký tự sau khi cập nhật điều khoản. Vui lòng rút gọn ghi chú báo giá.');
  if (next.contractDocument?.details) next.contractDocument.details = { ...next.contractDocument.details, ...changed };
  return next;
}
