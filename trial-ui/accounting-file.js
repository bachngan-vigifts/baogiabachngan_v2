export const ACCOUNTING_FILE_LIMIT = 5000;
export function parseAccountingRows(rows) {
  if (!rows.length) throw Error('File trống.');
  const header = rows[0].map(v => String(v).trim().toLowerCase());
  if (header.length !== 2 || header[0] !== 'sku' || !['sl', 'số lượng', 'so luong', 'quantity'].includes(header[1]))
    throw Error('Dùng mẫu gồm đúng hai cột: SKU, SL.');
  const output = [], seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every(v => String(v).trim() === '')) continue;
    if (output.length >= ACCOUNTING_FILE_LIMIT) throw Error('Tối đa 5.000 dòng/file. Hãy chia file; chưa nạp dòng nào.');
    const sku = String(row[0] ?? '').trim(), text = String(row[1] ?? '').trim();
    // Require an unambiguous decimal, never guess comma grouping/decimal locale.
    const quantity = Number(text);
    if (row.slice(2).some(v => String(v).trim()) || !sku || sku.length > 64 || /^[=+@\-]/.test(sku) ||
        !/^\d+(\.\d{1,3})?$/.test(text) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9)
      throw Error(`Dòng ${i + 1}: SKU hoặc SL không hợp lệ. SL dương, tối đa 3 số lẻ, dùng dấu chấm thập phân.`);
    if (seen.has(sku)) throw Error(`Dòng ${i + 1}: trùng SKU ${sku}. Gộp số lượng trước khi nhập.`);
    seen.add(sku); output.push({ sku, quantity });
  }
  if (!output.length) throw Error('File chưa có dòng hàng.');
  return output;
}

// Parsing happens outside the UI thread, bounded by file size, row limit and time.
export function readAccountingFile(file) {
  if (file.size > 5 * 1024 * 1024) return Promise.reject(Error('File tối đa 5 MB.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./accounting-file-worker.js', import.meta.url));
    const end = (error, rows) => { clearTimeout(timer); worker.terminate(); error ? reject(Error(error)) : resolve(rows); };
    const timer = setTimeout(() => end('Đọc file quá 15 giây. Hãy chia file nhỏ hơn.'), 15000);
    worker.onmessage = ({ data }) => end(data.error, data.rows);
    worker.onerror = () => end('Không đọc được file. Hãy dùng file mẫu Excel.');
    worker.postMessage(file);
  });
}
