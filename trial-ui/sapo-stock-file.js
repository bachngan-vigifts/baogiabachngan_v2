import { normalizeHeader, fileNumber } from './product-file.js';

const aliases = {
  sku: ['sku', 'masku', 'mahang', 'masanpham', 'maphienban', 'maphienbansanpham'],
  onHand: ['ton', 'tonkho', 'toncuoi', 'toncuoiky', 'soluongton', 'onhand', 'instock'],
};
export function detectSapoColumns(rows) {
  const header = rows.slice(0, 200).findIndex(row => row.some(v => aliases.sku.includes(normalizeHeader(v))));
  const labels = (rows[header] || []).map(normalizeHeader);
  return { header, mapping: Object.fromEntries(Object.entries(aliases).map(([k, values]) => [k, labels.findIndex(v => values.includes(v))])) };
}
export function parseSapoStockFile(rows, header, mapping, hiddenRows = []) {
  const cols = ['sku', 'onHand'].map(k => mapping[k]);
  if (!Number.isInteger(header) || header < 0 || header > 199 || header >= rows.length || cols.some(c => !Number.isInteger(c) || c < 0) || new Set(cols).size !== 2)
    throw Error('Chọn hai cột riêng biệt: Mã hàng và Tồn.');
  const result = [], seen = new Set(); let hidden = 0;
  for (let i = header + 1; i < rows.length; i++) {
    if (hiddenRows[i]?.hidden) { hidden++; continue; }
    const row = rows[i] || [], value = row[mapping.sku], sku = String(value ?? '').trim();
    if (!sku) continue;
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw Error(`Dòng ${i + 1}: mã hàng phải lưu dạng chữ để giữ đúng mã.`);
    if (seen.has(sku.toLowerCase())) throw Error(`Dòng ${i + 1}: mã ${sku} bị lặp trong cùng file. Kiểm tra lại file xuất Sapo.`);
    const onHand = fileNumber(row[mapping.onHand], i + 1, 'Tồn');
    if (onHand === null || Math.abs(onHand) > 1e12) throw Error(`Dòng ${i + 1}: cần số Tồn hợp lệ.`);
    seen.add(sku.toLowerCase()); result.push({ sku, onHand });
  }
  if (!result.length) throw Error('File không có mã hàng để cập nhật.');
  if (result.length > 50000) throw Error('Tối đa 50.000 mã trong một lượt cập nhật.');
  return { rows: result, hidden };
}
/** Files from different Sapo locations mapped to one CRM warehouse are added once, not overwritten. */
export function combineSapoStockFiles(files) {
  if (!files.length || files.length > 3 || new Set(files.map(f => f.source)).size !== files.length) throw Error('Mỗi nguồn Sapo chỉ được chọn một lần.');
  const merged = new Map();
  for (const file of files) {
    if (!file.warehouseId) throw Error('Chọn kho CRM nhận dữ liệu cho từng file.');
    for (const row of file.rows) {
      const key = row.sku.toLowerCase();
      const current = merged.get(key) || { sku: row.sku, stock: {} };
      const quantity = (current.stock[file.warehouseId] || 0) + row.onHand;
      if (!Number.isFinite(quantity) || Math.abs(quantity) > 1e12) throw Error(`Mã ${row.sku}: tổng số lượng vượt giới hạn.`);
      current.stock[file.warehouseId] = quantity;
      merged.set(key, current);
    }
  }
  if (merged.size > 50000) throw Error('Tổng cộng tối đa 50.000 mã mỗi lượt.');
  return [...merged.values()];
}
