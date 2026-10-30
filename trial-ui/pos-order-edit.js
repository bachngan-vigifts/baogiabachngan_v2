/** Edit persisted POS orders; receipt corrections keep the existing void/re-receive workflow. */
export function posOrderEditor({ api, detail, onSaved }) {
  const { order: o, lines, deliveries, schedules, payments } = detail;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = el('button', 'Sửa đơn POS', 'btn primary'); button.type = 'button';
  button.addEventListener('click', () => {
    const dialog = el('dialog', '', 'modal pos-order-edit-modal'), form = el('form');
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
    let snapshot = {}; try { snapshot = typeof o.posSnapshot === 'string' ? JSON.parse(o.posSnapshot) : o.posSnapshot || {}; } catch { /* API will reject incomplete historical configuration. */ }
    const activeShips = deliveries.filter(d => d.status !== 'cancelled');
    const tracked = activeShips.some(d => d.trackingCode && String(d.carrier).trim().toLowerCase() === 'ghn');
    let retryKey = snapshot.ghnAmendment?.version === 1 ? snapshot.ghnAmendment.key : null;
    const requestKey = retryKey || crypto.randomUUID();
    let canAbandon = !snapshot.ghnAmendment?.carrierWriteStarted;
    const financial = !retryKey && o.fulfillmentMode === 'cod' && !['deposit', 'prepaid'].includes(snapshot.saleFlow) && !payments.some(p => !p.voidedAt) && !lines.some(l => l.deliveredQty > 0)
      && activeShips.every(d => d.status === 'planned' && (!d.trackingCode || (String(d.carrier).trim().toLowerCase() === 'ghn' && (!d.trackingStatus || ['ready_to_pick', 'picking'].includes(d.trackingStatus))))) && activeShips.length <= 1;
    const lockedMessage = 'Đơn đã thu tiền, có cọc/trả trước hoặc hàng đã rời kho: dùng luồng thu hồi/đổi trả. Chỉ sửa hàng COD còn chờ lấy hàng.';
    body.append(el('p', retryKey ? 'Lần sửa trước đang chờ đối chiếu GHN. Chưa đổi hàng trên CRM và chưa được xuất/giao. Bấm Tiếp tục cập nhật GHN để hoàn tất.' : financial ? tracked
      ? 'Có thể thêm/xoá hàng khi GHN chưa lấy hàng. Khi lưu, CRM kiểm tra trạng thái và cập nhật hàng cùng tiền COD lên GHN trước khi hoàn tất đơn.'
      : 'Tìm sản phẩm theo quầy và chính sách giá của đơn gốc. Có thể thêm hoặc xoá mã; tổng tiền, voucher và chuyến chờ giao được tính lại khi lưu.' : lockedMessage, 'muted small'));
    const productControls = el('div', '', 'pos-edit-product-search'), productSearch = el('input'), find = el('button', 'Tìm', 'btn secondary');
    productSearch.type = 'search'; productSearch.placeholder = 'Tìm tên, mã hàng hoặc quét mã vạch…'; productSearch.setAttribute('aria-label', 'Tìm sản phẩm thêm vào đơn POS');
    productSearch.disabled = find.disabled = !financial; find.type = 'button';
    productControls.append(productSearch, find);
    const productStatus = el('p', '', 'muted small'), productResults = el('div', '', 'pos-edit-product-results'); productStatus.setAttribute('role', 'status');
    if (financial) body.append(productControls, productStatus, productResults);
    const table = el('table'), thead = el('thead'), header = el('tr');
    for (const title of ['Sản phẩm', 'SL', 'Giá niêm yết', 'CK', 'Loại CK', '']) header.append(el('th', title));
    thead.append(header); table.append(thead); const tbody = el('tbody'); table.append(tbody);
    let rows = [], productSeq = 0, productTimer;
    const renderRows = () => {
      tbody.replaceChildren(...rows.map(r => r.tr));
      if (!rows.length) { const tr = el('tr'), td = el('td', 'Chưa có sản phẩm. Tìm và thêm ít nhất một mã trước khi lưu.', 'muted'); td.colSpan = 6; tr.append(td); tbody.append(tr); }
    };
    const addRow = l => {
      const tr = el('tr'), description = el('td'); description.append(el('b', l.name), el('small', [l.sku, l.unit, l.taxRate > 0 ? 'Giá gồm VAT ' + l.taxRate + '%' : 'Không VAT'].filter(Boolean).join(' · ')));
      tr.append(description);
      const number = (value, step, label) => { const td = el('td'), input = el('input'); td.setAttribute('data-label', label); input.type = 'number'; input.min = '0'; input.step = step; input.value = value ?? 0; input.disabled = !financial; input.setAttribute('aria-label', label + ' · ' + l.name); input.required = true; td.append(input); tr.append(td); return input; };
      const qty = number(l.qty, '0.001', 'Số lượng'), price = number(l.listUnitPrice ?? l.unitPrice, '1', 'Đơn giá'), discount = number(l.discountValue, '0.01', 'Chiết khấu'); qty.min = '0.001';
      const td = el('td'), mode = el('select'); td.setAttribute('data-label', 'Loại CK'); mode.disabled = !financial; mode.setAttribute('aria-label', 'Loại chiết khấu · ' + l.name);
      for (const [v, text] of [['percent', '%'], ['amount', 'VNĐ / dòng']]) { const opt = el('option', text); opt.value = v; mode.append(opt); }
      mode.value = l.discountType || 'percent'; td.append(mode); tr.append(td);
      const action = el('td'), remove = el('button', '×', 'icon-btn danger'); remove.type = 'button'; remove.disabled = !financial;
      remove.setAttribute('aria-label', 'Xoá sản phẩm · ' + l.name); remove.title = financial ? 'Xoá sản phẩm khỏi đơn' : lockedMessage;
      action.append(remove); tr.append(action);
      const row = { id: l.id, sku: l.sku, tr, qty, price, discount, mode };
      remove.addEventListener('click', () => { if (!busy) { rows = rows.filter(r => r !== row); renderRows(); } });
      rows.push(row); renderRows(); return row;
    };
    if (!retryKey) lines.forEach(addRow);
    const scroll = el('div', '', 'pos-edit-lines'); scroll.append(table); body.append(scroll);
    const searchProducts = async () => {
      clearTimeout(productTimer); const seq = ++productSeq, term = productSearch.value.trim(); productResults.replaceChildren();
      if (!term || !financial || busy) { productStatus.textContent = ''; return; }
      if (!snapshot.register?.id || !snapshot.pricePolicyId) { productStatus.textContent = 'Thiếu quầy hoặc chính sách giá gốc. Mở lại đơn để kiểm tra.'; return; }
      productStatus.textContent = 'Đang tìm sản phẩm…'; find.disabled = true;
      try {
        const query = new URLSearchParams({ registerId: snapshot.register.id, pricePolicyId: snapshot.pricePolicyId, q: term, limit: '12' });
        const result = await api('/pos/catalog?' + query);
        if (seq !== productSeq || !dialog.open || busy) return;
        productStatus.textContent = result.products.length ? 'Bấm sản phẩm để thêm vào đơn.' : 'Không tìm thấy sản phẩm có giá theo chính sách của đơn gốc.';
        for (const p of result.products) {
          const own = o.holdsStock ? lines.filter(l => l.sku === p.sku).reduce((sum, l) => sum + Number(l.qty), 0) : 0;
          const available = Number.isFinite(Number(p.onHand)) && Number.isFinite(Number(p.reserved)) ? Math.max(0, Number(p.onHand) - Number(p.reserved) + own) : p.available;
          const pick = el('button', '', 'pos-edit-product-choice'); pick.type = 'button';
          pick.append(el('b', p.name), el('small', p.sku + ' · ' + new Intl.NumberFormat('vi-VN').format(p.price) + ' đ · Có thể bán ' + new Intl.NumberFormat('vi-VN').format(available ?? 0)));
          pick.addEventListener('click', () => {
            if (busy) return;
            let row = rows.find(r => r.sku === p.sku);
            if (row) row.qty.value = Number(row.qty.value || 0) + 1;
            else {
              if (rows.length >= 150) { error.textContent = 'Đơn tối đa 150 dòng hàng.'; return; }
              const withVat = typeof snapshot.vatEnabled === 'boolean' ? snapshot.vatEnabled : snapshot.pricePolicyId === snapshot.register.pricePolicyId;
              row = addRow({ sku: p.sku, name: p.name, unit: p.unit, qty: 1, listUnitPrice: p.price, taxRate: withVat ? snapshot.register.taxRate : 0, discountType: 'percent', discountValue: 0 });
            }
            productSeq++; productResults.replaceChildren(); productSearch.value = ''; productStatus.textContent = 'Đã thêm ' + p.sku + '.';
            row.qty.focus();
          }); productResults.append(pick);
        }
      } catch (e) { if (seq === productSeq && dialog.open) productStatus.textContent = e.message; }
      finally { if (seq === productSeq) find.disabled = !financial; }
    };
    productSearch.addEventListener('input', () => { productSeq++; clearTimeout(productTimer); productResults.replaceChildren(); find.disabled = !financial; productStatus.textContent = ''; productTimer = setTimeout(searchProducts, 200); });
    productSearch.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchProducts(); } });
    find.addEventListener('click', searchProducts);
    field(body, 'paymentNote', 'Điều kiện / ghi chú thanh toán (không ghi nhận đã thu)', schedules[0]?.note || '');
    field(body, 'reason', 'Lý do sửa đơn *', '').required = true;
    body.append(error);
    const foot = el('div', '', 'modal-foot'), cancel = el('button', 'Đóng', 'btn secondary'), save = el('button', retryKey ? 'Tiếp tục cập nhật GHN' : tracked ? 'Lưu và cập nhật GHN' : 'Lưu thay đổi', 'btn primary'), abandon = el('button', 'Bỏ lần sửa', 'btn secondary');
    abandon.type = 'button'; abandon.hidden = !retryKey;
    cancel.type = 'button'; save.type = 'submit'; cancel.addEventListener('click', () => { if (!busy) dialog.close(); }); foot.append(cancel, abandon, save);
    form.append(head, body, foot); dialog.append(form); document.body.append(dialog);
    let busy = false;
    const freezePending = (key, carrierWriteStarted = false, stored) => {
      if (Array.isArray(stored?.lines)) { rows = []; stored.lines.forEach(l => addRow({ ...l, listUnitPrice: l.price })); }
      for (const [name, value] of Object.entries(stored?.request || {})) if (controls[name] && value !== undefined && typeof value !== 'object') controls[name].value = value;
      canAbandon = !carrierWriteStarted; abandon.disabled = !canAbandon;
      retryKey = key; productSeq++; searchSeq++; choices.replaceChildren(); clearTimeout(productTimer); productResults.replaceChildren();
      for (const control of body.querySelectorAll('input,select,textarea,button')) control.disabled = true;
      save.textContent = 'Tiếp tục cập nhật GHN'; abandon.hidden = false;
    };
    if (retryKey) { freezePending(retryKey, !!snapshot.ghnAmendment.carrierWriteStarted, snapshot.ghnAmendment); error.textContent = snapshot.ghnAmendment.error || ''; }
    abandon.addEventListener('click', async () => {
      if (busy || !retryKey || !canAbandon) return; busy = true; form.inert = true;
      try { await api('/orders/' + encodeURIComponent(o.id) + '/pos', 'PUT', { requestKey: retryKey, cancelGhnEdit: true }); dialog.close(); await onSaved(); }
      catch (ex) { error.textContent = ex.message; } finally { busy = false; form.inert = false; }
    });
    dialog.addEventListener('close', () => { productSeq++; clearTimeout(productTimer); dialog.remove(); }, { once: true });
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    dialog.showModal();
    form.addEventListener('submit', async e => {
      e.preventDefault(); if (busy || (!retryKey && !form.reportValidity())) return;
      if (!retryKey && financial && !rows.length) { error.textContent = 'Thêm ít nhất một sản phẩm trước khi lưu đơn.'; return; }
      busy = true; form.inert = true; save.disabled = cancel.disabled = abandon.disabled = true; error.textContent = '';
      if (tracked || retryKey) save.textContent = 'Đang cập nhật GHN…';
      try {
        const data = Object.fromEntries(['customerName', 'contact', 'phone', 'email', 'taxCode', 'address', 'paymentNote', 'reason'].map(k => [k, controls[k].value]));
        await api('/orders/' + encodeURIComponent(o.id) + '/pos', 'PUT', retryKey ? { requestKey: retryKey, resumeGhnEdit: true } : {
          ...data, customerId, revision: o.revision, requestKey,
          ...(financial ? { lines: rows.map(r => ({ ...(r.id ? { id: r.id } : { sku: r.sku }), qty: r.qty.value, price: r.price.value, discountValue: Number(r.discount.value), discountType: r.mode.value })) } : {}),
          ...(ship ? { delivery: { address: controls.shipAddress.value, receiverName: controls.receiverName.value, receiverPhone: controls.receiverPhone.value } } : {}),
        });
        dialog.close(); await onSaved();
      } catch (e) {
        error.textContent = e.message;
        if (tracked || retryKey) {
          try { const fresh = await api('/orders/' + encodeURIComponent(o.id)); const snap = typeof fresh.order?.posSnapshot === 'string' ? JSON.parse(fresh.order.posSnapshot) : fresh.order?.posSnapshot; if (snap?.lastGhnAmendment?.key === requestKey && !snap.lastGhnAmendment.result?.cancelledGhnEdit) { dialog.close(); await onSaved(); return; } if (snap?.ghnAmendment?.key) freezePending(snap.ghnAmendment.key, !!snap.ghnAmendment.carrierWriteStarted, snap.ghnAmendment); } catch { /* Keep the request key for a safe retry after reconnecting. */ }
        }
      } finally { busy = false; form.inert = false; save.disabled = cancel.disabled = false; abandon.disabled = !canAbandon; save.textContent = retryKey ? 'Tiếp tục cập nhật GHN' : tracked ? 'Lưu và cập nhật GHN' : 'Lưu thay đổi'; }
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
    const cancel = el('button', 'Huỷ', 'btn secondary'), save = el('button', 'Xác nhận đã thu', 'btn primary'); cancel.type = 'button'; save.type = 'submit'; cancel.addEventListener('click', () => { if (!busy) dialog.close(); }); foot.append(cancel, save);
    const key = crypto.randomUUID(); let busy = false;
    form.append(body, foot); dialog.append(form); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); }); dialog.showModal();
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
  const methods = [...new Set(detail.payments.filter(p => !p.voidedAt).map(p => p.paymentSource==='pos_exchange_credit'?'tiền đổi hàng':p.method === 'cash' ? 'tiền mặt' : p.method === 'transfer' ? 'chuyển khoản' : 'khác'))];
  return terms + ' · ' + (methods.length ? 'Đã thu bằng ' + methods.join(', ') : 'Chưa thu');
}

export function posGhnEditNotice(detail) {
  try {
    const snapshot = typeof detail.order.posSnapshot === 'string' ? JSON.parse(detail.order.posSnapshot) : detail.order.posSnapshot;
    return snapshot?.ghnAmendment ? 'Đơn đang chờ hoàn tất cập nhật GHN. Hàng và công nợ trên CRM vẫn giữ nguyên; chưa được đóng gói, xuất/giao hay thu tiền. Bấm Sửa đơn POS để tiếp tục. ' + (snapshot.ghnAmendment.error || '') : '';
  } catch { return ''; }
}
