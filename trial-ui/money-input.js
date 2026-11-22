/**
 * Ô số tiền tự có dấu chấm ngăn cách khi gõ (1500000 → 1.500.000) để tránh nhập thừa / thiếu số 0.
 *
 * Không đổi ô gốc: ô <input type="number"> mà code đang đọc (value, querySelector('input[type=number]'),
 * FormData, min/max) vẫn giữ nguyên và luôn chứa SỐ CHƯA ĐỊNH DẠNG. Một ô chữ hiển thị đặt ngay trước ô gốc,
 * ô gốc ẩn đi; gõ vào ô hiển thị thì cập nhật ô gốc và phát sự kiện input/change trên ô gốc như người dùng gõ.
 * Code gán ô gốc (input.value = 120000) thì ô hiển thị tự cập nhật.
 *
 * Nhận diện ô tiền theo nhãn (tiền, giá, phí, cọc, thu, chi, hoàn, lương, đ/VNĐ…), loại ô %, số lượng, ngày;
 * ô nào cần bật/tắt rõ ràng thì đặt data-money="1" / data-money="0".
 */
const PROTO = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const HID = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
// Native number values with decimal/exponent notation must never pass through the integer digit stripper.
const needsNative = input => input.type === 'number' && input.value !== '' && !/^-?\d+$/.test(input.value);
const MONEY = /tiền|giá|phí|cước|cọc|đ\/|thu |thực thu|đã thu|chi |hoàn|lương|thưởng|công nợ|khách đưa|thanh toán|doanh (số|thu)|ngân sách|vnđ|vnd|₫|giá trị|\(đ\)|\bđ\b|số dư|tồn quỹ|két|đợt trả|amount|price/i;
const NOT_MONEY = /%|phần trăm|tỷ lệ|số lượng|\bsl\b|qty|ngày|giờ|tháng|năm|số lần|điểm|số mã|số dòng|kg|cm|mm|gram|thuế suất/i;
const fmt = raw => {
  if (raw === '' || raw === '-') return raw;
  const neg = raw.startsWith('-'), digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return (neg ? '-' : '') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};
const clean = text => { const s = String(text ?? '').trim(); const neg = /^-/.test(s); const d = s.replace(/\D/g, ''); return d ? (neg ? '-' : '') + d : (neg && s === '-' ? '-' : ''); };

