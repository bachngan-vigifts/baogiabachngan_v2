const LABELS = { planned: 'Chưa giao', in_transit: 'Đang giao', delivered: 'Đã giao', failed: 'Giao lỗi', cancelled: 'Đã huỷ' };
export const deliveryToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
export function deliveryDay(date, delta) {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10);
}
export function deliveryCalendarDays(date, mode = 'month') {
  if (mode === 'day') return [date];
  const first = mode === 'month' ? date.slice(0, 7) + '-01' : date;
  const offset = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;
  return Array.from({ length: mode === 'month' ? 42 : 7 }, (_, i) => deliveryDay(first, i - offset));
}
export const deliveryIsOverdue = (trip, today = deliveryToday()) => trip.plannedDate < today && ['planned', 'in_transit', 'failed'].includes(trip.status);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
const button = (text, cls, act) => { const b = el('button', text, cls); b.type = 'button'; b.setAttribute('data-mobile-navigation', ''); b.addEventListener('click', act); return b; };
const dateLabel = d => d.slice(8) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);

export function renderDeliveryProducts(root, rows, onOpen) {
  const table = el('table', null, 'data-table dc-products'), head = el('thead'), tr = el('tr');
  const priced = rows.some(r => (r.products || []).some(p => p.unitPrice != null));
  const headers = ['Sản phẩm / SKU','Ngày hẹn giao','Số lượng','ĐVT','Khách hàng · Đơn / HĐKT','Nhân viên phụ trách','Trạng thái',...(priced ? ['Đơn giá sau CK','Tiền hàng chưa VAT','Tiền hàng có VAT'] : [])];
  for (const name of headers) tr.append(el('th', name));
  head.append(tr); table.append(head); const body = el('tbody');
  for (const row of rows) for (const p of row.products || []) {
    const tr = el('tr'), name = el('td'); name.append(button(p.name, 'btn ghost small', () => onOpen(row)), el('small', p.sku));
    tr.append(name, el('td', dateLabel(row.plannedDate)), el('td', p.qty.toLocaleString('vi-VN')), el('td', p.unit), el('td', `${row.customerName} · ${row.contractNo || row.orderNo} · ${row.deliveryNo}`), el('td', row.ownerName || '—'), el('td', LABELS[row.status]));
    if (priced) for (const amount of [p.unitPrice,p.amount,p.total]) tr.append(el('td', amount == null ? '—' : amount.toLocaleString('vi-VN')+' đ'));
    [...tr.children].forEach((cell, i) => { cell.dataset.label = headers[i]; });
    body.append(tr);
  }
  if (!body.children.length) { const tr = el('tr'), td = el('td', 'Không có sản phẩm trong các chuyến phù hợp.'); td.colSpan = priced ? 10 : 7; tr.append(td); body.append(tr); }
  table.append(body); root.replaceChildren(el('p', 'Mỗi dòng thuộc một chuyến giao; số lượng là số xếp trong chuyến, không phải tổng số đặt. Giá trị hàng không gồm phí vận chuyển.', 'muted small'), table);
}

