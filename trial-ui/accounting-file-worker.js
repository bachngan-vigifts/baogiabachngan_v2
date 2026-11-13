importScripts('./xlsx.full.min.js');
self.onmessage = async ({ data: file }) => {
  try {
    const { parseAccountingRows } = await import('./accounting-file.js');
    const x = self.XLSX;
    const book = x.read(await file.arrayBuffer(), { type: 'array', raw: true, codepage: 65001, sheetRows: 5002 });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw Error('File chưa có trang tính.');
    const range = x.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
    if (range.s.r !== 0 || range.s.c !== 0) throw Error('Đặt tiêu đề SKU, SL ở ô A1, B1 như file mẫu.');
    if (range.e.r >= 5001) throw Error('Tối đa 5.000 dòng/file. Hãy chia file; chưa nạp dòng nào.');
    if (range.e.c > 1) throw Error('Dùng mẫu gồm đúng hai cột SKU, SL.');
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith('!')) continue;
      if (cell.f) throw Error('File có công thức. Hãy dán giá trị và lưu SKU dạng Text.');
      if (address.startsWith('A') && cell.t === 'n' && !Number.isSafeInteger(cell.v))
        throw Error('SKU dạng số có thể mất chính xác. Hãy lưu cột SKU dạng Text.');
    }
    // Keep SKU display format (e.g. 000123), but numeric quantities unformatted.
    const rows = x.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true });
    for (let r = 1; r < rows.length; r++) {
      const quantity = sheet[x.utils.encode_cell({ r, c: 1 })];
      if (quantity?.t === 'n') rows[r][1] = String(quantity.v);
    }
    self.postMessage({ rows: parseAccountingRows(rows) });
  } catch (e) { self.postMessage({ error: e.message || 'Không đọc được file.' }); }
};
