import { setProductThumbnail } from './product-images.js';
/**
 * LẬP ĐƠN MUA BỔ SUNG – trang riêng `#/purchases/new?mode=restock` (thay cho popup chọn sản phẩm dạng catalogue).
 *  - Thông tin đơn ở đầu trang (NCC – chia được nhiều NCC, hẹn giao, địa chỉ giao, ghi chú).
 *  - "Danh sách mua": mỗi mã một dòng, kèm tồn Kho SR / Kho VIGIFTS / Hàng đang về (GET /purchase-products) và SL đặt.
 *  - Thêm sản phẩm bằng ô tìm (kết quả mỗi sản phẩm một dòng, Enter để thêm) hoặc "Cập nhật bằng file Excel" (có file mẫu).
 *  - Thanh dưới cùng luôn hiện số mã / tổng SL và nút "Tạo đơn nháp". Danh sách tự lưu nháp trên máy (không chứa mã đăng nhập).
 */
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const btn = (text, cls, fn) => { const b = el('button', cls || 'btn secondary', text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; };
const num = n => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const DRAFT_KEY = 'bn-purchase-restock-draft:v1';
const store = { get() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); } catch { /* bỏ qua */ } }, clear() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* bỏ qua */ } } };

/** Cột file Excel cập nhật danh sách: Mã hàng · Tên hàng (không bắt buộc) · Số lượng đặt. */
export const RESTOCK_TEMPLATE_HEAD = ['Mã hàng', 'Tên hàng (không bắt buộc)', 'Số lượng đặt'];
/**
 * Đọc bảng ô (mảng 2 chiều, chữ hiển thị) của file cập nhật. Tìm dòng tiêu đề có "Mã hàng" và "Số lượng"; không thấy thì cột A = mã, B = tên, C = SL.
 * Mã trùng cộng dồn SL. Trả { lines: [{ row, sku, name, qty }], errors: [{ row, sku, message }] }.
 */
export function parseRestockSheet(table) {
  const rows = table.map(r => (r || []).map(c => String(c ?? '').trim()));
  const head = rows.findIndex(r => r.some(c => fold(c) === 'ma hang' || fold(c) === 'sku') && r.some(c => /^so luong|^sl\b/.test(fold(c))));
  const at = (names, fallback) => head >= 0 ? Math.max(-1, rows[head].findIndex(c => names.some(n => fold(c).startsWith(n)))) : fallback;
  const col = { sku: at(['ma hang', 'sku'], 0), name: at(['ten hang', 'ten san pham'], 1), qty: at(['so luong', 'sl'], 2) };
  const lines = new Map(), errors = [];
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i], sku = col.sku >= 0 ? r[col.sku] || '' : '', name = col.name >= 0 ? r[col.name] || '' : '', raw = col.qty >= 0 ? r[col.qty] || '' : '';
    if (!sku && !raw) continue;
    const qty = Number(raw.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
    if (!sku) { errors.push({ row: i + 1, sku: '', message: 'Thiếu mã hàng' }); continue; }
    if (!Number.isInteger(qty) || qty <= 0 || qty > 1_000_000) { errors.push({ row: i + 1, sku, message: `Số lượng "${raw}" không hợp lệ (số nguyên lớn hơn 0)` }); continue; }
    const key = sku.toLowerCase(), cur = lines.get(key);
    if (cur) cur.qty += qty; else lines.set(key, { row: i + 1, sku, name, qty });
  }
  return { lines: [...lines.values()], errors };
}

