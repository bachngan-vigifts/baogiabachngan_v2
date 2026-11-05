import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_GROUP_MONTH, EMPTY_INPUT, EMPTY_PROFILE, bnSalesBonus, computePayslip, computeQuarterBonus, lockSalesBonus, monthRange, quarterMonths,
  shiftMonth, summarizeAttendance, targetPercent, vietQrUrl, normalizeBank, type PayrollInput, type SalaryProfile,
} from './payroll.ts';
import { computeKpiCv } from './kpi-cv.ts';
import { DEFAULT_PARAMS, mergeParams, validateParams } from './params.ts';

// Số liệu đối chiếu lấy từ file "Bảng lương mẫu T9/2026" (tên người đã bỏ). Kết quả phải khớp từng đồng (làm tròn từng khoản).
const P = DEFAULT_PARAMS;
const run = (profile: Partial<SalaryProfile>, input: Partial<PayrollInput> = {}, extra: { adjustments?: { kind: string; amount: number }[]; days?: number; revenue?: number; gm?: Partial<typeof EMPTY_GROUP_MONTH> } = {}) =>
  computePayslip({ profile: { ...EMPTY_PROFILE, ...profile }, params: P, input: { ...EMPTY_INPUT, ...input }, adjustments: extra.adjustments ?? [],
    attendanceDays: extra.days ?? 0, systemRevenue: extra.revenue ?? 0, groupMonth: { ...EMPTY_GROUP_MONTH, ...extra.gm }, quarterBonusAuto: 0 });
const amount = (r: ReturnType<typeof run>, key: string) => [...r.income, ...r.deductions].find(l => l.key === key)!.amount;

