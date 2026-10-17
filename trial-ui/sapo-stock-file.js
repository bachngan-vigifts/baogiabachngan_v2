import { normalizeHeader, fileNumber } from './product-file.js';

const aliases = {
  sku: ['sku', 'masku', 'mahang', 'masanpham', 'maphienban', 'maphienbansanpham'],
  onHand: ['ton', 'tonkho', 'toncuoi', 'toncuoiky', 'soluongton', 'onhand', 'instock'],
  committed: ['danggiaodich', 'soluongdanggiaodich', 'hangdanggiaodich', 'committed', 'allocated'],
};
export function detectSapoColumns(rows) {
  const header = rows.slice(0, 200).findIndex(row => row.some(v => aliases.sku.includes(normalizeHeader(v))));
  const labels = (rows[header] || []).map(normalizeHeader);
  return { header, mapping: Object.fromEntries(Object.entries(aliases).map(([k, values]) => [k, labels.findIndex(v => values.includes(v))])) };
}
export function parseSapoStockFile(rows, header, mapping, hiddenRows = []) {
  const cols = ['sku', 'onHand', 'committed'].map(k => mapping[k]);
  if (!Number.isInteger(header) || header < 0 || header > 199 || header >= rows.length || cols.some(c => !Number.isInteger(c) || c < 0) || new Set(cols).size !== 3)
    throw Error('Chọn ba cột riêng biệt: Mã hàng, Tồn và Đang giao dịch.');
  const result = [], seen = new Set(); let hidden = 0;
  for (let i = header + 1; i < rows.length; i++) {
    if (hiddenRows[i]?.hidden) { hidden++; continue; }
    const row = rows[i] || [], value = row[mapping.sku], sku = String(value ?? '').trim();
    if (!sku) continue;
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw Error(`Dòng ${i + 1}: mã hàng phải lưu dạng chữ để giữ đúng mã.`);
    if (seen.has(sku.toLowerCase())) throw Error(`Dòng ${i + 1}: mã ${sku} bị lặp trong cùng file. Kiểm tra lại file xuất Sapo.`);
    const onHand = fileNumber(row[mapping.onHand], i + 1, 'Tồn'), committed = fileNumber(row[mapping.committed], i + 1, 'Đang giao dịch');
    if (onHand === null || committed === null || committed < 0) throw Error(`Dòng ${i + 1}: cần đủ Tồn và Đang giao dịch; nhập 0 nếu không có giao dịch.`);
    if (Math.abs(onHand - committed) > 1e12) throw Error(`Dòng ${i + 1}: tồn khả dụng vượt giới hạn.`);
    seen.add(sku.toLowerCase()); result.push({ sku, onHand, committed });
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
      const current = merged.get(key) || { sku: row.sku, stock: {}, transactions: {} };
      const raw = current.transactions[file.warehouseId] || { onHand: 0, committed: 0 };
      raw.onHand += row.onHand; raw.committed += row.committed;
      if ([raw.onHand, raw.committed, raw.onHand - raw.committed].some(n => !Number.isFinite(n) || Math.abs(n) > 1e12)) throw Error(`Mã ${row.sku}: tổng số lượng vượt giới hạn.`);
      current.transactions[file.warehouseId] = raw;
      current.stock[file.warehouseId] = raw.onHand - raw.committed;
      merged.set(key, current);
    }
  }
  if (merged.size > 50000) throw Error('Tổng cộng tối đa 50.000 mã mỗi lượt.');
  return [...merged.values()];
}
