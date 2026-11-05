import { anniversarySuggestion, vietnamToday } from './customer-anniversary.js';
/** Shared customer fields for the directory and POS. Build server values as text only. */
export function customerFormFields({ requirePhone = false, requireProfile = false, requireName = true } = {}) {
  const root = document.createElement('div');
  root.className = 'form-grid cols-2 customer-form-fields';
  const controls = {};
  const titles = {};
  const fields = [
    ['name', 'Tên khách hàng / công ty', 'text', 500, true],
    ['contact', 'Người liên hệ', 'text', 500],
    ['phone', 'Điện thoại', 'tel', 40],
    ['email', 'Email', 'email', 500],
    ['taxCode', 'Mã số thuế', 'text', 500],
    ['establishedDate', 'Ngày thành lập', 'date', 10],
    ['customerCode', 'Mã khách hàng', 'text', 500],
    ['customerType', 'Nhóm / loại khách hàng', 'text', 500],
    ['address', 'Địa chỉ', 'textarea', 2000, true],
    ['depositRate', 'Tỷ lệ đặt cọc (%)', 'text', 500, false, 'Để trống = 30'],
    ['paymentTerm', 'Hạn thanh toán', 'text', 500, false, 'Số ngày, để trống = 5'],
    ['paymentDays', 'Số ngày công nợ', 'text', 4, false, 'Số nguyên 0–3650, để trống = chưa đặt'],
    ['creditLimit', 'Giới hạn công nợ (đ)', 'text', 500, true, 'Để trống = không giới hạn'],
  ];
  for (const [name, label, type, max, wide, placeholder] of fields) {
    const box = document.createElement('label');
    if (wide) box.className = 'span-2';
    const required = name === 'name' && requireName || name === 'phone' && requirePhone || requireProfile && ['name','contact','phone','taxCode','address'].includes(name);
    const title = document.createElement('span'); title.textContent = label + (required ? ' *' : '');
    const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    input.name = name; input.maxLength = max;
    if (type === 'textarea') input.rows = 2; else input.type = type;
    if (placeholder) input.placeholder = placeholder;
    input.required = required;
    input.setAttribute('aria-required', String(required));
    if (name === 'establishedDate') input.max = vietnamToday();
    if (name === 'depositRate') input.inputMode = 'decimal';
    if (name === 'creditLimit' || name === 'paymentDays') input.inputMode = 'numeric';
    if (name === 'paymentTerm') input.setAttribute('list', 'nq-payment-options');
    box.append(title, input); root.append(box); controls[name] = input; titles[name] = {title,label};
  }
  const anniversary = document.createElement('p'); anniversary.className = 'muted small span-2'; anniversary.setAttribute('aria-live','polite');
  const refreshAnniversary = () => {
    const date = controls.establishedDate.value, next = anniversarySuggestion(date);
    anniversary.textContent = !date ? 'Nhập ngày thành lập để gợi ý mốc 5, 10, 15… năm; chuẩn bị trước 60 ngày.' : next ? `Kỷ niệm ${next.years} năm vào ${next.date.split('-').reverse().join('/')} (${next.daysUntil === 0 ? 'hôm nay' : 'còn ' + next.daysUntil + ' ngày'}). ${next.upcoming ? next.suggestion : 'Sẽ gợi ý chăm sóc khi còn tối đa 60 ngày.'}` : 'Ngày thành lập không hợp lệ hoặc ở tương lai.';
  };
  controls.establishedDate.addEventListener('input',refreshAnniversary); refreshAnniversary(); root.append(anniversary);
  const hint = document.createElement('p'); hint.className = 'muted small span-2';
  hint.textContent = 'Điều khoản riêng của khách: tự điền khi tạo báo giá cho khách này (vẫn sửa được trên từng báo giá).';
  root.append(hint);
  const setRequiredProfile = value => {
    requireProfile=value;
    for(const [name,input] of Object.entries(controls)){
      const required=name==='name'&&requireName||name==='phone'&&requirePhone||value&&['name','contact','phone','taxCode','address'].includes(name);
      input.required=required;input.setAttribute('aria-required',String(required));titles[name].title.textContent=titles[name].label+(required?' *':'');
    }
  };
  return { root, controls, refreshAnniversary, setRequiredProfile, read: () => Object.fromEntries(Object.entries(controls).map(([name, input]) => [name, input.value.trim()])) };
}