test('tháng / quý / ngày công', () => {
  assert.deepEqual(monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29', next: '2024-03-01', days: 29 });
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.deepEqual(quarterMonths('2026-08'), { quarter: 3, months: ['2026-07', '2026-08', '2026-09'], isQuarterEnd: false });
  assert.equal(quarterMonths('2026-09').isQuarterEnd, true);
  assert.equal(summarizeAttendance([{ status: 'present' }, { status: 'half' }, { status: 'paid_leave' }, { status: 'absent' }]).worked, 2.5);
});

test('Sale – nhân viên kinh doanh (KPI CV chốt 115,72%, DS 568.184.000): thu nhập 15.060.208, thực nhận 14.251.959', () => {
  const r = run({ payrollGroup: 'sale', capacityCoef: 7, responsibility: 1_000_000, kpiEnabled: true, phoneAllowance: 250_000, insurance: 496_650 },
    { workDays: 24, revenue: 568_184_000, kpiOverride: 1.1572 }, { adjustments: [{ kind: 'phone_advance', amount: 311_599 }] });
  assert.equal(r.baseSalary, 4_758_000, 'LCB trống → LCB vùng 183.000 × 26');
  assert.equal(amount(r, 'salaryByDays'), 4_392_000); assert.equal(amount(r, 'capacity'), 1_400_000);
  assert.equal(amount(r, 'kpiBonus'), 6_818_208); assert.equal(amount(r, 'meal'), 1_200_000);
  assert.equal(r.gross, 15_060_208);
  assert.equal(amount(r, 'phoneDeduction'), 311_599, 'trừ MAX(tạm ứng ĐT, PC điện thoại)');
  assert.equal(r.net, 14_251_959);
});

test('Sale – admin tăng ca 1,5 giờ, thưởng khác; kho trách nhiệm theo tỷ lệ + sản lượng; IT-Web 0,5% DS web; thử việc', () => {
  const admin = run({ capacityCoef: 2, responsibility: 1_000_000, insurance: 496_650 }, { workDays: 25, overtimeHours: 1.5 }, { adjustments: [{ kind: 'bonus', amount: 1_000_000 }] });
  assert.equal(amount(admin, 'overtime'), 74_344); assert.equal(admin.gross, 8_299_344); assert.equal(admin.net, 7_802_694);
  const kho = run({ capacityCoef: 4, responsibilityMode: 'prorated', responsibility: 1_000_000, outputRate: 15_000, insurance: 496_650 }, { workDays: 18, outputQty: 11 }, { adjustments: [{ kind: 'bonus', amount: 1_000_000 }] });
  assert.equal(amount(kho, 'responsibility'), 692_308); assert.equal(amount(kho, 'outputBonus'), 165_000); assert.equal(kho.gross, 6_851_308);
  assert.equal(amount(run({ outputRate: 0.005 }, { outputQty: 80_702_409 }), 'outputBonus'), 403_512);
  const tv = run({ baseSalary: 5_000_000, mealAllowance: false, outputRate: 15_000 }, { workDays: 22, outputQty: 4 });
  assert.equal(tv.gross, 4_290_769); assert.equal(amount(tv, 'meal'), 0);
});

test('Sale – ngày công lấy từ chấm công khi không nhập tay; KPI CV tính từ số liệu; không đạt ngưỡng thì không thưởng', () => {
  const r = run({ kpiEnabled: true }, { kpiNewCustomers: 7, kpiTransactions: 52, kpiContracts: 2, kpiRevenue: 541_830_000 }, { days: 20, revenue: 300_000_000 });
  assert.equal(r.workDays, 20);
  assert.ok(Math.abs(r.kpi!.total - 0.745098895582329) < 1e-12, 'khớp ô M15 sheet KPI CV');
  assert.equal(r.kpi!.tier, 'low'); assert.equal(amount(r, 'kpiBonus'), 1_500_000, 'KPI 74,5% → 0,5% × DS hệ thống 300tr');
  assert.equal(amount(run({ kpiEnabled: true }, { kpiOverride: 0.5, revenue: 1e9 }), 'kpiBonus'), 0);
  assert.equal(amount(run({ kpiEnabled: false }, { kpiOverride: 1, revenue: 1e9 }), 'kpiBonus'), 0, 'không bật KPI → không thưởng KPI DS');
});

test('KPI CV: vượt chỉ tiêu KH mới được 20%, giao dịch tối đa 30%, ngày làm hàng / công tác được cộng', () => {
  const k = computeKpiCv({ ...EMPTY_INPUT, kpiNewCustomers: 90, kpiTransactions: 300, kpiContracts: 10, kpiMerchDays: 2 }, P, 415_000_000, 0);
  assert.equal(k.points.newCustomers, 0.2); assert.equal(k.points.transactions, 0.3); assert.equal(k.points.contracts, 0.1);
});

test('Bách Ngân – NVBH (trừ 1 ngày cơm, trách nhiệm theo ngày, tăng ca 24 giờ): 5.134.500 → 4.637.850; thưởng DS cửa hàng', () => {
  const r = run({ payrollGroup: 'bn', responsibilityMode: 'per_day', attendanceBonus: 200_000, insurance: 496_650, teamBonus: true },
    { workDays: 15, overtimeHours: 24 }, { gm: { bnRevenue: 188_288_191, bnAvgRevenue: 0 } });
  assert.equal(amount(r, 'meal'), 700_000); assert.equal(amount(r, 'responsibility'), 300_000); assert.equal(amount(r, 'overtime'), 1_189_500);
  assert.equal(amount(r, 'salesBonus'), 0, 'DS ≤ 300tr: không thưởng');
  assert.equal(r.gross, 5_134_500); assert.equal(r.net, 4_637_850);
  assert.equal(bnSalesBonus(P, 400_000_000, 380_000_000), 2_000_000, '≥ 100% DS TB → 1% ÷ 2');
  assert.equal(bnSalesBonus(P, 400_000_000, 450_000_000), 1_000_000, '≥ 85% → 0,5% ÷ 2');
  assert.equal(bnSalesBonus(P, 400_000_000, 500_000_000), 0);
});

test('Lock – NVBH (DS team 310.252.962 ≥ 310tr → 1,5% ÷ 2): 9.557.897 → 9.061.247; người không hưởng thưởng nhóm', () => {
  const gm = { lockRevenue: 310_252_962 };
  const r = run({ payrollGroup: 'lock', capacityCoef: 1, responsibilityMode: 'per_day', attendanceBonus: 200_000, insurance: 496_650, teamBonus: true }, { workDays: 27 }, { gm });
  assert.equal(amount(r, 'salesBonus'), 2_326_897); assert.equal(r.gross, 9_557_897); assert.equal(r.net, 9_061_247);
  assert.equal(amount(run({ payrollGroup: 'lock', teamBonus: false }, { workDays: 22 }, { gm }), 'salesBonus'), 0);
  assert.equal(lockSalesBonus(P, 250_000_000), 0, 'dưới sàn 85% × 300tr'); assert.equal(lockSalesBonus(P, 300_000_000), 1_500_000);
  assert.ok(!r.income.some(l => l.key === 'phone'), 'bảng Lock không có cột điện thoại');
});

test('Thưởng quý team Sale: đạt 98,8% (≥ 90%) và mọi người ≥ 60% → 0,5% DS quý chia theo tỷ trọng; không đạt → 0', () => {
  const q = computeQuarterBonus([{ memberId: 'a', target: 1_245_000_000, revenues: [400_000_000, 420_000_000, 410_000_000] }], P);
  assert.equal(q.fund, 6_150_000); assert.equal(q.rows[0]!.bonus, 6_150_000);
  const two = computeQuarterBonus([{ memberId: 'a', target: 600, revenues: [600, 0, 0] }, { memberId: 'b', target: 600, revenues: [300, 0, 0] }], P);
  assert.equal(two.membersOk, false, 'b đạt 50% < 60%'); assert.equal(two.fund, 0);
});

test('tham số: ghép với mặc định, từ chối giá trị sai; link VietQR', () => {
  assert.equal(mergeParams({ kpiHighRate: 0.01, standardDays: 0, la: 5 }).kpiHighRate, 0.01);
  assert.equal(mergeParams({ standardDays: 0 }).standardDays, 26, 'số chia = 0 → giữ mặc định');
  assert.match(validateParams({ kpiHighRate: 1.2 })!, /tỷ lệ/);
  assert.equal(validateParams({ standardDays: 24 }), null);
  assert.equal(vietQrUrl('VCB', '0123', 10_761_350, '2026-09'), 'https://img.vietqr.io/image/vcb-0123.png?amount=10761350&addInfo=Chuyen%20luong%20T9');
  assert.equal(vietQrUrl('vcb', '0123', 5_000_000, '2026-10', 'NGUYEN VAN A'), 'https://img.vietqr.io/image/vcb-0123.png?amount=5000000&addInfo=Chuyen%20luong%20T10&accountName=NGUYEN%20VAN%20A');
  assert.deepEqual(normalizeBank({ bankCode: ' VCB ', bankAccount: '0123 456-789', bankHolder: '  Trần  Thị Đào ' }), { bankCode: 'vcb', bankAccount: '0123456789', bankHolder: 'TRAN THI DAO' });
  assert.equal(vietQrUrl('', '0123', 1, '2026-09'), '');
  assert.equal(targetPercent(45, 60), 75);
});

test('TV / Thử việc: chỉ LCB theo ngày công ở cả ba nhóm (bỏ phụ cấp, thưởng, BHXH…) nhưng vẫn trừ tạm ứng, tạm ứng điện thoại, vi phạm',()=>{
 for(const payrollGroup of ['sale','bn','lock'] as const)for(const positionLabel of ['TV','Thử việc',' THỬ VIỆC ']){
  const r=computePayslip({profile:{...EMPTY_PROFILE,payrollGroup,positionLabel,baseSalary:5200000,capacityCoef:7,responsibility:1000000,phoneAllowance:250000,attendanceBonus:200000,kpiEnabled:true,teamBonus:true,insurance:496650,outputRate:15000},params:P,
   input:{...EMPTY_INPUT,workDays:24,overtimeHours:10,revenue:1e9,outputQty:100,quarterBonus:3000000,kpiOverride:1,healthInsurance:100000,incomeTax:200000},
   adjustments:['bonus','allowance','deduction','advance','phone_advance'].map(kind=>({kind,amount:500000})),attendanceDays:26,systemRevenue:1e9,groupMonth:{...EMPTY_GROUP_MONTH,bnRevenue:1e9,lockRevenue:1e9},quarterBonusAuto:5000000,contractBonus:1e6,contractBonusAdjustment:-1e5,kpiNetRevenue:1e9});
  assert.equal(r.gross,4800000);assert.equal(r.deductionTotal,1500000,'tạm ứng 500k + tạm ứng ĐT 500k + vi phạm 500k');assert.equal(r.net,3300000);assert.equal(r.kpi,null);assert.equal(r.kpiNetBasis,undefined);
  assert.ok(r.income.filter(l=>l.key!=='salaryByDays').every(l=>l.amount===0));
  assert.deepEqual(Object.fromEntries(r.deductions.map(l=>[l.key,l.amount])),{socialInsurance:0,...(payrollGroup==='sale'?{}:{healthInsurance:0,incomeTax:0}),violation:500000,phoneDeduction:500000,advance:500000});
 }
 const fallback=run({positionLabel:'TV'},{},{days:13});assert.equal(fallback.net,2379000,'LCB vùng và ngày chấm công khi không nhập tay');
});
