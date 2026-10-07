import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKpiCv, computePayroll, computePayslip, monthRange, parseMonthInputs, parseParams, shiftMonth, summarizeAttendance, targetPercent, EMPTY_PROFILE, EMPTY_PARAMS, type MonthInputs, type PayScheme, type SchemeParams } from './payroll.ts';

test('tháng: số ngày, đầu / cuối tháng, cộng trừ tháng qua năm', () => {
  assert.deepEqual(monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29', next: '2024-03-01', days: 29 });
  assert.equal(monthRange('2026-12').next, '2027-01-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-10', -5), '2026-05');
});

test('ngày công: đủ công 1, nửa công 0,5, nghỉ có lương 1, nghỉ không lương / vắng 0', () => {
  const s = summarizeAttendance([{ status: 'present' }, { status: 'present' }, { status: 'half' }, { status: 'paid_leave' }, { status: 'unpaid_leave' }, { status: 'absent' }, { status: 'la' }]);
  assert.deepEqual(s, { worked: 3.5, present: 2, half: 1, paidLeave: 1, unpaidLeave: 1, absent: 1, recorded: 6 });
});

test('phiếu lương: lương theo ngày công + phụ cấp + thưởng + hoa hồng − khấu trừ − bảo hiểm − tạm ứng', () => {
  const p = computePayslip({
    profile: { ...EMPTY_PROFILE, baseSalary: 10_400_000, allowance: 1_000_000, standardDays: 26, revenueTarget: 100_000_000, commissionRate: 2, insurance: 500_000 },
    workedDays: 24.5, revenue: 50_000_000,
    adjustments: [{ kind: 'bonus', amount: 300_000 }, { kind: 'bonus', amount: 200_000 }, { kind: 'allowance', amount: 100_000 }, { kind: 'deduction', amount: 50_000 }, { kind: 'advance', amount: 2_000_000 }],
  });
  assert.equal(p.salaryByDays, 9_800_000);
  assert.equal(p.commission, 1_000_000);
  assert.equal(p.gross, 9_800_000 + 1_000_000 + 100_000 + 500_000 + 1_000_000);
  assert.equal(p.net, p.gross - 50_000 - 500_000 - 2_000_000);
  assert.equal(computePayslip({ profile: { ...EMPTY_PROFILE, standardDays: 0 }, workedDays: 0, revenue: 0, adjustments: [] }).standardDays, 26, 'ngày công chuẩn 0 → mặc định 26');
});

test('% hoàn thành chỉ tiêu', () => {
  assert.equal(targetPercent(45_000_000, 60_000_000), 75);
  assert.equal(targetPercent(1, 3), 33.3);
  assert.equal(targetPercent(10, 0), null);
});


// ---------------- Đối chiếu với file Excel bảng lương tháng 9/2026 (số "Thực nhận" trong file; lệch tối đa 1 đồng do làm tròn từng khoản)
const LCB = 4_758_000;
function slip(scheme: PayScheme, base: number, worked: number, params: Partial<SchemeParams>, inputs: MonthInputs, bhxh = 0, adjustments: { kind: string; amount: number }[] = []) {
  return computePayroll({ profile: { ...EMPTY_PROFILE, scheme, baseSalary: base, insurance: bhxh, params: { ...EMPTY_PARAMS, ...params } }, workedDays: worked, revenue: 0, adjustments, inputs });
}
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) <= 1, `${msg}: ${a} ≠ ${b}`);

test('bảng lương Sale khớp file Excel', () => {
  const ngoc = slip('sale', LCB, 24, { capabilityCoef: 7, responsibility: 1_000_000, meal: true }, { kpiOverride: 1.1572, revenue: 568_184_000, phone: 250_000, phoneAdvance: 311_599 }, 496_650);
  near(ngoc.gross, 15_060_208, 'Ngọc tổng thu nhập'); near(ngoc.net, 14_251_959, 'Ngọc thực nhận'); assert.equal(ngoc.commission, 6_818_208);
  near(slip('sale', LCB, 26, { capabilityCoef: 11, responsibility: 1_000_000, meal: true }, { otherBonus: 2_000_000 }, 496_650).net, 10_761_350, 'Thủy');
  near(slip('sale', LCB, 25, { capabilityCoef: 2, responsibility: 1_000_000, meal: true }, { otherBonus: 1_000_000, overtimeHours: 1.5 }, 496_650).net, 7_802_693.75, 'Tiên (tăng ca 1,5 giờ)');
  near(slip('sale', LCB, 18, { capabilityCoef: 4, responsibility: 1_000_000, responsibilityMode: 'prorated', meal: true, outputRate: 15_000 }, { outputQty: 11, otherBonus: 1_000_000 }, 496_650).net, 6_354_657.69, 'Tâm (trách nhiệm theo ngày công, 11 đơn kho)');
  near(slip('sale', LCB, 26, { capabilityCoef: 3, responsibility: 800_000, meal: true, outputRate: 0.005 }, { outputQty: 80_702_409, otherBonus: 1_000_000 }, 496_650).net, 8_364_862.05, 'Lợi (0,5% DS web)');
  near(slip('sale', 5_000_000, 22, { outputRate: 15_000 }, { outputQty: 4 }).net, 4_290_769.23, 'Thử việc, không cơm xăng');
});

