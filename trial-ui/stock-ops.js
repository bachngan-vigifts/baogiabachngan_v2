/**
 * KHO BÁN THEO CHỨC VỤ – giao diện (docs/SO-KHO.md):
 *  - Điều chuyển kho (#/transfers, #/transfers/<id>): xin chuyển → người duyệt duyệt / từ chối → Kho bấm "Đã chuyển".
 *  - Lịch sử xuất nhập (#/stock-moves): mọi phát sinh sổ kho, lọc Bán hàng / Nhập / Xuất / Điều chuyển / Điều chỉnh, xuất Excel.
 *  - Kho bán theo chức vụ (gắn dưới trang Phân quyền): kho ↔ chức vụ được bán + kho riêng (chỉ người bán kho đó thấy tồn).
 * API: src/modules/inventory/api/{transfer-routes,history-routes}.ts. DOM dựng bằng createElement / textContent.
 */
import { downloadExcel } from './sheet-export.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const btn = (text, cls = 'btn secondary small', onClick) => { const b = el('button', cls, text); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };
const input = (type, value = '', attrs = {}) => { const i = el('input'); i.type = type; i.value = value ?? ''; Object.assign(i, attrs); return i; };
const field = (label, control, cls = '') => { const l = el('label', cls); l.append(document.createTextNode(label), control); return l; };
const select = (options, value = '', label = '') => { const s = el('select'); if (label) s.setAttribute('aria-label', label); for (const [v, t] of options) { const o = el('option', '', t); o.value = v; s.append(o); } s.value = value; return s; };
const num = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const signed = v => (v > 0 ? '+' : '') + num(v);
const dt = iso => iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const PILL = { pending: 'warn', approved: 'blue', done: 'ok', rejected: 'danger', cancelled: '' };

/** Hộp nhập: trả chuỗi (≥ 3 ký tự) hoặc null. */
function ask(title, placeholder) {
  return new Promise(resolve => {
    const dlg = el('dialog', 'modal narrow'), form = el('form'), area = el('textarea');
    area.rows = 3; area.required = true; area.minLength = 3; area.placeholder = placeholder; area.style.width = '100%';
    const foot = el('div', 'modal-foot'), ok = el('button', 'btn primary', 'Gửi'), no = btn('Huỷ', 'btn secondary');
    foot.append(no, ok); const body = el('div', 'modal-body'); body.append(area);
    const head = el('div', 'modal-head'); head.append(el('h2', '', title));
    form.append(head, body, foot); dlg.append(form); document.body.append(dlg);
    const done = v => { dlg.close(); dlg.remove(); resolve(v); };
    form.addEventListener('submit', e => { e.preventDefault(); const v = area.value.trim(); if (v.length >= 3) done(v); else area.reportValidity(); });
    no.addEventListener('click', () => done(null)); dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    dlg.showModal(); area.focus();
  });
}

