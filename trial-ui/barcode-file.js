const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');
const skuHeaders = ['sku', 'masku', 'mahang', 'masanpham', 'productcode', 'variantsku'];
const codeHeaders = ['barcode', 'mavach', 'ean', 'ean13'];
export function barcodeColumns(rows) {
  for (let header = 0; header < Math.min(rows.length, 20); header++) {
    const names = rows[header].map(norm), sku = names.flatMap((v, i) => skuHeaders.includes(v) ? [i] : []), barcode = names.flatMap((v, i) => codeHeaders.includes(v) ? [i] : []);
    if (sku.length && barcode.length) {
      if (sku.length !== 1 || barcode.length !== 1) throw Error('File có nhiều cột SKU/Barcode. Chỉ giữ một cột mỗi loại.');
      return { header, sku: sku[0], barcode: barcode[0] };
    }
  }
  throw Error('Không thấy hai cột SKU và Barcode (hoặc Mã hàng, Mã vạch). Anh tải file mẫu để điền.');
}
export function parseBarcodeSheet(rows) {
  const cols = barcodeColumns(rows), result = [];
  for (let i = cols.header + 1; i < rows.length; i++) {
    const r = rows[i], sku = String(r[cols.sku] ?? '').trim(), barcode = String(r[cols.barcode] ?? '').trim();
    if (!sku && !barcode) continue;
    if (!sku || !barcode) throw Error('Dòng ' + (i + 1) + ' thiếu SKU hoặc Barcode.');
    if (/^\d(?:\.\d+)?e[+-]?\d+$/i.test(sku) || /^\d(?:\.\d+)?e[+-]?\d+$/i.test(barcode)) throw Error('Dòng ' + (i + 1) + ' đang ở dạng số khoa học. Xuất lại SKU/Barcode dạng Text.');
    result.push({ sku, barcode, rowNumber: i + 1 });
  }
  if (!result.length || result.length > 20000) throw Error('File cần từ 1 đến 20.000 dòng barcode.');
  return result;
}
