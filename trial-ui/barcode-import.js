import { barcodeColumns, parseBarcodeSheet } from './barcode-file.js';
let excelPromise;
function excel() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  return excelPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = new URL('./xlsx.full.min.js', import.meta.url).href;
    script.onload = () => resolve(globalThis.XLSX);
    script.onerror = () => { excelPromise = null; script.remove(); reject(Error('Không tải được bộ đọc Excel.')); }; document.head.append(script);
  });
}
const el = (tag, text, attrs = {}) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
export async function openBarcodeImport({ api, isManager, toast }) {
  if (!isManager()) return;
  const dlg = el('dialog', undefined, { class: 'modal', 'aria-label': 'Cập nhật barcode từ file' }), head = el('div', undefined, { class: 'modal-head' }), body = el('div', undefined, { class: 'modal-body' }), foot = el('div', undefined, { class: 'modal-foot' });
  head.append(el('h2', 'Cập nhật barcode từ file'));
  const file = el('input', undefined, { type: 'file', accept: '.xlsx,.xls,.csv', 'aria-label': 'File barcode' }), sheet = el('select', undefined, { 'aria-label': 'Trang tính' });
  const status = el('p', 'Chọn file Excel/CSV có hai cột SKU và Barcode.', { role: 'status' }), results = el('div', undefined, { class: 'table-wrap' });
  const close = el('button', 'Đóng', { type: 'button', class: 'btn secondary' }), review = el('button', 'Xem trước', { type: 'button', class: 'btn secondary' }), apply = el('button', 'Lưu barcode', { type: 'button', class: 'btn primary' }), sample = el('button', 'Tải file mẫu', { type: 'button', class: 'btn secondary small' });
  let book, preview, input, seq = 0, busy = false;
  review.disabled = apply.disabled = true;
  const invalidate = () => { preview = input = null; apply.disabled = true; results.replaceChildren(); };
  const lock = value => { busy = value; for (const n of [file, sheet, close, review, apply]) n.disabled = value; if (!value) { review.disabled = !book; apply.disabled = !preview || !!preview.issueCount || !preview.added; } };
  sample.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob(['\uFEFFSKU,Barcode\r\n00123,0890123456789\r\n'], { type: 'text/csv;charset=utf-8' })), a = el('a'); a.href = url; a.download = 'mau-barcode.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  file.addEventListener('change', async () => {
    const n = ++seq; invalidate(); book = null; review.disabled = true; sheet.replaceChildren();
    const chosen = file.files?.[0]; if (!chosen) return;
    if (chosen.size > 20 * 1024 * 1024) { status.textContent = 'File tối đa 20 MB.'; return; }
    try {
      const XLSX = await excel(), next = XLSX.read(await chosen.arrayBuffer(), { type: 'array', codepage: 65001, raw: true });
      if (n !== seq || !dlg.open) return;
      book = next;
      for (const name of book.SheetNames) sheet.append(el('option', name, { value: name }));
      review.disabled = !book.SheetNames.length;
      status.textContent = 'Đã đọc file. Chọn trang tính rồi bấm Xem trước.';
    } catch (e) { if (n === seq) status.textContent = e.message; }
  });
  sheet.addEventListener('change', invalidate);
  review.addEventListener('click', async () => {
    if (busy || !book) return;
    lock(true); invalidate();
    try {
      const XLSX = await excel(), ws = book.Sheets[sheet.value], rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }), cols = barcodeColumns(rows);
      for (let i = cols.header + 1; i < rows.length; i++) for (const col of [cols.sku, cols.barcode]) {
        const cell = ws[XLSX.utils.encode_cell({ r: i, c: col })];
        if (cell?.t === 'n' && String(Math.trunc(cell.v)).length > 15) throw Error('Dòng ' + (i + 1) + ': mã số dài đã lưu dạng Number. Anh xuất lại dưới dạng Text để giữ nguyên mã.');
      }
      input = { filename: file.files[0].name, rows: parseBarcodeSheet(rows) };
      preview = await api('/admin/product-barcodes/preview', 'POST', input);
      status.textContent = `${preview.added} barcode mới · ${preview.existing} đã có · ${preview.duplicates} dòng lặp · ${preview.issueCount} dòng lỗi. Barcode cũ vẫn dùng tiếp.`;
      results.replaceChildren();
      for (const issue of preview.issues) results.append(el('p', `Dòng ${issue.row} · ${issue.sku} · ${issue.barcode}: ${issue.message}`, { class: 'danger-text' }));
      const table = el('table', undefined, { class: 'data-table' }), header = el('tr');
      for (const name of ['SKU', 'Sản phẩm', 'Barcode']) header.append(el('th', name));
      const thead = el('thead'); thead.append(header); const tbody = el('tbody');
      for (const row of preview.samples) {
        const tr = el('tr');
        for (const [i, value] of [row.sku, row.name, row.barcode].entries()) { const td = el('td', value, { 'data-label': ['SKU', 'Sản phẩm', 'Barcode'][i] }); td.style.overflowWrap = 'anywhere'; tr.append(td); }
        tbody.append(tr);
      }
      table.append(thead, tbody); results.append(table, el('p', 'Hiển thị tối đa 50 dòng xem trước. Nếu có lỗi, sửa file rồi chọn lại.'));
    } catch (e) { preview = null; status.textContent = e.message; }
    finally { lock(false); }
  });
  apply.addEventListener('click', async () => {
    if (busy || !preview || preview.issueCount || !preview.added) return;
    lock(true);
    try { const r = await api('/admin/product-barcodes/apply', 'POST', { ...input, version: preview.version }); toast(`Đã lưu ${r.added} barcode. Có thể quét tại POS.`); dlg.close(); }
    catch (e) { invalidate(); status.textContent = e.message; }
    finally { lock(false); }
  });
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  dlg.addEventListener('close', () => { ++seq; dlg.remove(); });
  body.append(el('p', 'Giữ SKU và Barcode ở dạng Text để không mất số 0 đầu. Chỉ gắn mã cho sản phẩm đang hoạt động/đã duyệt; mã không có hoặc trùng sản phẩm khác sẽ chặn lưu toàn file.'), sample, file, el('p', 'Trang tính'), sheet, status, results);
  foot.append(close, review, apply); dlg.append(head, body, foot); document.body.append(dlg); dlg.showModal();
}
