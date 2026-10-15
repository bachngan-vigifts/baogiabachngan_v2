/**
 * ĐƠN MUA HÀNG NCC (#/purchases) – xem docs/NCC-PAGE.md mục "Đơn mua hàng".
 *  #/purchases                 danh sách + lọc trạng thái
 *  #/purchases/<id>            mở chi tiết (ngăn kéo bên phải)
 *  #/purchases/new?type=&id=   lập đơn từ báo giá / đơn-HĐKT / khách hỏi tồn
 * Quyền do máy chủ quyết (`actions` trong chi tiết): giao diện chỉ ẩn / hiện nút. DOM dựng bằng createElement / textContent.
 * API: src/modules/suppliers/api/purchase-routes.ts.
 */
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const btn = (text, cls = 'btn secondary small', onClick) => { const b = el('button', cls, text); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };
const input = (type, value = '', attrs = {}) => { const i = el('input'); i.type = type; i.value = value ?? ''; Object.assign(i, attrs); return i; };
const field = (label, control, cls = '') => { const l = el('label', cls); l.append(document.createTextNode(label), control); return l; };
const dmy = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—';
const num = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const key = () => (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
const SOURCE_LABEL = { quote: 'Báo giá', order: 'Đơn / HĐKT', stock_request: 'Khách hỏi tồn' };
const STATE_PILL = { draft: 'warn', awaiting_confirmation: 'info', confirmed: 'info', partially_received: 'warn', received: 'ok', cancelled: '' };
const SAPO_LABEL = { pending: ['Chờ nhập Sapo', 'warn'], done: ['Đã nhập Sapo', 'ok'], failed: ['Nhập Sapo lỗi', 'danger'], not_needed: ['Không cần nhập Sapo', ''] };
const FILTERS = [['', 'Tất cả'], ['draft', 'Chờ duyệt'], ['awaiting_confirmation', 'Chờ NCC xác nhận'], ['confirmed', 'Chờ nhận hàng'], ['partially_received', 'Nhận một phần'],
  ['late', 'Quá hẹn'], ['sapo', 'Chờ nhập Sapo'], ['debt', 'Còn nợ NCC'], ['received', 'Đã nhận đủ'], ['cancelled', 'Đã huỷ']];
const ACTION_LABEL = { edit: 'Sửa nháp', approve: 'Duyệt giá', confirm: 'Ghi nhận NCC xác nhận', receive: 'Nhận hàng', pay: 'Ghi trả NCC', schedule: 'Lịch trả', pdf: 'PDF gửi NCC', cancel: 'Huỷ đơn' };

/** Catalog lookup for the manual purchase line; never converts SKUs to numbers. */
export function bindManualProductLookup({ api, sku, name, unit, host, add, active }) {
  const list = el('div', 'pur-product-results'); list.hidden = true;
  const status = el('small', 'muted pur-product-status'); status.setAttribute('role', 'status');
  host.append(list, status);
  sku.setAttribute('aria-label', 'Mã hàng (SKU)'); name.setAttribute('aria-label', 'Tìm tên hàng');
  name.autocomplete = sku.autocomplete = 'off';
  let timer = 0, request = 0, disposed = false, selected = null;
  const valid = id => !disposed && active() && id === request;
  function reset() {
    clearTimeout(timer); ++request; selected = null; list.replaceChildren(); list.hidden = true;
    status.textContent = ''; add.disabled = false;
  }
  function choose(p) {
    reset(); sku.value = String(p.sku); name.value = p.name || ''; unit.value = p.unit || '';
    selected = { sku: sku.value, name: name.value }; status.textContent = 'Đã chọn sản phẩm.';
  }
  function schedule(kind) {
    const previous = selected; reset();
    if (kind === 'sku') { name.value = ''; unit.value = ''; }
    else if (previous && name.value !== previous.name) { sku.value = ''; unit.value = ''; }
    const query = (kind === 'sku' ? sku : name).value.trim();
    if (!query || (kind === 'name' && query.length < 2)) return;
    const id = request; add.disabled = kind === 'sku'; status.textContent = 'Đang tìm sản phẩm…';
    timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams(kind === 'sku' ? { skus: query } : { q: query, limit: '8' });
        const data = await api('/products?' + params);
        if (!valid(id)) return;
        if (kind === 'sku') {
          const product = data.products.find(p => String(p.sku) === query);
          if (product) choose(product);
          else status.textContent = 'Chưa có mã trong danh mục; có thể nhập tên và ĐVT thủ công.';
        } else {
          list.replaceChildren();
          for (const product of data.products) {
            const option = btn('', 'pur-product-option', () => choose(product));
            option.append(el('b', '', product.sku), el('span', '', product.name), el('small', 'muted', product.unit || ''));
            option.addEventListener('keydown', e => {
              if (e.key === 'Escape') { e.stopPropagation(); reset(); name.focus(); }
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault(); (e.key === 'ArrowDown' ? option.nextElementSibling : option.previousElementSibling)?.focus();
              }
            });
            list.append(option);
          }
          list.hidden = !data.products.length;
          status.textContent = data.products.length ? 'Chọn sản phẩm để điền mã và ĐVT.' : 'Không thấy sản phẩm; có thể nhập thủ công.';
        }
      } catch {
        if (valid(id)) status.textContent = 'Không tìm được danh mục. Thử lại hoặc nhập mã, tên và ĐVT thủ công.';
      } finally { if (valid(id)) add.disabled = false; }
    }, 250);
  }
  const onSku = () => schedule('sku'), onName = () => schedule('name');
  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); reset(); }
    if (e.key === 'ArrowDown' && !list.hidden) { e.preventDefault(); list.firstChild?.focus(); }
  };
  sku.addEventListener('input', onSku); name.addEventListener('input', onName); name.addEventListener('keydown', onKey);
  return { reset, dispose() { reset(); disposed = true; sku.removeEventListener('input', onSku); name.removeEventListener('input', onName); name.removeEventListener('keydown', onKey); } };
}