export function initTransfers({ api, root, toast, go }) {
  let data = null, filter = 'open';
  const page = el('div', 'sup-page'), head = el('div', 'page-head'), titles = el('div');
  titles.append(el('span', 'eyebrow', 'Kho hàng'), el('h1', '', 'Điều chuyển kho'),
    el('p', 'muted', 'Kho của mình thiếu hàng: xin chuyển từ kho khác. Người duyệt duyệt, Kho bấm "Đã chuyển" thì sổ kho trừ kho đi, cộng kho đến.'));
  const tools = el('div', 'row-gap'), add = btn('＋ Xin điều chuyển', 'btn primary', () => openForm());
  tools.append(add); head.append(titles, tools);
  const panel = el('div', 'panel'), bar = el('div', 'toolbar chips');
  for (const [k, t] of [['open', 'Đang mở'], ['done', 'Đã chuyển'], ['', 'Tất cả']]) {
    const c = btn(t, 'chip' + (k === filter ? ' active' : ''), () => { filter = k; bar.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c)); load(); });
    bar.append(c);
  }
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table'), tbody = el('tbody');
  const thead = el('thead'), hr = el('tr');
  for (const h of ['Số phiếu', 'Kho đi → kho đến', 'Mã / SL', 'Người xin', 'Trạng thái']) hr.append(el('th', '', h));
  thead.append(hr); table.append(thead, tbody); wrap.append(table); panel.append(bar, wrap); page.append(head, panel);
  const shade = el('div', 'sup-shade'); shade.hidden = true;
  const drawer = el('aside', 'sup-drawer'); drawer.hidden = true; drawer.setAttribute('role', 'dialog');
  root.append(page, shade, drawer);
  const close = () => { drawer.hidden = true; shade.hidden = true; if (/^#\/transfers\//.test(location.hash)) history.replaceState(null, '', '#/transfers'); };
  shade.addEventListener('click', close);

  async function load(openId) {
    tbody.replaceChildren(el('tr'));
    try { data = await api('/stock-transfers' + (filter ? '?status=' + filter : '')); }
    catch (e) { tbody.replaceChildren(); toast(e.message, 'err'); return; }
    tbody.replaceChildren(...(data.transfers.length ? data.transfers.map(t => {
      const tr = el('tr', 'clickable'); tr.tabIndex = 0;
      const no = el('td', 'first'); no.append(el('b', '', t.transferNo), el('small', '', dt(t.createdAt)));
      const pill = el('span', 'pill ' + (PILL[t.status] || ''), t.statusLabel);
      const st = el('td'); st.append(pill);
      tr.append(no, el('td', '', `${t.fromName} → ${t.toName}`), el('td', '', `${t.lineCount} mã · ${num(t.qty)}`), el('td', '', t.requestedByName), st);
      tr.addEventListener('click', () => go('#/transfers/' + t.id)); tr.addEventListener('keydown', e => { if (e.key === 'Enter') go('#/transfers/' + t.id); });
      return tr;
    }) : [(() => { const tr = el('tr'), td = el('td', 'muted', 'Chưa có phiếu điều chuyển.'); td.colSpan = 5; tr.append(td); return tr; })()]));
    if (openId) show(openId);
  }

  async function show(id) {
    let t;
    try { t = await api('/stock-transfers/' + encodeURIComponent(id)); } catch (e) { toast(e.message, 'err'); return; }
    drawer.replaceChildren();
    const h = el('div', 'sup-drawer-head'); h.append(el('h2', '', 'Phiếu ' + t.transferNo), btn('✕', 'icon-btn', close));
    const meta = el('div', 'sup-meta');
    for (const [k, v] of [['Trạng thái', t.statusLabel], ['Kho đi → kho đến', `${t.fromName} → ${t.toName}`], ['Lý do', t.reason], ['Người xin', `${t.requestedByName} · ${dt(t.createdAt)}`],
      ['Duyệt', t.approvedByName ? `${t.approvedByName} · ${dt(t.approvedAt)}` : '—'], ['Kho chuyển', t.doneByName ? `${t.doneByName} · ${dt(t.doneAt)}` : '—']])
      { const r = el('div'); r.append(el('span', 'muted', k + ': '), el('b', '', v)); meta.append(r); }
    if (t.rejectReason) meta.append(el('p', 'danger-text', 'Từ chối: ' + t.rejectReason));
    const tbl = el('table', 'data-table'), th = el('tr');
    for (const x of ['Mã', 'Tên', 'SL chuyển', 'Tồn kho đi', 'Tồn kho đến']) th.append(el('th', '', x));
    const tb = el('tbody');
    for (const l of t.lines) { const r = el('tr'); r.append(el('td', '', l.sku), el('td', '', l.name), el('td', '', num(l.qty) + ' ' + (l.unit || '')), el('td', l.fromStock < l.qty && t.status !== 'done' ? 'danger-text' : '', num(l.fromStock)), el('td', '', num(l.toStock))); tb.append(r); }
    const thd = el('thead'); thd.append(th); tbl.append(thd, tb);
    const tw = el('div', 'table-wrap'); tw.append(tbl);
    const acts = el('div', 'row-gap');
    // Đang gửi: khoá mọi nút của phiếu (chống bấm 2 lần → lỗi "phiếu đã thay đổi"), nút đang bấm hiện "Đang …".
    const run = async (path, body, msg, b, busyText) => {
      if (acts.dataset.busy) return;
      acts.dataset.busy = '1';
      const all = [...acts.querySelectorAll('button')], label = b.textContent;
      all.forEach(x => { x.disabled = true; }); b.textContent = busyText; b.className += ' is-busy'; b.setAttribute('aria-busy', 'true');
      try { await api(`/stock-transfers/${t.id}/${path}`, 'POST', { revision: t.revision, ...body }); toast(msg); await load(t.id); }
      catch (e) { toast(e.message, 'err'); }
      finally { delete acts.dataset.busy; all.forEach(x => { x.disabled = false; }); b.textContent = label; b.className = b.className.replace(' is-busy', ''); b.removeAttribute('aria-busy'); }
    };
    const act = (text, cls, busyText, fn) => { const b = btn(text, cls, () => fn(b, busyText)); acts.append(b); };
    if (t.actions.approve) act('Duyệt', 'btn ok', 'Đang duyệt…', (b, bt) => run('approve', {}, 'Đã duyệt – nhóm Kho nhận việc chuyển hàng.', b, bt));
    if (t.actions.reject) act('Từ chối…', 'btn danger-outline', 'Đang từ chối…', async (b, bt) => { if (acts.dataset.busy) return; const r = await ask('Từ chối điều chuyển', 'Lý do từ chối'); if (r) run('reject', { reason: r }, 'Đã từ chối.', b, bt); });
    if (t.actions.done) act('Đã chuyển', 'btn primary', 'Đang ghi sổ kho…', (b, bt) => run('done', {}, 'Đã ghi sổ kho: trừ kho đi, cộng kho đến.', b, bt));
    if (t.actions.cancel) act('Huỷ phiếu', 'btn ghost', 'Đang huỷ…', (b, bt) => run('cancel', {}, 'Đã huỷ phiếu.', b, bt));
    drawer.append(h, meta, tw, acts);
    drawer.hidden = false; shade.hidden = false;
  }

  async function openForm() {
    if (!data) await load();
    const whs = data?.warehouses || [];
    drawer.replaceChildren();
    const h = el('div', 'sup-drawer-head'); h.append(el('h2', '', 'Xin điều chuyển kho'), btn('✕', 'icon-btn', close));
    const opts = [['', 'Chọn kho'], ...whs.map(w => [w.id, w.name])];
    const from = select(opts, '', 'Kho đi'), to = select(opts, '', 'Kho đến');
    const reason = input('text', '', { placeholder: 'VD: đơn của khách Kim Trần Gia cần hàng ở kho VIGIFTS', maxLength: 500 });
    const lines = el('div', 'transfer-lines');
    const lineRow = (sku = '', qty = '') => {
      const r = el('div', 'row-gap'), s = input('text', sku, { placeholder: 'Mã hàng' }), q = input('number', qty, { placeholder: 'SL', min: '0', step: 'any' });
      s.setAttribute('list', 'transfer-sku-list'); r.append(s, q, btn('✕', 'icon-btn', () => r.remove())); lines.append(r);
    };
    const list = el('datalist'); list.id = 'transfer-sku-list';
    const find = input('search', '', { placeholder: 'Tìm mã / tên hàng để thêm…' });
    let timer = 0;
    find.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => {
      if (find.value.trim().length < 2) return;
      try { const r = await api('/inventory/lookup?q=' + encodeURIComponent(find.value.trim())); list.replaceChildren(...r.products.map(p => { const o = el('option'); o.value = p.sku; o.label = `${p.name} · ${p.stock.map(s => s.warehouse + ' ' + num(s.qty)).join(' · ')}`; return o; })); }
      catch { /* bỏ qua */ }
    }, 250); });
    find.setAttribute('list', 'transfer-sku-list');
    lineRow();
    const send = btn('Gửi duyệt', 'btn primary', async () => {
      const body = { fromWarehouseId: from.value, toWarehouseId: to.value, reason: reason.value,
        lines: [...lines.children].map(r => ({ sku: r.querySelector('input[type=text]').value.trim(), qty: Number(r.querySelector('input[type=number]').value) })).filter(l => l.sku) };
      send.disabled = true;
      try { const t = await api('/stock-transfers', 'POST', body); toast('Đã gửi phiếu ' + t.transferNo + ' – chờ duyệt.'); filter = 'open'; go('#/transfers/' + t.id); }
      catch (e) { toast(e.message, 'err'); } finally { send.disabled = false; }
    });
    const form = el('div', 'form-grid');
    form.append(field('Kho đi (lấy hàng)', from), field('Kho đến (cần hàng)', to), field('Lý do', reason, 'wide'), field('Tìm hàng', find, 'wide'));
    drawer.append(h, form, list, el('h3', '', 'Mã hàng cần chuyển'), lines, btn('＋ Thêm dòng', 'btn ghost small', () => lineRow()), el('div', 'row-gap'), send);
    drawer.hidden = false; shade.hidden = false;
  }

  return { load: id => load(id), show };
}

