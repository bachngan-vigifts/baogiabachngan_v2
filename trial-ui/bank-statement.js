// ĐỐI CHIẾU SAO KÊ NGÂN HÀNG (trang Công nợ): tải file sao kê (Excel / CSV) → mỗi dòng tiền VÀO được ghép với công nợ
// đang còn phải thu → người dùng duyệt từng dòng rồi mới ghi thu (POST /payments, hình thức Chuyển khoản).
//  - Ghép chắc: nội dung chuyển khoản có số đơn / số HĐKT (bỏ dấu, khoảng trắng, gạch dưới) → chọn sẵn.
//  - Gợi ý: không có số chứng từ nhưng số tiền đúng bằng số còn nợ (hoặc quá hạn) của DUY NHẤT một đơn → không chọn sẵn, phải xem kỹ.
//  - Không khớp / vượt số còn nợ / tiền ra: không ghi được từ đây.
// Mã chống lặp suy ra từ (mã giao dịch ngân hàng, ngày, số tiền, đơn): tải lại cùng file hôm sau cũng không ghi thu lần hai.
export const TEMPLATE_HEADER = ['Ngày giao dịch', 'Số tiền ghi có (VND)', 'Nội dung chuyển khoản', 'Mã giao dịch ngân hàng', 'Tên người chuyển'];
export const TEMPLATE_SAMPLE = [
  ['28/10/2026', 5000000, 'CONG TY AN PHAT TT DH_20261020_005', 'FT26301123456', 'CONG TY TNHH AN PHAT'],
  ['28/10/2026', 12500000, 'TT HDKT B2B_HD_012 dot 2', 'FT26301987654', 'NGUYEN VAN A'],
];
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toUpperCase();
/** Chuỗi so khớp: bỏ dấu, chỉ giữ chữ + số (DH_20261020_005, "DH 20261020 005" → DH20261020005). */
export const compact = s => fold(s).replace(/[^A-Z0-9]/g, '');
const pad = n => String(n).padStart(2, '0');
/** Ngày: dd/mm/yyyy (hoặc dd-mm-yyyy, có giờ phía sau), yyyy-mm-dd, hoặc số ngày kiểu Excel. */
export function parseDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  const s = String(v ?? '').trim(); let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
/** Số tiền: số, hoặc chuỗi "1.234.567" / "1,234,567" / "1 234 567 đ". Âm hoặc rỗng → 0. */
export function parseAmount(v) {
  if (typeof v === 'number') return v > 0 ? Math.round(v) : 0;
  const s = String(v ?? '').replace(/[^\d.,-]/g, ''); if (!s || s.startsWith('-')) return 0;
  const n = Number(s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}
const COLS = {
  date: /^(NGAY( GIAO DICH| GD| HACH TOAN)?|TRANSACTION DATE|DATE|NGAY GIO)$/,
  amount: /^(SO TIEN GHI CO( \(VND\))?|GHI CO|CO|CREDIT( AMOUNT)?|SO TIEN( \(VND\))?|PHAT SINH CO)$/,
  content: /^(NOI DUNG( CHUYEN KHOAN| GIAO DICH)?|DIEN GIAI|MO TA|DESCRIPTION|REMARK|CHI TIET GIAO DICH)$/,
  ref: /^(MA GIAO DICH( NGAN HANG)?|SO THAM CHIEU|SO CHUNG TU|REFERENCE( NO)?|TRANSACTION (NO|ID)|MA GD|SO BUT TOAN)$/,
  payer: /^(TEN NGUOI CHUYEN|NGUOI CHUYEN|TEN DOI UNG|DOI TAC|TEN TAI KHOAN DOI UNG)$/,
};
/**
 * Đọc bảng (mảng các dòng, ô gốc) của file sao kê: tìm dòng tiêu đề trong 20 dòng đầu theo tên cột thường gặp
 * (file mẫu và tên cột phổ biến của ngân hàng), lấy các dòng tiền vào. Thiếu cột Ngày / Số tiền / Nội dung → báo lỗi rõ.
 */
export function parseStatement(aoa) {
  const head = aoa.slice(0, 20).findIndex(r => (r || []).some(c => COLS.amount.test(fold(c).trim())) && (r || []).some(c => COLS.content.test(fold(c).trim())));
  if (head < 0) throw new Error('Không tìm thấy dòng tiêu đề (cần cột Ngày giao dịch, Số tiền ghi có, Nội dung chuyển khoản). Dùng file mẫu nếu ngân hàng xuất tên cột khác.');
  const names = aoa[head].map(c => fold(c).trim()), at = key => names.findIndex(n => COLS[key].test(n));
  const col = { date: at('date'), amount: at('amount'), content: at('content'), ref: at('ref'), payer: at('payer') };
  if (col.date < 0) throw new Error('Thiếu cột Ngày giao dịch.');
  const rows = [];
  for (const [i, r] of aoa.slice(head + 1).entries()) {
    if (!r || !r.some(c => String(c ?? '').trim())) continue;
    const amount = parseAmount(r[col.amount]), date = parseDate(r[col.date]);
    if (!amount || !date) continue; // tiền ra, dòng tổng, dòng trống
    rows.push({ line: head + i + 2, date, amount, content: String(r[col.content] ?? '').trim(), ref: col.ref >= 0 ? String(r[col.ref] ?? '').trim() : '', payer: col.payer >= 0 ? String(r[col.payer] ?? '').trim() : '' });
  }
  return rows;
}
/**
 * Ghép từng dòng sao kê với công nợ đang còn phải thu (`receivables`: dòng của GET /receivables).
 * Kết quả: { row, match: receivable|null, kind: 'doc'|'amount'|'none', note, selectable, selected }.
 */
export function matchStatement(rows, receivables) {
  const open = receivables.filter(r => r.balance > 0);
  const keys = open.flatMap(r => [r.orderNo, r.contractNo].filter(Boolean).map(no => ({ r, key: compact(no) }))).filter(k => k.key.length >= 6);
  const seen = new Set();
  return rows.map(row => {
    const id = row.ref ? 'ref:' + row.ref : `${row.date}|${row.amount}|${row.content}`;
    if (seen.has(id)) return { row, match: null, kind: 'none', note: 'Trùng dòng phía trên trong file', selectable: false, selected: false };
    seen.add(id);
    const text = compact(row.content);
    const hits = keys.filter(k => text.includes(k.key)).sort((a, b) => b.key.length - a.key.length);
    const docs = [...new Set(hits.map(h => h.r))];
    let match = null, kind = 'none', note = 'Không thấy số đơn / HĐKT, số tiền không trùng công nợ nào';
    if (docs.length === 1 || (docs.length > 1 && hits[0].key.length > hits[1].key.length)) { match = hits[0].r; kind = 'doc'; note = 'Nội dung có số ' + (match.contractNo || match.orderNo); }
    else if (docs.length > 1) note = 'Nội dung nhắc nhiều đơn – ghi tay từng đơn';
    else {
      const same = open.filter(r => r.balance === row.amount || r.overdue === row.amount);
      if (same.length === 1) { match = same[0]; kind = 'amount'; note = 'Gợi ý: số tiền đúng bằng công nợ của đơn này – kiểm tra người chuyển trước khi ghi'; }
      else if (same.length > 1) note = `${same.length} đơn cùng số tiền – không tự ghép`;
    }
    if (match && row.amount > match.balance) return { row, match, kind, note: `Số tiền vượt số còn nợ (${match.balance.toLocaleString('vi-VN')} đ) – ghi tay`, selectable: false, selected: false };
    return { row, match, kind, note, selectable: !!match, selected: kind === 'doc' };
  });
}
/** Mã chống lặp ổn định cho một dòng sao kê + đơn (SHA-256, đúng dạng máy chủ chấp nhận: 16–100 ký tự chữ số / gạch). */
export async function bankKey(row, orderId) {
  const data = new TextEncoder().encode([row.ref, row.date, row.amount, orderId, row.ref ? '' : row.content].join('|'));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('');
  return 'bank-' + hash.slice(0, 40);
}
/** Nội dung ghi vào "Số chứng từ" của phiếu thu: mã giao dịch + nội dung CK (cắt ngắn). */
export const bankReference = row => [row.ref, row.content].filter(Boolean).join(' · ').slice(0, 200);
