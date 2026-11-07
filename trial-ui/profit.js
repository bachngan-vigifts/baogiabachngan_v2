/**
 * PHÂN TÍCH LỢI NHUẬN – trang #/profit (chỉ Manager; máy chủ kiểm tra lại quyền).
 * Lợi nhuận gộp = Doanh thu thuần − Giá vốn − Chi phí trực tiếp; ghi nhận theo ngày đơn; dòng thiếu giá vốn không tính 0.
 */
const GRAIN_LABEL = { day: 'Ngày', week: 'Tuần', month: 'Tháng', year: 'Năm' };
const TABS = { series: 'Thời gian', branches: 'Chi nhánh', owners: 'Nhân viên', customers: 'Khách hàng', orders: 'Đơn hàng', products: 'Sản phẩm' };
const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const pct = x => x === null || x === undefined ? '—' : (Math.round(x * 1000) / 10).toLocaleString('vi-VN') + '%';
const short = v => { const a = Math.abs(v), s = v < 0 ? '−' : '';
  return a >= 1e9 ? s + (Math.round(a / 1e7) / 100).toLocaleString('vi-VN') + ' tỷ' : a >= 1e6 ? s + Math.round(a / 1e6).toLocaleString('vi-VN') + ' tr' : s + Math.round(a).toLocaleString('vi-VN'); };
const csvCell = v => /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

