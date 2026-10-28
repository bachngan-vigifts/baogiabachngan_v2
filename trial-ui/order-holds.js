/**
 * GIỮ HÀNG THEO ĐƠN (chi tiết đơn CRM) – API src/modules/sales/api/order-hold-routes.ts, docs/SO-KHO.md › Giữ hàng theo đơn.
 * Mỗi lần giữ tối đa = có thể bán. Tự giữ lúc duyệt khi có ngày giao (hạn ngày giao + 3 ngày); "Giữ hàng / Giữ thêm" 5 ngày;
 * huỷ giữ (nhân viên phụ trách / Manager); Manager gia hạn. Đơn cũ (legacy): Manager xem / áp dụng kế hoạch chuyển đổi.
 * DOM dựng bằng createElement / textContent.
 */
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const num = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const when = iso => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export async function showOrderHolds({ api, toast, root, orderId, isManager = () => false, onChanged = () => {} }) {
  const base = '/orders/' + encodeURIComponent(orderId) + '/holds';
  let busy = false;
  const button = (text, cls, fn) => {
    const b = el('button', cls, text); b.type = 'button';
    b.addEventListener('click', async () => {
      if (busy) return; busy = true; root.querySelectorAll('button').forEach(x => { x.disabled = true; });
      try { await fn(); } catch (e) { toast(e.message, 'err'); } finally { busy = false; await draw(); }
    });
    return b;
  };
  async function draw() {
    let d; try { d = await api(base); } catch (e) { root.replaceChildren(el('p', 'muted small', e.message)); return; }
    const box = el('div', 'order-holds'), head = el('div', 'expected-row');
    head.append(el('span', 'muted small', 'Giữ hàng'));
    box.append(head);
    if (d.holdMode === 'legacy') {
      box.append(el('p', 'muted small', 'Đơn cũ: đang giữ toàn bộ phần chưa giao theo cách cũ, chờ Manager áp dụng kế hoạch chuyển đổi (giữ tối đa có thể bán).'));
      if (isManager()) box.append(button('Kế hoạch chuyển đổi giữ hàng đơn cũ', 'btn secondary small', () => openConversion({ api, toast, onChanged })));
      root.replaceChildren(box); return;
    }
    const list = el('ul', 'plain-list');
    for (const l of d.lines) {
      const li = el('li'), missing = Math.max(0, l.remaining - l.held);
      li.append(el('span', '', `${l.sku} · giữ ${num(l.held)} / còn giao ${num(l.remaining)}`), el('small', missing > 0 ? 'danger-text' : 'muted', missing > 0 ? ` thiếu ${num(missing)}` : ' đủ'));
      list.append(li);
    }
    if (d.lines.length) box.append(list);
    if (d.holds.length) box.append(el('p', 'muted small', 'Hạn giữ: ' + [...new Set(d.holds.map(h => when(h.expiresAt)))].join(', ') + ' · hết hạn tự nhả cho đơn khác.'));
    else box.append(el('p', 'muted small', 'Chưa giữ hàng. Đơn có ngày giao thì tự giữ lúc duyệt; hàng về bấm "Giữ hàng" (giữ ' + d.manualDays + ' ngày, tối đa có thể bán).'));
    const acts = el('div', 'row-gap');
    if (d.canHold) acts.append(button(d.holds.length ? 'Giữ thêm' : 'Giữ hàng', 'btn primary small', async () => {
      const r = await api(base, 'POST', { clientKey: crypto.randomUUID() });
      const got = r.lines.reduce((n, l) => n + l.qty, 0), short = r.lines.filter(l => l.qty < l.want);
      toast(got > 0 ? `Đã giữ thêm ${num(got)}.` + (short.length ? ' Thiếu: ' + short.map(l => `${l.sku} ${num(l.want - l.qty)}`).join(', ') + ' (chờ hàng về).' : '') : 'Không còn hàng có thể bán để giữ.', got > 0 ? undefined : 'err');
      onChanged();
    }));
    if (d.canExtend) acts.append(button('Gia hạn ' + d.manualDays + ' ngày', 'btn secondary small', async () => { await api(base + '/extend', 'POST', {}); toast('Đã gia hạn giữ hàng.'); }));
    if (d.canRelease) acts.append(button('Huỷ giữ', 'btn ghost small', async () => {
      const reason = prompt('Lý do huỷ giữ hàng (hàng nhả cho đơn khác):', ''); if (!reason) return;
      await api(base + '/release', 'POST', { reason }); toast('Đã huỷ giữ hàng.'); onChanged();
    }));
    if (acts.childElementCount) box.append(acts);
    root.replaceChildren(box);
  }
  await draw();
}

/** Manager: xem trước kế hoạch (không ghi gì) → áp dụng đúng mã kế hoạch đã xem. */
async function openConversion({ api, toast, onChanged }) {
  const plan = await api('/stock-holds/conversion');
  const dlg = el('dialog', 'modal'), body = el('div', 'modal-body'), head = el('div', 'modal-head'), foot = el('div', 'modal-foot');
  head.append(el('h2', '', 'Chuyển đổi giữ hàng đơn cũ'));
  body.append(el('p', 'small', `Xem trước – chưa thay đổi gì. Tổng đang giữ ${num(plan.held.before)} → sau chuyển đổi ${num(plan.held.after)}. Đơn trước giữ trước, mỗi đơn tối đa có thể bán; chỉ đơn đã duyệt, có kho bán và ngày giao còn hiệu lực mới giữ.`));
  const wrap = el('div', 'table-wrap'), table = el('table'), thead = el('thead'), tbody = el('tbody'), hr = el('tr');
  for (const t of ['Đơn', 'Kho', 'Ngày giao', 'Mã: trước → sau', 'Ghi chú']) hr.append(el('th', '', t));
  thead.append(hr); table.append(thead, tbody); wrap.append(table); body.append(wrap);
  for (const o of plan.orders) {
    const tr = el('tr');
    tr.append(el('td', '', o.orderNo), el('td', '', o.warehouse || '—'), el('td', '', o.deliveryDate || '—'),
      el('td', '', o.lines.map(l => `${l.sku}: ${num(l.before)} → ${num(l.after)}`).join('; ') || '—'), el('td', 'muted small', o.reason));
    tbody.append(tr);
  }
  if (!plan.orders.length) body.append(el('p', 'muted', 'Không còn đơn giữ hàng theo cách cũ.'));
  const close = el('button', 'btn secondary', 'Đóng'), apply = el('button', 'btn primary', 'Áp dụng kế hoạch ' + plan.planId);
  close.type = apply.type = 'button'; apply.hidden = !plan.orders.length;
  close.addEventListener('click', () => dlg.close());
  apply.addEventListener('click', async () => {
    apply.disabled = true;
    try { const r = await api('/stock-holds/conversion', 'POST', { planId: plan.planId, confirmed: true }); toast(`Đã chuyển đổi ${r.applied} đơn.`); dlg.close(); onChanged(); }
    catch (e) { toast(e.message, 'err'); apply.disabled = false; }
  });
  foot.append(close, apply); dlg.append(head, body, foot); document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove(), { once: true }); dlg.showModal();
}
