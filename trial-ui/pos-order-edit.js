/** Edit persisted POS orders; receipt corrections keep the existing void/re-receive workflow. */
export function posOrderEditor({ api, detail, onSaved }) {
  const { order: o, lines, deliveries, schedules, payments } = detail;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = el('button', 'Sửa đơn POS', 'btn primary'); button.type = 'button';
  button.addEventListener('click', () => {
    const dialog = el('dialog', '', 'modal'), form = el('form');
    dialog.style.width = 'min(960px, 96vw)'; dialog.style.maxHeight = '92vh'; dialog.style.overflow = 'auto';
    const head = el('div', '', 'modal-head'); head.append(el('h2', 'Sửa đơn POS · ' + o.orderNo));
    const body = el('div', '', 'modal-body'), error = el('p', '', 'danger-text'); error.setAttribute('role', 'alert');
    const controls = {};
    const field = (parent, key, label, value, type = 'text') => {
      const wrap = el('label', label), input = el('input'); input.type = type; input.value = value ?? ''; input.className = 'input';
      input.style.width = '100%'; wrap.style.display = 'grid'; wrap.style.gap = '5px'; wrap.append(input); parent.append(wrap); controls[key] = input; return input;
    };
    const grid = el('div', '', 'form-grid'); grid.style.display = 'grid'; grid.style.gridTemplateColumns = 'repeat(auto-fit,minmax(220px,1fr))'; grid.style.gap = '12px';
    body.append(el('h3', 'Khách hàng'), grid);
    let customerId = o.customerId || '';
    const search = field(grid, 'customerSearch', 'Tìm khách có sẵn (tên / điện thoại)', '');
    const choices = el('div'); grid.append(choices);
    let searchSeq = 0;
    search.addEventListener('input', async () => {
      const seq = ++searchSeq; choices.replaceChildren(); if (search.value.trim().length < 2) return;
      try {
        const result = await api('/pos/customers?q=' + encodeURIComponent(search.value.trim()));
        if (seq !== searchSeq || !dialog.open) return;
        for (const c of result.customers) {
          const pick = el('button', c.name + ' · ' + (c.phone || ''), 'btn ghost small'); pick.type = 'button';
          pick.addEventListener('click', () => { customerId = c.id; controls.customerName.value = c.name; controls.phone.value = c.phone || ''; controls.address.value = c.address || ''; choices.replaceChildren(); search.value = ''; }); choices.append(pick);
        }
      } catch (e) { if (seq === searchSeq) error.textContent = e.message; }
    });
    field(grid, 'customerName', 'Tên khách trên đơn', o.customerName).required = true;
    field(grid, 'contact', 'Người liên hệ', o.contact);
    field(grid, 'phone', 'Điện thoại', o.phone);
    field(grid, 'email', 'Email', o.email);
    field(grid, 'taxCode', 'Mã số thuế', o.taxCode);
    field(grid, 'address', 'Địa chỉ khách hàng', o.address);
    const editableShips = deliveries.filter(d => ['planned', 'in_transit'].includes(d.status));
    const ship = editableShips[0];
    if (ship) {
      body.append(el('h3', 'Giao hàng'));
      const shipping = grid.cloneNode(false); body.append(shipping);
      field(shipping, 'shipAddress', 'Địa chỉ giao hàng', ship.address).required = o.fulfillmentMode === 'cod';
      field(shipping, 'receiverName', 'Người nhận', ship.receiverName);
      field(shipping, 'receiverPhone', 'Điện thoại người nhận', ship.receiverPhone);
    }
    body.append(el('h3', 'Hàng trong đơn'));
    const financial = o.fulfillmentMode === 'cod' && !payments.some(p => !p.voidedAt) && !lines.some(l => l.deliveredQty > 0) && editableShips.every(d => d.status === 'planned') && editableShips.length <= 1;
    body.append(el('p', financial ? 'Giá niêm yết theo chính sách của bill gốc; giữ thuế suất và chiết khấu từng dòng. Server tính lại tổng tiền.' : 'Đơn đã thu/xuất hàng: sửa thông tin khách và ghi chú tại đây. Phiếu thu ghi nhầm dùng “Huỷ phiếu” rồi ghi thu lại.', 'muted small'));
    const table = el('table'), thead = el('thead'), header = el('tr');
    for (const title of ['Sản phẩm', 'SL', 'Giá niêm yết', 'CK', 'Loại CK']) header.append(el('th', title));
    thead.append(header); table.append(thead); const tbody = el('tbody'); table.append(tbody);
    const rows = lines.map(l => {
      const tr = el('tr'); tr.append(el('td', l.name + (l.taxRate > 0 ? ' (giá gồm VAT)' : ' (không VAT)')));
      const number = (value, step) => { const td = el('td'), input = el('input'); input.type = 'number'; input.min = '0'; input.step = step; input.value = value; input.disabled = !financial; input.style.width = '100%'; input.style.minWidth = '80px'; input.required = true; td.append(input); tr.append(td); return input; };
      const qty = number(l.qty, '0.001'), price = number(l.listUnitPrice ?? l.unitPrice, '1'), discount = number(l.discountValue, '0.01'); qty.min = '0.001';
      const td = el('td'), mode = el('select'); mode.disabled = !financial;
      for (const [v, text] of [['percent', '%'], ['amount', 'VNĐ / dòng']]) { const opt = el('option', text); opt.value = v; mode.append(opt); }
      mode.value = l.discountType; td.append(mode); tr.append(td); tbody.append(tr);
      return { id: l.id, qty, price, discount, mode };
    });
    const scroll = el('div'); scroll.style.overflowX = 'auto'; scroll.append(table); body.append(scroll);
    field(body, 'paymentNote', 'Điều kiện / ghi chú thanh toán (không ghi nhận đã thu)', schedules[0]?.note || '');
    field(body, 'reason', 'Lý do sửa đơn *', '').required = true;
    body.append(error);
    const foot = el('div', '', 'modal-foot'), cancel = el('button', 'Huỷ', 'btn secondary'), save = el('button', 'Lưu thay đổi', 'btn primary');
    cancel.type = 'button'; save.type = 'submit'; cancel.addEventListener('click', () => dialog.close()); foot.append(cancel, save);
    form.append(head, body, foot); dialog.append(form); document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
    let busy = false;
    form.addEventListener('submit', async e => {
      e.preventDefault(); if (busy || !form.reportValidity()) return;
      busy = true; save.disabled = true; error.textContent = '';
      try {
        const data = Object.fromEntries(['customerName', 'contact', 'phone', 'email', 'taxCode', 'address', 'paymentNote', 'reason'].map(k => [k, controls[k].value]));
        await api('/orders/' + encodeURIComponent(o.id) + '/pos', 'PUT', {
          ...data, customerId, revision: o.revision,
          ...(financial ? { lines: rows.map(r => ({ id: r.id, qty: r.qty.value, price: r.price.value, discountValue: Number(r.discount.value), discountType: r.mode.value })) } : {}),
          ...(ship ? { delivery: { address: controls.shipAddress.value, receiverName: controls.receiverName.value, receiverPhone: controls.receiverPhone.value } } : {}),
        });
        dialog.close(); await onSaved();
      } catch (e) { error.textContent = e.message; }
      finally { busy = false; save.disabled = false; }
    });
  });
  return button;
}

