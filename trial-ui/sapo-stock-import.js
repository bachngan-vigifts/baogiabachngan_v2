import { detectSapoColumns, parseSapoStockFile, combineSapoStockFiles } from './sapo-stock-file.js';

let excelPromise;
function excel() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  return excelPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = new URL('./xlsx.full.min.js', import.meta.url).href;
    s.onload = () => resolve(globalThis.XLSX); s.onerror = () => { excelPromise = null; s.remove(); reject(Error('Không tải được bộ đọc Excel.')); }; document.head.append(s);
  });
}
const sources = [
  { label: 'Kho Minh Long - Lock (showroom)', match: name => name.includes('minh long') && name.includes('lock') && !name.includes('hoa don') },
  { label: 'KHO VIGIFTS', match: name => name.includes('vigifts') },
  { label: 'Hoá đơn Lock', match: name => name.includes('lock') && name.includes('hoa don') },
  { label: 'Hoá đơn Minh Long', match: name => name.includes('hoa don') && (name.includes('bach ngan') || (name.includes('minh long') && !name.includes('lock'))) },
];
const fmt = n => n === null || n === undefined ? '—' : Number(n).toLocaleString('vi-VN');
function el(tag, text, attrs = {}) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); return node; }
function labelled(label, input) { const node = el('label', label); node.append(input); return node; }
function option(value, label) { return el('option', label, { value }); }
const normal = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
/** Bảng tóm tắt xem trước / kết quả: dòng trong file → cập nhật / bỏ qua (kèm lý do và danh sách mã). */
function summaryBox(p, hidden, applied = false) {
  const box = el('div', undefined, { class: 'import-summary' }), list = el('dl');
  const add = (label, value, tone = '') => { if (!value && tone !== 'ok') return; const dt = el('dt', label), dd = el('dd', fmt(value)); if (tone) dd.className = tone; list.append(dt, dd); };
  add('Mã trong file', p.fileRows ?? p.matched);
  add(applied ? 'Đã cập nhật' : 'Sẽ cập nhật', p.matched, 'ok');
  add('Không có trong CRM (bỏ qua)', p.unknownCount, 'warn');
  add('Mã trùng không xác định (bỏ qua)', p.ambiguousCount, 'warn');
  add('Dòng ẩn trong file (bỏ qua)', hidden);
  box.append(list);
  if (p.ledgerWarehouses?.length) box.append(el('p', `⚠ ${p.ledgerWarehouses.join(', ')} đã chốt tồn đầu kỳ: tồn hiển thị lấy theo sổ kho CRM, số trong file chỉ lưu để đối chiếu (trang Đối chiếu Sapo) – muốn sửa lệch thì lập phiếu điều chỉnh.`, { class: 'import-warn' }));
  // Mã không có trong CRM chỉ báo số lượng (tự bỏ qua); mã trùng không xác định liệt kê để sửa.
  for (const [label, codes, count] of [['Mã không xác định', p.ambiguous, p.ambiguousCount]]) {
    if (!codes?.length) continue;
    const more = el('details'); more.append(el('summary', `${label} (${fmt(count)})`), el('p', codes.join(', ') + (count > codes.length ? ` … và ${fmt(count - codes.length)} mã khác` : ''), { class: 'muted small' }));
    box.append(more);
  }
  if (!applied && p.samples?.length) {
    const table = el('table', undefined, { class: 'data-table' }), tr = el('tr'); for (const h of ['Mã hàng', 'Kho CRM', 'Tồn cũ', 'Tồn mới']) tr.append(el('th', h)); const thead = el('thead'); thead.append(tr); table.append(thead);
    const tbody = el('tbody'); for (const x of p.samples) { const r = el('tr'); for (const value of [x.sku, x.warehouse, fmt(x.before), fmt(x.after)]) r.append(el('td', value)); tbody.append(r); } table.append(tbody);
    const wrap = el('div', undefined, { class: 'table-wrap' }); wrap.append(table); box.append(el('p', 'Xem trước 30 dòng đầu:', { class: 'muted small' }), wrap);
  }
  return box;
}
export async function openSapoStockImport({ api, isManager, onChanged, toast = () => {} }) {
  if (!isManager()) return;
  const data = await api('/products?limit=1'), stores = data.warehouses.filter(w => w.kind === 'stock');
  if (!stores.length) throw Error('CRM chưa có kho thực để nhận dữ liệu.');
  const dialog = el('dialog', undefined, { class: 'modal', 'aria-label': 'Cập nhật kho từ Sapo' });
  const head = el('div', undefined, { class: 'modal-head' }), body = el('div', undefined, { class: 'modal-body' }), foot = el('div', undefined, { class: 'modal-foot' });
  head.append(el('h2', 'Cập nhật kho'));
  body.append(el('p', '1. Mở Sapo, đăng nhập bằng tài khoản của anh và xuất tồn kho cho từng nguồn: kho Minh Long - Lock (showroom), KHO VIGIFTS, Hoá đơn Lock và Hoá đơn Minh Long. Giữ hai cột Mã hàng và Tồn.'));
  const link = el('a', 'Mở Sapo để tải file', { href: 'https://bachngankiengiang.mysapo.com/admin', target: '_blank', rel: 'noopener noreferrer', class: 'btn secondary' }); body.append(link);
  body.append(el('p', '2. Chọn ít nhất một file Excel/CSV bên dưới. Nguồn không cập nhật được để trống. CRM lấy trực tiếp số lượng ở cột Tồn. Nếu chọn nhiều file cùng kho CRM, số tồn được cộng trong một lần lưu; không cộng vào số tồn cũ.'));
  body.append(el('p', 'Mã hàng phải giữ dạng chữ để không mất số 0 đầu. Ô trống và mã trùng trong một file sẽ báo lỗi. Chỉ thay số lượng của mã có trong file; mã không nằm trong file giữ nguyên. Mã không có trong CRM được tự động bỏ qua.', { class: 'muted small' }));
  const date = el('input', undefined, { type: 'datetime-local', required: '', 'aria-label': 'Thời điểm số liệu Sapo' });
  const now = new Date(); date.value = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  body.append(labelled('Thời điểm số liệu trên Sapo', date));
  const status = el('p', '', { role: 'status', 'aria-live': 'polite', class: 'import-status' }), previewBox = el('div'), cards = [];
  // Tiến độ: chữ + thanh chạy + số giây (file lớn / mạng chậm vẫn thấy đang chạy, không tưởng bị treo).
  const progress = el('div', undefined, { class: 'import-progress', hidden: '' }), progressText = el('span'), progressBar = el('i'); progress.append(progressText, progressBar);
  let ticker = 0;
  const step = text => { clearInterval(ticker); progress.hidden = false; const start = Date.now(); progressText.textContent = text;
    ticker = setInterval(() => { progressText.textContent = `${text} (${Math.round((Date.now() - start) / 1000)} giây)`; }, 1000); };
  const done = () => { clearInterval(ticker); progress.hidden = true; };
  // Cho trình duyệt vẽ chữ "Đang …" trước khi đọc file nặng (đọc Excel chạy đồng bộ).
  const paint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const close = el('button', 'Đóng', { type: 'button', class: 'btn secondary' }), review = el('button', 'Xem trước', { type: 'button', class: 'btn secondary' }), apply = el('button', 'Xác nhận cập nhật kho', { type: 'button', class: 'btn primary' });
  let preview = null, busy = false;
  function invalidate() { preview = null; apply.disabled = true; previewBox.replaceChildren(); }
  function lock(value) { busy = value; dialog.querySelectorAll('input, select, button').forEach(n => n.disabled = value); if (!value) { review.disabled = false; apply.disabled = !preview; } }
  date.onchange = invalidate;
  for (const source of sources) {
    const card = el('fieldset'), grid = el('div', undefined, { class: 'form-grid cols-2' }); card.append(el('legend', source.label), grid);
    const file = el('input', undefined, { type: 'file', accept: '.xlsx,.xls,.csv', 'aria-label': 'File ' + source.label }), sheet = el('select', undefined, { 'aria-label': 'Trang tính ' + source.label });
    const target = el('select', undefined, { 'aria-label': 'Kho CRM nhận ' + source.label }), header = el('input', undefined, { type: 'number', min: '1', max: '200', value: '1', 'aria-label': 'Dòng tiêu đề ' + source.label });
    target.append(option('', '— Chọn kho CRM nhận dữ liệu —')); for (const w of stores) target.append(option(w.id, w.name));
    const expected = stores.find(w => source.match(normal(w.name)));
    target.value = expected?.id || '';
    const mapping = {}, controls = el('div', undefined, { class: 'form-grid cols-2' });
    grid.append(labelled('File Excel / CSV (tối đa 20 MB)', file), labelled('Trang tính', sheet), labelled('Kho CRM nhận dữ liệu', target), labelled('Dòng tiêu đề', header)); card.append(controls);
    const state = { source: source.label, file, sheet, target, header, mapping, book: null, rows: [], hidden: [], ws: null }; cards.push(state);
    function mapColumns() {
      invalidate(); controls.replaceChildren(); const h = state.rows[Number(header.value) - 1] || [], detected = detectSapoColumns([h]).mapping;
      for (const [key, label] of [['sku', 'Mã hàng'], ['onHand', 'Tồn']]) {
        const select = el('select', undefined, { 'aria-label': label + ' ' + source.label }); select.append(option('', '— Chọn cột —'));
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
      lock(true); step(`Đang đọc file ${source.label}…`); await paint(); try {
        if (selected.size > 20000000) throw Error('Chọn file dưới 20 MB.');
        const x = await excel(), book = x.read(await selected.arrayBuffer(), { type: 'array', raw: true, cellStyles: true, cellNF: true, sheetRows: 50201 });
        sheet.replaceChildren(); book.SheetNames.forEach((name, i) => { if (!book.Workbook?.Sheets?.[i]?.Hidden) sheet.append(option(name, name)); });
        if (!sheet.options.length) throw Error('File không có trang tính hiển thị.'); state.book = book;
        for (const name of [...sheet.options].map(o => o.value)) {
          // Chỉ đọc 200 dòng đầu để tìm dòng tiêu đề (không chuyển cả trang tính).
          const ws = book.Sheets[name], ref = ws['!ref']; if (!ref) continue;
          const head = x.utils.decode_range(ref); head.e.r = Math.min(head.e.r, head.s.r + 199);
          if (detectSapoColumns(x.utils.sheet_to_json(ws, { header: 1, raw: true, range: x.utils.encode_range(head) })).header >= 0) { sheet.value = name; break; }
        }
        readSheet(); status.textContent = `Đã đọc ${source.label}: ${fmt(Math.max(0, state.rows.length - Number(header.value)))} dòng dữ liệu. Kiểm tra kho và hai cột rồi bấm "Xem trước".`;
      } catch (e) { state.book = null; status.textContent = `${source.label}: ${e.message}`; } finally { done(); lock(false); }
    };
    sheet.onchange = () => { try { readSheet(); } catch (e) { state.rows = []; invalidate(); status.textContent = e.message; } }; header.onchange = mapColumns; target.onchange = invalidate; body.append(card);
  }
  body.append(progress, status, previewBox); foot.append(close, review, apply); dialog.append(head, body, foot); document.body.append(dialog);
  close.onclick = () => { if (!busy) dialog.close(); }; dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); }); dialog.addEventListener('close', () => dialog.remove());
  review.onclick = async () => {
    if (busy) return; invalidate(); lock(true); step('Đang đọc dữ liệu các file…'); await paint();
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
      step(`Đang kiểm tra ${fmt(input.rows.length)} mã với CRM…`);
      const p = await api('/admin/products/import/sapo-stock/preview', 'POST', input); preview = p.matched ? { ...input, version: p.version } : null;
      const hidden = parsed.reduce((n, f) => n + f.hidden, 0);
      status.textContent = p.matched ? `Sẵn sàng cập nhật ${fmt(p.matched)} mã. Kiểm tra bảng tóm tắt rồi bấm "Xác nhận cập nhật kho".` : 'Không có mã nào trong file khớp sản phẩm CRM – không có gì để cập nhật.';
      previewBox.append(summaryBox(p, hidden));
      for (const c of selectedCards) previewBox.append(el('p', `${c.source}: ${c.file.files[0].name} → ${stores.find(w => w.id === c.target.value)?.name || '?'}`, { class: 'muted small' }));
    } catch (e) { status.textContent = e.message; } finally { done(); lock(false); }
  };
  apply.onclick = async () => {
    if (busy || !preview) return; lock(true);
    step(`Đang lưu ${fmt(preview.rows.length)} mã vào CRM… file lớn có thể mất vài chục giây, đừng đóng cửa sổ.`);
    try {
      const p = await api('/admin/products/import/sapo-stock/apply', 'POST', preview); preview = null;
      const message = `Đã cập nhật ${fmt(p.matched)} mã (${fmt(p.cells)} ô tồn) lúc ${new Date(p.updatedAt).toLocaleString('vi-VN')}.`;
      // Giữ hộp mở với kết quả đầy đủ: bao nhiêu mã cập nhật, bao nhiêu bỏ qua và vì sao.
      status.textContent = '✅ ' + message; previewBox.replaceChildren(summaryBox(p, 0, true));
      for (const c of cards) { c.file.value = ''; c.book = null; }
      review.hidden = true; apply.hidden = true; close.textContent = 'Xong';
      toast(message);
      try { await onChanged(); } catch { /* cập nhật đã lưu; lỗi tải lại danh sách không đổi kết quả */ }
    }
    catch (e) { invalidate(); status.textContent = e.message + ' Xem trước lại trước khi cập nhật.'; } finally { done(); lock(false); }
  };
  lock(false); dialog.showModal();
}