/** Live calendar: consumes the same permission-scoped response as the delivery table. */
export function createDeliveryCalendar({ root, onRange, actions, orderLink }) {
  let anchor = deliveryToday(), selected = anchor, mode = 'month', rows = [], dialog = null, from = '', to = '';
  const range = () => { const days = deliveryCalendarDays(anchor, mode); return [days[0], days.at(-1)]; };
  const close = () => { if (dialog) { dialog.close(); dialog.remove(); dialog = null; } };
  const tone = trip => deliveryIsOverdue(trip) ? 'overdue' : trip.status;
  function details(trip) {
    close(); dialog = el('dialog', null, 'modal delivery-calendar-dialog');
    const head = el('div', null, 'modal-head'); head.append(el('h2', trip.deliveryNo), button('×', 'icon-btn', close));
    head.firstChild.id = 'delivery-calendar-title'; dialog.setAttribute('aria-labelledby', 'delivery-calendar-title');
    head.lastChild.setAttribute('aria-label', 'Đóng chi tiết chuyến giao');
    const body = el('div', null, 'modal-body');
    body.append(el('h3', trip.customerName), el('p', `${dateLabel(trip.plannedDate)} · ${trip.timeSlot || 'Chưa có giờ'} · ${LABELS[trip.status]}`));
    if (deliveryIsOverdue(trip)) body.append(el('p', 'Quá hạn giao hàng', 'danger-text'));
    const fields = [
      ['Chứng từ', trip.contractNo || trip.orderNo], ['Phụ trách', trip.ownerName],
      ['Người nhận', [trip.receiverName || trip.customerContact, trip.receiverPhone || trip.customerPhone].filter(Boolean).join(' · ')],
      ['Địa chỉ', trip.address || trip.customerAddress], ['Đơn vị giao', trip.carrier], ['Mã vận đơn', trip.trackingCode], ['Ghi chú', trip.note],
    ];
    const dl = el('dl', null, 'dc-detail-fields');
    for (const [label, value] of fields) dl.append(el('dt', label), el('dd', value || '—'));
    body.append(dl, el('h3', 'Sản phẩm trong chuyến'));
    const list = el('ul');
    for (const p of trip.products || []) list.append(el('li', `${p.name} · ${p.sku || 'Không có mã'} · ${p.qty.toLocaleString('vi-VN')} ${p.unit || ''}`));
    if (!list.children.length) list.append(el('li', 'Chưa có dòng sản phẩm.'));
    body.append(list);
    const link = orderLink?.(trip); if (link) { const a = el('a', 'Mở đơn / HĐKT', 'btn secondary'); a.href = link; a.addEventListener('click', close); body.append(a); }
    const foot = el('div', null, 'modal-foot');
    // Callback returns already escaped action markup from the existing delivery UI.
    if (actions) foot.innerHTML = actions(trip);
    foot.addEventListener('click', e => { if (e.target.closest('button')) close(); });
    dialog.append(head, body, foot); dialog.addEventListener('cancel', close); document.body.append(dialog); dialog.showModal();
  }
  function event(trip) {
    const names = (trip.products || []).map(p => p.name).join(', ');
    const b = button('', `dc-event dc-${tone(trip)}`, () => details(trip));
    b.append(el('strong', names || trip.deliveryNo), el('small', trip.customerName), el('small', `${trip.timeSlot || 'Chưa có giờ'} · ${trip.contractNo || trip.orderNo} · ${LABELS[trip.status]}`));
    b.title = `${names} · ${trip.customerName} · ${trip.deliveryNo}`;
    return b;
  }
  function changeRange() { selected = anchor; const [a, b] = range(); onRange(a, b); }
  function draw() {
    const tools = el('div', null, 'dc-tools'), modes = el('div', null, 'chips'); modes.setAttribute('aria-label', 'Chế độ lịch giao hàng');
    for (const [key, label] of [['month', 'Tháng'], ['week', 'Tuần'], ['day', 'Ngày']]) {
      const b = button(label, 'chip' + (mode === key ? ' active' : ''), () => { mode = key; changeRange(); });
      b.setAttribute('aria-pressed', String(mode === key)); modes.append(b);
    }
    const previous = button('‹', 'btn secondary', () => move(-1)), next = button('›', 'btn secondary', () => move(1));
    previous.setAttribute('aria-label', 'Kỳ trước'); next.setAttribute('aria-label', 'Kỳ sau');
    tools.append(modes, previous, el('h2', mode === 'month' ? `Tháng ${Number(anchor.slice(5, 7))}/${anchor.slice(0, 4)}` : dateLabel(anchor)), button('Hôm nay', 'btn secondary', () => { anchor = deliveryToday(); changeRange(); }), next);
    const days = deliveryCalendarDays(anchor, mode), grid = el('div', null, 'dc-grid dc-view-' + mode);
    grid.setAttribute('aria-label', 'Lịch chuyến giao');
    if (mode !== 'day') for (const name of ['T2','T3','T4','T5','T6','T7','CN']) grid.append(el('b', name, 'dc-weekday'));
    for (const day of days) {
      const trips = rows.filter(r => r.plannedDate === day), cell = el('div', null, 'dc-day' + (day === selected ? ' selected' : '') + (day.slice(0, 7) !== anchor.slice(0, 7) ? ' outside' : ''));
      const select = button(String(Number(day.slice(8))), 'dc-day-number' + (day === deliveryToday() ? ' today' : ''), () => { selected = day; draw(); });
      select.setAttribute('aria-label', `${dateLabel(day)}, ${trips.length} chuyến`); select.setAttribute('aria-pressed', String(day === selected)); cell.append(select);
      if (from && (day < from || day > to)) { cell.append(el('small', 'Ngoài khoảng lọc', 'muted')); }
      else {
        for (const trip of trips.slice(0, mode === 'day' ? trips.length : 3)) cell.append(event(trip));
        if (trips.length > 3 && mode !== 'day') cell.append(button(`+${trips.length - 3} chuyến`, 'dc-more', () => { selected = day; draw(); }));
      }
      grid.append(cell);
    }
    const agenda = el('section', null, 'card dc-agenda'); agenda.append(el('h3', `Chuyến ngày ${dateLabel(selected)}`));
    const selectedTrips = rows.filter(r => r.plannedDate === selected);
    for (const trip of selectedTrips) agenda.append(event(trip));
    if (!selectedTrips.length) agenda.append(el('p', 'Không có chuyến giao phù hợp bộ lọc trong ngày này.', 'muted'));
    const legend = el('p', 'Quá hạn · Chưa giao · Đang giao · Đã giao · Giao lỗi · Đã huỷ. Nhãn trạng thái luôn hiện trên từng chuyến.', 'muted small');
    root.replaceChildren(tools, legend, grid, agenda);
  }
  function move(delta) {
    if (mode === 'month') { const d = new Date(anchor.slice(0,7) + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + delta); anchor = d.toISOString().slice(0,10); }
    else anchor = deliveryDay(anchor, delta * (mode === 'week' ? 7 : 1));
    changeRange();
  }
  return { range, close, details, render(data, options = {}) {
    close(); rows = [...data].sort((a,b) => a.plannedDate.localeCompare(b.plannedDate) || a.timeSlot.localeCompare(b.timeSlot) || a.deliveryNo.localeCompare(b.deliveryNo));
    from = options.from || ''; to = options.to || '';
    if (from && to && (anchor < from || anchor > to)) { anchor = from; selected = from; }
    draw();
  } };
}