const GROUPS = [['', 'Tất cả'], ['sale', 'Bán hàng'], ['in', 'Nhập'], ['out', 'Xuất'], ['transfer', 'Điều chuyển'], ['adjust', 'Điều chỉnh / đầu kỳ']];

export function initStockMoves({ api, root, toast }) {
  let group = '', rows = [];
  const page = el('div', 'sup-page'), head = el('div', 'page-head'), titles = el('div');
  titles.append(el('span', 'eyebrow', 'Kho hàng'), el('h1', '', 'Lịch sử xuất nhập'),
    el('p', 'muted', 'Mọi phát sinh sổ kho: bán hàng (duyệt đơn / HĐKT, bán quầy), nhập NCC, đóng gói, điều chuyển, điều chỉnh. Mới nhất trước, tối đa 1000 dòng.'));
  const tools = el('div', 'row-gap');
  const exp = btn('⬇ Xuất Excel', 'btn secondary', () => downloadExcel(`lich-su-xuat-nhap-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Xuất nhập',
    header: ['Thời gian', 'Kho', 'Loại', 'Mã', 'Tên', 'Số lượng', 'ĐVT', 'Chứng từ', 'Ghi chú', 'Người làm'], autoFilter: true,
    rows: rows.map(m => [dt(m.at), m.warehouse, m.kindLabel, m.sku, m.name, m.qty, m.unit, m.refNo, m.note, m.by]) }]).catch(e => toast(e.message, 'err')));
  tools.append(exp); head.append(titles, tools);
  const panel = el('div', 'panel'), bar = el('div', 'toolbar'), chips = el('div', 'chips');
  for (const [k, t] of GROUPS) { const c = btn(t, 'chip' + (k === group ? ' active' : ''), () => { group = k; chips.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c)); load(); }); chips.append(c); }
  const wh = select([['', 'Mọi kho']], '', 'Kho'), from = input('date'), to = input('date'), q = input('search', '', { placeholder: 'Mã, tên, số chứng từ…' });
  for (const x of [wh, from, to]) x.addEventListener('change', () => load());
  let timer = 0; q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  bar.append(wh, field('Từ', from), field('Đến', to), q);
  const count = el('p', 'muted small');
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table'), tbody = el('tbody'), thead = el('thead'), hr = el('tr');
  for (const h of ['Thời gian', 'Kho', 'Loại', 'Mã / tên', 'SL', 'Chứng từ', 'Người làm']) hr.append(el('th', '', h));
  thead.append(hr); table.append(thead, tbody); wrap.append(table); panel.append(chips, bar, count, wrap); page.append(head, panel); root.append(page);

  async function load() {
    const p = new URLSearchParams();
    if (group) p.set('group', group); if (wh.value) p.set('warehouseId', wh.value); if (from.value) p.set('from', from.value); if (to.value) p.set('to', to.value); if (q.value.trim()) p.set('q', q.value.trim());
    let d; try { d = await api('/stock-moves?' + p); } catch (e) { toast(e.message, 'err'); return; }
    if (wh.options.length === 1) for (const w of d.warehouses) { const o = el('option', '', w.name); o.value = w.id; wh.append(o); }
    rows = d.moves;
    count.textContent = `${rows.length} dòng` + (rows.length >= 1000 ? ' (đã đủ 1000 – lọc thêm để xem cũ hơn)' : '');
    tbody.replaceChildren(...(rows.length ? rows.map(m => {
      const tr = el('tr'), item = el('td', 'first'); item.append(el('b', '', m.sku), el('small', '', m.name));
      const ref = el('td'); if (m.link) { const a = el('a', '', m.refNo || 'Mở'); a.href = m.link; ref.append(a); } else ref.textContent = m.refNo; if (m.note) ref.append(el('small', '', m.note));
      tr.append(el('td', '', dt(m.at)), el('td', '', m.warehouse), el('td', '', m.kindLabel), item, el('td', m.qty < 0 ? 'danger-text' : 'paid-text', signed(m.qty)), ref, el('td', '', m.by));
      return tr;
    }) : [(() => { const tr = el('tr'), td = el('td', 'muted', 'Không có phát sinh.'); td.colSpan = 7; tr.append(td); return tr; })()]));
  }
  return { load };
}

/** Bảng kho ↔ chức vụ được bán (dưới trang Phân quyền). */
export function initSellerConfig({ api, root, toast }) {
  const panel = el('div', 'panel seller-config');
  panel.append(el('h2', '', 'Kho bán theo chức vụ'), el('p', 'muted', 'Nhân viên chỉ lập đơn / HĐKT từ kho chức vụ mình được bán (Manager bán mọi kho). "Kho riêng": chỉ chức vụ bán kho đó thấy tồn (VD kho Hoá đơn).'));
  const body = el('div'); panel.append(body); root.append(panel);
  async function load() {
    let d; try { d = await api('/warehouse-sellers'); } catch (e) { panel.hidden = true; return; }
    panel.hidden = false;
    const table = el('table', 'data-table'), thr = el('tr'); thr.append(el('th', '', 'Kho'), ...d.positions.map(p => el('th', '', p.name)), el('th', '', 'Kho riêng'));
    const thead = el('thead'); thead.append(thr); const tbody = el('tbody');
    for (const w of d.warehouses) {
      const tr = el('tr'); tr.dataset.id = w.id; tr.append(el('td', 'first', w.name));
      for (const p of d.positions) { const td = el('td'), c = input('checkbox'); c.checked = w.positions.includes(p.id); c.dataset.pos = p.id; c.setAttribute('aria-label', `${w.name} – ${p.name}`); td.append(c); tr.append(td); }
      const td = el('td'), c = input('checkbox'); c.checked = w.stockPrivate; c.dataset.private = '1'; c.setAttribute('aria-label', `${w.name} – kho riêng`); td.append(c); tr.append(td);
      tbody.append(tr);
    }
    table.append(thead, tbody);
    const wrap = el('div', 'table-wrap'); wrap.append(table);
    const save = btn('Lưu kho bán', 'btn primary', async () => {
      const warehouses = [...tbody.children].map(tr => ({ id: tr.dataset.id, positions: [...tr.querySelectorAll('input[data-pos]:checked')].map(c => c.dataset.pos), stockPrivate: tr.querySelector('input[data-private]').checked }));
      try { await api('/warehouse-sellers', 'PUT', { warehouses }); toast('Đã lưu kho bán theo chức vụ.'); } catch (e) { toast(e.message, 'err'); }
    });
    body.replaceChildren(wrap, save);
  }
  return { load };
}