const CONF_TONE = { confirmed: 'ok', estimate: 'warn', backfill: 'muted' };
const REASON = { create: 'Tạo đơn', amend: 'Sửa đơn', confirm: 'Duyệt đơn', pos: 'Bán POS', pos_edit: 'Sửa đơn POS', adjust: 'Manager điều chỉnh' };
export function initProfit({ api, root, toast, esc, money }) {
  const pill = (tone, text) => `<span class="pill ${tone}">${esc(text)}</span>`;
  const when = v => new Date(v).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
  const st = { costs: 'all', grain: 'month', from: vnToday().slice(0, 4) + '-01-01', to: vnToday(), branch: '', owner: '', tab: 'owners', missingOnly: false, data: null };
  const num = v => Math.round(v).toLocaleString('vi-VN');
  const marginCell = r => { const w = r.margin === null ? 0 : Math.max(0, Math.min(1, r.margin / 0.4)) * 80;
    return `<span class="pf-mbar" style="width:${w}px"></span> ${pct(r.margin)}`; };
  const flag = r => r.gross < 0 ? '<span class="pill danger">Lỗ</span>' : r.margin !== null && r.margin < 0.15 ? '<span class="pill warn">Biên thấp</span>' : '';
  const miss = r => r.missingOrders ? `<span class="pill muted" title="Doanh thu thiếu giá vốn: ${esc(money(r.missingRevenue))}">${r.missingOrders} thiếu giá vốn</span>` : '';

  async function load() {
    root.innerHTML = '<p class="muted">Đang tính lợi nhuận…</p>';
    const q = new URLSearchParams({ from: st.from, to: st.to, grain: st.grain, ...(st.branch ? { branch: st.branch } : {}), ...(st.owner ? { owner: st.owner } : {}), ...(st.costs === 'confirmed' ? { costs: 'confirmed' } : {}) });
    try { st.data = await api('/profit?' + q); } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    render();
  }
  function render() {
    const d = st.data, s = d.summary, opt = (list, val, all) => `<option value="">${all}</option>` + list.map(o => `<option value="${esc(o.id)}" ${o.id === val ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
    root.innerHTML = `<div class="page-head"><div><h1>Phân tích lợi nhuận</h1><p class="muted">Chỉ Manager · số liệu chưa VAT · LN gộp = Doanh thu thuần − Giá vốn − Chi phí trực tiếp · ghi nhận theo ngày đơn</p></div></div>
      <div class="card pf-filters"><div class="seg" role="group" aria-label="Kỳ">${Object.entries(GRAIN_LABEL).map(([k, v]) => `<button type="button" data-grain="${k}" class="${k === st.grain ? 'on' : ''}">${v}</button>`).join('')}</div>
        <label>Từ<input type="date" id="pf-from" value="${esc(st.from)}"></label><label>Đến<input type="date" id="pf-to" value="${esc(st.to)}"></label>
        <label>Chi nhánh<select id="pf-branch">${opt(d.filterOptions.branches, st.branch, 'Tất cả')}</select></label>
        <label>Nhân viên<select id="pf-owner">${opt(d.filterOptions.owners, st.owner, 'Tất cả')}</select></label>
        <label>Giá vốn<select id="pf-costs"><option value="all" ${st.costs === 'all' ? 'selected' : ''}>Gồm ước tính / backfill</option><option value="confirmed" ${st.costs === 'confirmed' ? 'selected' : ''}>Chỉ giá vốn chính xác</option></select></label>
        <button type="button" class="btn secondary" id="pf-csv">Xuất Excel (CSV)</button></div>
      <div class="pf-kpis">
        <div class="card"><small>Doanh thu thuần</small><b class="num">${short(s.revenue)}</b><span>${s.orders} đơn</span></div>
        <div class="card"><small>Giá vốn hàng bán</small><b class="num">${short(s.cost)}</b><span>${s.coveredRevenue ? pct(s.cost / s.coveredRevenue) + ' doanh thu' : ''}</span></div>
        <div class="card"><small>Chi phí trực tiếp</small><b class="num">${short(s.direct)}</b><span>in ${short(d.direct.printing)} · hoa hồng ${short(d.direct.commission)} · ship ${short(d.direct.shipping)}</span></div>
        <div class="card"><small>Lợi nhuận gộp</small><b class="num ${s.gross < 0 ? 'neg' : ''}">${short(s.gross)}</b><span>&nbsp;</span></div>
        <div class="card"><small>Biên LN gộp</small><b class="num">${pct(s.margin)}</b><span>trên doanh thu đủ giá vốn</span></div>
        <div class="card"><small>LN sau chi phí</small><b class="num ${s.net < 0 ? 'neg' : ''}">${short(s.net)}</b><span>+ thu phí khách ${short(s.feeRevenue)} − phí GHN ${short(s.carrierFee)} · biên ${pct(s.netMargin)}</span></div>
        <div class="card"><small>Độ tin cậy giá vốn</small><b class="num">${s.revenue ? pct(s.revenueBy.confirmed / s.revenue) : '—'}</b><span>chính xác · ${s.revenue ? pct(s.revenueBy.estimate / s.revenue) : '—'} ước tính · ${s.revenue ? pct(s.revenueBy.backfill / s.revenue) : '—'} backfill · ${s.revenue ? pct(s.revenueBy.missing / s.revenue) : '—'} thiếu</span></div></div>
      ${s.carrierUnknownOrders ? `<div class="pf-warn" role="status">⚠ ${s.carrierUnknownOrders} đơn POS có vận đơn GHN nhưng chưa có phí GHN – chưa trừ (không coi là 0).</div>` : ''}
      <p class="muted small">Phí quẹt thẻ / cổng thanh toán: ${esc(d.cardFees?.note || '')}</p>
      ${s.revenueBy.backfill > 0 && st.costs === 'all' ? `<div class="pf-warn" role="status"><span>ℹ ${esc(money(s.revenueBy.backfill))} doanh thu dùng giá vốn <b>backfill</b> (đơn chưa lưu giá vốn lúc bán – tính lại từ báo giá / giá nhập gần nhất), không coi là chính xác. Chọn "Chỉ giá vốn chính xác" để xem số chắc chắn.</span></div>` : ''}
      ${s.missingOrders ? `<div class="pf-warn" role="status">⚠ ${s.missingOrders} đơn (${esc(money(s.missingRevenue))} doanh thu) có dòng thiếu giá vốn – phần đó không tính vào lợi nhuận, không coi là 0.
        <button type="button" class="btn ghost small" id="pf-missing">${st.missingOnly ? 'Xem tất cả đơn' : 'Xem các đơn cần bổ sung'}</button></div>` : ''}
      <div class="pf-two"><div class="card"><h3 class="pf-h">Lợi nhuận gộp theo ${GRAIN_LABEL[st.grain].toLowerCase()}</h3>${chart(d.series)}</div>
        <div class="card"><h3 class="pf-h">Theo chi nhánh</h3>${table(['Chi nhánh', '>DT thuần', '>LN gộp', '>Biên'], d.branches.map(r => [esc(r.label), short(r.revenue), short(r.gross), pct(r.margin)]))}</div></div>
      <div class="card"><div class="pf-tabs" role="tablist">${Object.entries(TABS).map(([k, v]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === st.tab}" class="${k === st.tab ? 'on' : ''}">${v}</button>`).join('')}</div>
        <div id="pf-tab">${tabBody()}</div></div>`;
    root.querySelectorAll('[data-grain]').forEach(b => b.onclick = () => { st.grain = b.dataset.grain; load(); });
    root.querySelector('#pf-from').onchange = e => { if (e.target.value) { st.from = e.target.value; load(); } };
    root.querySelector('#pf-to').onchange = e => { if (e.target.value) { st.to = e.target.value; load(); } };
    root.querySelector('#pf-branch').onchange = e => { st.branch = e.target.value; load(); };
    root.querySelector('#pf-owner').onchange = e => { st.owner = e.target.value; load(); };
    root.querySelector('#pf-costs').onchange = e => { st.costs = e.target.value; load(); };
    root.querySelector('#pf-missing')?.addEventListener('click', () => { st.missingOnly = !st.missingOnly; st.tab = 'orders'; render(); });
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; render(); });
    root.querySelector('#pf-csv').onclick = exportCsv;
    bindTab();
  }
  function table(heads, rows, attrs = []) {
    return `<div class="table-wrap"><table class="data-table pf-table"><thead><tr>${heads.map(h => `<th${h.startsWith('>') ? ' class="right"' : ''}>${esc(h.replace(/^>/, ''))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr ${attrs[i] || ''}>${r.map((c, j) => `<td data-label="${esc(heads[j].replace(/^>/, ''))}"${heads[j].startsWith('>') ? ' class="right num"' : ''}>${c}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${heads.length}" class="muted">Không có dữ liệu trong khoảng đã chọn.</td></tr>`}</tbody></table></div>`;
  }
  const H = ['>Số đơn', '>DT thuần', '>Giá vốn', '>CP trực tiếp', '>LN gộp', 'Biên LN', ''];
  const rowCells = r => [num(r.orders), num(r.revenue), num(r.cost), num(r.direct), `<b class="${r.gross < 0 ? 'neg' : ''}">${num(r.gross)}</b>`, marginCell(r), `${flag(r)} ${miss(r)}`];
  function tabBody() {
    const d = st.data;
    if (st.tab === 'orders') {
      const list = st.missingOnly ? d.orders.filter(o => o.missingLines) : d.orders;
      return table(['Ngày', 'Đơn', 'Khách hàng', 'Nhân viên', '>DT thuần', '>Giá vốn', '>CP trực tiếp', '>LN gộp', '>Phí POS / GHN', '>LN sau CP', 'Biên LN', ''],
        list.map(o => [esc(o.orderDate.split('-').reverse().join('/')), esc(o.orderNo), esc(o.customerName), esc(o.ownerName), num(o.revenue), num(o.cost), num(o.direct),
          `<b class="${o.gross < 0 ? 'neg' : ''}">${num(o.gross)}</b>`, o.feeRevenue || o.carrierFee ? `+${num(o.feeRevenue)} / −${num(o.carrierFee)}` : '—', `<b class="${o.net < 0 ? 'neg' : ''}">${num(o.net)}</b>`, marginCell(o), `${flag(o)}${o.missingLines ? ` <span class="pill muted">${o.missingLines} dòng thiếu giá vốn</span>` : ''}`]),
        list.map(o => `class="pf-click" data-order="${esc(o.id)}" tabindex="0"`)) + (d.ordersTotal > d.orders.length ? `<p class="muted small">Hiện ${d.orders.length}/${d.ordersTotal} đơn mới nhất – lọc theo nhân viên / chi nhánh để xem đủ.</p>` : '');
    }
    if (st.tab === 'products') return table(['Mã', 'Sản phẩm', '>SL', ...H], d.products.map(r => [esc(r.key.startsWith('(không mã)') ? '—' : r.key), esc(r.label), num(r.qty), ...rowCells(r)]));
    const label = { series: 'Kỳ', branches: 'Chi nhánh', owners: 'Nhân viên', customers: 'Khách hàng' }[st.tab];
    const list = st.tab === 'series' ? [...d.series].reverse() : d[st.tab];
    return table([label, ...H], list.map(r => [esc(r.label), ...rowCells(r)]), st.tab === 'owners' ? list.map(r => `class="pf-click" data-owner="${esc(r.key)}" tabindex="0" title="Lọc theo nhân viên này"`) : []);
  }
  function bindTab() {
    const on = (el, fn) => { el.onclick = fn; el.onkeydown = e => { if (e.key === 'Enter') fn(); }; };
    root.querySelectorAll('[data-order]').forEach(tr => on(tr, () => openOrder(tr.dataset.order)));
    root.querySelectorAll('[data-owner]').forEach(tr => on(tr, () => { st.owner = tr.dataset.owner; st.tab = 'orders'; load(); }));
  }
  function chart(series) {
    if (!series.length) return '<p class="muted">Không có dữ liệu.</p>';
    const W = 640, Hh = 220, top = 14, base = 186, left = 52, max = Math.max(1, ...series.map(r => r.gross)), min = Math.min(0, ...series.map(r => r.gross));
    const span = max - min, y = v => top + (max - v) / span * (base - top), zero = y(0), slot = (W - left - 8) / series.length, bw = Math.max(2, Math.min(28, slot * 0.62));
    const ticks = [max, max / 2, 0, ...(min < 0 ? [min] : [])];
    const every = Math.ceil(series.length / 12);
    return `<svg class="pf-chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Lợi nhuận gộp theo kỳ">
      ${ticks.map(t => `<line x1="${left}" x2="${W - 4}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'pf-base' : 'pf-grid'}"/><text x="${left - 6}" y="${y(t) + 3}" text-anchor="end" class="pf-axis">${esc(short(t))}</text>`).join('')}
      ${series.map((r, i) => { const x = left + i * slot + (slot - bw) / 2, h = Math.abs(y(r.gross) - zero), neg = r.gross < 0, rr = Math.min(4, bw / 2, h);
        const path = neg ? `M${x} ${zero} V${zero + h - rr} q0 ${rr} ${rr} ${rr} h${bw - 2 * rr} q${rr} 0 ${rr} ${-rr} V${zero} z`
          : `M${x} ${zero} V${zero - h + rr} q0 ${-rr} ${rr} ${-rr} h${bw - 2 * rr} q${rr} 0 ${rr} ${rr} V${zero} z`;
        return `<g class="pf-bar"><rect x="${left + i * slot}" y="${top}" width="${slot}" height="${base - top}" fill="transparent"/><path d="${path}" class="${neg ? 'neg' : ''}"/>
          <title>${esc(r.label)}: LN gộp ${esc(money(r.gross))} · DT ${esc(money(r.revenue))} · biên ${pct(r.margin)}</title>
          ${i % every === 0 ? `<text x="${x + bw / 2}" y="${Hh - 18}" text-anchor="middle" class="pf-axis">${esc(r.label.length > 7 ? r.label.slice(0, 5) : r.label)}</text>` : ''}</g>`; }).join('')}
    </svg>`;
  }
  async function openOrder(id) {
    let o; try { o = await api('/profit/orders/' + encodeURIComponent(id)); } catch (e) { toast(e.message, 'err'); return; }
    const dlg = document.createElement('dialog'); dlg.className = 'modal pf-dialog';
    dlg.innerHTML = `<div class="modal-head"><h2>Lợi nhuận đơn ${esc(o.orderNo)}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body"><p class="small">${esc(o.orderDate.split('-').reverse().join('/'))} · ${esc(o.customerName)} · ${esc(o.ownerName)} · ${esc(o.branch)}</p>
      ${table(['Sản phẩm', '>SL', '>DT thuần', '>Giá vốn / đv', 'Nguồn · tin cậy', '>In', '>Hoa hồng', '>LN gộp', ''], o.lines.map(l => [`${esc(l.name)}<br><small class="muted">${esc(l.sku || '—')}</small>`,
        num(l.qty), num(l.revenue), l.unitCost === null ? '—' : num(l.unitCost),
        l.costSource === 'missing' ? `<span class="pill danger">${esc(l.costSourceLabel)}</span>` : `<small>${esc(l.costSourceLabel)}</small><br>${pill(CONF_TONE[l.confidence], l.confidenceLabel)}${l.snapshot?.costAt ? `<br><small class="muted">giá lúc ${esc(when(l.snapshot.costAt))}</small>` : ''}`,
        num(l.printing), num(l.commission), l.gross === null ? '—' : `<b class="${l.gross < 0 ? 'neg' : ''}">${num(l.gross)}</b>`,
        `<button type="button" class="btn ghost small" data-adjust="${esc(l.id)}">Điều chỉnh</button>`]))}
      <div class="pf-adjust" hidden><h3 class="pf-h">Điều chỉnh giá vốn: <span data-adj-name></span></h3>
        <div class="form-grid cols-2"><label>Giá vốn / đơn vị (chưa VAT)<input data-adj-cost inputmode="numeric"></label><label>Lý do (bắt buộc)<input data-adj-reason maxlength="500" placeholder="VD: giá NCC theo HĐ số…"></label></div>
        <p class="muted small">Ghi lịch sử (giá cũ / mới, người, thời điểm); giá vốn dòng này thành "Chính xác".</p><p class="error" data-adj-err role="alert"></p>
        <button type="button" class="btn primary small" data-adj-save>Lưu điều chỉnh</button></div>
      ${o.lines.some(l => l.history?.length) ? `<details class="small"><summary>Lịch sử giá vốn</summary><ol class="pf-hist">${o.lines.flatMap(l => (l.history || []).map(h =>
        `<li><b>${esc(when(h.at))}</b> · ${esc(l.sku || l.name)} · ${esc(REASON[h.reason] || h.reason)}: ${h.previousUnitCost === null ? '' : esc(num(h.previousUnitCost)) + ' → '}${h.unitCost === null ? 'thiếu giá vốn' : esc(num(h.unitCost))}${h.note ? ` – ${esc(h.note)}` : ''} <small class="muted">· ${esc(h.actor)}</small></li>`)).join('')}</ol></details>` : ''}
      <p class="small">Ship mình trả: <b>${esc(money(o.shipping))}</b> · LN gộp đơn: <b>${esc(money(o.gross))}</b> · biên ${pct(o.margin)}${o.missingLines ? ` · <span class="warn-text">${o.missingLines} dòng thiếu giá vốn – bổ sung giá vốn trên báo giá hoặc nhập hàng để tính</span>` : ''}</p></div>
      <div class="modal-foot"><a class="btn secondary" href="#/orders/${encodeURIComponent(o.id)}">Mở đơn</a><button type="button" class="btn primary" data-x>Đóng</button></div>`;
    document.body.append(dlg); dlg.showModal();
    dlg.addEventListener('close', () => dlg.remove()); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    dlg.querySelector('a.btn').addEventListener('click', () => dlg.close());
    let editing = null; const box = dlg.querySelector('.pf-adjust');
    dlg.querySelectorAll('[data-adjust]').forEach(b => b.onclick = () => { editing = o.lines.find(l => l.id === b.dataset.adjust); box.hidden = false;
      box.querySelector('[data-adj-name]').textContent = editing.name; box.querySelector('[data-adj-cost]').value = editing.unitCost === null ? '' : num(editing.unitCost);
      box.querySelector('[data-adj-reason]').value = ''; box.querySelector('[data-adj-err]').textContent = ''; box.querySelector('[data-adj-cost]').focus(); });
    dlg.querySelector('[data-adj-save]').onclick = async () => {
      const err = box.querySelector('[data-adj-err]');
      try { await api('/profit/line-costs/' + encodeURIComponent(editing.id), 'PUT', { unitCost: box.querySelector('[data-adj-cost]').value.replace(/\./g, '').replace(',', '.'),
        reason: box.querySelector('[data-adj-reason]').value, revision: editing.snapshot ? editing.snapshot.revision : null });
        toast('Đã điều chỉnh giá vốn.'); dlg.close(); load(); openOrder(id); } catch (e) { err.textContent = e.message; }
    };
  }
  function exportCsv() {
    const d = st.data, heads = ['Nhóm', 'Số đơn', 'Doanh thu thuần', 'Giá vốn', 'Chi phí trực tiếp', 'LN gộp', 'Biên LN (%)', 'Đơn thiếu giá vốn', 'DT thiếu giá vốn'];
    const rows = st.tab === 'orders'
      ? [['Ngày', 'Đơn', 'Khách hàng', 'Nhân viên', 'Chi nhánh', 'Doanh thu thuần', 'Giá vốn', 'Chi phí trực tiếp', 'LN gộp', 'Biên LN (%)', 'Dòng thiếu giá vốn'],
        ...d.orders.map(o => [o.orderDate, o.orderNo, o.customerName, o.ownerName, o.branch, o.revenue, o.cost, o.direct, o.gross, o.margin === null ? '' : Math.round(o.margin * 1000) / 10, o.missingLines])]
      : [heads, ...(st.tab === 'series' ? d.series : d[st.tab]).map(r => [r.label, r.orders, r.revenue, r.cost, r.direct, r.gross, r.margin === null ? '' : Math.round(r.margin * 1000) / 10, r.missingOrders, r.missingRevenue])];
    const blob = new Blob(['﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `loi-nhuan-${TABS[st.tab]}-${st.from}-${st.to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return { show: load };
}