export function posCodReceipt({ api, delivery, onSaved }) {
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = el('button', 'Thu COD · ' + delivery.deliveryNo, 'btn primary small'); button.type = 'button';
  button.addEventListener('click', () => {
    const dialog = el('dialog', '', 'modal narrow'), form = el('form'), body = el('div', '', 'modal-body'), foot = el('div', '', 'modal-foot');
    body.append(el('h2', 'Xác nhận thực nhận COD'), el('p', 'Chỉ xác nhận khi cửa hàng đã nhận tiền. Khoản thu ghi vào ca đang mở tại đúng két của đơn.'));
    const method = el('select');
    for (const [v, label] of [['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản']]) { const opt = el('option', label); opt.value = v; method.append(opt); }
    method.value = 'cash';
    const label = el('label', 'Cửa hàng đã thực nhận tiền '), confirmed = el('input'); confirmed.type = 'checkbox'; confirmed.required = true; label.append(confirmed);
    const error = el('p', '', 'danger-text'); error.setAttribute('role', 'alert');
    body.append(method, label, error);
    const cancel = el('button', 'Huỷ', 'btn secondary'), save = el('button', 'Xác nhận đã thu', 'btn primary'); cancel.type = 'button'; save.type = 'submit'; cancel.addEventListener('click', () => dialog.close()); foot.append(cancel, save);
    form.append(body, foot); dialog.append(form); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
    const key = crypto.randomUUID(); let busy = false;
    form.addEventListener('submit', async e => {
      e.preventDefault(); if (busy || !form.reportValidity()) return; busy = true; save.disabled = true; error.textContent = '';
      try {
        const options = await api('/pos/options');
        if (!options.current) throw new Error('Cần mở ca tại đúng quầy trong Bán hàng nhanh trước khi thu COD.');
        await api('/pos/cod/' + encodeURIComponent(delivery.id) + '/collect', 'POST', { key, shiftId: options.current.id, method: method.value, confirmed: confirmed.checked });
        dialog.close(); await onSaved();
      } catch (e) { error.textContent = e.message; }
      finally { busy = false; save.disabled = false; }
    });
  });
  return button;
}

export function posPaymentText(detail) {
  const terms = detail.schedules.map(s => s.note).filter(n => n && !['POS', 'Ship COD'].includes(n)).join(' · ') || (detail.order.fulfillmentMode === 'cod' ? 'Thu COD sau khi giao hàng' : 'Thanh toán tại quầy');
  const methods = [...new Set(detail.payments.filter(p => !p.voidedAt).map(p => p.method === 'cash' ? 'tiền mặt' : p.method === 'transfer' ? 'chuyển khoản' : 'khác'))];
  return terms + ' · ' + (methods.length ? 'Đã thu bằng ' + methods.join(', ') : 'Chưa thu');
}