test('KPI CV Sale: KH mới, giao dịch, HĐ, DS; thưởng theo mức KPI', () => {
  near(Math.round(computeKpiCv({ newCustomers: 7, transactions: 52, contracts: 2, revenue: 541_830_000, hangDays: 0 }) * 10000), 7451, 'KPI Ngọc từ số thực hiện');
  assert.equal(computeKpiCv({ newCustomers: 97, transactions: 261, contracts: 9, revenue: 0, hangDays: 0 }), 0.2 + 0.3 + 0.1, 'vượt chỉ tiêu: KH mới 20%, giao dịch 30%, HĐ 10%');
  assert.equal(computeKpiCv({ newCustomers: 0, transactions: 0, contracts: 0, revenue: 0, hangDays: 1 }), 4 / 96 * 0.1 + 10 / 260 * 0.3, 'mỗi ngày làm hàng cộng 4 KH mới, 10 giao dịch');
  const reward = (kpi: number) => slip('sale', LCB, 26, {}, { kpiOverride: kpi, revenue: 100_000_000 }).commission;
  assert.deepEqual([reward(0.95), reward(0.9), reward(0.6), reward(0.59)], [1_200_000, 1_200_000, 500_000, 0]);
  assert.equal(slip('sale', LCB, 26, {}, { revenue: 100_000_000 }).commission, 0, 'chưa có KPI thì chưa thưởng');
});

test('bảng lương Bách Ngân khớp file Excel; thưởng DS theo DS trung bình 6 tháng', () => {
  const ngan = slip('bachngan', LCB, 15, { responsibility: 20_000, responsibilityMode: 'per_day', meal: true }, { attendanceBonus: 200_000, overtimeHours: 24, revenue: 188_288_191 }, 496_650);
  near(ngan.gross, 5_134_500, 'Kim Ngân tổng lương'); near(ngan.net, 4_637_850, 'Kim Ngân thực nhận (24 giờ tăng ca = LCB ÷ 24 ÷ 8 × giờ × 2)');
  near(slip('bachngan', LCB, 7, { capabilityCoef: 1, responsibility: 20_000, responsibilityMode: 'per_day', meal: true }, { attendanceBonus: 200_000, overtimeHours: 0.5 }, 496_650).net, 1_649_131.25, 'Yến');
  const bonus = (revenue: number, avg: number) => slip('bachngan', LCB, 26, {}, { revenue, avgRevenue6: avg }).commission;
  assert.deepEqual([bonus(400_000_000, 400_000_000), bonus(350_000_000, 400_000_000), bonus(300_000_000, 250_000_000), bonus(320_000_000, 400_000_000), bonus(500_000_000, 0)], [2_000_000, 875_000, 0, 0, 0]);
});

test('bảng lương Lock khớp file Excel; thưởng theo DS team', () => {
  const p = { responsibility: 20_000, responsibilityMode: 'per_day' as const, meal: true };
  near(slip('lock', LCB, 27, { ...p, capabilityCoef: 1 }, { attendanceBonus: 200_000, revenue: 310_252_962 }, 496_650).net, 9_061_247.22, 'Huỳnh Châu Quan');
  near(slip('lock', 5_000_000, 26, { meal: true }, { attendanceBonus: 200_000, revenue: 310_252_962 }, 496_650).net, 8_330_247.22, 'Cao Mỵ Nương');
  near(slip('lock', 5_000_000, 22, {}, {}).net, 4_230_769.23, 'Đặng Võ Bảo Trân (thử việc)');
  const bonus = (revenue: number) => slip('lock', LCB, 26, {}, { revenue }).commission;
  assert.deepEqual([bonus(254_999_999), bonus(255_000_000), bonus(263_500_000), bonus(309_999_999), bonus(310_000_000)], [0, 1_275_000, 1_317_500, 1_550_000, 2_325_000]);
});

test('phiếu lương nhiều khoản: dòng chi tiết cộng đúng, thưởng/phạt/tạm ứng của hệ thống được cộng vào', () => {
  const r = slip('lock', LCB, 26, { meal: true }, { revenue: 0, bhyt: 71_370, tncn: 10_000 }, 496_650, [{ kind: 'bonus', amount: 100_000 }, { kind: 'allowance', amount: 50_000 }, { kind: 'deduction', amount: 20_000 }, { kind: 'advance', amount: 1_000_000 }]);
  const income = r.lines.filter(l => l.type === 'income').reduce((s, l) => s + l.amount, 0), out = r.lines.filter(l => l.type === 'deduction').reduce((s, l) => s + l.amount, 0);
  assert.equal(r.gross, income); assert.equal(r.net, income - out);
  assert.equal(r.net, r.gross - r.deduction - r.insurance - r.advance, 'khớp công thức thực lĩnh cũ');
  assert.equal(r.insurance, 496_650 + 71_370 + 10_000);
});

test('cách tính cũ (basic) vẫn như trước và có dòng chi tiết để in', () => {
  const r = computePayroll({ profile: { ...EMPTY_PROFILE, baseSalary: 10_400_000, allowance: 1_000_000, commissionRate: 2, insurance: 500_000 }, workedDays: 26, revenue: 50_000_000, adjustments: [{ kind: 'advance', amount: 1_000_000 }] });
  assert.equal(r.scheme, 'basic'); assert.equal(r.net, 10_400_000 + 1_000_000 + 1_000_000 - 500_000 - 1_000_000);
  assert.deepEqual(r.lines.map(l => l.key), ['salary', 'allowance', 'commission', 'insurance', 'advance']);
});

test('đọc tham số / dữ liệu tháng lưu JSON: bỏ khoá lạ, số âm, chuỗi hỏng', () => {
  assert.deepEqual(parseParams('{"capabilityCoef":7,"meal":true,"responsibilityMode":"per_day","responsibility":20000,"x":1}'), { capabilityCoef: 7, responsibility: 20_000, responsibilityMode: 'per_day', meal: true, outputRate: 0 });
  assert.deepEqual(parseParams('không phải json'), EMPTY_PARAMS);
  assert.deepEqual(parseMonthInputs('{"revenue":5,"phone":-1,"bhyt":"abc","tncn":"","hack":9,"kpiOverride":1.15}'), { revenue: 5, kpiOverride: 1.15 });
});
