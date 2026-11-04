import { initAdjustmentQueue } from './inventory-adjustments.js';
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
  let status = null, rows = [], req = 0, onlyDiff = true, editing = false, busy = false, loadRun = 0;
  // BỐ CỤC TOÀN TRANG như Kiểm kê hàng: đầu trang (tiêu đề + nút) · tab Phiếu cân bằng / Đối chiếu Sapo · nút ＋ mở trang lập phiếu.
  const page = el('div', 'sup-page');
  const head = el('div', 'page-head'), titles = el('div'), description = el('p', 'muted');
  titles.append(el('span', 'eyebrow', 'Kho hàng'), el('h1', '', 'Cân bằng kho'), description);
  const tools = el('div', 'head-actions row-gap');
  const create = btn('', 'btn-add', () => adjustForm()); create.title = 'Tạo phiếu cân bằng kho'; create.setAttribute('aria-label', 'Tạo phiếu cân bằng kho'); create.hidden = true;
  create.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
  const openingTools = el('span', 'row-gap');
  tools.append(openingTools, create);
  head.append(titles, tools);
  const TABS = [['adjustments', 'Phiếu cân bằng kho'], ['compare', 'Đối chiếu tồn Sapo']];
  let tab = (() => { try { return localStorage.getItem('inventoryTab') === 'compare' ? 'compare' : 'adjustments'; } catch { return 'adjustments'; } })();
  const tabBar = el('div', 'toolbar chips inv-tabs'); tabBar.setAttribute('role', 'tablist');
  const tabButtons = TABS.map(([id, text]) => { const b = btn(text, 'chip', () => { tab = id; try { localStorage.setItem('inventoryTab', id); } catch {} updatePage(); }); b.dataset.tab = id; b.setAttribute('role', 'tab'); tabBar.append(b); return b; });
  const info = el('div', 'panel inv-status');
  const panel = el('section', 'panel inv-compare-panel'), panelHead = el('div', 'card-title-row');
  panelHead.append(el('h2', 'card-title', 'Đối chiếu tồn sổ kho ↔ Sapo'));
  const bar = el('form', 'transfer-filter-grid inv-compare-filter');
  const wh = el('select'); wh.setAttribute('aria-label', 'Kho');
  const search = input('search', '', { placeholder: 'Mã hoặc tên hàng…', maxLength: 80 }); search.setAttribute('aria-label', 'Tìm mã hàng');
  const diffBox = input('checkbox'); diffBox.checked = true;
  const diffLabel = el('label', 'inv-check'); diffLabel.append(diffBox, document.createTextNode(' Chỉ dòng lệch'));
  const resetCompare = btn('Xoá bộ lọc', 'btn secondary small', () => { search.value = ''; diffBox.checked = onlyDiff = true; loadRows(); });
  bar.append(field('Tìm mã hàng', search), field('Kho', wh), diffLabel, resetCompare);
  bar.addEventListener('submit', e => { e.preventDefault(); loadRows(); });
  const countEl = el('p', 'muted transfer-filter-note');
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table'), thead = el('thead'), tbody = el('tbody');
  const unopenedEl = el('div', 'inv-unopened');
  table.append(thead, tbody); wrap.append(table); panel.append(panelHead, bar, countEl, unopenedEl, wrap);
  const queueHost = el('section', 'panel inv-adjustments-panel');
  const editor = el('section', 'panel inv-adjust-editor'); editor.hidden = true;
  page.append(head, tabBar, queueHost, info, panel, editor);
  const adjustmentQueue = initAdjustmentQueue({ api, host: queueHost, toast, onChanged: () => load() });
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
  function updatePage() {
    for (const b of tabButtons) { const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); }
    tabBar.hidden = editing; editor.hidden = !editing;
    queueHost.hidden = editing || tab !== 'adjustments';
    info.hidden = panel.hidden = editing || tab !== 'compare';
    openingTools.hidden = editing;
    create.hidden = editing || !status?.canManage || !status?.warehouses?.length;
    description.textContent = editing ? 'Nhập mã hàng và số tăng / giảm. Nhân viên gửi phiếu chờ duyệt; chỉ Manager được duyệt và cập nhật tồn.'
      : tab === 'compare' ? 'Đối chiếu tồn sổ kho với tồn Sapo để tìm chênh lệch. Bấm một dòng để xem thẻ kho và điều chỉnh mã đó.'
        : 'Quản lý phiếu cân bằng kho. Bấm + để lập phiếu mới; chỉ Manager được duyệt hoàn thành và cập nhật tồn.';
  }
  updatePage();

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
    info.replaceChildren(); openingTools.replaceChildren();
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
      if (s.canApproveAdjustment && (sel || unopened.length)) openingTools.append(btn(sel?.openedAt ? 'Chốt lại tồn đầu kỳ' : 'Chốt tồn đầu kỳ', sel?.openedAt ? 'btn ghost' : 'btn secondary', async () => {
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
    updatePage();
  }

  function renderRows(diffCount) {
    thead.replaceChildren(); tbody.replaceChildren();
    const hr = el('tr'); for (const [h, c] of [['Mã / tên', ''], ['Kho', ''], ['Sổ kho', 'num'], ['Sapo', 'num'], ['Lệch', 'num']]) hr.append(el('th', c, h));
    thead.append(hr);
    countEl.textContent = `${num(rows.length)} dòng · ${num(diffCount)} dòng lệch` + (rows.length >= 500 ? ' · hiện 500 dòng đầu' : '');
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
    const run = ++loadRun, route = location.hash;
    const transferId = /^#\/inventory(?:\?|$)/.test(route) ? new URLSearchParams(route.split('?')[1] || '').get('transfer') : null;
    try {
      const next = await api('/inventory/status');
      if(run !== loadRun) return;
      status = next; renderStatus();
      await Promise.all([loadRows(),adjustmentQueue.load(status)]);
      if(!transferId || run !== loadRun || location.hash !== route || busy) return;
      if(editing) { toast('Đang có phiếu cân bằng chưa lưu. Hãy ghi hoặc huỷ phiếu đó rồi mở lại Cân bằng kho nhanh.', 'err'); history.replaceState(null, '', '#/inventory'); return; }
      if(!status.canManage) throw Error('Bạn chưa được cấp quyền lập phiếu cân bằng kho.');
      const transfer = await api('/stock-transfers/' + encodeURIComponent(transferId));
      if(run !== loadRun || location.hash !== route || editing || busy) return;
      if(!transfer.actions?.adjustBalance) throw Error('Bạn chưa được cấp quyền cân bằng kho từ phiếu này.');
      const warehouseIds = [transfer.fromWarehouseId,transfer.toWarehouseId];
      if(!status.warehouses.some(w=>warehouseIds.includes(w.id))) throw Error('Không có kho của phiếu trong phạm vi được cân bằng.');
      adjustForm({transfer,warehouseIds,lines:[...new Set(transfer.lines.map(l=>l.sku))].map(sku=>({sku})),reason:'Cân bằng kho từ phiếu điều chuyển ' + transfer.transferNo});
      history.replaceState(null, '', '#/inventory');
    }
    catch (e) { if(run === loadRun) { info.replaceChildren(el('p', 'error', e.message || 'Không tải được sổ kho.')); toast(e.message || 'Không tải được sổ kho.', 'err'); } }
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
      if (status?.canManage) d.append(btn('Điều chỉnh mã này…', 'btn secondary small', () => { close(); adjustForm({ warehouseId, sku, qty: c.sapo - c.balance }); }));
    } catch (e) { d.append(el('p', 'error', e.message || 'Không tải được thẻ kho.')); }
  }

  // ---------------------------------------------------------------- phiếu cân bằng kho: trang lập phiếu toàn trang (thay ngăn kéo cũ)
  function adjustForm(prefill = {}) {
    if (busy || !status?.canManage) return;
    editing = true; editor.replaceChildren(); updatePage();
    const back = btn('‹ Danh sách phiếu', 'btn ghost small', () => { if (busy) return; editing = false; editor.replaceChildren(); updatePage(); });
    const top = el('div', 'card-title-row'); top.append(el('h2', 'card-title', 'Lập phiếu cân bằng kho'), back);
    const f = el('form', 'sup-form inv-adjust-form'), err = el('p', 'error');
    const w = el('select'); w.required = true;w.setAttribute('aria-label','Kho cân bằng');
    w.append(Object.assign(el('option','','Chọn kho…'),{value:''}));
    for (const x of status.warehouses.filter(x=>!prefill.warehouseIds||prefill.warehouseIds.includes(x.id))) w.append(Object.assign(el('option', '', x.name), { value: x.id }));
    w.value = ''; // Every new sheet needs an explicit warehouse choice, including from a stock card.
    const reason = input('text', prefill.reason || '', { maxLength: 500, required: true, placeholder: 'VD: kiểm kê lệch, hàng vỡ, xuất mẫu…' });
    const g = el('div', 'form-grid two'); g.append(field('Kho', w), field('Lý do *', reason));
    const list = el('div', 'inv-adjust-lines');
    const addLine = (sku = '', qty = '') => {
      const r = el('div', 'pur-inline'), s = input('text', sku, { placeholder: 'Mã hàng (SKU)', maxLength: 200 }), q = input('number', qty, { step: 'any', placeholder: '+ tăng / − giảm', className: 'pur-qty' });
      s.setAttribute('aria-label', 'Mã hàng'); q.setAttribute('aria-label', 'Số tăng / giảm');
      r.append(s, q, btn('×', 'icon-btn', () => r.remove())); list.append(r);
    };
    if(prefill.lines?.length) for(const line of prefill.lines) addLine(line.sku);
    else addLine(prefill.sku || '', prefill.qty ? String(prefill.qty) : '');
    if(prefill.transfer) f.append(el('p','muted small',`Phiếu ${prefill.transfer.transferNo}: ${prefill.transfer.fromName} → ${prefill.transfer.toName}. Chọn kho cần cân bằng và nhập số tăng/giảm thực tế; số lượng điều chuyển không phải số điều chỉnh.`));
    f.append(g, el('p', 'muted small', status.canApproveAdjustment?'Số dương = tăng tồn, số âm = giảm tồn. Manager ghi phiếu sẽ duyệt và cập nhật sổ kho ngay.':'Số dương = tăng tồn, số âm = giảm tồn. Phiếu sẽ gửi Manager duyệt; lúc gửi chưa thay đổi tồn kho.'), list,
      btn('+ Thêm mã', 'btn secondary small', () => addLine()), err);
    const ok = el('button', 'btn primary', status.canApproveAdjustment?'Ghi phiếu điều chỉnh':'Gửi Manager duyệt'); ok.type = 'submit';
    const clientKey=crypto.randomUUID();let uncertain=null;
    const foot = el('div', 'row-gap inv-adjust-foot'); foot.append(ok, btn('Huỷ', 'btn secondary', () => back.click())); f.append(foot);
    f.addEventListener('submit', async e => {
      e.preventDefault(); err.textContent = '';
      if(!uncertain&&!status.warehouses.some(x=>x.id===w.value&&(!prefill.warehouseIds||prefill.warehouseIds.includes(x.id)))){err.textContent='Chọn kho trước khi ghi phiếu cân bằng.';w.focus();return;}
      const lines = [...list.children].map(r => { const [s, q] = r.querySelectorAll('input'); return { sku: s.value.trim(), qty: Number(q.value) }; }).filter(l => l.sku && l.qty);
      if(ok.disabled)return;ok.disabled = true;busy=true;
      const body=uncertain||{ warehouseId: w.value, reason: reason.value.trim(), lines,clientKey };
      try { const r = await api('/inventory/adjustments', 'POST', body);busy=false;toast(r.status==='pending'?`Đã gửi phiếu ${r.refNo}, chờ Manager duyệt. Chưa đổi tồn kho.`:`Đã ghi phiếu ${r.refNo}.`);editing=false;editor.replaceChildren();tab='adjustments';updatePage();await load(); }
      catch (ex) {const unknown=!ex.status||ex.status>=500;uncertain=unknown?body:null;err.textContent = (ex.message || 'Không ghi được phiếu.')+(unknown?' Chưa rõ kết quả. Bấm kiểm tra lại lần gửi này, không lập phiếu khác.':'');for(const input of f.querySelectorAll('input,select,textarea'))input.disabled=unknown;ok.textContent=unknown?'Kiểm tra lại lần gửi':status.canApproveAdjustment?'Ghi phiếu điều chỉnh':'Gửi Manager duyệt';ok.disabled = false;}
      finally{busy=false;}
    });
    editor.append(top, f);
    window.scrollTo?.(0, 0); (prefill.sku ? reason : w).focus?.();
  }

  return { load };
}
