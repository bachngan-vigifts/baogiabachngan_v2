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
const NUMBER = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'valueAsNumber');
// Native number values with decimal/exponent notation must never pass through the integer digit stripper.
const needsNative = input => {
  const raw = PROTO.get.call(input);
  if (raw === '') return input.type === 'number' && input.validity.badInput;
  // Existing text controls may contain grouped integers (450.000.000). A single dot stays ambiguous: preserve it.
  if (input.type === 'text' && /^-?\d{1,3}(?:\.\d{3}){2,}$/.test(raw)) return false;
  return !/^-?\d+$/.test(raw);
};
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
function moneyCandidate(input) {
  if (!(input instanceof HTMLInputElement) || input.dataset.moneyProxy) return false;
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

export function isMoneyInput(input) { return moneyCandidate(input) && !needsNative(input); }

const proxies = new WeakMap();
const resetForms = new WeakSet();
function watchReset(form) {
  if (!form || resetForms.has(form)) return;
  resetForms.add(form);
  // One listener per form; do not retain detached line inputs in a long-lived quote form.
  form.addEventListener('reset', () => queueMicrotask(() => {
    for (const input of form.querySelectorAll('input')) proxies.get(input)?.sync();
  }));
}
export function enhanceMoneyInput(input) {
  watchReset(input?.form);
  const known = proxies.get(input);
  if (known) { known.sync(); return known.view.isConnected ? known.view : null; }
  // Track initially fractional controls too, so a later integer can regain formatting.
  if (!moneyCandidate(input)) return null;
  const attributes = Object.fromEntries(['tabindex', 'aria-hidden'].map(k => [k, input.getAttribute(k)]));
  const nativeFocus = input.focus, nativeSelect = input.select;
  const nativeStepUp = input.stepUp, nativeStepDown = input.stepDown;
  let hidden = HID.get.call(input), enhanced = false, switching = false, managedStep = false;
  const view = document.createElement('input');
  view.type = 'text'; view.inputMode = 'numeric'; view.autocomplete = 'off'; view.dataset.moneyProxy = '1';
  view.className = input.className + ' money-input'; view.style.cssText = input.style.cssText;
  for (const a of ['placeholder', 'aria-label', 'title']) if (input.hasAttribute(a)) view.setAttribute(a, input.getAttribute(a));
  const restoreAttributes = () => {
    for (const [key, value] of Object.entries(attributes)) {
      if (value === null) input.removeAttribute(key); else input.setAttribute(key, value);
    }
  };
  function sync(promote = true) {
    const native = needsNative(input) || (promote === false && !enhanced), focused = document.activeElement === (enhanced ? view : input);
    switching = true;
    try {
      if (native) {
        // Disable forwarding BEFORE removing a focused proxy: some browsers emit blur synchronously here.
        if (enhanced) { enhanced = false; view.remove(); restoreAttributes(); }
        HID.set.call(input, hidden);
        if (input.type === 'number' && !input.hasAttribute('step')) { managedStep = true; input.setAttribute('step', 'any'); }
        if (focused && !hidden) nativeFocus.call(input);
        return;
      }
      if (managedStep) { if (input.getAttribute('step') === 'any') input.removeAttribute('step'); managedStep = false; }
      const attaching = !enhanced;
      if (view.parentNode !== input.parentNode || view.nextSibling !== input) input.before(view);
      enhanced = true;
      HID.set.call(input, true); input.tabIndex = -1; input.setAttribute('aria-hidden', 'true'); view.hidden = hidden;
      const raw = PROTO.get.call(input);
      if (document.activeElement !== view || clean(view.value) !== raw) view.value = fmt(raw);
      view.disabled = input.disabled; view.readOnly = input.readOnly; view.required = input.required;
      if (attaching && focused && !hidden) view.focus();
    } finally { switching = false; }
  }
  // Keep these wrappers in native mode; setters and browser mutation methods must never leave a stale display.
  Object.defineProperty(input, 'value', { configurable: true, get() { return PROTO.get.call(this); }, set(v) { PROTO.set.call(this, v == null ? '' : String(v)); sync(); } });
  Object.defineProperty(input, 'valueAsNumber', { configurable: true, get() { return NUMBER.get.call(this); }, set(v) { NUMBER.set.call(this, v); sync(); } });
  input.stepUp = function (...args) { const result = nativeStepUp.apply(this, args); sync(); return result; };
  input.stepDown = function (...args) { const result = nativeStepDown.apply(this, args); sync(); return result; };
  input.focus = opts => enhanced ? view.focus(opts) : nativeFocus.call(input, opts);
  input.select = () => enhanced ? view.select() : nativeSelect.call(input);
  Object.defineProperty(input, 'hidden', { configurable: true, get() { return hidden; }, set(v) { hidden = !!v; if (enhanced) view.hidden = hidden; else HID.set.call(input, hidden); } });
  // A trailing decimal separator can temporarily read as an integer; keep native editing until blur.
  input.addEventListener('input', () => { if (!switching) sync(enhanced || document.activeElement !== input); });
  input.addEventListener('blur', () => { if (!switching) sync(); });
  view.addEventListener('input', () => {
    if (switching || !enhanced) return;
    const before = view.value, caret = view.selectionStart ?? before.length, digitsLeft = before.slice(0, caret).replace(/\D/g, '').length;
    const raw = clean(before), shown = fmt(raw); view.value = shown;
    let pos = 0, seen = 0; while (pos < shown.length && seen < digitsLeft) { if (/\d/.test(shown[pos])) seen++; pos++; }
    try { view.setSelectionRange(pos, pos); } catch { /* keyboard may not support selection */ }
    PROTO.set.call(input, raw === '-' ? '' : raw);
    const max = input.max === '' ? NaN : Number(input.max), min = input.min === '' ? NaN : Number(input.min), n = Number(raw);
    view.setCustomValidity(raw && raw !== '-' && (n > max || n < min) ? `Số tiền phải trong khoảng ${fmt(String(min || 0))} – ${fmt(String(max))}` : '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  view.addEventListener('change', () => { if (!switching && enhanced) input.dispatchEvent(new Event('change', { bubbles: true })); });
  for (const t of ['blur', 'keydown']) view.addEventListener(t, e => {
    if (switching || !enhanced) return;
    if (t === 'keydown' && e.key === 'Enter') input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    if (t === 'blur') input.dispatchEvent(new FocusEvent('blur'));
  });
  new MutationObserver(() => sync(enhanced || document.activeElement !== input)).observe(input, { attributes: true, attributeFilter: ['disabled', 'readonly', 'required', 'value'] });
  // External labels target whichever control is visible, never a detached proxy.
  for (const label of input.labels || []) if (!label.contains(view)) label.addEventListener('click', e => { if (e.target === label) { e.preventDefault(); input.focus(); } });
  proxies.set(input, {view, sync}); sync();
  return enhanced ? view : null;
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
