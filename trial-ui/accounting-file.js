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

// Staged mode reports row-level issues on the server instead of dropping bad rows.
export function parseStagedAccountingRows(rows) {
  if (!rows.length) throw Error('File trống.');
  const h=rows[0].map(v=>String(v).trim().toLowerCase());
  if(h.length!==2||h[0]!=="sku"||!["sl","số lượng","so luong","quantity"].includes(h[1])) throw Error('Dùng mẫu gồm đúng hai cột: SKU, SL.');
  const output=[];
  for(let i=1;i<rows.length;i++) {
    if(rows[i].every(v=>String(v).trim()==="")) continue;
    if(output.length>=30000) throw Error('Tối đa 30.000 dòng/file; chưa nhận file.');
    output.push({sku:String(rows[i][0]??'').trim().slice(0,200),quantity:String(rows[i][1]??'').trim().slice(0,64),sourceRow:i+1});
  }
  if(!output.length)throw Error('File chưa có dòng hàng.');
  return output;
}

// Parsing happens outside the UI thread, bounded by file size, row limit and time.
export function readAccountingFile(file, { staged = false, signal } = {}) {
  if (file.size > (staged ? 20 : 5) * 1024 * 1024) return Promise.reject(Error(staged ? 'File tối đa 20 MB.' : 'File tối đa 5 MB.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./accounting-file-worker.js', import.meta.url));
    let settled=false;
    const end = (error, rows) => { if(settled)return;settled=true;clearTimeout(timer); worker.terminate();signal?.removeEventListener('abort', abort); error ? reject(Error(error)) : resolve(rows); };
    const abort=()=>end('Đã dừng đọc file.');
    const timer = setTimeout(() => end('Đọc file quá thời gian cho phép. Hãy dùng file nhỏ hơn.'), staged ? 45000 : 15000);
    worker.onmessage = ({ data }) => end(data.error, data.rows);
    worker.onerror = () => end('Không đọc được file. Hãy dùng file mẫu Excel.');
    if(signal?.aborted)return abort();
    signal?.addEventListener('abort',abort,{once:true});
    worker.postMessage({file,staged});
  });
}
