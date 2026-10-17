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
export async function downloadExcel(filename, sheets) {
  const X = await excel(), wb = X.utils.book_new();
  for (const s of sheets) {
    const ws = X.utils.aoa_to_sheet([s.header, ...s.rows]);
    ws['!cols'] = (s.widths || s.header.map(h => Math.max(10, String(h).length + 2))).map(wch => ({ wch }));
    X.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  X.writeFile(wb, `${filename}_${new Date().toLocaleDateString('sv-SE')}.xlsx`);
}
