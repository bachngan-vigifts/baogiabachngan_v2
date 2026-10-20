import { detectSapoColumns, parseSapoStockFile, combineSapoStockFiles } from './sapo-stock-file.js';

let excelPromise;
function excel() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  return excelPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = new URL('./xlsx.full.min.js', import.meta.url).href;
    s.onload = () => resolve(globalThis.XLSX); s.onerror = () => { excelPromise = null; s.remove(); reject(Error('Không tải được bộ đọc Excel.')); }; document.head.append(s);
  });
}
const sources = ['KHO VIGIFTS', 'Hoá đơn Lock', 'Hoá đơn Bách Ngân'];
const fmt = n => n === null || n === undefined ? '—' : Number(n).toLocaleString('vi-VN');
function el(tag, text, attrs = {}) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); return node; }
function labelled(label, input) { const node = el('label', label); node.append(input); return node; }
function option(value, label) { return el('option', label, { value }); }
const normal = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
export async function openSapoStockImport({ api, isManager, onChanged, toast = () => {} }) {
  if (!isManager()) return;
  const data = await api('/products?limit=1'), stores = data.warehouses.filter(w => w.kind === 'stock');
  if (!stores.length) throw Error('CRM chưa có kho thực để nhận dữ liệu.');
  const dialog = el('dialog', undefined, { class: 'modal', 'aria-label': 'Cập nhật kho từ Sapo' });
  const head = el('div', undefined, { class: 'modal-head' }), body = el('div', undefined, { class: 'modal-body' }), foot = el('div', undefined, { class: 'modal-foot' });
  head.append(el('h2', 'Cập nhật kho'));
  body.append(el('p', '1. Mở Sapo, đăng nhập bằng tài khoản của anh và xuất tồn kho cho từng nguồn: KHO VIGIFTS, Hoá đơn Lock, Hoá đơn Bách Ngân. Giữ hai cột Mã hàng và Tồn.'));
  const link = el('a', 'Mở Sapo để tải file', { href: 'https://bachngankiengiang.mysapo.com/admin', target: '_blank', rel: 'noopener noreferrer', class: 'btn secondary' }); body.append(link);
  body.append(el('p', '2. Chọn ít nhất một file Excel/CSV bên dưới. Nguồn không cập nhật được để trống. CRM lấy trực tiếp số lượng ở cột Tồn. Nếu chọn nhiều file cùng kho CRM, số tồn được cộng trong một lần lưu; không cộng vào số tồn cũ.'));
  body.append(el('p', 'Mã hàng phải giữ dạng chữ để không mất số 0 đầu. Ô trống và mã trùng trong một file sẽ báo lỗi. Chỉ thay số lượng của mã có trong file; mã không nằm trong file giữ nguyên. Mã không có trong CRM được tự động bỏ qua.', { class: 'muted small' }));
  const date = el('input', undefined, { type: 'datetime-local', required: '', 'aria-label': 'Thời điểm số liệu Sapo' });
  const now = new Date(); date.value = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  body.append(labelled('Thời điểm số liệu trên Sapo', date));
  const status = el('p', '', { role: 'status', 'aria-live': 'polite' }), previewBox = el('div'), cards = [];
  const close = el('button', 'Đóng', { type: 'button', class: 'btn secondary' }), review = el('button', 'Xem trước', { type: 'button', class: 'btn secondary' }), apply = el('button', 'Xác nhận cập nhật kho', { type: 'button', class: 'btn primary' });
  let preview = null, busy = false;
  function invalidate() { preview = null; apply.disabled = true; previewBox.replaceChildren(); }
  function lock(value) { busy = value; dialog.querySelectorAll('input, select, button').forEach(n => n.disabled = value); if (!value) { review.disabled = false; apply.disabled = !preview; } }
  date.onchange = invalidate;
  for (const source of sources) {
    const card = el('fieldset'), grid = el('div', undefined, { class: 'form-grid cols-2' }); card.append(el('legend', source), grid);
    const file = el('input', undefined, { type: 'file', accept: '.xlsx,.xls,.csv', 'aria-label': 'File ' + source }), sheet = el('select', undefined, { 'aria-label': 'Trang tính ' + source });
    const target = el('select', undefined, { 'aria-label': 'Kho CRM nhận ' + source }), header = el('input', undefined, { type: 'number', min: '1', max: '200', value: '1', 'aria-label': 'Dòng tiêu đề ' + source });
    target.append(option('', '— Chọn kho CRM nhận dữ liệu —')); for (const w of stores) target.append(option(w.id, w.name));
    const expected = source === sources[0]
      ? stores.find(w => normal(w.name).includes('vigifts'))
      : stores.find(w => normal(w.name).includes('minh long') && normal(w.name).includes('lock'));
    target.value = expected?.id || '';
    const mapping = {}, controls = el('div', undefined, { class: 'form-grid cols-2' });
    grid.append(labelled('File Excel / CSV (tối đa 20 MB)', file), labelled('Trang tính', sheet), labelled('Kho CRM nhận dữ liệu', target), labelled('Dòng tiêu đề', header)); card.append(controls);
    const state = { source, file, sheet, target, header, mapping, book: null, rows: [], hidden: [], ws: null }; cards.push(state);
    function mapColumns() {
      invalidate(); controls.replaceChildren(); const h = state.rows[Number(header.value) - 1] || [], detected = detectSapoColumns([h]).mapping;
      for (const [key, label] of [['sku', 'Mã hàng'], ['onHand', 'Tồn']]) {
        const select = el('select', undefined, { 'aria-label': label + ' ' + source }); select.append(option('', '— Chọn cột —'));
        h.forEach((name, i) => select.append(option(String(i), `${i + 1} · ${name ?? ''}`))); select.value = detected[key] >= 0 ? String(detected[key]) : ''; select.onchange = invalidate; mapping[key] = select; controls.append(labelled(label, select));
      }
    }
    function readSheet() {
      invalidate(); const ws = state.book.Sheets[sheet.value], range = ws['!fullref'] || ws['!ref'];
      if (range && globalThis.XLSX.utils.decode_range(range).e.r > 50200) throw Error('Trang tính quá lớn. Tối đa 50.000 dòng.');
      state.ws = ws; state.rows = globalThis.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true, range: 0 }); state.hidden = ws['!rows'] || [];
      const detected = detectSapoColumns(state.rows); if (detected.header < 0) throw Error('Không tìm thấy cột Mã hàng / SKU trong 200 dòng đầu.'); header.value = detected.header + 1; mapColumns();
    }
    file.onchange = async () => {
      if (busy) return; invalidate(); state.book = null; const selected = file.files[0]; if (!selected) { lock(false); return; }
      lock(true); try {
        if (selected.size > 20000000) throw Error('Chọn file dưới 20 MB.');
        const x = await excel(), book = x.read(await selected.arrayBuffer(), { type: 'array', raw: true, cellStyles: true, cellNF: true, sheetRows: 50201 });
        sheet.replaceChildren(); book.SheetNames.forEach((name, i) => { if (!book.Workbook?.Sheets?.[i]?.Hidden) sheet.append(option(name, name)); });
        if (!sheet.options.length) throw Error('File không có trang tính hiển thị.'); state.book = book;
        for (const name of [...sheet.options].map(o => o.value)) {
          if (detectSapoColumns(x.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, range: 0 }).slice(0, 200)).header >= 0) { sheet.value = name; break; }
        }
        readSheet(); status.textContent = `Đã đọc ${source}. Kiểm tra kho và hai cột trước khi xem trước.`;
      } catch (e) { state.book = null; status.textContent = `${source}: ${e.message}`; } finally { lock(false); }
    };
    sheet.onchange = () => { try { readSheet(); } catch (e) { state.rows = []; invalidate(); status.textContent = e.message; } }; header.onchange = mapColumns; target.onchange = invalidate; body.append(card);
  }
  body.append(status, previewBox); foot.append(close, review, apply); dialog.append(head, body, foot); document.body.append(dialog);
  close.onclick = () => { if (!busy) dialog.close(); }; dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); }); dialog.addEventListener('close', () => dialog.remove());
  review.onclick = async () => {
    if (busy) return; invalidate(); lock(true);
    try {
      const selectedCards = cards.filter(c => c.book && c.file.files[0]);
      if (!selectedCards.length) throw Error('Chọn ít nhất một file Sapo trước khi xem trước.');
      const parsed = selectedCards.map(c => {
        const mapping = Object.fromEntries(Object.entries(c.mapping).map(([key, select]) => [key, select.value === '' ? -1 : Number(select.value)]));
        const rows = c.rows.map(r => [...r]);
        // Excel SKU numeric cells with a zero-padding format must retain their displayed zeros.
        rows.forEach((r, i) => { const cell = c.ws[globalThis.XLSX.utils.encode_cell({ r: i, c: mapping.sku })]; if (cell?.t === 'n' && /^0+$/.test(cell.z || '') && cell.w) r[mapping.sku] = cell.w; });
        return { source: c.source, warehouseId: c.target.value, ...parseSapoStockFile(rows, Number(c.header.value) - 1, mapping, c.hidden) };
      });
      const time = new Date(date.value); if (!Number.isFinite(time.getTime())) throw Error('Nhập thời điểm số liệu Sapo.');
      const input = { filename: selectedCards.map(c => c.file.files[0].name).join(' + ').slice(0, 300), observedAt: time.toISOString(), rows: combineSapoStockFiles(parsed) };
      const p = await api('/admin/products/import/sapo-stock/preview', 'POST', input); preview = p.matched ? { ...input, version: p.version } : null;
      status.textContent = `${fmt(p.matched)} mã sẽ cập nhật${p.ambiguousCount ? ` · ${fmt(p.ambiguousCount)} mã không xác định` : ''}. Xem trước tối đa 30 dòng; bỏ qua ${fmt(parsed.reduce((n, f) => n + f.hidden, 0))} dòng ẩn.`;
      const table = el('table', undefined, { class: 'data-table' }), tr = el('tr'); for (const h of ['Mã hàng', 'Kho CRM', 'Tồn cũ', 'Tồn mới']) tr.append(el('th', h)); const thead = el('thead'); thead.append(tr); table.append(thead);
      const tbody = el('tbody'); for (const s of p.samples) { const r = el('tr'); for (const value of [s.sku, s.warehouse, fmt(s.before), fmt(s.after)]) r.append(el('td', value)); tbody.append(r); } table.append(tbody); const wrap = el('div', undefined, { class: 'table-wrap' }); wrap.append(table); previewBox.append(wrap);
      for (const c of cards) previewBox.append(el('p', `${c.source} → ${stores.find(w => w.id === c.target.value)?.name || '?'}`));
    } catch (e) { status.textContent = e.message; } finally { lock(false); }
  };
  apply.onclick = async () => {
    if (busy || !preview) return; lock(true);
    try {
      const p = await api('/admin/products/import/sapo-stock/apply', 'POST', preview); preview = null;
      const message = `Đã cập nhật ${fmt(p.matched)} mã lúc ${new Date(p.updatedAt).toLocaleString('vi-VN')}.`;
      status.textContent = message;
      try { await onChanged(); } catch { /* cập nhật đã lưu; lỗi tải lại danh sách không đổi kết quả */ }
      dialog.close(); toast(message);
    }
    catch (e) { invalidate(); status.textContent = e.message + ' Xem trước lại trước khi cập nhật.'; } finally { lock(false); }
  };
  lock(false); dialog.showModal();
}
