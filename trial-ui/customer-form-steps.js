/** Form Thêm / Sửa khách hàng nhập theo 3 bước: Công ty → Người liên hệ → Kiểm tra và lưu.
 *  Chỉ ẩn / hiện các ô sẵn có theo bước (không di chuyển, không đổi tên ô) nên dữ liệu gửi máy chủ, kiểm trùng và tra MST giữ nguyên. */
const STEPS = [[1, 'Công ty'], [2, 'Người liên hệ'], [3, 'Kiểm tra và lưu']];
const COMPANY = ['customerCode', 'taxCode', 'name', 'address', 'phone', 'email'], COMPANY_EXTRA = ['establishedDate', 'customerType'];
const TERMS = ['depositRate', 'paymentTerm', 'paymentDays', 'creditLimit'];

export function initCustomerFormSteps({ dialog, form, fields, profileRoot, taxLookup, note, error, doc = document }) {
  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const root = fields.root, tagged = [], open = { 1: false, 3: false };
  let step = 1, editing = false;
  const tag = (el, s, { extra = false, order } = {}) => { if (!el) return; el.dataset.cstep = String(s); if (extra) el.dataset.cextra = '1'; if (order !== undefined) el.style.order = String(order); tagged.push(el); };
  const wrap = name => fields.controls[name]?.closest('label');

  // Bước 1 · Công ty
  const h1 = make('h3', 'span-2 customer-step-title', 'Bước 1 · Công ty / khách hàng');
  const more1 = make('button', 'span-2 customer-step-more'); more1.type = 'button';
  root.prepend(h1); root.append(more1);
  tag(h1, 1, { order: 0 }); tag(taxLookup, 1); tag(note, 1);
  COMPANY.forEach((name, i) => tag(wrap(name), 1, { order: i + 1 }));
  tag(more1, 1, { order: 10 });
  COMPANY_EXTRA.forEach((name, i) => tag(wrap(name), 1, { extra: true, order: 11 + i }));
  const [anniversary, termsHint] = [...root.querySelectorAll(':scope > p')];
  tag(anniversary, 1, { extra: true, order: 15 });
  // Bước 2 · Người liên hệ
  const h2 = make('h3', 'span-2 customer-step-title'), hint2 = make('p', 'span-2 muted small', 'Đây là người mình gọi điện và gửi báo giá, không phải số tổng đài của công ty.');
  root.append(h2, hint2);
  tag(h2, 2, { order: 0 }); tag(hint2, 2, { order: 1 }); tag(fields.contactSlot, 2, { order: 2 });
  // Bước 3 · Kiểm tra và lưu
  const h3 = make('h3', 'span-2 customer-step-title', 'Bước 3 · Kiểm tra lại rồi lưu'), summary = make('div', 'span-2 customer-step-summary');
  const more3 = make('button', 'span-2 customer-step-more'); more3.type = 'button';
  root.append(h3, summary, more3);
  tag(h3, 3, { order: 0 }); tag(summary, 3, { order: 1 }); tag(more3, 3, { order: 2 });
  TERMS.forEach((name, i) => tag(wrap(name), 3, { extra: true, order: 3 + i }));
  tag(termsHint, 3, { extra: true, order: 8 }); tag(profileRoot, 3, { extra: true });

  // Thanh bước + nút điều hướng
  const bar = make('div', 'customer-steps'); bar.setAttribute('aria-label', 'Các bước nhập khách hàng');
  const stepButtons = STEPS.map(([n, label], i) => {
    const b = make('button', 'customer-step'); b.type = 'button'; b.dataset.mobileInline = '';
    b.append(make('b', '', String(n)), make('span', '', label)); b.addEventListener('click', () => go(n));
    if (i) bar.append(make('i')); bar.append(b); return b;
  });
  dialog.querySelector('.modal-head').after(bar);
  const save = form.querySelector('#save-customer');
  const back = make('button', 'btn secondary', 'Quay lại'), next = make('button', 'btn primary', 'Tiếp tục');
  back.type = next.type = 'button'; back.dataset.mobileInline = next.dataset.mobileInline = '';
  save.before(back, next);
  dialog.classList.add('customer-stepped');

  const value = name => fields.controls[name].value.trim();
  const text = (cls, t) => make('span', cls, t);
  function paintSummary() {
    const line = (label, v, required) => { const row = make('span'); row.append(label ? label + ': ' : '', text(v ? '' : required ? 'customer-step-miss' : 'muted', v || (required ? 'chưa nhập' : '—'))); return row; };
    const card = (cls, title, name, rows) => { const c = make('div', 'customer-step-card ' + cls); c.append(make('small', '', title), make('b', name ? '' : 'customer-step-miss', name || 'chưa nhập'), ...rows); return c; };
    const entries = [...fields.contactSlot.querySelectorAll('.customer-contact-entry')];
    const main = entries.find(e => e.querySelector('.customer-primary-choice input')?.checked) ?? entries[0];
    const of = label => main?.querySelector(`[aria-label="${label}"]`)?.value.trim() ?? '';
    const company = card('is-company', 'Công ty', value('name'), [line('Mã KH', value('customerCode'), !editing), line('MST', value('taxCode'), !editing), line('Địa chỉ', value('address'), !editing), line('ĐT công ty', value('phone')), line('Email công ty', value('email'))]);
    const person = card('is-person', 'Người liên hệ chính', of('Tên người liên hệ'), [line('Chức vụ', of('Chức vụ')), line('ĐT', of('Điện thoại liên hệ')), line('Email', of('Email liên hệ')),
      ...(entries.length > 1 ? [text('muted', `và ${entries.length - 1} người liên hệ khác`)] : [])]);
    summary.replaceChildren(company, person);
  }
  function show(n) {
    step = n;
    for (const el of tagged) el.classList.toggle('cstep-off', Number(el.dataset.cstep) !== n || (el.dataset.cextra === '1' && !open[n]));
    stepButtons.forEach((b, i) => { b.classList.toggle('done', i + 1 < n); if (i + 1 === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    more1.textContent = (open[1] ? '－' : '＋') + ' Ngày thành lập, nhóm khách · không bắt buộc';
    more3.textContent = (open[3] ? '－' : '＋') + (editing ? ' Điều khoản bán hàng riêng · không bắt buộc' : ' Điều khoản bán hàng, phụ trách, ghi chú · không bắt buộc, để trống dùng mặc định');
    more1.setAttribute('aria-expanded', String(open[1])); more3.setAttribute('aria-expanded', String(open[3]));
    h2.textContent = 'Bước 2 · Người liên hệ' + (value('name') ? ' của ' + value('name') : '');
    back.hidden = n === 1; next.hidden = n === 3; save.hidden = n !== 3;
    if (n === 3) paintSummary();
    dialog.dataset.customerStep = String(n);
    dialog.querySelector('.modal-body')?.scrollTo?.(0, 0);
  }
  /** Ô bắt buộc còn trống ở một bước (chỉ tính ô đang áp dụng, bỏ qua phần bị ẩn riêng như hồ sơ khi sửa). */
  function missing(n) {
    for (const el of tagged) {
      if (Number(el.dataset.cstep) !== n || el.hidden) continue;
      const input = [...el.querySelectorAll('input,textarea,select')].find(i => i.required && i.type !== 'hidden' && !i.value.trim());
      if (input) return input;
    }
    return null;
  }
  function go(n) {
    error.textContent = '';
    for (let k = 1; k < n; k++) {
      const input = missing(k);
      const email = k === 1 && value('email') && !/^\S+@\S+\.\S+$/.test(value('email')) ? fields.controls.email : null;
      if (input || email) { show(k); error.textContent = input ? 'Nhập đủ các ô có dấu * ở bước này rồi tiếp tục.' : 'Email công ty chưa đúng định dạng.'; (input || email).focus(); return false; }
    }
    show(n); return true;
  }
  more1.addEventListener('click', () => { open[1] = !open[1]; show(step); });
  more3.addEventListener('click', () => { open[3] = !open[3]; show(step); });
  back.addEventListener('click', () => { error.textContent = ''; show(Math.max(1, step - 1)); });
  next.addEventListener('click', () => { if (go(step + 1)) (step === 3 ? save : dialog.querySelector('[data-cstep="2"]:not(.cstep-off) input:not([type=hidden])'))?.focus(); });
  // Enter trong ô nhập ở bước 1–2 = Tiếp tục (không lưu sớm khi chưa xem lại).
  form.addEventListener('keydown', e => { if (e.key !== 'Enter' || e.defaultPrevented || step === 3 || !e.target.matches('input') || e.target.closest('#customer-tax-lookup')) return; e.preventDefault(); next.click(); });
  return {
    /** Gọi mỗi lần mở form, sau khi đã nạp dữ liệu. */
    reset(isNew) {
      editing = !isNew; open[1] = COMPANY_EXTRA.some(value); open[3] = TERMS.some(value);
      show(1);
    },
    step: () => step,
    /** Vẽ lại tóm tắt bước 3 sau khi ô được điền lại từ bản mới (xung đột khi lưu hồ sơ). */
    repaint() { if (step === 3) paintSummary(); },
  };
}
