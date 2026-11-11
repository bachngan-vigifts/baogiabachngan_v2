/** Edits the print snapshot only; does not write business data. */
const FIELDS = [
  ['orderNo', 'Số đơn đặt hàng'], ['quoteNo', 'Số chứng từ / báo giá'],
  ['customerName', 'Tên khách hàng'], ['customerCode', 'Mã khách hàng'], ['taxCode', 'Mã số thuế'], ['contact', 'Người liên hệ / điện thoại'],
  ['orderDate', 'Ngày đặt'], ['expectedDeliveryDate', 'Ngày hẹn giao'], ['address', 'Địa chỉ giao hàng', 'textarea'],
  ['note', 'Ghi chú đơn hàng', 'textarea'], ['signDate', 'Dòng ngày ký'], ['signers.0', 'Người đặt'], ['signers.1', 'Người phụ trách'], ['signers.2', 'Người phê duyệt'],
];
const valueAt = (data, path) => path.split('.').reduce((o, key) => o[key], data) ?? '';
const setAt = (data, path, value) => { const keys = path.split('.'); let o = data; for (const k of keys.slice(0, -1)) o = o[k]; o[keys.at(-1)] = value; };

export function initOrderPrintForm({ host, data, beforeUpdate, onUpdate }) {
  const make = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  host.append(make('h3', 'Thông tin điền mẫu'), make('p', 'Sửa thông tin riêng cho bản in/PDF/Excel. Nội dung đã lưu của đơn giữ nguyên. Có thể sửa trực tiếp trên bản xem trước.', 'muted small'));
  const fields = make('div', null, 'order-doc-fields'), controls = [];
  for (const [path, title, kind] of FIELDS) {
    const label = make('label', title), input = make(kind === 'textarea' ? 'textarea' : 'input');
    input.dataset.printField = path;
    if (kind === 'textarea') { input.rows = path === 'note' ? 6 : 3; input.maxLength = path === 'note' ? 20000 : 2000; }
    else { input.type = 'text'; input.maxLength = 500; }
    if (path === 'orderDate' || path === 'expectedDeliveryDate') input.placeholder = 'dd/mm/yyyy';
    label.append(input); fields.append(label); controls.push({ path, input, last: '' });
    input.addEventListener('input', apply);
  }
  host.append(fields);
  const update = make('button', 'Cập nhật bản xem', 'btn secondary small'); update.type = 'button'; update.addEventListener('click', apply); host.append(update);
  function sync() { for (const c of controls) { c.input.value = String(valueAt(data, c.path)); c.last = c.input.value; } }
  function apply() {
    beforeUpdate();
    // Preserve changes on the paper when an unchanged form control still has its old value.
    for (const c of controls) if (c.input.value !== c.last) setAt(data, c.path, c.input.value);
    onUpdate(); sync();
  }
  sync();
  return { apply, sync };
}
