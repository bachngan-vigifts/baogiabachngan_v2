import { initEarlyRequests } from './purchase-early-requests.js';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const button = (text, cls, action) => { const n = el('button', cls, text); n.type = 'button'; n.addEventListener('click', action); return n; };
const number = n => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const date = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : 'Chưa hẹn';
const labelled = (text, node) => { const label = el('label', 'incoming-field'); label.append(el('span', 'muted small', text), node); return label; };

/** Incoming quantities and persisted draft → explicit supplier submission. */
export function initPurchaseIncoming({ api, host, go }) {
  let data = null, offset = 0, pending = 0, mode = 'all', visible = false, timer, canRequest = false;
  const selected = new Map(), expanded = new Set();
  const kpis = el('div', 'incoming-kpis'), filters = el('div', 'incoming-filters');
  const search = el('input'); search.type = 'search'; search.placeholder = 'Tìm mã hàng hoặc tên sản phẩm'; search.setAttribute('aria-label', 'Tìm hàng đang về');
  const supplier = el('select'); supplier.setAttribute('aria-label', 'Nhà cung cấp');
  const from = el('input'), to = el('input'); from.type = to.type = 'date';
  const chips = el('div', 'chips incoming-chips');
  for (const [key, title] of [['all', 'Tất cả'], ['late', 'Quá hẹn'], ['week', 'Hẹn trong 7 ngày'], ['selected', 'Đã chọn']]) {
    const b = button(title, 'chip', () => { mode = key; offset = 0; load(); }); b.dataset.mode = key; chips.append(b);
  }
  filters.append(labelled('Sản phẩm', search), labelled('NCC', supplier), labelled('Hẹn từ', from), labelled('Đến', to), chips);
  const error = el('p', 'error incoming-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table incoming-table'), thead = el('thead'), tbody = el('tbody'), hr = el('tr');
  for (const title of ['', 'Mã hàng', 'Tên sản phẩm', 'Đang về', 'Đơn NCC', 'Hẹn sớm nhất', 'Trạng thái', 'SL cần lấy trước']) hr.append(el('th', '', title));
  thead.append(hr); table.append(thead, tbody); wrap.append(table);
  const pagination = el('div', 'incoming-pagination'), pageLabel = el('span', 'muted small');
  const prev = button('← Trước', 'btn secondary small', () => { offset = Math.max(0, offset - 50); load(); });
  const next = button('Sau →', 'btn secondary small', () => { offset += 50; load(); }); pagination.append(pageLabel, prev, next);
  const footer = el('div', 'incoming-selection'), summary = el('div'), clear = button('Bỏ chọn', 'btn secondary', () => { selected.clear(); render(); if (mode === 'selected') load(); });
  const save = button('Lưu và gửi NCC', 'btn primary', () => {
    if(!selectionSummary())return;
    history.newDraft({lines:[...selected].map(([sku,r])=>({sku,quantity:r.quantity,name:r.name,unit:r.unit})),scope:{supplierId:supplier.value,from:from.value,to:to.value,status:mode==='selected'?'all':mode}});
  }); save.disabled = true;
  const note = el('p', 'muted small', 'Các lựa chọn chưa được lưu hoặc gửi NCC.');
  note.setAttribute('role', 'alert');
  footer.append(summary, clear, save); host.append(kpis, filters, error, wrap, pagination, footer, note);
  const historyHost=el('section','early-request-history');host.append(historyHost);
  const history=initEarlyRequests({api,host:historyHost,canWrite:()=>canRequest,onSaved:()=>{selected.clear();render();}});
  for (const node of [supplier, from, to]) node.addEventListener('change', () => { offset = 0; load(); });
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { offset = 0; load(); }, 200); });
  function fail(message) { error.textContent = message; error.hidden = !message; }
  function selectionSummary() {
    const values = [...selected.values()], invalid = values.some(r => !Number.isSafeInteger(r.quantity) || r.quantity <= 0 || r.quantity > r.max);
    summary.textContent = `Đã chọn ${number(values.length)} mã · Tổng SL cần lấy trước ${number(values.reduce((sum,r) => sum + (Number(r.quantity) || 0), 0))}`;
    const problems = [...selected].filter(([,r]) => !Number.isSafeInteger(r.quantity) || r.quantity <= 0 || r.quantity > r.max);
    note.classList.toggle('incoming-validation', problems.length > 0);
    note.textContent = problems.length ? 'Chưa thể lưu: ' + problems.slice(0,3).map(([sku,r]) => `${sku}: ${r.quantity > r.max ? 'SL vượt số còn về '+number(r.max) : 'SL phải là số nguyên dương'}`).join('; ') : 'Các lựa chọn chưa được lưu hoặc gửi NCC.';
    clear.disabled = !values.length; save.disabled = !canRequest || !data?.canSend || invalid || !values.length;
    return !invalid && values.length > 0;
  }
  function render() {
    if (!data) return;
    kpis.replaceChildren();
    for (const [title, value] of [['Mã đang về', data.kpis.skus], ['Tổng SL đang về', data.kpis.quantity], ['Số NCC', data.kpis.suppliers], ['Số đơn quá hẹn', data.kpis.overdueOrders]]) {
      const card = el('div', 'card incoming-kpi'); card.append(el('span', 'muted small', title), el('strong', '', number(value))); kpis.append(card);
    }
    chips.querySelectorAll('button').forEach(b => { b.classList.toggle('active', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
    tbody.replaceChildren();
    if (!data.rows.length) { const tr = el('tr'), td = el('td', 'muted', 'Không có hàng đang về phù hợp bộ lọc.'); td.colSpan = 8; tr.append(td); tbody.append(tr); }
    for (const row of data.rows) {
      const tr = el('tr'), chosen = selected.get(row.sku); if (chosen) chosen.max = row.quantity;
      tr.classList.toggle('incoming-selected', !!chosen);
      const check = el('input'); check.type = 'checkbox'; check.checked = !!chosen; check.disabled = !canRequest || row.unitConflict || selected.size >= 300 && !chosen;
      check.setAttribute('aria-label', 'Chọn mã ' + row.sku);
      const checkCell = el('td'); checkCell.append(check);
      const code = el('td'), toggle = button(row.sku, 'incoming-code', () => { expanded.has(row.sku) ? expanded.delete(row.sku) : expanded.add(row.sku); render(); });
      toggle.setAttribute('aria-expanded', String(expanded.has(row.sku))); code.append(toggle);
      if(data.canViewStock){const lookup=el('a','small sup-sub','Tra tồn');lookup.href='#/stock-lookup?q='+encodeURIComponent(row.sku);code.append(lookup);}
      const name = el('td'); name.append(el('span', '', row.name || 'Chưa có tên'), el('small', 'muted sup-sub', 'ĐVT: ' + (row.unit || 'Chưa có dữ liệu')));
      if (row.importedMissingSource) name.append(el('small', 'sup-pill warn', 'Nhập Excel, thiếu chứng từ'));
      if (row.unitConflict) name.append(el('small', 'sup-pill warn', 'ĐVT không thống nhất; chưa thể xin lấy trước'));
      const orders = el('td'); orders.append(el('span', '', `${number(row.orderCount)} đơn · ${row.supplierNames.join(', ')}`), el('small', 'muted sup-sub', row.orders.map(o => `${o.ticketNumber} · ${number(o.quantity)}`).join(' · ')));
      const due = el('td', row.late ? 'pur-late' : '', date(row.earliestDue) + (row.late ? ' · quá hẹn' : ''));
      const status = el('td'); status.append(el('span', 'sup-pill ' + (row.late ? 'warn' : ''), row.late ? 'Quá hẹn' : row.confirmed ? 'Đã xác nhận' : 'Chờ NCC xác nhận'));
      const qtyCell = el('td'), qty = el('input'); qty.type = 'number'; qty.min = '1'; qty.max = String(Math.floor(row.quantity)); qty.step = '1'; qty.placeholder = 'Nhập SL'; qty.value = chosen?.quantity ?? ''; qty.disabled = !canRequest || row.unitConflict;
      qty.setAttribute('aria-label', 'SL cần lấy trước mã ' + row.sku);
      const quantityError = el('small', 'error sup-sub'); quantityError.hidden = true; quantityError.id = 'incoming-error-' + encodeURIComponent(row.sku);
      quantityError.setAttribute('role', 'alert'); qty.setAttribute('aria-describedby',quantityError.id); qtyCell.append(qty, quantityError);
      const validateQuantity = amount => {
        const valid = Number.isSafeInteger(amount) && amount > 0 && amount <= row.quantity;
        quantityError.textContent = valid || amount === null ? '' : amount > row.quantity ? `SL ${number(amount)} vượt số còn về ${number(row.quantity)}.` : `Nhập số nguyên từ 1 đến ${number(Math.floor(row.quantity))}.`;
        quantityError.hidden = !quantityError.textContent; qty.setCustomValidity(quantityError.textContent); qty.setAttribute('aria-invalid',String(!!quantityError.textContent));
      };
      const update = () => {
        const amount = qty.value === '' ? null : Number(qty.value);
        if (!selected.has(row.sku) && selected.size >= 300 && amount !== null) { fail('Mỗi phiếu chọn tối đa 300 mã hàng.'); qty.value = ''; return; }
        if (amount === null) selected.delete(row.sku);
        else selected.set(row.sku, { quantity: amount, max: row.quantity, name:row.name,unit:row.unit });
        check.checked = amount !== null; tr.classList.toggle('incoming-selected', amount !== null);
        validateQuantity(amount); selectionSummary();
      };
      qty.addEventListener('input', update);
      validateQuantity(chosen?.quantity ?? null);
      check.addEventListener('change', () => { qty.value = check.checked ? (chosen?.quantity || 1) : ''; update(); });
      tr.append(checkCell, code, name, el('td', 'num', number(row.quantity)), orders, due, status, qtyCell); tbody.append(tr);
      if (expanded.has(row.sku)) {
        const detail = el('tr', 'incoming-details'), td = el('td'); td.colSpan = 8;
        const list = el('div', 'incoming-orders');
        for (const order of row.orders) {
          const line = el('div', 'incoming-order'), link = el('a', '', order.ticketNumber); link.href = '#/purchases/' + encodeURIComponent(order.id) + '?mode=incoming';
          link.addEventListener('click', e => { if (!e.ctrlKey && !e.metaKey && e.button === 0) { e.preventDefault(); go(link.getAttribute('href')); } });
          const supplierNode=el(data.canViewSuppliers&&order.supplierId?'a':'span','',order.supplierName);
          if(supplierNode.tagName==='A')supplierNode.href='#/suppliers/'+encodeURIComponent(order.supplierId);
          line.append(link, supplierNode, el('span', '', number(order.quantity) + ' ' + (order.unit || '')), el('span', '', date(order.due)));
          if (order.importedMissingSource) line.append(el('small', 'sup-pill warn', 'Nhập Excel, thiếu chứng từ'));
          list.append(line);
        }
        td.append(list); detail.append(td); tbody.append(detail);
      }
    }
    footer.hidden = note.hidden = !canRequest;
    pageLabel.textContent = data.total ? `${number(data.offset + 1)}–${number(data.offset + data.rows.length)} / ${number(data.total)} mã` : '0 mã';
    prev.disabled = offset === 0; next.disabled = offset + 50 >= data.total; selectionSummary();
  }
  async function load() {
    if (!visible) return;
    const request = ++pending; fail(''); host.setAttribute('aria-busy', 'true');
    const params = new URLSearchParams({ q: search.value.trim(), supplierId: supplier.value, from: from.value, to: to.value, status: mode === 'selected' ? 'all' : mode, limit: '50', offset: String(offset) });
    if (mode === 'selected') { params.set('selected', '1'); for (const sku of selected.keys()) params.append('sku', sku); }
    try {
      const result = await api('/purchase-incoming?' + params);
      if (request !== pending || !visible) return;
      data = result; canRequest = !!result.canRequest;
      const id = supplier.value; supplier.replaceChildren(); const all = el('option', '', 'Tất cả NCC'); all.value = ''; supplier.append(all);
      for (const s of result.suppliers) { const option = el('option', '', s.name); option.value = s.id; supplier.append(option); } supplier.value = id;
      render();
    } catch (e) { if (request === pending && visible) fail(e.message || 'Không tải được hàng đang về.'); }
    finally { if (request === pending) host.setAttribute('aria-busy', 'false'); }
  }
  return { async show(id='') { visible = true; host.hidden = false; await load();if(id)await history.open(id);else await history.load(); }, hide() { visible = false; ++pending; clearTimeout(timer); host.hidden = true; } };
}
