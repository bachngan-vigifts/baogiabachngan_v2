/**
 * Nhập đơn mua NCC từ file Excel tổng đơn đặt hàng của NCC (mẫu Minh Long – xem docs/NCC-PAGE.md mục "Nhập đơn mua từ Excel").
 * Đọc các cột: Đơn hàng (số đơn phía NCC) · Ngày giao gốc · Mã hàng · Tên hàng · Sl đặt · ĐG Bán · Chiết khấu · SL giao.
 * Các dòng cùng "Đơn hàng" gom thành một đơn mua. Cột khác bỏ qua.
 * Hàm thuần (không DOM) để test được: nhận bảng ô dạng mảng 2 chiều (giá trị gốc + chữ hiển thị).
 */
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Tên cột → khoá; dự phòng theo vị trí cột của mẫu Minh Long (A, E, F, G, L, O, Q, R) khi không thấy dòng tiêu đề. */
const COLUMNS = [
  ['order', ['don hang'], 0],
  ['date', ['ngay giao goc'], 4],
  ['sku', ['ma hang'], 5],
  ['name', ['ten hang'], 6],
  ['qty', ['sl dat', 'so luong dat'], 11],
  ['price', ['dg ban', 'don gia ban', 'don gia'], 14],
  ['discount', ['chiet khau'], 16],
  ['received', ['sl giao', 'so luong giao'], 17],
  ['value', ['trigiadonhang', 'tri gia don hang'], 15],
];

const num = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  // "1.234.567" hoặc "1,234,567" (dấu nghìn) / "26,13" (dấu thập phân kiểu Việt).
  const t = /^-?\d{1,3}([.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, '') : s.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const pad = n => String(n).padStart(2, '0');
/** Ngày: "dd/mm/yyyy", số ngày kiểu Excel, hoặc Date → "yyyy-mm-dd" ('' nếu không đọc được). */
export function isoDate(v) {
  if (v instanceof Date && !Number.isNaN(+v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return d.toISOString().slice(0, 10); }
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(String(v ?? ''));
  if (m) { const [, d, mo, y] = m.map(Number); const t = new Date(Date.UTC(y, mo - 1, d)); if (t.getUTCMonth() === mo - 1 && t.getUTCDate() === d) return `${y}-${pad(mo)}-${pad(d)}`; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '').trim())) return String(v).trim();
  return '';
}

/**
 * @param raw  bảng giá trị gốc (số là số) – XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })
 * @param text bảng chữ hiển thị (giữ số 0 đầu của mã hàng) – sheet_to_json(ws, { header: 1, raw: false })
 * @returns {{ orders: {internalNo, arrivalDate, lines: {sku, name, quantity, price, discount, received, row}[]}[], warnings: string[], rows: number }}
 */
export function parsePurchaseSheet(raw, text = raw) {
  const head = raw.findIndex(r => (r || []).some(c => fold(c) === 'don hang') && (r || []).some(c => fold(c) === 'ma hang'));
  const cols = {};
  for (const [k, names, fallback] of COLUMNS) {
    const at = head >= 0 ? raw[head].findIndex(c => names.includes(fold(c))) : -1;
    cols[k] = at >= 0 ? at : fallback;
  }
  const warnings = [], orders = new Map();
  let rows = 0;
  for (let i = head + 1; i < raw.length; i++) {
    const r = raw[i] || [], t = text[i] || [], line = i + 1;
    const cell = k => r[cols[k]], label = k => String(t[cols[k]] ?? r[cols[k]] ?? '').trim();
    const no = label('order'), sku = label('sku');
    if (!no && !sku) continue;
    rows++;
    if (!no) { warnings.push(`Dòng ${line}: thiếu số đơn hàng – bỏ qua.`); continue; }
    if (!sku) { warnings.push(`Dòng ${line} (${no}): thiếu mã hàng – bỏ qua.`); continue; }
    const quantity = num(cell('qty')), price = num(cell('price')), discount = num(cell('discount')) ?? 0, received = num(cell('received')) ?? 0, value = num(cell('value'));
    if (!(quantity > 0) || !Number.isInteger(quantity)) { warnings.push(`Dòng ${line} (${no} – ${sku}): số lượng đặt không hợp lệ – bỏ qua.`); continue; }
    if (!(price >= 0)) { warnings.push(`Dòng ${line} (${no} – ${sku}): thiếu đơn giá – bỏ qua.`); continue; }
    if (!(discount >= 0 && discount <= 100)) { warnings.push(`Dòng ${line} (${no} – ${sku}): chiết khấu ${discount} không hợp lệ – bỏ qua.`); continue; }
    if (received < 0 || received > quantity) warnings.push(`Dòng ${line} (${no} – ${sku}): SL giao ${received} vượt SL đặt ${quantity} – chỉ ghi nhận ${quantity}.`);
    const expect = Math.round(quantity * price * (1 - discount / 100));
    if (value !== null && Math.abs(value - expect) > Math.max(2, expect * 0.001))
      warnings.push(`Dòng ${line} (${no} – ${sku}): trị giá trong file ${Math.round(value).toLocaleString('vi-VN')} khác SL × giá × (1 − CK) = ${expect.toLocaleString('vi-VN')}. Hệ thống tính theo SL × giá × CK.`);
    const date = isoDate(cell('date')) || isoDate(label('date'));
    const o = orders.get(no) || { internalNo: no, arrivalDate: '', lines: [] };
    if (date && (!o.arrivalDate || date > o.arrivalDate)) o.arrivalDate = date;
    const same = o.lines.find(l => l.sku.toLowerCase() === sku.toLowerCase());
    if (same) {
      if (same.price !== price || same.discount !== discount) { warnings.push(`Dòng ${line} (${no} – ${sku}): mã lặp trong đơn với giá / CK khác dòng ${same.row} – bỏ qua.`); continue; }
      same.quantity += quantity; same.received = Math.min(same.quantity, same.received + Math.max(0, received));
      warnings.push(`Dòng ${line} (${no} – ${sku}): mã lặp trong đơn – cộng số lượng vào dòng ${same.row}.`);
    } else o.lines.push({ sku, name: label('name'), quantity, price, discount, received: Math.min(quantity, Math.max(0, received)), promisedDate: date, row: line });
    orders.set(no, o);
  }
  return { orders: [...orders.values()], warnings, rows };
}

/** Tổng tiền hàng (chưa VAT) của một đơn đọc từ file. */
export const orderSubtotal = o => o.lines.reduce((t, l) => t + Math.round(l.quantity * l.price * (1 - l.discount / 100)), 0);
