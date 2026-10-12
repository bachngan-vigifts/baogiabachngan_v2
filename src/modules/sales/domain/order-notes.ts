/** Only the delivery and payment terms belong to the default order note. */
export interface QuoteNotesSource { notes?: unknown; deliveryDate?: unknown; customerAddress?: unknown }
type Kind = 'time' | 'address' | 'payment' | 'method';
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
function terms(notes: unknown) {
  const parts: Record<Kind, string[]> = { time: [], address: [], payment: [], method: [] };
  let active: Kind | null = null;
  for (const raw of text(notes).split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-+–•]\s*/, ''), key = fold(line);
    let kind: Kind | null = /^thoi gian giao hang\s*[:：]/.test(key) ? 'time'
      : /^dia (?:chi|diem) giao hang\s*[:：]/.test(key) ? 'address'
      : /^phuong thuc thanh toan\s*[:：]/.test(key) ? 'method'
      : /^(?:thanh toan|dieu khoan thanh toan|dieu kien thanh toan)\s*[:：]/.test(key) || /^(?:ben a thanh toan|ben mua se tien hanh tam ung|dat coc|tam ung|\d+(?:[.,]\d+)?%\s*(?:tri gia|gia tri)\s+con lai)/.test(key) ? 'payment' : null;
    if (kind) {
      const value = /^(?:Thời gian giao hàng|Địa (?:chỉ|điểm) giao hàng|Phương thức thanh toán|Thanh toán|Điều (?:khoản|kiện) thanh toán)\s*[:：]\s*/i.test(line)
        ? line.replace(/^[^:：]+[:：]\s*/, '') : line;
      if (kind === 'time' || kind === 'address') parts[kind] = [];
      parts[kind].push(value); active = kind;
    } else if (!line || /^\s*[-+–•]/.test(raw) || /^(?:tran trong|hy vong|kinh chao|tong |bao gia|gia tren|don vi|ma so thue|so tai khoan|tai khoan|ngan hang)/.test(key) || /^[^:：]{1,70}[:：]/.test(line)) active = null;
    else if (active) parts[active].push(line);
  }
  return { time: parts.time.join(' ').trim(), address: parts.address.join(' ').trim(), payment: parts.payment.join(' ').trim(), method: parts.method.join(' ').trim() };
}
function day(date: unknown) {
  const s = text(date); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + 'T00:00:00Z')) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) return '';
  return s.split('-').reverse().join('/');
}
export function orderDeliveryAddress(source: QuoteNotesSource) {
  const address = terms(source.notes).address;
  return address && !/^theo thoa thuan[.]?$/.test(fold(address)) ? address : text(source.customerAddress) || address;
}
function render(t: ReturnType<typeof terms>) {
  const payment = [t.payment, t.method ? 'Phương thức: ' + t.method : ''].filter(Boolean).join(' ');
  return ['- Thời gian giao hàng: ' + t.time, '- Địa chỉ giao hàng: ' + t.address, '- Thanh toán: ' + payment].join('\n');
}
export function orderNotesFromQuote(source: QuoteNotesSource) {
  const t = terms(source.notes), date = day(source.deliveryDate);
  if (date) t.time = 'Giao hàng ngày ' + date + '.';
  t.address = orderDeliveryAddress(source);
  return render(t);
}
/** Update only delivery fields selected by the user; retain edited payment terms. */
export function syncOrderDeliveryNotes(notes: string, changes: { deliveryDate?: string; deliveryAddress?: string }, source: QuoteNotesSource) {
  const t = terms(notes);
  if (changes.deliveryDate !== undefined) { const date = day(changes.deliveryDate); t.time = date ? 'Giao hàng ngày ' + date + '.' : terms(source.notes).time; }
  if (changes.deliveryAddress !== undefined) t.address = changes.deliveryAddress.trim();
  return render(t);
}
