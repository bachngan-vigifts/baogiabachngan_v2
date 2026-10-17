// Đọc dữ liệu file độc lập với giao diện; dùng chung cho Excel và CSV.
export const normalizeHeader = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');
export const findHeader = rows => rows.slice(0, 200).findIndex(row => row.some(v => ['sku', 'masku', 'mahang', 'masanpham', 'itemname'].includes(normalizeHeader(v))));
export function fileNumber(value, line, label) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  let text = String(value).trim().replace(/\s/g, '');
  if (typeof value === 'string') {
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(Number(text)) || Math.abs(Number(text)) > 1e12) throw Error(`Dòng ${line}, ${label}: số không hợp lệ.`);
  return Number(text);
}
export function parseProductFile(rows, header, mapping, kind, hiddenRows = [], unit = 'mm') {
  if (!Number.isInteger(header) || header < 0 || header > 199 || header >= rows.length) throw Error('Dòng tiêu đề phải nằm trong 200 dòng đầu của trang tính.');
  const columns = Object.values(mapping).filter(v => v !== null);
  if (mapping.sku === null || columns.length < 2 || new Set(columns).size !== columns.length) throw Error('Chọn cột SKU và ít nhất một cột dữ liệu riêng biệt.');
  const found = new Map(); let blanks = 0, hidden = 0, duplicates = 0;
  for (let i = header + 1; i < rows.length; i++) {
    if (hiddenRows[i]?.hidden) { hidden++; continue; }
    const row = rows[i] || [], sku = String(row[mapping.sku] ?? '').trim(); if (!sku) continue;
    const data = {};
    for (const [name, col] of Object.entries(mapping)) {
      if (name === 'sku' || col === null) continue;
      const n = fileNumber(row[col], i + 1, name);
      if (n === null) { blanks++; continue; }
      if (kind === 'stock') data[name] = Math.sign(n) * Math.floor(Math.abs(n) + .5);
      else {
        if (n < 0 || n > 1e6 || name === 'perCarton' && !Number.isInteger(n)) throw Error(`Dòng ${i + 1}: quy cách phải dương, SP/thùng phải là số nguyên.`);
        if (n === 0) { blanks++; continue; }
        data[name] = Math.round(n / (name.startsWith('carton') && name !== 'cartonWeight' && unit === 'mm' ? 10 : 1) * 1000) / 1000;
      }
    }
    if (!Object.keys(data).length) continue;
    const key = sku.toLowerCase(), previous = found.get(key);
    if (previous) {
      duplicates++;
      if (kind !== 'stock') throw Error(`Dòng ${i + 1}: SKU ${sku} bị lặp.`);
      for (const [w, n] of Object.entries(data)) previous.stock[w] = Math.max(previous.stock[w] ?? -Infinity, n);
    } else found.set(key, { sku, [kind === 'stock' ? 'stock' : 'fields']: data });
  }
  if (!found.size) throw Error('File không có dòng dữ liệu để cập nhật.');
  if (found.size > 5000) throw Error('Tối đa 5.000 mã mỗi lượt. Chia file thành các phần nhỏ hơn.');
  return { rows: [...found.values()], blanks, hidden, duplicates };
}
