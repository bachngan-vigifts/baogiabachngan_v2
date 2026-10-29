import { withBusy } from './busy-buttons.js';
/**
 * XUẤT EXCEL dùng chung (Công nợ, Công nợ NCC, Sổ thu / chi): tạo file .xlsx ngay trên trình duyệt từ bảng dữ liệu đang xem.
 * Thư viện xlsx.full.min.js chỉ tải khi bấm xuất lần đầu.
 */
let excelPromise;
function excel() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  return excelPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = new URL('./xlsx.full.min.js', import.meta.url).href;
    s.onload = () => resolve(globalThis.XLSX); s.onerror = () => { excelPromise = null; s.remove(); reject(Error('Không tải được bộ tạo Excel.')); }; document.head.append(s);
  });
}

/**
 * `sheets`: [{ name, header: string[], rows: (string|number|null)[][], widths?: number[] }]. Số giữ dạng số (cộng / lọc được trong Excel).
 * Tên file tự thêm ngày xuất, VD "cong-no_2026-10-17.xlsx".
 */
/** Tạo file mất vài giây với bảng lớn: nút vừa bấm hiện đang xử lý và không bấm trùng được (busy-buttons.js). */
export function downloadExcel(filename, sheets) { return withBusy('EXPORT', buildExcel(filename, sheets)); }
async function buildExcel(filename, sheets) {
  const X = await excel(), wb = X.utils.book_new();
  for (const s of sheets) {
    const ws = X.utils.aoa_to_sheet([s.header, ...s.rows]);
    ws['!cols'] = (s.widths || s.header.map(h => Math.max(10, String(h).length + 2))).map(wch => ({ wch }));
    if (s.autoFilter && s.header.length) ws['!autofilter'] = { ref: `A1:${X.utils.encode_col(s.header.length - 1)}${s.rows.length + 1}` };
    X.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  X.writeFile(wb, `${filename}_${new Date().toLocaleDateString('sv-SE')}.xlsx`);
}
/** Đọc trang tính đầu tiên của file Excel / CSV người dùng chọn → mảng các dòng (ô giữ giá trị gốc: số là số). */
export async function readSheet(file) {
  const X = await excel(), wb = X.read(await file.arrayBuffer(), { type: 'array', codepage: 65001, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]]; if (!ws) throw new Error('File không có trang tính nào.');
  return X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}
