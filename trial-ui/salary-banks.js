// Ngân hàng nhận lương: mã theo VietQR (img.vietqr.io nhận mã / tên viết tắt / BIN). Lưu chữ thường như hồ sơ lương.
export const SALARY_BANKS = [
  ['vcb', 'Vietcombank'], ['icb', 'VietinBank'], ['bidv', 'BIDV'], ['vba', 'Agribank'], ['tcb', 'Techcombank'], ['mb', 'MB Bank'],
  ['acb', 'ACB'], ['vpb', 'VPBank'], ['tpb', 'TPBank'], ['stb', 'Sacombank'], ['hdb', 'HDBank'], ['vib', 'VIB'], ['shb', 'SHB'],
  ['eib', 'Eximbank'], ['msb', 'MSB'], ['ocb', 'OCB'], ['seab', 'SeABank'], ['lpb', 'LPBank'], ['nab', 'Nam A Bank'], ['abb', 'ABBANK'],
  ['bab', 'Bac A Bank'], ['vccb', 'BVBank (Bản Việt)'], ['klb', 'KienlongBank'], ['pgb', 'PGBank'], ['ncb', 'NCB'], ['vab', 'VietABank'],
  ['vietbank', 'Vietbank'], ['pvcb', 'PVcomBank'], ['scb', 'SCB'], ['cake', 'CAKE by VPBank'], ['ubank', 'Ubank by VPBank'], ['timo', 'Timo'],
];
const NAME = new Map(SALARY_BANKS);
/** Tên ngân hàng để hiện (mã lạ / nhập tay cũ → hiện mã in hoa). */
export const bankName = code => NAME.get(String(code || '').toLowerCase()) || String(code || '').toUpperCase();
/** <option> chọn ngân hàng; giữ mã cũ không có trong danh sách để không mất dữ liệu. */
export const bankOptions = (current, esc) => {
  const cur = String(current || '').toLowerCase(), list = cur && !NAME.has(cur) ? [[cur, cur.toUpperCase()], ...SALARY_BANKS] : SALARY_BANKS;
  return `<option value="">– Chọn ngân hàng –</option>${list.map(([v, t]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(t)}</option>`).join('')}`;
};
