import { test } from 'node:test';
import assert from 'node:assert/strict';
// Module trình duyệt (JS thuần) – nạp qua URL để TypeScript không đòi khai báo kiểu.
const m: any = await import(new URL('../../trial-ui/bank-statement.js', import.meta.url).href);

const receivables = [
  { orderId: 'o1', orderNo: 'DH_20261020_005', contractNo: null, customerName: 'An Phát', balance: 5000000, overdue: 5000000 },
  { orderId: 'o2', orderNo: 'DH_20261021_001', contractNo: 'B2B_HD_012', customerName: 'Bình Minh', balance: 20000000, overdue: 12500000 },
  { orderId: 'o3', orderNo: 'DH_20261022_003', contractNo: null, customerName: 'Cẩm Tú', balance: 7300000, overdue: 0 },
  { orderId: 'o4', orderNo: 'DH_20261001_009', contractNo: null, customerName: 'Đã thu đủ', balance: 0, overdue: 0 },
];

test('file mẫu đọc được; tên cột ngân hàng phổ biến; bỏ tiền ra / dòng tổng; ngày và số tiền nhiều kiểu', () => {
  const rows = m.parseStatement([['SAO KÊ TÀI KHOẢN'], m.TEMPLATE_HEADER, ...m.TEMPLATE_SAMPLE, ['', '', 'Tổng cộng', '', '']]);
  assert.equal(rows.length, 2); assert.deepEqual([rows[0].date, rows[0].amount, rows[0].ref], ['2026-10-28', 5000000, 'FT26301123456']);
  const bank = m.parseStatement([['Ngày GD', 'Ghi có', 'Ghi nợ', 'Diễn giải', 'Số tham chiếu'], [46323, '1.250.000', '', 'TT DH20261022003', 'X1'], ['27-10-2026 08:15', '', '300.000', 'Phí', 'X2']]);
  assert.equal(bank.length, 1, 'cột Ghi có trống (tiền ra) bị bỏ'); assert.deepEqual([bank[0].date, bank[0].amount], ['2026-10-28', 1250000]);
  assert.throws(() => m.parseStatement([['a', 'b'], [1, 2]]), /dòng tiêu đề/);
  assert.equal(m.parseAmount('1,234,567 đ'), 1234567); assert.equal(m.parseAmount('-5000'), 0); assert.equal(m.parseDate('2026-10-05'), '2026-10-05');
});

test('ghép: có số đơn / HĐKT trong nội dung → chọn sẵn; chỉ trùng số tiền một đơn → gợi ý (không chọn sẵn); mơ hồ / vượt nợ / trùng dòng → không ghi', () => {
  const rows = [
    { date: '2026-10-28', amount: 5000000, content: 'CONG TY AN PHAT TT DH 20261020 005', ref: 'FT1' },
    { date: '2026-10-28', amount: 12500000, content: 'TT HDKT B2B HD 012 dot 2', ref: 'FT2' },
    { date: '2026-10-28', amount: 7300000, content: 'chuyen tien hang', ref: 'FT3' },
    { date: '2026-10-28', amount: 9999, content: 'khong ro', ref: 'FT4' },
    { date: '2026-10-28', amount: 6000000, content: 'TT DH_20261020_005', ref: 'FT5' },
    { date: '2026-10-28', amount: 5000000, content: 'CONG TY AN PHAT TT DH 20261020 005', ref: 'FT1' },
  ];
  const r = m.matchStatement(rows, receivables);
  assert.deepEqual(r.map((x: any) => [x.kind, x.match?.orderId ?? null, x.selectable, x.selected]), [
    ['doc', 'o1', true, true], ['doc', 'o2', true, true], ['amount', 'o3', true, false], ['none', null, false, false], ['doc', 'o1', false, false], ['none', null, false, false]]);
  assert.match(r[4].note, /vượt số còn nợ/); assert.match(r[5].note, /Trùng dòng/);
});

test('mã chống lặp ổn định theo giao dịch + đơn (tải lại cùng file không ghi lần hai), đúng dạng máy chủ nhận', async () => {
  const row = { date: '2026-10-28', amount: 5000000, content: 'TT', ref: 'FT1' };
  const a = await m.bankKey(row, 'o1'), b = await m.bankKey({ ...row }, 'o1'), c = await m.bankKey(row, 'o2');
  assert.equal(a, b); assert.notEqual(a, c); assert.match(a, /^[a-zA-Z0-9_-]{16,100}$/);
  assert.equal(m.bankReference(row), 'FT1 · TT');
});