export function initRestockPage({ api, host, toast, go, options, loadXlsx, onBack, confirmBox = async t => confirm(t) }) {
  let rows = [], sups = [], o = null, searchSeq = 0, searchTimer = 0, offset = 0, hits = [], hitsFor = null, active = -1, busy = false;
  const page = el('section', 'pur-rs');
  // ----- đầu trang
  const head = el('div', 'page-head pur-rs-head'), titles = el('div');
  titles.append(el('span', 'eyebrow', 'Mua hàng'), el('h1', '', 'Lập đơn mua bổ sung'),
    el('p', 'muted', 'Thêm sản phẩm cần mua, xem tồn Kho SR / Kho VIGIFTS / hàng đang về rồi nhập số lượng đặt.'));
  const back = btn('← Đơn mua NCC', 'btn secondary', () => onBack());
  head.append(titles, back);
  // ----- thông tin đơn
  const info = el('section', 'panel pur-rs-info');
  const supSel = el('select'), chips = el('div', 'pur-sup-chips'), supField = el('label', 'pur-rs-field pur-rs-sup');
  supSel.setAttribute('aria-label', 'Thêm nhà cung cấp');
  supField.append(el('span', '', 'Nhà cung cấp *'), supSel, chips);
  const arrival = el('input'); arrival.type = 'date';
  const address = el('input'); address.maxLength = 120; address.placeholder = 'Nhập địa chỉ giao hàng';
  const note = el('textarea'); note.rows = 1; note.maxLength = 2000; note.placeholder = 'Ghi chú cho NCC (không bắt buộc)';
  const f = (label, input, cls = '') => { const l = el('label', 'pur-rs-field ' + cls); l.append(el('span', '', label), input); return l; };
  info.append(supField, f('Hẹn giao dự kiến', arrival), f('Địa chỉ giao hàng *', address), f('Ghi chú', note, 'pur-rs-note'));
  // ----- danh sách mua
  const listBox = el('section', 'panel pur-rs-list'), bar = el('div', 'pur-rs-bar');
  const searchWrap = el('div', 'pur-rs-search'), q = el('input');
  q.type = 'search'; q.placeholder = 'Thêm sản phẩm: gõ mã hoặc tên rồi Enter…'; q.setAttribute('aria-label', 'Tìm sản phẩm để thêm');
  q.setAttribute('role', 'combobox'); q.setAttribute('aria-expanded', 'false'); q.setAttribute('aria-controls', 'pur-rs-results'); q.autocomplete = 'off';
  const results = el('div', 'pur-rs-results'); results.id = 'pur-rs-results'; results.setAttribute('role', 'listbox'); results.hidden = true;
  searchWrap.append(q, results);
  const excelBtn = btn('⬆ Cập nhật bằng file Excel', 'btn secondary', () => excelDialog());
  const clearBtn = btn('Xoá hết', 'btn ghost small', async () => { if (rows.length && await confirmBox(`Xoá ${rows.length} mã khỏi danh sách đang lập?`, { title: 'Xoá danh sách', ok: 'Xoá hết', danger: true })) { rows = []; render(); } });
  bar.append(searchWrap, excelBtn, clearBtn);
  const tableWrap = el('div', 'table-wrap pur-rs-table');
  listBox.append(el('h2', 'card-title', 'Danh sách mua'), bar, tableWrap);
  // ----- thanh dưới cùng
  const foot = el('div', 'pur-rs-foot'), summary = el('span', 'pur-rs-summary'), err = el('p', 'error'); err.setAttribute('role', 'alert');
  const submit = btn('Tạo đơn nháp', 'btn primary', () => save());
  foot.append(summary, err, submit);
  page.append(head, info, listBox, foot);
  host.replaceChildren(page);

  // ----- lưu nháp
  const persist = () => store.set({ rows: rows.map(({ sku, name, unit, want, split }) => ({ sku, name, unit, want, split })), sups, arrival: arrival.value, address: address.value, note: note.value });
  for (const x of [arrival, address, note]) x.addEventListener('input', persist);

  // ----- nhà cung cấp
  function fillSuppliers() {
    supSel.replaceChildren(el('option', '', sups.length ? '+ Chia thêm cho NCC khác…' : '— Chọn nhà cung cấp —'));
    supSel.firstChild.value = '';
    for (const s of o?.suppliers || []) if (!sups.some(x => x.id === s.id)) { const op = el('option', '', s.name); op.value = s.id; supSel.append(op); }
    chips.replaceChildren(...sups.map((x, i) => {
      const c = el('span', 'sup-pill info pur-sup-chip'); c.append(el('span', '', (i === 0 && sups.length > 1 ? '★ ' : '✓ ') + x.name));
      const rm = btn('×', 'icon-btn', () => { sups.splice(i, 1); fillSuppliers(); render(); }); rm.setAttribute('aria-label', 'Bỏ ' + x.name); c.append(rm);
      return c;
    }));
  }
  supSel.addEventListener('change', () => {
    const s = o.suppliers.find(x => x.id === supSel.value);
    if (s && sups.length >= 6) toast('Tối đa 6 nhà cung cấp mỗi lần lập.', 'err');
    else if (s) sups.push({ id: s.id, name: s.name });
    fillSuppliers(); render();
  });

  // ----- tìm & thêm sản phẩm
  // null = đang tải lại tồn (mở lại nháp): hiện "…" thay vì 0 dễ hiểu nhầm là hết hàng.
  const stockCell = (n, title) => { const td = el('td', 'num pur-rs-stock' + (n == null ? ' loading' : Number(n) > 0 ? '' : ' zero'), n == null ? '…' : num(n)); if (title) td.title = title; return td; };
  const breakdown = p => (p.warehouses || []).map(w => `${w.name}: ${num(w.qty)}`).join('\n');
  function addProduct(p, qty = 1) {
    const cur = rows.find(r => r.sku.toLowerCase() === p.sku.toLowerCase());
    if (cur) { toast(`${p.sku} đã có trong danh sách.`); focusRow(cur.sku); return; }
    rows.push({ sku: p.sku, name: p.name, unit: p.unit || '', sr: p.sr, vigifts: p.vigifts, incoming: p.incoming, warehouses: p.warehouses || [], want: qty, split: {} });
    render(); focusRow(p.sku);
  }
  const focusRow = sku => { const i = tableWrap.querySelector(`input[data-sku="${CSS.escape(sku)}"]`); if (i) { i.focus(); i.select?.(); } };
  function drawResults(more) {
    results.replaceChildren();
    if (!hits.length) { results.append(el('p', 'muted small pur-rs-empty', q.value.trim() ? 'Không có sản phẩm phù hợp.' : 'Gõ mã hoặc tên sản phẩm.')); }
    hits.forEach((p, i) => {
      const added = rows.some(r => r.sku.toLowerCase() === p.sku.toLowerCase());
      // Thêm xong: con trỏ nhảy vào ô SL của dòng vừa thêm (gõ số, Enter để quay lại ô tìm).
      const row = btn('', 'pur-rs-hit' + (i === active ? ' is-active' : '') + (added ? ' is-added' : ''), () => { hideResults(); addProduct(p); });
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(i === active)); row.title = breakdown(p);
      const thumb = el('span', 'pur-rs-hit-thumb'); thumb.setAttribute('aria-hidden', 'true');
      const noImage = () => { thumb.replaceChildren(); thumb.textContent = '—'; thumb.title = 'Chưa có ảnh'; };
      if (/^https:\/\//i.test(p.imageUrl || '')) { const image = el('img'); image.alt = ''; setProductThumbnail(image, p.imageUrl, 'list', noImage); thumb.append(image); } else noImage();
      const name = el('span', 'pur-rs-hit-name'); name.append(el('b', '', p.sku), el('span', '', p.name));
      const st = el('span', 'pur-rs-hit-stock');
      for (const [k, v] of [['SR', p.sr], ['VIG', p.vigifts], ['Về', p.incoming]]) st.append(el('span', Number(v) > 0 ? '' : 'zero', `${k} ${num(v)}`));
      row.append(thumb, name, el('span', 'muted pur-rs-hit-unit', p.unit || ''), st, el('span', 'pur-rs-hit-add', added ? '✓ Đã thêm' : '+ Thêm'));
      results.append(row);
    });
    if (more != null) results.append(btn('Xem thêm sản phẩm', 'btn ghost small pur-rs-more', () => search(true)));
    results.hidden = false; q.setAttribute('aria-expanded', 'true');
  }
  const hideResults = () => { results.hidden = true; q.setAttribute('aria-expanded', 'false'); active = -1; };
  async function search(more = false) {
    const seq = ++searchSeq; if (!more) offset = 0;
    try {
      const d = await api('/purchase-products?' + new URLSearchParams({ q: q.value.trim(), offset: String(offset), limit: '20' }));
      if (seq !== searchSeq) return;
      hits = more ? [...hits, ...d.products] : d.products; hitsFor = q.value.trim(); offset = d.nextOffset ?? offset; if (!more) active = hits.length ? 0 : -1;
      drawResults(d.nextOffset);
    } catch (e) { if (seq === searchSeq) { results.replaceChildren(el('p', 'error small', e.message || 'Không tải được sản phẩm.')); results.hidden = false; } }
  }
  q.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => search(), 150); });
  q.addEventListener('focus', () => { if (!hits.length) search(); else drawResults(null); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!hits.length) return; active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; drawResults(null); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      // Gõ nhanh rồi Enter ngay: chờ kết quả đúng với chữ đang gõ (không thêm nhầm theo kết quả cũ).
      const pick = () => {
        const exact = hits.find(p => p.sku.toLowerCase() === q.value.trim().toLowerCase()), p = exact || hits[active];
        if (p) { hideResults(); addProduct(p); }
      };
      if (hitsFor === q.value.trim()) pick(); else { clearTimeout(searchTimer); search().then(() => { if (hitsFor === q.value.trim()) pick(); }); }
    } else if (e.key === 'Escape') hideResults();
  });
  const outside = e => { if (!page.isConnected) { document.removeEventListener('click', outside); return; } if (!searchWrap.contains(e.target)) hideResults(); };
  document.addEventListener('click', outside);

  // ----- bảng danh sách mua
  const perSupplier = r => {
    const others = sups.slice(1).map(x => Math.max(0, Math.floor(Number(r.split[x.id]) || 0)));
    return [Math.max(0, Math.floor(Number(r.want) || 0) - others.reduce((t, v) => t + v, 0)), ...others];
  };
  const qtyInput = (value, sku) => { const i = el('input', 'pur-qty'); i.type = 'number'; i.min = '1'; i.step = '1'; i.inputMode = 'numeric'; i.value = value ?? ''; if (sku) i.dataset.sku = sku; return i; };
  function render() {
    tableWrap.replaceChildren();
    if (!rows.length) {
      const empty = el('div', 'pur-rs-placeholder');
      empty.append(el('b', '', 'Chưa có sản phẩm nào.'), el('span', 'muted', 'Gõ mã / tên vào ô tìm ở trên, hoặc bấm "Cập nhật bằng file Excel" để thêm cả danh sách.'));
      tableWrap.append(empty);
    } else {
      const t = el('table', 'data-table pur-rs-grid'), tr0 = el('tr'), tb = el('tbody');
      const heads = ['#', 'Mã hàng', 'Tên sản phẩm', 'ĐVT', 'Kho SR', 'Kho VIGIFTS', 'Đang về', sups.length > 1 ? 'SL đặt (tổng)' : 'SL đặt'];
      if (sups.length > 1) heads.push(...sups.map(x => x.name));
      for (const h of [...heads, '']) tr0.append(el('th', /^(Kho|Đang|SL|#)/.test(h) ? 'num' : '', h));
      t.append(el('thead'), tb); t.tHead.append(tr0);
      rows.forEach((r, idx) => {
        const tr = el('tr'), want = qtyInput(r.want, r.sku), wantTd = el('td', 'pur-rs-want'), first = el('td', 'num');
        want.setAttribute('aria-label', 'SL đặt ' + r.sku);
        tr.append(el('td', 'num muted', idx + 1), el('td', 'pur-rs-sku', r.sku), el('td', 'pur-rs-name', r.name), el('td', 'muted', r.unit || ''),
          stockCell(r.sr, breakdown(r)), stockCell(r.vigifts, breakdown(r)), stockCell(r.incoming, r.incoming ? 'Đơn mua NCC đã duyệt, chưa nhận đủ' : ''));
        wantTd.append(want); tr.append(wantTd);
        if (sups.length > 1) {
          tr.append(first);
          for (const x of sups.slice(1)) {
            const td = el('td'), i = qtyInput(r.split[x.id] || ''); i.min = '0'; i.setAttribute('aria-label', `SL ${r.sku} cho ${x.name}`);
            i.addEventListener('input', () => { r.split[x.id] = Number(i.value) || 0; update(); }); td.append(i); tr.append(td);
          }
        }
        const update = () => { const parts = perSupplier(r); first.textContent = num(parts[0]); first.classList.toggle('pur-late', parts.slice(1).reduce((a, v) => a + v, 0) > (Number(r.want) || 0)); summarize(); persist(); };
        want.addEventListener('input', () => { r.want = Number(want.value) || 0; update(); });
        want.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); q.focus(); q.select(); } });
        const x = el('td'), rm = btn('×', 'icon-btn', () => { rows.splice(idx, 1); render(); }); rm.setAttribute('aria-label', 'Bỏ ' + r.sku); x.append(rm); tr.append(x);
        tb.append(tr); update();
      });
      tableWrap.append(t);
      if (sups.length > 1) tableWrap.append(el('p', 'muted small', `Cột ${sups[0].name} tự tính = "SL đặt (tổng)" trừ số nhập cho các NCC còn lại.`));
    }
    summarize(); persist();
  }
  function summarize() {
    const total = rows.reduce((n, r) => n + Math.max(0, Math.floor(Number(r.want) || 0)), 0);
    summary.textContent = rows.length ? `${rows.length} mã · tổng ${num(total)} sản phẩm${sups.length ? ' · ' + sups.map(s => s.name).join(', ') : ''}` : 'Chưa có sản phẩm';
    submit.disabled = busy || !rows.length;
  }

  // ----- cập nhật bằng file Excel
  async function excelDialog() {
    const dlg = el('dialog', 'modal pur-rs-excel'), body = el('div', 'pur-rs-excel-body');
    const close = () => { dlg.close(); dlg.remove(); };
    const file = el('input'); file.type = 'file'; file.accept = '.xlsx,.xls,.csv'; file.setAttribute('aria-label', 'Chọn file Excel');
    const preview = el('div', 'pur-rs-preview'), status = el('p', 'muted small'), modeBox = el('div', 'pur-rs-mode');
    const mode = (value, label, checked) => { const l = el('label', ''), r = el('input'); r.type = 'radio'; r.name = 'pur-rs-mode'; r.value = value; r.checked = checked; l.append(r, el('span', '', label)); return l; };
    modeBox.append(mode('merge', 'Cập nhật vào danh sách đang lập (mã đã có: lấy SL trong file)', true), mode('replace', 'Thay toàn bộ danh sách bằng file', false));
    const apply = btn('Cập nhật vào danh sách', 'btn primary', () => doApply()); apply.disabled = true;
    const template = btn('⬇ Tải file mẫu', 'btn secondary', async () => {
      try {
        const X = await loadXlsx(), wb = X.utils.book_new();
        const data = [RESTOCK_TEMPLATE_HEAD, ...rows.map(r => [r.sku, r.name, Math.max(1, Math.floor(Number(r.want) || 1))])];
        const ws = X.utils.aoa_to_sheet(data); ws['!cols'] = [{ wch: 18 }, { wch: 48 }, { wch: 14 }];
        X.utils.book_append_sheet(wb, ws, 'Đơn mua bổ sung');
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Hướng dẫn'], ['Cột A: Mã hàng (bắt buộc, đúng mã trong danh mục).'], ['Cột B: Tên hàng – không bắt buộc, chỉ để dễ đọc.'],
          ['Cột C: Số lượng đặt – số nguyên lớn hơn 0.'], ['Mã trùng nhau được cộng dồn số lượng.'], ['Các mã đang có trong danh sách lập đơn đã được điền sẵn ở trang đầu.']]), 'Hướng dẫn');
        X.writeFile(wb, 'mau-don-mua-bo-sung.xlsx');
      } catch (e) { toast(e.message || 'Không tạo được file mẫu.', 'err'); }
    });
    body.append(el('h2', '', 'Cập nhật danh sách bằng file Excel'),
      el('p', 'muted', 'File gồm 3 cột: Mã hàng · Tên hàng (không bắt buộc) · Số lượng đặt. Tải file mẫu, điền rồi chọn file để xem trước.'),
      (() => { const r = el('div', 'row-gap'); r.append(template, file); return r; })(), status, preview, modeBox);
    const actions = el('div', 'pur-rs-excel-actions'); actions.append(btn('Đóng', 'btn secondary', close), apply); body.append(actions);
    const head = el('div', 'modal-head'); head.append(body.querySelector('h2'));
    body.classList.add('modal-body'); actions.classList.add('modal-foot');
    dlg.append(head, body, actions); dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
    document.body.append(dlg); dlg.showModal();
    let ready = [];
    file.addEventListener('change', async () => {
      const fl = file.files?.[0]; if (!fl) return;
      apply.disabled = true; ready = []; preview.replaceChildren(); status.textContent = 'Đang đọc file…';
      try {
        // .csv đọc dạng chữ UTF-8 (không thì tiêu đề tiếng Việt bị lỗi font); .xlsx / .xls đọc nhị phân.
        const X = await loadXlsx(), wb = /\.csv$/i.test(fl.name) ? X.read(await fl.text(), { type: 'string' }) : X.read(await fl.arrayBuffer(), { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]];
        const parsed = parseRestockSheet(X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }));
        if (!parsed.lines.length && !parsed.errors.length) { status.textContent = 'File không có dòng nào có mã hàng.'; return; }
        // Đối chiếu danh mục + lấy tồn (500 mã / lần).
        const found = new Map(), missing = new Set();
        for (let i = 0; i < parsed.lines.length; i += 500) {
          const part = parsed.lines.slice(i, i + 500), d = await api('/purchase-products?skus=' + encodeURIComponent(part.map(l => l.sku).join(',')));
          for (const p of d.products) found.set(p.sku.toLowerCase(), p);
          for (const s of d.missing || []) missing.add(s.toLowerCase());
        }
        const t = el('table', 'data-table pur-rs-preview-table'), tb = el('tbody'), h = el('tr');
        for (const x of ['Dòng', 'Mã hàng', 'Tên', 'SL', 'Kết quả']) h.append(el('th', x === 'SL' || x === 'Dòng' ? 'num' : '', x));
        t.append(el('thead'), tb); t.tHead.append(h);
        const line = (row, sku, name, qty, result, cls) => { const tr = el('tr', cls); tr.append(el('td', 'num muted', row), el('td', '', sku), el('td', '', name), el('td', 'num', qty === '' ? '' : num(qty)), el('td', '', result)); tb.append(tr); };
        let errors = parsed.errors.length;
        for (const l of parsed.lines) {
          const p = found.get(l.sku.toLowerCase());
          if (!p) { errors++; line(l.row, l.sku, l.name, l.qty, 'Không có trong danh mục (hoặc chưa duyệt)', 'pur-rs-bad'); continue; }
          const cur = rows.find(r => r.sku.toLowerCase() === p.sku.toLowerCase());
          ready.push({ p, qty: l.qty });
          line(l.row, p.sku, p.name, l.qty, cur ? `Cập nhật SL ${num(cur.want)} → ${num(l.qty)}` : 'Thêm mới', cur ? 'pur-rs-upd' : 'pur-rs-new');
        }
        for (const e of parsed.errors) line(e.row, e.sku, '', '', e.message, 'pur-rs-bad');
        preview.append(t);
        status.textContent = `${ready.length} mã hợp lệ${errors ? ` · ${errors} dòng lỗi (bỏ qua)` : ''}.`;
        apply.disabled = !ready.length;
      } catch (e) { status.textContent = e.message || 'Không đọc được file. Kiểm tra lại file Excel.'; }
    });
    function doApply() {
      const replace = dlg.querySelector('input[name="pur-rs-mode"]:checked')?.value === 'replace';
      if (replace) rows = [];
      for (const { p, qty } of ready) {
        const cur = rows.find(r => r.sku.toLowerCase() === p.sku.toLowerCase());
        if (cur) Object.assign(cur, { want: qty, sr: p.sr, vigifts: p.vigifts, incoming: p.incoming, warehouses: p.warehouses });
        else rows.push({ sku: p.sku, name: p.name, unit: p.unit || '', sr: p.sr, vigifts: p.vigifts, incoming: p.incoming, warehouses: p.warehouses || [], want: qty, split: {} });
      }
      render(); close(); toast(`Đã cập nhật ${ready.length} mã từ file.`, 'ok');
    }
  }

  // ----- tạo đơn nháp
  async function save() {
    err.textContent = '';
    if (!sups.length) { err.textContent = 'Chọn ít nhất một nhà cung cấp.'; supSel.focus(); return; }
    if (!address.value.trim()) { err.textContent = 'Vui lòng nhập địa chỉ giao hàng.'; address.focus(); return; }
    const bad = rows.find(r => !Number.isSafeInteger(Number(r.want)) || Number(r.want) <= 0);
    if (bad) { err.textContent = `${bad.sku}: SL đặt phải là số nguyên lớn hơn 0.`; focusRow(bad.sku); return; }
    const over = rows.find(r => perSupplier(r).slice(1).reduce((a, v) => a + v, 0) > Number(r.want));
    if (over) { err.textContent = `${over.sku}: số chia cho các NCC khác vượt "SL đặt (tổng)".`; return; }
    const orders = sups.map((x, i) => ({ supplierId: x.id, arrivalDate: arrival.value || undefined, warehouse: address.value.trim(), note: note.value,
      lines: rows.map(r => ({ sku: r.sku, name: r.name, unit: r.unit, quantity: perSupplier(r)[i], sources: [] })).filter(l => l.quantity > 0) })).filter(x => x.lines.length);
    if (!orders.length) { err.textContent = 'Chưa có số lượng nào để đặt.'; return; }
    busy = true; summarize(); const label = submit.textContent; submit.textContent = 'Đang tạo…';
    try {
      const r = await api('/purchase-orders', 'POST', { orders });
      store.clear();
      toast(o.isManager ? `Đã tạo ${r.ids.length} đơn mua – chờ duyệt giá.` : `Đã lưu ${r.ids.length} đơn mua nháp – kiểm tra rồi bấm "Gửi duyệt".`, 'ok');
      go('#/purchases/' + encodeURIComponent(r.ids[0]));
    } catch (e) { err.textContent = e.message || 'Chưa tạo được đơn mua.'; }
    finally { busy = false; submit.textContent = label; summarize(); }
  }

  // ----- mở trang: nạp NCC, khôi phục nháp (làm mới tồn theo mã)
  async function open() {
    render(); fillSuppliers();
    try { o = await options(); } catch (e) { err.textContent = e.message || 'Không tải được danh sách nhà cung cấp.'; return; }
    const draft = store.get();
    if (draft?.rows?.length || draft?.sups?.length) {
      sups = (draft.sups || []).filter(s => o.suppliers.some(x => x.id === s.id));
      arrival.value = draft.arrival || ''; address.value = draft.address || ''; note.value = draft.note || '';
      rows = (draft.rows || []).map(r => ({ ...r, sr: null, vigifts: null, incoming: null, warehouses: [], split: r.split || {} }));
      if (rows.length) toast(`Đã mở lại danh sách đang lập (${rows.length} mã).`);
    }
    fillSuppliers(); render();
    if (rows.length) try {
      const d = await api('/purchase-products?skus=' + encodeURIComponent(rows.map(r => r.sku).join(',')));
      const by = new Map(d.products.map(p => [p.sku.toLowerCase(), p]));
      for (const r of rows) { const p = by.get(r.sku.toLowerCase()); if (p) Object.assign(r, { name: p.name, unit: p.unit, sr: p.sr, vigifts: p.vigifts, incoming: p.incoming, warehouses: p.warehouses }); }
      render();
    } catch { /* giữ số cũ */ }
    q.focus();
  }
  return { open };
}