function labelOf(input) {
  const own = input.getAttribute('aria-label') || input.placeholder || '';
  const label = input.labels?.[0] || input.closest('label');
  const text = label ? [...label.childNodes].filter(n => n !== input && !n.contains?.(input)).map(n => n.textContent).join(' ') : '';
  const prev = input.previousElementSibling?.matches('span,small,b,strong,label') ? input.previousElementSibling.textContent : '';
  return [own, text, prev, input.name, input.dataset.label || ''].join(' ').replace(/\s+/g, ' ').trim();
}
export function isMoneyInput(input) {
  if (!(input instanceof HTMLInputElement) || input.dataset.moneyProxy || needsNative(input)) return false;
  // Ô chữ chỉ bật khi đánh dấu rõ (data-money="1"); ô số nhận diện theo nhãn.
  if (input.dataset.money === '1') return input.type === 'number' || input.type === 'text';
  if (input.type !== 'number') return false;
  if (input.dataset.money === '0' || input.closest('[data-money="0"]')) return false;
  const step = input.getAttribute('step');
  // Ô cho phép số lẻ (step="any" hoặc < 1: giá vốn có lẻ, số lượng, %, kg) không tự chấm, để "1500.5" không thành 15.005.
  if (step && (step === 'any' || (Number(step) > 0 && Number(step) < 1))) return false;
  const text = labelOf(input);
  // "đ/kg", "(đ)" là tiền dù có đơn vị khác đi kèm; ô % luôn không phải tiền.
  if (/%|phần trăm|tỷ lệ/i.test(text)) return false;
  return MONEY.test(text) && (!NOT_MONEY.test(text) || /\(đ|đ\/|vnđ/i.test(text));
}

const proxies = new WeakMap();
export function enhanceMoneyInput(input) {
  if (proxies.has(input) || !isMoneyInput(input)) return null;
  const previous = Object.fromEntries(['value','hidden','focus','select'].map(k=>[k,Object.getOwnPropertyDescriptor(input,k)]));
  const attributes = Object.fromEntries(['tabindex','aria-hidden'].map(k=>[k,input.getAttribute(k)]));
  let observer;
  const view = document.createElement('input');
  view.type = 'text'; view.inputMode = 'numeric'; view.autocomplete = 'off'; view.dataset.moneyProxy = '1';
  view.className = input.className + ' money-input'; view.style.cssText = input.style.cssText;
  for (const a of ['placeholder', 'aria-label', 'title', 'id']) if (a !== 'id' && input.hasAttribute(a)) view.setAttribute(a, input.getAttribute(a));
  const detach = () => {
    const hidden=view.hidden;observer?.disconnect();view.remove();proxies.delete(input);
    for(const [key,descriptor]of Object.entries(previous)){if(descriptor)Object.defineProperty(input,key,descriptor);else delete input[key];}
    HID.set.call(input,hidden);
    for(const [key,value]of Object.entries(attributes)){if(value===null)input.removeAttribute(key);else input.setAttribute(key,value);}
  };
  const sync = () => { if(needsNative(input)){detach();return;}const raw = PROTO.get.call(input); if (document.activeElement !== view || clean(view.value) !== raw) view.value = fmt(raw); view.disabled = input.disabled; view.readOnly = input.readOnly; view.required = input.required; };
  // Code gán ô gốc → ô hiển thị cập nhật.
  Object.defineProperty(input, 'value', { configurable: true, get() { return PROTO.get.call(this); }, set(v) { PROTO.set.call(this, v == null ? '' : String(v)); sync(); } });
  input.focus = opts => view.focus(opts); input.select = () => view.select();
  view.addEventListener('input', () => {
    const before = view.value, caret = view.selectionStart ?? before.length, digitsLeft = before.slice(0, caret).replace(/\D/g, '').length;
    const raw = clean(before), shown = fmt(raw);
    view.value = shown;
    // Giữ con trỏ sau đúng chữ số vừa gõ (bỏ qua dấu chấm thêm vào).
    let pos = 0, seen = 0; while (pos < shown.length && seen < digitsLeft) { if (/\d/.test(shown[pos])) seen++; pos++; }
    try { view.setSelectionRange(pos, pos); } catch { /* một số bàn phím không cho đặt con trỏ */ }
    PROTO.set.call(input, raw === '-' ? '' : raw);
    const max = input.max === '' ? NaN : Number(input.max), min = input.min === '' ? NaN : Number(input.min), n = Number(raw);
    view.setCustomValidity(raw && raw !== '-' && (n > max || n < min) ? `Số tiền phải trong khoảng ${fmt(String(min || 0))} – ${fmt(String(max))}` : '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  view.addEventListener('change', () => input.dispatchEvent(new Event('change', { bubbles: true })));
  for (const t of ['blur', 'focus', 'keydown']) view.addEventListener(t, e => { if (t === 'keydown' && e.key === 'Enter') input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); if (t === 'blur') input.dispatchEvent(new FocusEvent('blur')); });
  observer=new MutationObserver(sync);observer.observe(input, { attributes: true, attributeFilter: ['disabled', 'readonly', 'required'] });
  // Code ẩn/hiện ô gốc (input.hidden = …) thì ẩn/hiện ô hiển thị; ô gốc luôn ẩn.
  view.hidden = input.hidden;
  input.before(view); HID.set.call(input, true); input.tabIndex = -1; input.setAttribute('aria-hidden', 'true');
  Object.defineProperty(input, 'hidden', { configurable: true, get() { return view.hidden; }, set(v) { view.hidden = !!v; } });
  for (const label of input.labels || []) if (!label.contains(view)) label.addEventListener('click', e => { if (e.target === label) { e.preventDefault(); view.focus(); } });
  proxies.set(input, view); sync();
  return view;
}

/** Bật cho toàn trang: ô tiền hiện có và ô tạo sau (bảng, hộp thoại). */
export function initMoneyInputs(root = document) {
  const SEL = 'input[type=number],input[data-money="1"]';
  const scan = node => { if (node.nodeType !== 1) return; if (node.matches?.(SEL)) enhanceMoneyInput(node); for (const i of node.querySelectorAll?.(SEL) || []) enhanceMoneyInput(i); };
  scan(root.body || root);
  let queued = new Set(), timer = 0;
  new MutationObserver(list => {
    for (const m of list) for (const n of m.addedNodes) queued.add(n);
    if (!timer) timer = requestAnimationFrame(() => { timer = 0; const batch = queued; queued = new Set(); for (const n of batch) if (n.isConnected) scan(n); });
  }).observe(root.body || root, { childList: true, subtree: true });
}
