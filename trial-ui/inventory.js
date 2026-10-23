/**
 * ĐỐI CHIẾU TỒN SAPO (#/inventory; trang giao dịch "Sổ kho" là #/stock-moves – stock-ops.js) – giai đoạn 1 chạy song song với Sapo (docs/SO-KHO.md).
 *  Đối chiếu tồn sổ kho ↔ tồn Sapo theo (mã, kho) · thẻ kho từng mã · Manager chốt tồn đầu kỳ / lập phiếu điều chỉnh.
 * API: src/modules/inventory/api/routes.ts. DOM dựng bằng createElement / textContent.
 */
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const btn = (text, cls = 'btn secondary small', onClick) => { const b = el('button', cls, text); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };
const input = (type, value = '', attrs = {}) => { const i = el('input'); i.type = type; i.value = value ?? ''; Object.assign(i, attrs); return i; };
const field = (label, control, cls = '') => { const l = el('label', cls); l.append(document.createTextNode(label), control); return l; };
const num = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const signed = v => (v > 0 ? '+' : '') + num(v);
const dt = iso => iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const REF_LINK = { supplier_receipt: null, packing_slip: id => '#/packing/' + encodeURIComponent(id) };

export function initInventory({ api, root, toast, confirmBox }) {
  let status = null, rows = [], req = 0, onlyDiff = true;
  const page = el('div', 'sup-page');
  const head = el('div', 'page-head'), titles = el('div');
  titles.append(el('span', 'eyebrow', 'Kho hàng'), el('h1', '', 'Đối chiếu tồn Sapo'),
    el('p', 'muted', 'Sổ kho tự ghi khi nhận hàng NCC và khi kho xác nhận đã đóng hàng. Đang chạy song song: Sapo vẫn là nguồn tồn chính – trang này so tồn sổ kho với tồn Sapo để tìm chỗ lệch.'));
  const tools = el('div', 'row-gap');
  head.append(titles, tools);
  const info = el('div', 'panel inv-status');
  const panel = el('div', 'panel'), bar = el('div', 'toolbar');
  const wh = el('select'); wh.setAttribute('aria-label', 'Kho');
  const search = input('search', '', { placeholder: 'Tìm mã / tên hàng…' }); search.setAttribute('aria-label', 'Tìm mã hàng');
  const label = el('label', 'search'); label.append(search);
  const diffBox = input('checkbox'); diffBox.checked = true;
  const diffLabel = el('label', 'inv-check'); diffLabel.append(diffBox, document.createTextNode(' Chỉ dòng lệch'));
  const countEl = el('span', 'muted small');
  bar.append(wh, label, diffLabel, countEl);
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table'), thead = el('thead'), tbody = el('tbody');
  const unopenedEl = el('div', 'inv-unopened');
  table.append(thead, tbody); wrap.append(table); panel.append(bar, unopenedEl, wrap);
  page.append(head, info, panel);
  const shade = el('div', 'sup-shade'); shade.hidden = true;
  const drawer = el('aside', 'sup-drawer'); drawer.hidden = true; drawer.setAttribute('role', 'dialog');
  root.append(page, shade, drawer);
  const close = () => { drawer.hidden = true; shade.hidden = true; };
  shade.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) close(); });
  let timer = 0;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(loadRows, 250); });
  wh.addEventListener('change', () => { if (status) renderStatus(); loadRows(); });
  diffBox.addEventListener('change', () => { onlyDiff = diffBox.checked; loadRows(); });

  function frame(eyebrow, title) {
    const top = el('div', 'sup-drawer-head'), t = el('div'); t.append(el('span', 'eyebrow', eyebrow), el('h2', '', title));
    const x = btn('×', 'icon-btn', close); x.setAttribute('aria-label', 'Đóng');
    top.append(t, x); drawer.replaceChildren(top); drawer.hidden = false; shade.hidden = false; drawer.scrollTop = 0;
    return drawer;
  }

  /** Kết quả chốt "Tất cả kho": từng kho đã chốt / bỏ qua / lỗi kèm lý do (không gộp thành một thông báo chung). */
  function openingResults(r) {
    const d = frame('Chốt tồn đầu kỳ · ' + (r.refNo || ''), 'Kết quả theo kho');
    const t = el('table', 'data-table'), th = el('tr'), tb = el('tbody'), LABEL = { opened: 'Đã chốt', skipped: 'Bỏ qua', failed: 'Chưa chốt được' };
    for (const [h, cl] of [['Kho', ''], ['Kết quả', ''], ['Số dòng', 'num'], ['Ghi chú', '']]) th.append(el('th', cl, h));
    t.append(el('thead'), tb); t.tHead.append(th);
    for (const x of r.results || []) {
      const tr = el('tr');
      tr.append(el('td', '', x.name), el('td', x.status === 'failed' ? 'pur-late' : '', LABEL[x.status] || x.status), el('td', 'num', num(x.lines)), el('td', 'small', x.message || ''));
      tb.append(tr);
    }
    const tw = el('div', 'table-wrap'); tw.append(t); d.append(tw);
  }

  function renderStatus() {
    info.replaceChildren(); tools.replaceChildren();
    const s = status, keep = wh.value;
    wh.replaceChildren();
    if (!s.warehouseRestricted) wh.append(Object.assign(el('option', '', 'Tất cả kho'), { value: '' }));
    if (s.warehouseRestricted && !s.warehouses.length) wh.append(Object.assign(el('option', '', 'Chưa có kho VIGIFTS'), { value: '' }));
    wh.disabled = s.warehouseRestricted && !s.warehouses.length;
    for (const w of s.warehouses) wh.append(Object.assign(el('option', '', w.name), { value: w.id }));
    wh.value = s.warehouses.some(w => w.id === keep) ? keep : s.defaultWarehouseId || '';
    // Trạng thái theo kho đang chọn; "Tất cả kho" liệt kê từng kho (đã chốt lúc nào, ai chốt / chưa chốt).
    const sel = s.warehouses.find(w => w.id === wh.value), opened = w => `Đã chốt tồn đầu kỳ lúc ${dt(w.openedAt)}${w.openedBy ? ' – ' + w.openedBy : ''} · ${num(w.moveCount)} dòng phát sinh.`;
    if (sel) info.append(sel.openedAt ? el('p', '', `${sel.name}: ${opened(sel)}`)
      : el('p', 'pur-late', `${sel.name} chưa chốt tồn đầu kỳ: bấm "Chốt tồn đầu kỳ" để lấy tồn Sapo hiện tại của kho này làm điểm bắt đầu cho sổ kho.`));
    else if (s.warehouses.length) {
      const ul = el('ul', 'inv-wh-status');
      for (const w of s.warehouses) ul.append(el('li', w.openedAt ? '' : 'pur-late', `${w.name}: ${w.openedAt ? opened(w) : 'chưa chốt tồn đầu kỳ.'}`));
      info.append(ul);
    }
    const unopened = s.warehouses.filter(w => !w.openedAt);
    // "Chốt lại" chỉ cho đúng một kho đã chốt đang được chọn; "Tất cả kho" chỉ chốt các kho chưa chốt.
    if (s.canManage && s.warehouses.length) {
      tools.append(btn('Phiếu điều chỉnh', 'btn secondary', () => adjustForm()));
      if (sel || unopened.length) tools.append(btn(sel?.openedAt ? 'Chốt lại tồn đầu kỳ' : 'Chốt tồn đầu kỳ', sel?.openedAt ? 'btn ghost' : 'btn primary', async () => {
        const msg = sel ? `Chốt tồn cho ${sel.name}. ` + (sel.openedAt ? 'Chỉ chốt lại được khi kho chưa có phát sinh ngoài tồn đầu kỳ. Kho đã nhập, xuất hoặc điều chỉnh phải dùng phiếu điều chỉnh để sửa lệch. Tiếp tục?'
          : 'Lấy tồn Sapo hiện tại làm tồn đầu kỳ cho kho này?')
          : `Chốt tồn đầu kỳ cho ${unopened.length} kho chưa chốt (${unopened.map(w => w.name).join(', ')}). Mỗi kho chốt riêng: kho lỗi không ảnh hưởng kho khác. Tiếp tục?`;
        if (!await confirmBox(msg, { title: 'Chốt tồn đầu kỳ', ok: 'Chốt tồn' })) return;
        try {
          const r = await api('/inventory/opening', 'POST', { confirm: true, ...(sel ? { warehouseId: sel.id } : {}) });
          if (sel) toast(`Đã chốt tồn đầu kỳ ${sel.name} (${num(r.lines)} dòng).`); else openingResults(r);
          load();
        } catch (e) { toast(e.message || 'Không chốt được.', 'err'); }
      }));
    }
    if (s.warehouseRestricted) info.append(el('p', 'muted small', 'Sổ kho của nhân viên Kho chỉ hiển thị KHO VIGIFTS.'));
  }

  function renderRows(diffCount) {
    thead.replaceChildren(); tbody.replaceChildren();
    const hr = el('tr'); for (const [h, c] of [['Mã / tên', ''], ['Kho', ''], ['Sổ kho', 'num'], ['Sapo', 'num'], ['Lệch', 'num']]) hr.append(el('th', c, h));
    thead.append(hr);
    countEl.textContent = `${num(diffCount)} dòng lệch` + (rows.length >= 500 ? ' · hiện 500 dòng đầu' : '');
    if (!rows.length) { const tr = el('tr'), td = el('td', 'muted', onlyDiff ? 'Không có dòng nào lệch với Sapo.' : 'Chưa có dữ liệu tồn.'); td.colSpan = 5; tr.append(td); tbody.append(tr); return; }
    for (const r of rows) {
      const tr = el('tr', 'clickable'); tr.tabIndex = 0;
      const nm = el('td'); nm.append(el('b', '', r.sku), el('small', 'muted sup-sub', r.name || '—'));
      tr.append(nm, el('td', '', r.warehouse), el('td', 'num', num(r.ledger)), el('td', 'num', num(r.sapo)), el('td', 'num' + (r.diff ? ' pur-late' : ''), r.diff ? signed(r.diff) : '0'));
      const open = () => openCard(r.sku, r.warehouseId, r.warehouse);
      tr.addEventListener('click', open); tr.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
      tbody.append(tr);
    }
  }
  /** Kho chưa chốt: sổ kho chưa có số để so, không đưa vào bảng lệch. */
  function renderUnopened(list) {
    unopenedEl.replaceChildren();
    for (const w of list) unopenedEl.append(el('p', 'pur-late', `${w.name} chưa chốt tồn đầu kỳ, chưa đối chiếu được.`));
  }
  async function loadRows() {
    const id = ++req;
    try {
      const d = await api('/inventory/compare?' + new URLSearchParams({ warehouseId: wh.value, q: search.value.trim(), diff: onlyDiff ? '1' : '0' }));
      if (id !== req) return; rows = d.rows; renderRows(d.diffCount); renderUnopened(d.unopened || []);
    } catch (e) { if (id === req) { rows = []; renderRows(0); renderUnopened([]); toast(e.message || 'Không tải được sổ kho.', 'err'); } }
  }
  async function load() {
    try { status = await api('/inventory/status'); renderStatus(); await loadRows(); }
    catch (e) { info.replaceChildren(el('p', 'error', e.message || 'Không tải được sổ kho.')); }
  }

  // ---------------------------------------------------------------- thẻ kho
  async function openCard(sku, warehouseId, warehouseName) {
    const d = frame('Thẻ kho · ' + warehouseName, sku);
    try {
      const c = await api('/inventory/card?' + new URLSearchParams({ sku, warehouseId }));
      d.append(el('p', 'muted', c.name + (c.unit ? ` (${c.unit})` : '')));
      const sum = el('p', 'pur-total'); sum.append(`Sổ kho ${num(c.balance)} · Sapo ${num(c.sapo)} · `, el('b', c.balance !== c.sapo ? 'pur-late' : '', 'Lệch ' + signed(c.balance - c.sapo)));
      d.append(sum);
      const t = el('table', 'data-table'), th = el('tr'), tb = el('tbody');
      for (const [h, cl] of [['Thời gian', ''], ['Chứng từ', ''], ['+/−', 'num'], ['Tồn', 'num']]) th.append(el('th', cl, h));
      t.append(el('thead'), tb); t.tHead.append(th);
      if (!c.lines.length) { const tr = el('tr'), td = el('td', 'muted', 'Chưa có phát sinh.'); td.colSpan = 4; tr.append(td); tb.append(tr); }
      for (const l of c.lines) {
        const tr = el('tr'), ref = el('td'), link = REF_LINK[l.refType];
        const no = link ? Object.assign(el('a', '', l.refNo || l.kindLabel), { href: link(l.refId) }) : el('b', '', l.refNo || '—');
        if (link) no.addEventListener('click', close);
        ref.append(el('span', 'sup-pill', l.kindLabel), ' ', no); if (l.note) ref.append(el('small', 'muted sup-sub', l.note)); if (l.by) ref.append(el('small', 'muted sup-sub', l.by));
        tr.append(el('td', '', dt(l.at)), ref, el('td', 'num' + (l.qty < 0 ? ' pur-late' : ''), signed(l.qty)), el('td', 'num', num(l.balance)));
        tb.append(tr);
      }
      const tw = el('div', 'table-wrap'); tw.append(t); d.append(tw);
      if (status?.canManage) d.append(btn('Điều chỉnh mã này…', 'btn secondary small', () => adjustForm({ warehouseId, sku, qty: c.sapo - c.balance })));
    } catch (e) { d.append(el('p', 'error', e.message || 'Không tải được thẻ kho.')); }
  }

  // ---------------------------------------------------------------- phiếu điều chỉnh (Manager)
  function adjustForm(prefill = {}) {
    const d = frame('Phiếu điều chỉnh kho', 'Điều chỉnh tồn'), f = el('form', 'sup-form'), err = el('p', 'error');
    const w = el('select'); w.required = true;
    for (const x of status.warehouses) w.append(Object.assign(el('option', '', x.name), { value: x.id }));
    if (prefill.warehouseId) w.value = prefill.warehouseId;
    const reason = input('text', '', { maxLength: 500, required: true, placeholder: 'VD: kiểm kê lệch, hàng vỡ, xuất mẫu…' });
    const g = el('div', 'form-grid two'); g.append(field('Kho', w), field('Lý do *', reason));
    const list = el('div', 'inv-adjust-lines');
    const addLine = (sku = '', qty = '') => {
      const r = el('div', 'pur-inline'), s = input('text', sku, { placeholder: 'Mã hàng (SKU)', maxLength: 200 }), q = input('number', qty, { step: 'any', placeholder: '+ tăng / − giảm', className: 'pur-qty' });
      r.append(s, q, btn('×', 'icon-btn', () => r.remove())); list.append(r);
    };
    addLine(prefill.sku || '', prefill.qty ? String(prefill.qty) : '');
    f.append(g, el('p', 'muted small', 'Số dương = tăng tồn, số âm = giảm tồn. Mỗi phiếu ghi vào sổ kho, không sửa / xoá được (lập phiếu khác nếu nhầm).'), list,
      btn('+ Thêm mã', 'btn secondary small', () => addLine()), err);
    const ok = el('button', 'btn primary', 'Ghi phiếu điều chỉnh'); ok.type = 'submit';
    const foot = el('div', 'sup-drawer-foot'); foot.append(ok); f.append(foot);
    f.addEventListener('submit', async e => {
      e.preventDefault(); err.textContent = '';
      const lines = [...list.children].map(r => { const [s, q] = r.querySelectorAll('input'); return { sku: s.value.trim(), qty: Number(q.value) }; }).filter(l => l.sku && l.qty);
      ok.disabled = true;
      try { const r = await api('/inventory/adjustments', 'POST', { warehouseId: w.value, reason: reason.value.trim(), lines }); toast(`Đã ghi phiếu ${r.refNo}.`); close(); load(); }
      catch (ex) { err.textContent = ex.message || 'Không ghi được phiếu.'; ok.disabled = false; }
    });
    d.append(f);
  }

  return { load };
}