export function initPurchases({ api, root, toast, confirmBox, money, go, today }) {
  let rows = [], filter = '', req = 0, opts = null, current = null;
  let disposeLookup = () => {};
  const page = el('div', 'sup-page');
  const head = el('div', 'page-head'), titles = el('div');
  titles.append(el('span', 'eyebrow', 'Mua hàng'), el('h1', '', 'Đơn mua NCC'),
    el('p', 'muted', 'Lập đơn từ báo giá, đơn / HĐKT hoặc khách hỏi tồn; Manager duyệt giá; kho nhận hàng từng đợt rồi nhập kho trên Sapo (Sapo là nguồn tồn chính).'));
  const add = btn('+ Lập đơn mua', 'btn primary', () => openCreate());
  head.append(titles, add);
  const panel = el('div', 'panel'), bar = el('div', 'toolbar');
  const search = input('search', '', { placeholder: 'Tìm số đơn, NCC, mã hàng, số báo giá / HĐKT, khách…' }); search.setAttribute('aria-label', 'Tìm đơn mua');
  const label = el('label', 'search'); label.append(search);
  const countEl = el('span', 'muted small');
  bar.append(label, countEl);
  const chips = el('div', 'chips pur-chips');
  for (const [v, t] of FILTERS) { const c = btn(t, 'chip' + (v === '' ? ' active' : ''), () => { filter = v; chips.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c)); load(); }); chips.append(c); }
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table'), thead = el('thead'), tbody = el('tbody');
  table.append(thead, tbody); wrap.append(table); panel.append(bar, chips, wrap);
  page.append(head, panel);
  const shade = el('div', 'sup-shade'); shade.hidden = true; shade.addEventListener('click', () => close());
  const drawer = el('aside', 'sup-drawer pur-drawer'); drawer.hidden = true; drawer.setAttribute('role', 'dialog');
  root.append(page, shade, drawer);
  let timer = 0;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 200); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) close(); });

  async function options() { return opts ||= await api('/purchase-options'); }

  // ---------------------------------------------------------------- danh sách
  function renderList(prices) {
    thead.replaceChildren(); tbody.replaceChildren();
    const hr = el('tr'); for (const h of ['Số đơn', 'Nhà cung cấp', 'Ngày lập', 'Hẹn giao', 'Đã nhận', ...(prices ? ['Tổng tiền', 'Còn nợ'] : []), 'Trạng thái']) hr.append(el('th', '', h));
    thead.append(hr);
    countEl.textContent = rows.length + ' đơn mua';
    if (!rows.length) { const tr = el('tr'), td = el('td', 'muted', 'Chưa có đơn mua nào.'); td.colSpan = prices ? 8 : 6; tr.append(td); tbody.append(tr); return; }
    for (const r of rows) {
      const tr = el('tr', 'clickable' + (r.state === 'cancelled' ? ' is-off' : '')); tr.tabIndex = 0;
      const no = el('td'); no.append(el('b', '', r.ticketNumber || '—'), el('small', 'muted sup-sub', r.lineCount + ' mã'));
      const arr = el('td', r.late ? 'pur-late' : '', dmy(r.arrivalDate)); if (r.late) arr.title = 'Quá ngày hẹn, chưa nhận đủ';
      const prog = el('td'); prog.append(el('span', '', `${num(r.good)}/${num(r.ordered)}`)); if (r.damaged) prog.append(el('small', 'muted sup-sub', `hỏng ${num(r.damaged)}`));
      tr.append(no, el('td', '', r.supplierName || '—'), el('td', '', dmy(r.createdAt)), arr, prog);
      if (prices) { tr.append(el('td', 'num', r.state === 'draft' && !r.total ? 'Chờ giá' : money(r.total))); const d = el('td', 'num' + (r.overdue > 0 ? ' pur-late' : ''), r.balance > 0 ? money(r.balance) : '—'); tr.append(d); }
      const st = el('td'); st.append(el('span', 'sup-pill ' + (STATE_PILL[r.state] ?? ''), r.stateLabel));
      if (r.sapoPending) st.append(el('span', 'sup-pill warn pur-gap', `${r.sapoPending} phiếu chờ Sapo`));
      tr.append(st);
      const open = () => go('#/purchases/' + encodeURIComponent(r.id));
      tr.addEventListener('click', open); tr.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
      tbody.append(tr);
    }
  }
  async function load() {
    const id = ++req;
    try {
      const d = await api('/purchase-orders?' + new URLSearchParams({ q: search.value.trim(), state: filter }));
      if (id !== req) return; rows = d.orders; renderList(d.canSeePrices);
    } catch (e) { if (id === req) toast(e.message || 'Không tải được đơn mua.', 'err'); }
  }

  /** Router gọi: id = '' (danh sách) | 'new' (lập đơn, ?type=&id=) | id đơn. */
  async function show(id, query = '') {
    load();
    if (id === 'new') { const p = new URLSearchParams(query); openCreate(p.get('type') && p.get('id') ? { type: p.get('type'), id: p.get('id') } : null); }
    else if (id) openDetail(id);
    else hide();
  }

  // ---------------------------------------------------------------- ngăn kéo
  const hide = () => { disposeLookup(); drawer.hidden = true; shade.hidden = true; current = null; };
  const close = () => { hide(); if (/^#\/purchases\/./.test(location.hash)) history.replaceState(null, '', '#/purchases'); };
  function frame(eyebrow, title, onBack) {
    disposeLookup(); disposeLookup = () => {};
    const top = el('div', 'sup-drawer-head'), t = el('div'); t.append(el('span', 'eyebrow', eyebrow), el('h2', '', title));
    const tools = el('div', 'pur-head-tools');
    if (onBack) tools.append(btn('← Quay lại', 'btn secondary small', onBack));
    const x = btn('×', 'icon-btn', close); x.setAttribute('aria-label', 'Đóng'); tools.append(x);
    top.append(t, tools);
    drawer.replaceChildren(top); drawer.hidden = false; shade.hidden = false; drawer.scrollTop = 0;
    return drawer;
  }
  const errorBox = () => { const e = el('p', 'error'); e.setAttribute('role', 'alert'); return e; };
  /** Chạy thao tác ghi: khoá nút, báo lỗi tại chỗ, thành công thì vẽ lại chi tiết. */
  async function run(button, err, fn, ok) {
    err.textContent = ''; button.disabled = true;
    try { const v = await fn(); if (ok) toast(ok); if (v && v.id) { current = v; renderDetail(); } load(); return v; }
    catch (e) { err.textContent = e.message || 'Không thực hiện được.'; button.disabled = false; }
  }

  // ---------------------------------------------------------------- chi tiết
  async function openDetail(id) {
    try { [current] = await Promise.all([api('/purchase-orders/' + encodeURIComponent(id)), options()]); renderDetail(); }
    catch (e) { toast(e.message || 'Không mở được đơn mua.', 'err'); close(); }
  }
  function renderDetail() {
    const v = current, d = frame(v.stateLabel + (v.confirmedOnBehalf ? ' · Manager ghi nhận thay NCC' : ''), `${v.ticketNumber} · ${v.supplier?.name || ''}`);
    const has = a => v.actions.includes(a);
    const acts = el('div', 'pur-actions');
    for (const a of ['edit', 'approve', 'confirm', 'receive', 'pay', 'schedule', 'pdf', 'cancel']) {
      if (has(a)) acts.append(btn(ACTION_LABEL[a], a === 'cancel' ? 'btn secondary small danger-text' : a === 'approve' || a === 'receive' ? 'btn primary small' : 'btn secondary small', () => ACTIONS[a]()));
      // Cạnh nút PDF: gửi email đơn đặt hàng (đơn đã duyệt) + hỏi tồn NCC (mọi người xem được đơn, không kèm giá).
      if (a === 'pdf' && has('pdf')) {
        const mail = btn('✉ Gửi email NCC', 'btn secondary small', () => mailSupplier('order'));
        if (v.state === 'draft') { mail.disabled = true; mail.title = 'Manager duyệt giá trước khi gửi đơn cho NCC'; }
        acts.append(mail);
      }
      if (a === 'pdf' && has('pdf') && !v.cancelledAt && v.progress.missing > 0) acts.append(btn('Hỏi tồn NCC', 'btn secondary small', () => mailSupplier('stock')));
    }
    // Người không xem được giá (không có nút PDF) vẫn hỏi tồn được.
    if (!has('pdf') && !v.cancelledAt && v.progress.missing > 0) acts.append(btn('Hỏi tồn NCC', 'btn secondary small', () => mailSupplier('stock')));
    if (acts.children.length) d.append(acts);
    if (v.cancelledAt) d.append(el('p', 'pur-note danger', `Đã huỷ ${dmy(v.cancelledAt)}: ${v.cancelReason || ''}`));

    const info = el('dl', 'pur-info');
    const row = (k, val) => { info.append(el('dt', '', k), el('dd', '', val || '—')); };
    row('Hẹn giao', dmy(v.arrivalDate)); row('Kho nhận', v.warehouse); row('Số đơn phía NCC', v.internalNo);
    row('Ngày lập', dmy(v.createdAt)); row('Duyệt', v.approvedAt ? dmy(v.approvedAt) : 'Chưa duyệt'); row('NCC xác nhận', v.confirmedAt ? dmy(v.confirmedAt) : 'Chưa');
    if (v.supplierEmail) row('Gửi tới', v.supplierEmail + (v.ccEmail ? ' · CC ' + v.ccEmail : ''));
    if (v.note) row('Ghi chú', v.note);
    d.append(info);

    // Dòng hàng
    const sec = section('Hàng đặt', `Đã nhận đạt ${num(v.progress.good)}/${num(v.progress.ordered)}` + (v.progress.damaged ? ` · hỏng ${num(v.progress.damaged)}` : '') + (v.progress.missing ? ` · còn thiếu ${num(v.progress.missing)}` : ' · đủ'));
    const t = el('table', 'data-table pur-lines'), th = el('tr');
    const cols = ['Mã / tên', 'SL', 'Hẹn giao', ...(v.priceHidden ? [] : ['Giá', 'CK %', 'Thành tiền'])];
    for (const c of cols) th.append(el('th', '', c));
    const tb = el('tbody');
    for (const l of v.lines) {
      const tr = el('tr'), name = el('td');
      name.append(el('b', '', l.sku), el('small', 'sup-sub', l.name + (l.unit ? ` (${l.unit})` : '')));
      for (const s of l.sources) {
        // Liên kết về chứng từ nguồn (báo giá / đơn-HĐKT / khách hỏi tồn); người không có quyền xem sẽ nhận thông báo từ trang đó.
        const row = el('small', 'muted sup-sub'), link = el('a', '', s.no);
        link.href = (s.type === 'quote' ? '#/quotes/' : s.type === 'order' ? '#/orders/' : '#/stock-requests/') + encodeURIComponent(s.id);
        link.addEventListener('click', () => hide());
        row.append('↳ ', link, `${s.customerName ? ' · ' + s.customerName : ''}: ${num(s.quantity)}`); name.append(row);
      }
      if (l.supplierNote) name.append(el('small', 'muted sup-sub', 'NCC: ' + l.supplierNote));
            // Đã nhận / hỏng / thiếu xem ở dòng tóm tắt phía trên và ở "Phiếu nhận hàng"; "Hẹn giao" = ngày NCC hẹn giao riêng mã này.
      tr.append(name, el('td', 'num', num(l.quantity)), el('td', '', dmy(l.promisedDate)));
      if (!v.priceHidden) tr.append(el('td', 'num', l.price == null ? '—' : money(l.price)), el('td', 'num', l.purchaseDiscount ? num(l.purchaseDiscount) : '—'), el('td', 'num', money(l.lineTotal)));
      tb.append(tr);
    }
    t.append(el('thead'), tb); t.tHead.append(th);
    const tw = el('div', 'table-wrap'); tw.append(t); sec.append(tw);
    if (v.totals) { const s = el('p', 'pur-total'); s.append(`Tạm tính ${money(v.totals.subtotal)} · VAT ${money(v.totals.vat)} · `, el('b', '', 'Tổng ' + money(v.totals.total))); sec.append(s); }
    else sec.append(el('p', 'muted small', 'Giá mua chỉ Manager và Kế toán xem.'));
    d.append(sec);

    // Phiếu nhận + Sapo
    const rs = section('Phiếu nhận hàng', 'Đã nhận ≠ đã nhập kho: sau khi nhận, kho nhập phiếu trên Sapo rồi ghi mã phiếu Sapo vào đây. CRM không tự cộng tồn.');
    if (!v.receipts.length) rs.append(el('p', 'muted small', 'Chưa nhận đợt nào.'));
    for (const r of v.receipts) rs.append(receiptCard(r));
    d.append(rs);

    // Thanh toán NCC
    if (v.debt) {
      const ps = section('Thanh toán NCC', '');
      const k = el('div', 'pur-kpis');
      const kpi = (label, value, cls = '') => { const b = el('div', 'pur-kpi ' + cls); b.append(el('small', 'muted', label), el('b', '', value)); k.append(b); };
      kpi('Tổng đơn', money(v.debt.total)); kpi('Đã trả', money(v.debt.paid)); kpi('Còn nợ', money(v.debt.balance), v.debt.balance > 0 ? 'warn' : 'ok');
      kpi('Quá hạn', v.debt.overdue > 0 ? money(v.debt.overdue) : '—', v.debt.overdue > 0 ? 'danger' : '');
      kpi('Kỳ tới', v.debt.nextDueDate ? `${money(v.debt.nextDueAmount)} · ${dmy(v.debt.nextDueDate)}` : '—');
      ps.append(k);
      if (v.schedules.length) {
        const ul = el('ul', 'pur-list'); const KIND = { deposit: 'Cọc', installment: 'Đợt trả', balance: 'Còn lại' };
        for (const s of v.schedules) ul.append(el('li', '', `${KIND[s.kind] || s.kind}: ${money(s.amount)}${s.dueDate ? ' · hạn ' + dmy(s.dueDate) : ' · chưa đặt hạn'}${s.note ? ' · ' + s.note : ''}`));
        ps.append(el('h4', '', 'Lịch trả'), ul);
      }
      ps.append(el('h4', '', 'Các lần trả'));
      if (!v.payments.length) ps.append(el('p', 'muted small', 'Chưa trả lần nào.'));
      for (const p of v.payments) ps.append(paymentRow(p));
      d.append(ps);
    }

    // Lịch sử
    const hs = section('Lịch sử', '');
    const ul = el('ul', 'pur-history');
    for (const e of v.events) { const li = el('li'); li.append(el('small', 'muted', `${new Date(e.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })} · ${e.by || ''}`), el('span', '', e.summary)); ul.append(li); }
    hs.append(ul); d.append(hs);
  }
  function section(title, hint) { const s = el('section', 'sup-section'); s.append(el('h3', '', title)); if (hint) s.append(el('p', 'muted small', hint)); return s; }

  function receiptCard(r) {
    const card = el('div', 'pur-card' + (r.cancelledAt ? ' is-off' : ''));
    const top = el('div', 'pur-card-head'); const [lbl, cls] = SAPO_LABEL[r.sapoStatus] || [r.sapoStatus, ''];
    top.append(el('b', '', `${r.receiptNo} · ${dmy(r.receivedDate)}`), el('span', 'sup-pill ' + (r.cancelledAt ? '' : cls), r.cancelledAt ? 'Đã huỷ' : lbl + (r.sapoReceiptCode ? ' · ' + r.sapoReceiptCode : '')));
    card.append(top, el('small', 'muted', `${r.by || ''}${r.warehouse ? ' · ' + r.warehouse : ''}${r.note ? ' · ' + r.note : ''}`));
    card.append(el('p', 'small', r.lines.map(l => `${l.sku}: đạt ${num(l.goodQty)}${l.damagedQty ? `, hỏng ${num(l.damagedQty)}` : ''}${l.note ? ` (${l.note})` : ''}`).join(' · ')));
    if (r.sapoNote && r.sapoStatus === 'failed') card.append(el('p', 'pur-note danger small', 'Lỗi Sapo: ' + r.sapoNote));
    if (r.cancelledAt) { card.append(el('p', 'muted small', 'Lý do huỷ: ' + (r.cancelReason || ''))); return card; }
    const o = opts || {};
    if (!o.canReceive) return card;
    const tools = el('div', 'pur-inline'), err = errorBox();
    const setSapo = (status, extra) => body => run(body.button, err, () => api(`/supplier-receipts/${encodeURIComponent(r.id)}/sapo`, 'PUT', { status, ...extra(body) }), 'Đã cập nhật nhập kho Sapo.');
    if (r.sapoStatus !== 'done') {
      tools.append(
        btn('Đã nhập Sapo…', 'btn primary small', () => inlineForm(card, 'Mã phiếu nhập kho trên Sapo', 'VD: PN00123', 'Lưu', setSapo('done', b => ({ code: b.value })))),
        btn('Báo lỗi Sapo…', 'btn secondary small', () => inlineForm(card, 'Lỗi khi nhập Sapo (giữ phiếu để xử lý tiếp)', 'Mô tả lỗi', 'Lưu', setSapo('failed', b => ({ note: b.value })))),
      );
      if (r.sapoStatus !== 'not_needed') tools.append(btn('Không cần nhập', 'btn secondary small', e => run(e.currentTarget, err, () => api(`/supplier-receipts/${encodeURIComponent(r.id)}/sapo`, 'PUT', { status: 'not_needed', note: '' }))));
      else tools.append(btn('Chuyển lại chờ nhập', 'btn secondary small', e => run(e.currentTarget, err, () => api(`/supplier-receipts/${encodeURIComponent(r.id)}/sapo`, 'PUT', { status: 'pending' }))));
    }
    if (o.isManager) {
      if (r.sapoStatus === 'done') tools.append(btn('Mở lại (nhập nhầm)', 'btn secondary small', async e => {
        if (!await confirmBox(`Mở lại phiếu ${r.receiptNo}? Chỉ làm khi đã huỷ phiếu nhập ${r.sapoReceiptCode} trên Sapo, tránh cộng tồn hai lần.`, { title: 'Mở lại nhập Sapo', ok: 'Mở lại', danger: true })) return;
        run(e.target, err, () => api(`/supplier-receipts/${encodeURIComponent(r.id)}/sapo`, 'PUT', { status: 'pending', note: 'Manager mở lại' }));
      }));
      else tools.append(btn('Huỷ phiếu…', 'btn secondary small danger-text', () => inlineForm(card, 'Lý do huỷ phiếu nhận', 'VD: đếm nhầm', 'Huỷ phiếu', b => run(b.button, err, () => api(`/supplier-receipts/${encodeURIComponent(r.id)}/cancel`, 'POST', { reason: b.value }), 'Đã huỷ phiếu nhận.'))));
    }
    card.append(tools, err);
    return card;
  }
  /** Ô nhập một dòng ngay trong thẻ (mã Sapo, lý do huỷ…). */
  function inlineForm(host, label, placeholder, okText, submit) {
    host.querySelector('.pur-inline-form')?.remove();
    const f = el('form', 'pur-inline-form'), i = input('text', '', { placeholder, maxLength: 500, required: true });
    const ok = el('button', 'btn primary small', okText); ok.type = 'submit';
    f.append(field(label, i), ok, btn('Thôi', 'btn secondary small', () => f.remove()));
    f.addEventListener('submit', e => { e.preventDefault(); if (i.value.trim()) submit({ value: i.value.trim(), button: ok }); });
    host.append(f); i.focus();
  }
  function paymentRow(p) {
    const row = el('div', 'pur-card' + (p.voidedAt ? ' is-off' : ''));
    const top = el('div', 'pur-card-head');
    top.append(el('b', '', `${money(p.amount)} · ${dmy(p.paidDate)}`), el('span', 'sup-pill ' + (p.voidedAt ? '' : 'ok'), p.voidedAt ? 'Đã huỷ' : { transfer: 'Chuyển khoản', cash: 'Tiền mặt', other: 'Khác' }[p.method] || p.method));
    row.append(top, el('small', 'muted', [p.by, p.reference && 'CT ' + p.reference, p.note].filter(Boolean).join(' · ')));
    if (p.voidedAt) row.append(el('small', 'muted', 'Lý do huỷ: ' + (p.voidReason || '')));
    const tools = el('div', 'pur-inline'), err = errorBox();
    if (p.hasAttachment) tools.append(btn('Xem chứng từ', 'btn secondary small', async e => {
      try { e.target.disabled = true; const r = await api(`/supplier-payments/${encodeURIComponent(p.id)}/attachment`); window.open(r.url, '_blank', 'noopener'); }
      catch (x) { toast(x.message, 'err'); } finally { e.target.disabled = false; }
    }));
    if (!p.voidedAt && opts?.isManager) tools.append(btn('Huỷ khoản trả…', 'btn secondary small danger-text', () => inlineForm(row, 'Lý do huỷ khoản trả', 'VD: nhập sai số tiền', 'Huỷ khoản trả', b => run(b.button, err, () => api(`/supplier-payments/${encodeURIComponent(p.id)}/void`, 'POST', { reason: b.value }), 'Đã huỷ khoản trả.'))));
    if (tools.children.length) row.append(tools, err);
    return row;
  }

  // ---------------------------------------------------------------- thao tác
  const back = () => renderDetail();
  /**
   * Soạn email cho NCC bằng ứng dụng email của máy (mailto – chưa có dịch vụ gửi mail phía máy chủ):
   *  - 'order': tải PDF đơn đặt hàng về máy rồi mở email tới người nhận đơn + CC (đính kèm file PDF vừa tải);
   *  - 'stock': hỏi NCC còn hàng / ngày giao cho các mã còn thiếu (không kèm giá).
   * Máy chủ trả email người nhận theo danh bạ NCC và ghi vào lịch sử đơn.
   */
  async function mailSupplier(kind) {
    const v = current;
    try {
      if (kind === 'order') { const { downloadPurchasePdf } = await import('./purchase-pdf.js'); await downloadPurchasePdf(v); }
      const r = await api(`/purchase-orders/${encodeURIComponent(v.id)}/mail`, 'POST', { kind });
      const lines = v.lines.filter(l => kind === 'order' || l.missing > 0);
      const list = lines.slice(0, 40).map((l, i) => `${i + 1}. ${l.sku} - ${l.name}: ${num(kind === 'order' ? l.quantity : l.missing)} ${l.unit || ''}`.trim()).join('\n') + (lines.length > 40 ? `\n... và ${lines.length - 40} mã khác (xem file đính kèm)` : '');
      const subject = kind === 'order' ? `Đơn đặt hàng ${v.ticketNumber} – Bách Ngân` : `Hỏi tồn kho – ${v.ticketNumber} – Bách Ngân`;
      const text = kind === 'order'
        ? `Kính gửi ${v.supplier?.name || 'Quý nhà cung cấp'},\n\nBách Ngân gửi đơn đặt hàng ${v.ticketNumber} (file PDF đính kèm)${v.arrivalDate ? `, đề nghị giao trước ngày ${dmy(v.arrivalDate)}` : ''}:\n${list}\n\nĐề nghị Quý NCC xác nhận đơn hàng, ngày giao và số đơn nội bộ (nếu có).\n\nTrân trọng.`
        : `Kính gửi ${v.supplier?.name || 'Quý nhà cung cấp'},\n\nBách Ngân cần hỏi tồn kho và thời gian giao các mã sau:\n${list}\n\nNhờ Quý NCC phản hồi số lượng còn và ngày giao dự kiến.\n\nTrân trọng.`;
      const href = `mailto:${encodeURIComponent(r.to)}?` + new URLSearchParams({ ...(r.cc.length ? { cc: r.cc.join(',') } : {}), subject, body: text }).toString().replace(/\+/g, '%20');
      const a = document.createElement('a'); a.href = href; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove();
      toast(kind === 'order' ? 'Đã tải PDF và mở email gửi NCC – nhớ đính kèm file PDF vừa tải.' : 'Đã mở email hỏi tồn NCC.');
      openDetail(v.id); // cập nhật lịch sử
    } catch (e) { toast(e.message || 'Không soạn được email.', 'err'); }
  }
  const ACTIONS = {
    edit: () => editForm(),
    approve: () => paymentForm('approve'),
    schedule: () => paymentForm('schedule'),
    confirm: () => confirmForm(),
    receive: () => receiveForm(),
    pay: () => payForm(),
    pdf: async () => {
      try { const { downloadPurchasePdf } = await import('./purchase-pdf.js'); await downloadPurchasePdf(current); }
      catch (e) { toast(e.message || 'Không tạo được PDF.', 'err'); }
    },
    cancel: () => {
      const d = frame('Huỷ đơn mua', current.ticketNumber, back), f = el('form', 'sup-form'), err = errorBox();
      const reason = el('textarea'); reason.rows = 3; reason.maxLength = 500; reason.required = true;
      const ok = el('button', 'btn danger-outline', 'Huỷ đơn mua'); ok.type = 'submit';
      f.append(el('p', 'muted', 'Đơn đã nhận hàng hoặc đã trả tiền không huỷ được. Huỷ xong, số lượng đã đặt được trả lại cho chứng từ nguồn.'), field('Lý do huỷ *', reason), err, foot(ok));
      f.addEventListener('submit', e => { e.preventDefault(); run(ok, err, () => api(`/purchase-orders/${encodeURIComponent(current.id)}/cancel`, 'POST', { reason: reason.value, revision: current.revision }), 'Đã huỷ đơn mua.'); });
      d.append(f); reason.focus();
    },
  };
  const foot = (...buttons) => { const f = el('div', 'sup-drawer-foot'); f.append(...buttons); return f; };
  const qtyInput = (value, max) => { const i = input('number', value, { min: '0', step: '1', className: 'pur-qty' }); if (max != null) i.max = String(max); return i; };

  async function editForm() {
    const o = await options();
    const d = frame('Sửa đơn nháp', current.ticketNumber, back), f = el('form', 'sup-form'), err = errorBox();
    const sup = supplierSelect(o.suppliers, current.supplier?.id);
    const arrival = input('date', current.arrivalDate || ''), wh = input('text', current.warehouse || '', { maxLength: 120 }), note = el('textarea'); note.rows = 2; note.value = current.note || '';
    const grid = el('div', 'form-grid two'); grid.append(field('Nhà cung cấp', sup), field('Hẹn giao (dự kiến)', arrival), field('Kho nhận', wh), field('Ghi chú', note, 'span-2'));
    const t = el('table', 'data-table pur-lines'), tb = el('tbody');
    t.append(el('thead'), tb); const th = el('tr'); for (const h of ['Mã / tên', 'Từ chứng từ', 'SL đặt', '']) th.append(el('th', '', h)); t.tHead.append(th);
    const lines = current.lines.map(l => ({ ...l }));
    for (const l of lines) {
      const tr = el('tr'), qty = qtyInput(l.quantity); qty.addEventListener('input', () => { l.quantity = Number(qty.value); });
      const nm = el('td'); nm.append(el('b', '', l.sku), el('small', 'sup-sub', l.name));
      tr.append(nm, el('td', 'small', l.sources.map(s => `${s.no}: ${num(s.quantity)}`).join(', ') || '—'), el('td', '', ''), el('td', '', ''));
      tr.children[2].append(qty);
      tr.children[3].append(btn('×', 'icon-btn', () => { l.removed = true; tr.remove(); }));
      tb.append(tr);
    }
    const tw = el('div', 'table-wrap'); tw.append(t);
    const ok = el('button', 'btn primary', 'Lưu nháp'); ok.type = 'submit';
    f.append(grid, el('p', 'muted small', 'Giảm số lượng dưới phần lấy từ chứng từ sẽ bớt phần liên kết (từ chứng từ cuối) để không giữ chỗ thừa.'), tw, err, foot(ok));
    f.addEventListener('submit', e => {
      e.preventDefault();
      const body = { revision: current.revision, supplierId: sup.value, arrivalDate: arrival.value, warehouse: wh.value, note: note.value,
        lines: lines.filter(l => !l.removed).map(l => {
          let left = Math.max(0, Math.floor(l.quantity) || 0);
          const sources = l.sources.map(s => { const q = Math.min(s.quantity, left); left -= q; return { type: s.type, id: s.id, quantity: q }; }).filter(s => s.quantity > 0);
          return { sku: l.sku, name: l.name, unit: l.unit, quantity: Math.floor(l.quantity) || 0, sources };
        }) };
      run(ok, err, () => api('/purchase-orders/' + encodeURIComponent(current.id), 'PUT', body), 'Đã lưu đơn nháp.');
    });
    d.append(f);
  }
  function supplierSelect(list, value) {
    const s = el('select'); const o0 = el('option', '', '— Chọn nhà cung cấp —'); o0.value = ''; s.append(o0);
    for (const x of list) { const o = el('option', '', x.name); o.value = x.id; s.append(o); }
    s.value = value || ''; return s;
  }

  /** Duyệt (giá + lịch trả) hoặc chỉ sửa lịch trả. */
  async function paymentForm(mode) {
    const v = current, approve = mode === 'approve';
    const d = frame(approve ? 'Manager duyệt đơn' : 'Lịch trả NCC', v.ticketNumber, back), f = el('form', 'sup-form'), err = errorBox();
    const price = new Map();
    if (approve) {
      const t = el('table', 'data-table pur-lines'), tb = el('tbody'), th = el('tr');
      for (const h of ['Mã / tên', 'SL', 'Giá mua *', 'CK %', 'VAT %']) th.append(el('th', '', h));
      t.append(el('thead'), tb); t.tHead.append(th);
      for (const l of v.lines) {
        const p = input('number', l.price ?? '', { min: '0', step: 'any', required: true, className: 'pur-money' }), dc = input('number', l.purchaseDiscount ?? 0, { min: '0', max: '100', step: 'any', className: 'pur-qty' }), tx = input('number', l.taxRate ?? 8, { min: '0', max: '100', step: 'any', className: 'pur-qty' });
        price.set(l.id, { l, p, dc, tx });
        const tr = el('tr'), nm = el('td'); nm.append(el('b', '', l.sku), el('small', 'sup-sub', l.name));
        const cells = [p, dc, tx].map(i => { const td = el('td'); td.append(i); return td; });
        tr.append(nm, el('td', 'num', num(l.quantity)), ...cells); tb.append(tr);
        [p, dc, tx].forEach(i => i.addEventListener('input', recalc));
      }
      const tw = el('div', 'table-wrap'); tw.append(t); f.append(tw);
      const hint = el('p', 'muted small'); f.append(hint);
      prefillCosts(price, hint).then(() => recalc());
    }
    const totalEl = el('p', 'pur-total');
    const total = () => approve ? [...price.values()].reduce((s, { l, p, dc, tx }) => { const line = Number(p.value || 0) * (100 - Number(dc.value || 0)) / 100 * l.quantity; return s + line + line * Number(tx.value || 0) / 100; }, 0) : (v.totals?.total || 0);
    // Cọc / đợt trả / hạn phần còn lại
    const pay = el('section', 'sup-section'); pay.append(el('h3', '', 'Điều khoản thanh toán'));
    const mode0 = el('select'); for (const [k, t] of [['none', 'Không cọc'], ['percent', 'Cọc theo %'], ['amount', 'Cọc số tiền']]) { const o = el('option', '', t); o.value = k; mode0.append(o); }
    const dep = v.schedules.find(s => s.kind === 'deposit');
    mode0.value = dep ? 'amount' : 'none';
    const depVal = input('number', dep?.amount ?? '', { min: '0', step: 'any' }), depDue = input('date', dep?.dueDate || '');
    const g = el('div', 'form-grid two pur-pay'); g.append(field('Cọc', mode0), field('Giá trị cọc', depVal), field('Hạn cọc', depDue));
    const bal = v.schedules.find(s => s.kind === 'balance'), balDue = input('date', bal?.dueDate || ''); g.append(field('Hạn trả phần còn lại', balDue));
    const inst = el('div', 'pur-installments');
    const addInst = (s = {}) => { const r = el('div', 'pur-inst'), a = input('number', s.amount ?? '', { min: '0', step: 'any', placeholder: 'Số tiền' }), dd = input('date', s.dueDate || ''); a.addEventListener('input', recalc); r.append(a, dd, btn('×', 'icon-btn', () => { r.remove(); recalc(); })); inst.append(r); };
    v.schedules.filter(s => s.kind === 'installment').forEach(addInst);
    pay.append(g, el('h4', '', 'Trả nhiều đợt (tuỳ chọn)'), inst, btn('+ Thêm đợt trả', 'btn secondary small', () => addInst()));
    const toggle = () => { depVal.disabled = depDue.disabled = mode0.value === 'none'; recalc(); };
    mode0.addEventListener('change', toggle); depVal.addEventListener('input', recalc);
    function recalc() {
      const t = total(), deposit = mode0.value === 'percent' ? t * Number(depVal.value || 0) / 100 : mode0.value === 'amount' ? Number(depVal.value || 0) : 0;
      const parts = [...inst.querySelectorAll('.pur-inst input[type=number]')].reduce((s, i) => s + Number(i.value || 0), 0);
      totalEl.textContent = `Tổng (ước tính) ${money(t)} · cọc ${money(deposit)} · các đợt ${money(parts)} · còn lại ${money(Math.max(0, t - deposit - parts))}`;
    }
    f.append(totalEl, pay);
    let to, cc;
    if (approve) {
      const r = el('section', 'sup-section'); r.append(el('h3', '', 'Gửi đơn tới NCC'), el('p', 'muted small', 'Để trống: dùng email "Nhận đơn" / "CC" trong danh bạ NCC.'));
      to = input('email', '', { placeholder: 'email nhận đơn', maxLength: 254 }); cc = input('text', '', { placeholder: 'CC, cách nhau dấu phẩy', maxLength: 2000 });
      const gg = el('div', 'form-grid two'); gg.append(field('Gửi tới', to), field('CC', cc)); r.append(gg); f.append(r);
    }
    const ok = el('button', 'btn primary', approve ? 'Duyệt đơn' : 'Lưu lịch trả'); ok.type = 'submit';
    f.append(err, foot(ok)); toggle();
    f.addEventListener('submit', e => {
      e.preventDefault();
      const payment = { deposit: { mode: mode0.value, value: Number(depVal.value || 0), dueDate: depDue.value || undefined },
        installments: [...inst.querySelectorAll('.pur-inst')].map(r => ({ amount: Number(r.querySelector('input[type=number]').value || 0), dueDate: r.querySelector('input[type=date]').value || undefined })).filter(x => x.amount > 0),
        balanceDueDate: balDue.value || undefined };
      if (!approve) return run(ok, err, () => api(`/purchase-orders/${encodeURIComponent(v.id)}/schedules`, 'PUT', { payment }), 'Đã lưu lịch trả.');
      const lines = [...price.values()].map(({ l, p, dc, tx }) => ({ lineId: l.id, price: p.value === '' ? null : Number(p.value), purchaseDiscount: Number(dc.value || 0), taxRate: Number(tx.value || 0) }));
      run(ok, err, () => api(`/purchase-orders/${encodeURIComponent(v.id)}/approve`, 'POST', { revision: v.revision, lines, payment,
        ...(to.value.trim() ? { supplierEmail: to.value.trim() } : {}), ...(cc.value.trim() ? { cc: cc.value.split(',').map(s => s.trim()).filter(Boolean) } : {}) }), 'Đã duyệt đơn mua.');
    });
    d.append(f);
  }

  /**
   * Gợi ý giá cho dòng chưa có giá – cùng quy tắc "Cập nhật CK mua vào" ở báo giá:
   * Giá mua = giá niêm yết (bảng giá đang chọn ở trang báo giá, quy về chưa thuế) và CK % theo thương hiệu
   * (Healthy Cook 15, Lys 19, Lock&Lock 58, Minh Long 25) → giá nhập = giá niêm yết × (1 − CK). Manager vẫn sửa được trước khi duyệt.
   */
  async function prefillCosts(price, hint) {
    const empty = [...price.values()].filter(x => x.l.price == null);
    if (!empty.length) return;
    hint.textContent = 'Đang lấy giá niêm yết…';
    try {
      const { defaultCostDiscount, netPrice } = await import('./quote-math.js');
      const skus = [...new Set(empty.map(x => x.l.sku).filter(Boolean))];
      const { products = [], policies = [] } = await api('/products?skus=' + encodeURIComponent(skus.join(',')));
      let pref = ''; try { pref = localStorage.getItem('bn-price-policy') || ''; } catch { /* bỏ qua */ }
      const policy = policies.find(p => p.id === pref) || policies[0];
      const bySku = new Map(products.map(p => [String(p.sku), p])), missing = [];
      for (const { l, p, dc, tx } of empty) {
        const prod = bySku.get(String(l.sku));
        const raw = prod?.prices?.find(x => x.policyId === policy?.id)?.price, disc = defaultCostDiscount(prod || l);
        if (!prod || !Number.isFinite(raw) || disc === null) { missing.push(l.sku); continue; }
        const tax = prod.taxable ? (Number.isFinite(prod.taxIn) ? prod.taxIn : Number.isFinite(prod.taxOut) ? prod.taxOut : 8) : 0;
        const included = /VAT/i.test(policy?.name || '') || prod.taxBasis === 'Giá đã bao gồm thuế';
        if (p.value === '') p.value = String(Math.round(netPrice(raw, prod.taxable ? (prod.taxOut ?? 0) : 0, included)));
        if (!Number(dc.value)) dc.value = String(disc);
        if (l.taxRate == null) tx.value = String(tax);
      }
      hint.textContent = `Đã điền sẵn giá niêm yết${policy ? ` (${policy.name})` : ''} + CK mua vào theo thương hiệu, kiểm tra lại rồi bấm Duyệt.`
        + (missing.length ? ` Chưa xác định được: ${missing.join(', ')} – nhập tay.` : '');
    } catch { hint.textContent = 'Không lấy được giá niêm yết – nhập giá mua tay.'; }
  }

  function confirmForm() {
    const v = current, d = frame('Ghi nhận thay NCC', v.ticketNumber, back), f = el('form', 'sup-form'), err = errorBox();
    f.append(el('p', 'muted', 'Dùng khi NCC xác nhận qua điện thoại / email (chưa có cổng NCC). Lịch sử ghi rõ Manager ghi nhận thay.'));
    const arrival = input('date', v.arrivalDate || ''), internal = input('text', v.internalNo || '', { maxLength: 100 }), note = input('text', '', { maxLength: 300, placeholder: 'VD: chị Hoa xác nhận qua Zalo' });
    const g = el('div', 'form-grid two'); g.append(field('Ngày hẹn giao', arrival), field('Số đơn phía NCC', internal), field('Ghi chú', note, 'span-2'));
    const t = el('table', 'data-table pur-lines'), tb = el('tbody'), th = el('tr'); for (const h of ['Mã / tên', 'SL', 'Hẹn riêng', 'Ghi chú NCC']) th.append(el('th', '', h));
    t.append(el('thead'), tb); t.tHead.append(th);
    const ins = v.lines.map(l => {
      const pd = input('date', l.promisedDate || ''), nt = input('text', l.supplierNote || '', { maxLength: 500 });
      const tr = el('tr'), nm = el('td'); nm.append(el('b', '', l.sku), el('small', 'sup-sub', l.name));
      const a = el('td'), b = el('td'); a.append(pd); b.append(nt); tr.append(nm, el('td', 'num', num(l.quantity)), a, b); tb.append(tr);
      return { l, pd, nt };
    });
    const tw = el('div', 'table-wrap'); tw.append(t);
    const ok = el('button', 'btn primary', 'Ghi nhận'); ok.type = 'submit';
    f.append(g, tw, err, foot(ok));
    f.addEventListener('submit', e => {
      e.preventDefault();
      run(ok, err, () => api(`/purchase-orders/${encodeURIComponent(v.id)}/confirm`, 'POST', { revision: v.revision, arrivalDate: arrival.value || undefined, internalNo: internal.value, note: note.value,
        lines: ins.map(x => ({ lineId: x.l.id, promisedDate: x.pd.value, note: x.nt.value })) }), 'Đã ghi nhận NCC xác nhận.');
    });
    d.append(f);
  }

  function receiveForm() {
    const v = current, clientKey = key(); // một lần mở hộp nhận = một mã: bấm lặp / mạng chập chờn không tạo phiếu thứ hai
    const d = frame('Nhận hàng', v.ticketNumber, back), f = el('form', 'sup-form'), err = errorBox();
    const date = input('date', today(), { max: today() }), wh = input('text', v.warehouse || '', { maxLength: 120 }), note = input('text', '', { maxLength: 1000 });
    const g = el('div', 'form-grid two'); g.append(field('Ngày nhận', date), field('Kho nhận', wh), field('Ghi chú', note, 'span-2'));
    const t = el('table', 'data-table pur-lines'), tb = el('tbody'), th = el('tr'); for (const h of ['Mã / tên', 'Còn thiếu', 'Đạt', 'Hỏng', 'Ghi chú']) th.append(el('th', '', h));
    t.append(el('thead'), tb); t.tHead.append(th);
    const ins = v.lines.filter(l => l.missing > 0).map(l => {
      const good = qtyInput('', l.missing), bad = qtyInput(''), nt = input('text', '', { maxLength: 300 });
      const tr = el('tr'), nm = el('td'); nm.append(el('b', '', l.sku), el('small', 'sup-sub', l.name));
      const cells = [good, bad, nt].map(i => { const td = el('td'); td.append(i); return td; });
      tr.append(nm, el('td', 'num', num(l.missing)), ...cells); tb.append(tr);
      return { l, good, bad, nt };
    });
    const tw = el('div', 'table-wrap'); tw.append(t);
    const fill = btn('Điền đủ số còn thiếu', 'btn secondary small', () => ins.forEach(x => { x.good.value = String(x.l.missing); }));
    const ok = el('button', 'btn primary', 'Ghi nhận phiếu nhận'); ok.type = 'submit';
    f.append(g, el('p', 'muted small', 'Hàng hỏng không tính vào số đã nhận, vẫn còn thiếu để NCC giao bù. Sau khi lưu, nhập phiếu trên Sapo rồi ghi mã Sapo vào phiếu.'), fill, tw, err, foot(ok));
    f.addEventListener('submit', e => {
      e.preventDefault();
      const lines = ins.map(x => ({ lineId: x.l.id, goodQty: Number(x.good.value || 0), damagedQty: Number(x.bad.value || 0), note: x.nt.value })).filter(x => x.goodQty > 0 || x.damagedQty > 0);
      run(ok, err, () => api(`/purchase-orders/${encodeURIComponent(v.id)}/receipts`, 'POST', { clientKey, receivedDate: date.value, warehouse: wh.value, note: note.value, lines }), 'Đã ghi nhận hàng về – nhớ nhập kho trên Sapo.');
    });
    d.append(f);
  }

  function payForm() {
    const v = current, clientKey = key();
    const d = frame('Ghi trả NCC', v.ticketNumber, back), f = el('form', 'sup-form'), err = errorBox();
    const amount = input('number', v.debt?.nextDueAmount || v.debt?.balance || '', { min: '1', step: '1', required: true });
    const date = input('date', today(), { max: today() }), method = el('select');
    for (const [k, t] of [['transfer', 'Chuyển khoản'], ['cash', 'Tiền mặt'], ['other', 'Khác']]) { const o = el('option', '', t); o.value = k; method.append(o); }
    const ref = input('text', '', { maxLength: 120, placeholder: 'Số UNC / phiếu chi' }), note = input('text', '', { maxLength: 1000 });
    const file = input('file', ''); file.accept = 'image/jpeg,image/png,image/webp,application/pdf';
    const g = el('div', 'form-grid two'); g.append(field('Số tiền *', amount), field('Ngày trả', date), field('Hình thức', method), field('Số chứng từ', ref), field('Ghi chú', note, 'span-2'), field('Chứng từ (ảnh / PDF ≤ 6 MB)', file, 'span-2'));
    const ok = el('button', 'btn primary', 'Ghi khoản trả'); ok.type = 'submit';
    f.append(el('p', 'muted', `Còn nợ ${money(v.debt?.balance)}` + (v.debt?.nextDueDate ? ` · kỳ tới ${money(v.debt.nextDueAmount)} hạn ${dmy(v.debt.nextDueDate)}` : '')), g, err, foot(ok));
    f.addEventListener('submit', e => {
      e.preventDefault();
      run(ok, err, async () => {
        let attachment;
        const fl = file.files?.[0];
        if (fl) {
          if (fl.size > 6 * 1024 * 1024) throw new Error('Chứng từ tối đa 6 MB.');
          const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Không đọc được file.')); r.readAsDataURL(fl); });
          attachment = { name: fl.name, mime: fl.type, data };
        }
        return api(`/purchase-orders/${encodeURIComponent(v.id)}/payments`, 'POST', { clientKey, amount: Number(amount.value), paidDate: date.value, method: method.value, reference: ref.value, note: note.value, attachment });
      }, 'Đã ghi khoản trả NCC.');
    });
    d.append(f); amount.focus();
  }

  // ---------------------------------------------------------------- lập đơn (từ chứng từ, chia nhiều NCC)
  async function openCreate(src) {
    let o;
    try { o = await options(); } catch (e) { toast(e.message, 'err'); return; }
    const d = frame('Lập đơn mua', 'Đơn mua mới'), f = el('form', 'sup-form pur-create'), err = errorBox();
    /** rows: một dòng / (chứng từ, mã) hoặc mã nhập tay; qty theo từng NCC đã chọn. */
    const rows = [], sups = [], loaded = new Set();
    const srcBox = el('section', 'sup-section');
    const q = input('search', '', { placeholder: 'Tìm số báo giá, đơn / HĐKT, tên khách…' }), results = el('div', 'pur-results');
    srcBox.append(el('h3', '', '1. Chọn chứng từ nguồn'), el('p', 'muted small', 'Số lượng cần mua được gợi ý từ số chứng từ cần, số đã đặt ở đơn mua chưa huỷ và tồn kho.'), field('Tìm chứng từ', q), results);
    let t2 = 0, rq = 0;
    const search = async () => {
      const id = ++rq;
      try {
        const r = await api('/purchase-sources?q=' + encodeURIComponent(q.value.trim())); if (id !== rq) return;
        results.replaceChildren();
        if (!r.sources.length) results.append(el('p', 'muted small', 'Không thấy chứng từ phù hợp.'));
        for (const s of r.sources) {
          const b = btn('', 'pur-result', () => addSource(s.type, s.id));
          b.append(el('span', 'sup-pill info', SOURCE_LABEL[s.type]), el('b', '', s.no), el('small', 'muted', s.customerName || ''));
          if (loaded.has(s.type + ':' + s.id)) { b.disabled = true; b.classList.add('is-added'); b.append(el('span', 'pur-added', '✓ Đã thêm')); }
          results.append(b);
        }
      } catch (e) { results.replaceChildren(el('p', 'error', e.message)); }
    };
    q.addEventListener('input', () => { clearTimeout(t2); t2 = setTimeout(search, 250); });
    const supBox = el('section', 'sup-section');
    let pick = supplierSelect(o.suppliers, '');
    supBox.append(el('h3', '', '2. Chọn nhà cung cấp (có thể chia nhiều NCC)'), el('div', 'pur-inline'));
    supBox.lastChild.append(pick, btn('+ Thêm NCC vào đơn', 'btn secondary small', () => {
      if (!pick.value || sups.some(s => s.id === pick.value)) return;
      if (sups.length >= 6) { toast('Tối đa 6 nhà cung cấp mỗi lần lập.', 'err'); return; }
      sups.push({ id: pick.value, name: pick.selectedOptions[0].textContent });
      pick.value = ''; renderGrid();
    }));
    // Tạo NCC mới (Manager / Kế toán): mở trang Nhà cung cấp ở tab mới; quay lại tab này thì danh sách NCC tự cập nhật.
    if (o.canEditSuppliers) {
      supBox.lastChild.append(btn('＋ Tạo NCC mới', 'btn ghost small', () => window.open(location.pathname + '#/suppliers?new=1', '_blank')));
      const refreshSuppliers = async () => {
        if (!f.isConnected) { window.removeEventListener('focus', refreshSuppliers); return; }
        try { opts = null; const fresh = await options(); const keep = pick.value; const next = supplierSelect(fresh.suppliers, keep); pick.replaceWith(next); pick = next; noSup.hidden = fresh.suppliers.length > 0; }
        catch { /* giữ danh sách cũ */ }
      };
      window.addEventListener('focus', refreshSuppliers);
    }
    const noSup = el('p', 'muted small', o.canEditSuppliers ? 'Chưa có nhà cung cấp đang hoạt động – bấm "＋ Tạo NCC mới".' : 'Chưa có nhà cung cấp đang hoạt động – Manager / Kế toán thêm ở trang Nhà cung cấp.');
    noSup.hidden = o.suppliers.length > 0; supBox.append(noSup);
    const gridBox = el('section', 'sup-section');
    const manual = el('div', 'pur-inline pur-manual');
    const mSku = input('text', '', { placeholder: 'Mã hàng (SKU)', maxLength: 200 }), mName = input('text', '', { placeholder: 'Tên hàng', maxLength: 300 }), mUnit = input('text', '', { placeholder: 'ĐVT', maxLength: 40, className: 'pur-qty' }), mQty = qtyInput('');
    const addManual = btn('+ Thêm mã ngoài chứng từ', 'btn secondary small', () => {
      const sku = mSku.value.trim(), qty = Math.floor(Number(mQty.value));
      if (!sku || !(qty > 0)) { toast('Nhập mã hàng và số lượng.', 'err'); return; }
      rows.push({ sku, name: mName.value.trim(), unit: mUnit.value.trim(), need: null, remaining: qty, stock: null, source: null, want: qty, split: {} });
      lookup.reset(); mSku.value = mName.value = mUnit.value = mQty.value = ''; renderGrid(); mSku.focus();
    });
    manual.append(mSku, mName, mUnit, mQty, addManual);
    const lookup = bindManualProductLookup({ api, sku: mSku, name: mName, unit: mUnit, host: manual, add: addManual, active: () => f.isConnected && !drawer.hidden });
    disposeLookup = () => lookup.dispose();
    const table = el('div', 'table-wrap');
    gridBox.append(el('h3', '', '3. Chia số lượng cho từng NCC'), table, el('h4', '', 'Mã ngoài chứng từ (hàng dự trữ…)'), manual);
    const arrival = input('date', ''), wh = input('text', '', { maxLength: 120 }), note = el('textarea'); note.rows = 2; note.maxLength = 2000;
    const g = el('div', 'form-grid two'); g.append(field('Hẹn giao dự kiến', arrival), field('Kho nhận', wh), field('Ghi chú cho các đơn', note, 'span-2'));
    const ok = el('button', 'btn primary', 'Tạo đơn nháp'); ok.type = 'submit';
    f.append(srcBox, supBox, gridBox, g, el('p', 'muted small', o.canSeePrices ? 'Giá mua nhập ở bước duyệt.' : 'Giá mua do Manager nhập khi duyệt.'), err, foot(ok));
    d.append(f);

    async function addSource(type, id) {
      if (loaded.has(type + ':' + id)) return;
      try {
        const r = await api(`/purchase-sources/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
        loaded.add(type + ':' + id);
        const open = r.lines.filter(l => l.remaining > 0);
        if (!open.length) toast(`${r.source.no}: các mã đã đặt đủ.`);
        // SL cần đặt điền sẵn = còn cần đặt − tồn kho (chưa đặt gì thì = SL trong đơn − tồn kho); mã chưa có số liệu tồn → đặt đủ.
        // Anh chị sửa tay được (vd. đặt cả lô ở NCC thay vì lấy một phần từ kho).
        for (const l of open) rows.push({ sku: l.sku, name: l.name, unit: l.unit, remaining: l.remaining, ordered: l.ordered, need: l.quantity, stock: l.stock, source: r.source,
          want: Math.max(0, l.remaining - Math.max(0, Math.floor(Number(l.stock) || 0))), split: {} });
        renderGrid(); search();
      } catch (e) { toast(e.message || 'Không tải được chứng từ.', 'err'); }
    }
    /** Số đặt từng NCC của một dòng: NCC đầu nhận phần còn lại của "SL cần đặt", các NCC sau nhập tay. */
    const perSupplier = r => {
      const others = sups.slice(1).map(x => Math.max(0, Math.floor(Number(r.split[x.id]) || 0)));
      return [Math.max(0, Math.floor(Number(r.want) || 0) - others.reduce((t, v) => t + v, 0)), ...others];
    };
    function renderGrid() {
      table.replaceChildren();
      if (!rows.length) { table.append(el('p', 'muted small', 'Chưa có mã nào – chọn chứng từ ở bước 1 hoặc thêm mã bên dưới.')); return; }
      const t = el('table', 'data-table pur-lines pur-grid'), th = el('tr'), tb = el('tbody');
      const heads = ['Mã / tên', 'Chứng từ', 'SL trong đơn', 'Tồn kho', sups.length === 1 ? `SL cần đặt · ${sups[0].name}` : 'SL cần đặt'];
      if (sups.length > 1) heads.push(...sups.map(x => x.name));
      for (const h of [...heads, '']) th.append(el('th', '', h));
      t.append(el('thead'), tb); t.tHead.append(th);
      rows.forEach((r, idx) => {
        const tr = el('tr'), nm = el('td'); nm.append(el('b', '', r.sku), el('small', 'sup-sub', r.name + (r.unit ? ` (${r.unit})` : '')));
        const src = el('td', 'small pur-src', r.source ? r.source.no : 'Ngoài chứng từ'); if (r.source?.customerName) src.title = r.source.customerName;
        const need = el('td', 'num', r.need == null ? '—' : num(r.need));
        // Tồn kho: đủ cho phần còn cần → xanh; có nhưng thiếu → cam; hết / âm → đỏ; chưa có số liệu → xám.
        const st = r.stock == null ? null : Number(r.stock);
        const stock = el('td', 'num pur-stock ' + (st == null ? 'none' : st >= r.remaining ? 'ok' : st > 0 ? 'warn' : 'out'), st == null ? '—' : num(st));
        const wantTd = el('td', 'pur-want'), want = qtyInput(r.want ?? ''), hint = el('small', 'sup-sub');
        wantTd.append(want, hint);
        tr.append(nm, src, need, stock, wantTd);
        const firstCell = el('td', 'num');
        if (sups.length > 1) {
          tr.append(firstCell);
          for (const x of sups.slice(1)) { const td = el('td'), i = qtyInput(r.split[x.id] || ''); i.addEventListener('input', () => { r.split[x.id] = Number(i.value) || 0; update(); }); td.append(i); tr.append(td); }
        }
        const update = () => {
          const w = Math.max(0, Math.floor(Number(r.want) || 0)), parts = perSupplier(r), others = parts.slice(1).reduce((a, v) => a + v, 0);
          const extra = r.source ? Math.max(0, w - r.remaining) : 0;
          // Đặt ít hơn "còn cần đặt" = phần thiếu lấy từ kho: báo nếu kho không đủ.
          const fromStock = r.source ? Math.max(0, r.remaining - w) : 0, short = fromStock - Math.max(0, st ?? 0);
          hint.textContent = others > w ? `Các NCC khác vượt ${num(others - w)}` : extra ? `+${num(extra)} dự trữ` : fromStock && short > 0 ? `Kho thiếu ${num(short)}` : fromStock ? `Lấy kho ${num(fromStock)}` : '';
          hint.className = 'sup-sub ' + (others > w || (fromStock && short > 0) ? 'pur-late' : extra ? 'pur-extra' : 'muted');
          firstCell.textContent = num(parts[0]);
        };
        want.addEventListener('input', () => { r.want = Number(want.value) || 0; update(); });
        const x = el('td'); x.append(btn('×', 'icon-btn', () => { rows.splice(idx, 1); renderGrid(); })); tr.append(x);
        update(); tb.append(tr);
      });
      table.append(t);
      if (!sups.length) table.append(el('p', 'muted small', 'Thêm ít nhất một nhà cung cấp ở bước 2.'));
      else if (sups.length > 1) table.append(el('p', 'muted small', `Cột ${sups[0].name} tự tính = "SL cần đặt" trừ số nhập cho các NCC còn lại.`));
    }
    f.addEventListener('submit', e => {
      e.preventDefault(); err.textContent = '';
      if (!sups.length) { err.textContent = 'Chọn ít nhất một nhà cung cấp.'; return; }
      for (const r of rows) if (perSupplier(r).slice(1).reduce((a, v) => a + v, 0) > Math.max(0, Math.floor(Number(r.want) || 0))) { err.textContent = `${r.sku}: số chia cho các NCC khác vượt "SL cần đặt".`; return; }
      const lines = sups.map(() => new Map());
      for (const r of rows) {
        // Phần lấy từ chứng từ không vượt "còn cần đặt" (chống mua trùng); phần đặt thêm tính là hàng ngoài chứng từ.
        let left = r.source ? r.remaining : 0;
        perSupplier(r).forEach((qty, i) => {
          if (qty <= 0) return;
          const k = r.sku.toLowerCase(), cur = lines[i].get(k) || { sku: r.sku, name: r.name, unit: r.unit, quantity: 0, sources: [] };
          const fromSrc = Math.min(qty, left); left -= fromSrc;
          cur.quantity += qty; if (fromSrc > 0) cur.sources.push({ type: r.source.type, id: r.source.id, quantity: fromSrc });
          lines[i].set(k, cur);
        });
      }
      const orders = sups.map((x, i) => ({ supplierId: x.id, lines: [...lines[i].values()], arrivalDate: arrival.value || undefined, warehouse: wh.value, note: note.value })).filter(x => x.lines.length);
      if (!orders.length) { err.textContent = 'Chưa có số lượng nào để đặt.'; return; }
      run(ok, err, async () => {
        const r = await api('/purchase-orders', 'POST', { orders });
        toast(`Đã tạo ${r.ids.length} đơn mua nháp – chờ Manager duyệt.`);
        go('#/purchases/' + encodeURIComponent(r.ids[0]));
      });
    });
    renderGrid();
    if (src) addSource(src.type, src.id); else search();
  }

  return { load, show, openCreate };
}
