import {SALE_ADMIN_POSITION_ID} from '../../staff/domain/roles.ts';
/**
 * BẢNG LƯƠNG (theo file "Bảng lương mẫu" – 3 bảng: Sale & VP, Bách Ngân, Lock). Hàm thuần, test không cần DB.
 * Tham số công ty ở ./params.ts, KPI công việc ở ./kpi-cv.ts. Từng khoản lương có KHOÁ cố định (LINE_LABEL) để
 * phiếu lương, bảng tổng hợp và file Excel dùng chung.
 *
 *  Chung 3 bảng
 *   Lương theo công   = LCB × ngày làm ÷ công chuẩn            (LCB trống → LCB vùng = LCB/ngày × công chuẩn)
 *   Phụ cấp năng lực  = hệ số năng lực × đơn giá 1 hệ số
 *   Trách nhiệm       = cố định / theo tỷ lệ ngày làm / theo ngày (Bách Ngân, Lock: 20.000 × ngày làm)
 *   Cơm + xăng        = (cơm + xăng / ngày) × MAX(0, ngày làm − ngày trừ cơm của nhóm)   (chỉ người được hưởng; thử việc không)
 *   Tăng ca           = LCB ÷ 24 ÷ 8 × giờ × 2
 *  Sale & VP
 *   Thưởng KPI DS     = DS tháng × (KPI CV ≥ 90% → 1,2%; ≥ 60% → 0,5%; còn lại 0)
 *   Thưởng sản lượng  = sản lượng × đơn giá / tỷ lệ (kho 15.000/đơn, TK 30.000/lượt, IT-Web 0,5% DS web)
 *   Thực nhận         = Tổng thu nhập − BHXH − vi phạm − MAX(tạm ứng điện thoại, PC điện thoại) − tạm ứng
 *  Bách Ngân  Thưởng DS = (DS > 300tr: DS/DS TB 6 tháng ≥ 100% → 1%; ≥ 85% → 0,5%) × DS ÷ 2
 *  Lock       Thưởng DS = DS team < 85% × 300tr → 0; ≥ 310tr → 1,5% × DS ÷ 2; còn lại 1% × DS ÷ 2
 *  Bách Ngân, Lock  Thực nhận = Tổng lương − BHXH − BHYT − TNCN − vi phạm − tạm ứng điện thoại − tạm ứng
 */
import { minWageMonth, type PayrollParams } from './params.ts';
import { computeKpiCv, kpiTargetsOf, type KpiCvInput, type KpiCvResult } from './kpi-cv.ts';

// ---------------- Nhóm bảng lương
export const PAYROLL_GROUPS = ['sale', 'bn', 'lock'] as const;
export type PayrollGroup = typeof PAYROLL_GROUPS[number];
export const GROUP_LABEL: Record<PayrollGroup, string> = { sale: 'Sale & Văn phòng', bn: 'NVBH ML (Bách Ngân)', lock: 'NVBH Lock' };
export const RESPONSIBILITY_MODES = ['fixed', 'prorated', 'per_day'] as const;
export type ResponsibilityMode = typeof RESPONSIBILITY_MODES[number];
export const RESPONSIBILITY_LABEL: Record<ResponsibilityMode, string> = { fixed: 'Cố định / tháng', prorated: 'Theo tỷ lệ ngày làm', per_day: 'Theo ngày (tham số / ngày)' };

// ---------------- Ngày công
export const ATTENDANCE_STATUSES = ['present', 'half', 'paid_leave', 'unpaid_leave', 'absent'] as const;
export type AttendanceStatus = typeof ATTENDANCE_STATUSES[number];
/** Số công của mỗi trạng thái (thứ 7 làm nửa ngày → chấm "nửa công"). */
export const ATTENDANCE_CREDIT: Record<AttendanceStatus, number> = { present: 1, half: 0.5, paid_leave: 1, unpaid_leave: 0, absent: 0 };
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = { present: 'Đủ công', half: 'Nửa công', paid_leave: 'Nghỉ có lương', unpaid_leave: 'Nghỉ không lương', absent: 'Vắng' };
export interface AttendanceSummary { worked: number; present: number; half: number; paidLeave: number; unpaidLeave: number; absent: number; recorded: number }
export function summarizeAttendance(rows: readonly { status: string }[]): AttendanceSummary {
  const s: AttendanceSummary = { worked: 0, present: 0, half: 0, paidLeave: 0, unpaidLeave: 0, absent: 0, recorded: 0 };
  for (const r of rows) {
    const st = r.status as AttendanceStatus;
    if (!(st in ATTENDANCE_CREDIT)) continue;
    s.worked += ATTENDANCE_CREDIT[st]; s.recorded++;
    if (st === 'present') s.present++; else if (st === 'half') s.half++; else if (st === 'paid_leave') s.paidLeave++; else if (st === 'unpaid_leave') s.unpaidLeave++; else s.absent++;
  }
  return s;
}

// ---------------- Khoản cộng / trừ nhập theo tháng (nhiều dòng, có lý do)
export const ADJUSTMENT_KINDS = ['bonus', 'allowance', 'deduction', 'advance', 'phone_advance'] as const;
export type AdjustmentKind = typeof ADJUSTMENT_KINDS[number];
export const ADJUSTMENT_LABEL: Record<AdjustmentKind, string> = {
  bonus: 'Thưởng khác / tuyên dương', allowance: 'Công tác / phụ cấp khác', deduction: 'Vi phạm / khấu trừ', advance: 'Tạm ứng', phone_advance: 'Tạm ứng điện thoại',
};

/** Phiếu lương đã chốt (`confirmed`) → đã trả (`paid`). Chưa chốt = tạm tính, không lưu. */
export const PAYSLIP_STATUSES = ['confirmed', 'paid'] as const;
export type PayslipStatus = typeof PAYSLIP_STATUSES[number];
export const HR_LIMITS = { maxSalary: 10_000_000_000, maxAmount: 10_000_000_000, reason: 500, note: 500, text: 120 } as const;

// ---------------- Tháng
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const isMonth = (v: unknown): v is string => typeof v === 'string' && MONTH_RE.test(v);
export function daysInMonth(month: string) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0)).getUTCDate(); }
/** Ngày đầu / cuối tháng (YYYY-MM-DD) và tháng sau (để so sánh `<`). */
export function monthRange(month: string) {
  const days = daysInMonth(month);
  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, '0')}`, next: shiftMonth(month, 1) + '-01', days };
}
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number), d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** Ba tháng của quý chứa `month` (cũ → mới) và tháng có phải cuối quý không. */
export function quarterMonths(month: string) {
  const m = Number(month.slice(5)), first = m - (m - 1) % 3;
  const months = [0, 1, 2].map(i => `${month.slice(0, 4)}-${String(first + i).padStart(2, '0')}`);
  return { quarter: Math.ceil(m / 3), months, isQuarterEnd: m % 3 === 0 };
}

// ---------------- Hồ sơ lương từng người (áp dụng từ tháng)
export interface SalaryProfile {
  payrollGroup: PayrollGroup; positionLabel: string;
  /** Lương cơ bản / thoả thuận; 0 = LCB vùng (tham số). */
  baseSalary: number; capacityCoef: number;
  responsibilityMode: ResponsibilityMode; responsibility: number;
  mealAllowance: boolean; phoneAllowance: number; attendanceBonus: number;
  /** Sale: tính KPI công việc + thưởng KPI DS. Bách Ngân / Lock: hưởng thưởng DS của nhóm. */
  kpiEnabled: boolean; teamBonus: boolean; kpiEligible?:boolean; fixedKpi?: number | null; contractBonusEnabled?: boolean;
  outputRate: number; revenueTarget: number; insurance: number;
  /** Chỉ tiêu KPI riêng (null = theo mức chung của tháng). */
  kpiNewCustomersTarget?: number | null; kpiTransactionsTarget?: number | null; kpiContractsTarget?: number | null;
  bankCode: string; bankAccount: string; bankHolder: string;
}
export const EMPTY_PROFILE: SalaryProfile = {
  payrollGroup: 'sale', positionLabel: '', baseSalary: 0, capacityCoef: 0, responsibilityMode: 'fixed', responsibility: 0,
  mealAllowance: true, phoneAllowance: 0, attendanceBonus: 0, kpiEnabled: false, teamBonus: false, fixedKpi:null,contractBonusEnabled:false, outputRate: 0, revenueTarget: 0, insurance: 0, kpiNewCustomersTarget: null, kpiTransactionsTarget: null, kpiContractsTarget: null,
  bankCode: '', bankAccount: '', bankHolder: '',
};

/**
 * Hồ sơ lương mặc định theo chức vụ khi nhân viên CHƯA có hồ sơ lương – để không ai bị sót khỏi bảng lương:
 * NVBH ML → bảng cửa hàng ML (Bách Ngân), NVBH Lock → bảng Lock (trách nhiệm theo ngày, chuyên cần, thưởng DS nhóm như file mẫu);
 * chức vụ khác → Sale & Văn phòng. Manager vẫn phải lưu hồ sơ lương (LCB, BHXH…) trước khi chốt.
 */
export const salaryKpiEligible=(positionId:string|null|undefined)=>positionId!==SALE_ADMIN_POSITION_ID;
export const POSITION_GROUP: Readonly<Record<string, PayrollGroup>> = { 'sales-ml': 'bn', 'sales-lock': 'lock' };
export function defaultProfileFor(positionId: string | null | undefined): SalaryProfile {
  const g = POSITION_GROUP[positionId ?? ''];
  return g ? { ...EMPTY_PROFILE,kpiEligible:salaryKpiEligible(positionId), payrollGroup: g, positionLabel: 'NVBH', responsibilityMode: 'per_day', attendanceBonus: 200_000, teamBonus: true } : {...EMPTY_PROFILE,kpiEligible:salaryKpiEligible(positionId)};
}

// ---------------- Số liệu nhập theo tháng (một dòng / người / tháng)
export interface PayrollInput extends KpiCvInput {
  /** Ngày làm việc; null = lấy từ chấm công. */
  workDays: number | null;
  overtimeHours: number;
  /** Chỉ số đối chiếu, chưa tự quy đổi thành khoản trừ. */
  lateCount?: number; leaveHours?: number;
  /** DS tháng cá nhân (Sale – tính thưởng KPI DS); null = DS đơn hàng trên hệ thống. */
  revenue: number | null;
  /** Sản lượng: số đơn (kho), số lượt (thiết kế), DS web (IT). */
  outputQty: number;
  healthInsurance: number; incomeTax: number;
  /** Thưởng quý; null = tự tính (tháng cuối quý, khi bật "chi trả thưởng quý"). */
  quarterBonus: number | null;
}
export const EMPTY_INPUT: PayrollInput = {
  workDays: null, overtimeHours: 0, lateCount: 0, leaveHours: 0, revenue: null, outputQty: 0, healthInsurance: 0, incomeTax: 0, quarterBonus: null,
  kpiNewCustomers: null, kpiTransactions: null, kpiContracts: null, kpiRevenue: null, kpiMerchDays: 0, kpiTripDays: 0, kpiOverride: null,
};

/** Số liệu chung của nhóm trong tháng (doanh số cửa hàng / team, thưởng quý). */
export interface GroupMonth { bnRevenue: number; bnAvgRevenue: number; lockRevenue: number; payQuarterBonus: boolean }
export const EMPTY_GROUP_MONTH: GroupMonth = { bnRevenue: 0, bnAvgRevenue: 0, lockRevenue: 0, payQuarterBonus: false };

// ---------------- Phiếu lương
export const LINE_LABEL = {
  salaryByDays: 'Lương theo công', capacity: 'Phụ cấp năng lực', responsibility: 'Trách nhiệm', kpiBonus: 'Thưởng KPI DS',
  outputBonus: 'Thưởng sản lượng', quarterBonus: 'Thưởng quý', salesBonus: 'Thưởng DS', otherBonus: 'Thưởng khác', contractBonus:'Thưởng HĐKT',contractBonusAdjustment:'Điều chỉnh thưởng HĐKT kỳ trước',
  meal: 'Cơm + xăng', phone: 'Điện thoại', attendanceBonus: 'Chuyên cần', trip: 'Công tác / phụ cấp khác', overtime: 'Tăng ca',
  socialInsurance: 'BHXH', healthInsurance: 'BHYT', incomeTax: 'Thuế TNCN', violation: 'Vi phạm / khấu trừ',
  phoneDeduction: 'Điện thoại (tạm ứng / hoàn PC)', advance: 'Tạm ứng',
} as const;
export type LineKey = keyof typeof LINE_LABEL;
export interface PayLine { key: LineKey; label: string; amount: number; note: string }
/** Cột thu nhập / khấu trừ của từng bảng (thứ tự như file Excel). */
export const GROUP_INCOME: Record<PayrollGroup, LineKey[]> = {
  sale: ['salaryByDays', 'capacity', 'responsibility', 'kpiBonus', 'outputBonus', 'quarterBonus', 'otherBonus', 'contractBonus','contractBonusAdjustment', 'meal', 'phone', 'trip', 'overtime'],
  bn: ['salaryByDays', 'capacity', 'responsibility', 'salesBonus', 'otherBonus', 'meal', 'phone', 'attendanceBonus', 'trip', 'overtime'],
  lock: ['salaryByDays', 'capacity', 'responsibility', 'salesBonus', 'otherBonus', 'meal', 'attendanceBonus', 'trip', 'overtime'],
};
export const GROUP_DEDUCTION: Record<PayrollGroup, LineKey[]> = {
  sale: ['socialInsurance', 'violation', 'phoneDeduction', 'advance'],
  bn: ['socialInsurance', 'healthInsurance', 'incomeTax', 'violation', 'phoneDeduction', 'advance'],
  lock: ['socialInsurance', 'healthInsurance', 'incomeTax', 'violation', 'phoneDeduction', 'advance'],
};

export interface PayslipCalc {
  group: PayrollGroup; positionLabel: string; workDays: number; baseSalary: number; revenue: number;
  income: PayLine[]; deductions: PayLine[]; gross: number; deductionTotal: number; net: number;
  employment?: {company:'BN'|'VG'|null;department:string|null;leader:boolean};
  kpiNetBasis?:{netRevenue:number;issues:number;rate:number};
  kpi: KpiCvResult | null;snapshotUnavailable?:boolean;
  salesCrm?:{apply:boolean;bonusApply?:boolean;kpiApply?:boolean;from:string;kpiEligible?:boolean;previewKpi?:KpiCvResult|null;kpiBonusPreview?:number;facts:{newCustomers:number;transactions:number;contracts:number};awards:import('./contract-bonus.ts').AwardProposal[];};
}

const round = (n: number) => Math.round(n);
const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;

/** Thưởng DS cửa hàng Bách Ngân (đã chia số người). */
export function bnSalesBonus(p: PayrollParams, revenue: number, avg: number) {
  if (revenue <= p.bnMinRevenue || avg <= 0) return 0;
  const r = revenue / avg, rate = r >= p.bnLevel1 ? p.bnLevel1Rate : r >= p.bnLevel2 ? p.bnLevel2Rate : 0;
  return revenue * rate / p.bnSplit;
}
/** Thưởng DS team Lock (đã chia số người). */
export function lockSalesBonus(p: PayrollParams, revenue: number) {
  if (revenue < p.lockFloor * p.lockTarget) return 0;
  return revenue * (revenue >= p.lockHigh ? p.lockHighRate : p.lockRate) / p.lockSplit;
}
/** Tỷ lệ thưởng KPI DS (Sale) theo KPI CV. */
export function netKpiBonusRate(p:PayrollParams,kpi:number|null){
  if(kpi===null)return 0;
  // Ignore floating-point noise at exact 60/90/120% boundaries.
  const epsilon=1e-12;
  return kpi+epsilon<0.6?0:kpi+epsilon<0.9?p.saleKpiNetLowRate:kpi<=1.2+epsilon?p.saleKpiNetHighRate:p.saleKpiNetOverRate;
}
export const kpiBonusRate = (p: PayrollParams, kpi: number | null) => kpi === null ? 0 : kpi >= p.kpiHigh ? p.kpiHighRate : kpi >= p.kpiLow ? p.kpiLowRate : 0;

/** Vị trí lương TV / Thử việc chỉ hưởng LCB theo ngày công. */
export const isProbation = (position: string) => ['TV', 'THỬ VIỆC'].includes(position.trim().toLocaleUpperCase('vi'));

export function computePayslip(a: {
  profile: SalaryProfile; params: PayrollParams; input: PayrollInput; adjustments: readonly { kind: string; amount: number }[];
  /** Ngày công từ chấm công; DS đơn hàng trên hệ thống; thưởng quý tự tính (nếu có). */
  attendanceDays: number; systemRevenue: number; groupMonth: GroupMonth; quarterBonusAuto: number;kpiNetRevenue?:number;kpiNetRevenueIssues?:number;contractBonus?:number;contractBonusAdjustment?:number;
}): PayslipCalc {
  const { profile: f, params: p, input: inp, groupMonth: gm } = a, g = f.payrollGroup;
  const adj = (k: AdjustmentKind) => a.adjustments.filter(x => x.kind === k).reduce((s, x) => s + x.amount, 0);
  const days = inp.workDays ?? a.attendanceDays, lcb = f.baseSalary > 0 ? f.baseSalary : minWageMonth(p);
  const revenue = inp.revenue ?? a.systemRevenue;
  const probation = isProbation(f.positionLabel);
  const kpi = !probation && g === 'sale' && f.kpiEligible!==false && f.kpiEnabled ? computeKpiCv({...inp,kpiOverride:f.fixedKpi??inp.kpiOverride}, p, kpiTargetsOf(p, f), revenue) : null;
  const responsibility = f.responsibilityMode === 'per_day' ? p.responsibilityDay * days
    : f.responsibilityMode === 'prorated' ? f.responsibility * days / p.standardDays : f.responsibility;
  const mealOff = g === 'sale' ? p.mealOffSale : g === 'bn' ? p.mealOffBn : p.mealOffLock;
  const salesBonus = !f.teamBonus ? 0 : g === 'bn' ? bnSalesBonus(p, gm.bnRevenue, gm.bnAvgRevenue) : g === 'lock' ? lockSalesBonus(p, gm.lockRevenue) : 0;
  const netPolicy=a.kpiNetRevenue!==undefined,rate = netPolicy?netKpiBonusRate(p,kpi?.used??null):kpiBonusRate(p, kpi?.used ?? null),bonusRevenue=netPolicy?Math.max(0,a.kpiNetRevenue!):revenue, phone = g === 'lock' ? 0 : f.phoneAllowance, phoneAdvance = adj('phone_advance');
  const amounts: Record<LineKey, [number, string]> = {
    salaryByDays: [lcb * days / p.standardDays, `${vnd(lcb)} × ${days} ngày ÷ ${p.standardDays}`],
    capacity: [f.capacityCoef * p.capacityUnit, f.capacityCoef ? `Hệ số ${f.capacityCoef} × ${vnd(p.capacityUnit)}` : ''],
    responsibility: [responsibility, f.responsibilityMode === 'per_day' ? `${vnd(p.responsibilityDay)} × ${days} ngày` : f.responsibilityMode === 'prorated' ? `${vnd(f.responsibility)} × ${days} ÷ ${p.standardDays}` : ''],
    kpiBonus: [bonusRevenue * rate, kpi ? `KPI CV ${pct(kpi.used)} → ${pct(rate)} × ${netPolicy?'DS net':'DS'} ${vnd(bonusRevenue)}` : ''],
    outputBonus: [inp.outputQty * f.outputRate, inp.outputQty ? `${inp.outputQty.toLocaleString('vi-VN')} × ${f.outputRate < 1 ? pct(f.outputRate) : vnd(f.outputRate)}` : ''],
    quarterBonus: [inp.quarterBonus ?? a.quarterBonusAuto, inp.quarterBonus === null && a.quarterBonusAuto ? 'Tự tính theo DS quý của team' : ''],
    salesBonus: [salesBonus, salesBonus ? (g === 'bn' ? `DS cửa hàng ${vnd(gm.bnRevenue)} (TB 6 tháng ${vnd(gm.bnAvgRevenue)}) ÷ ${p.bnSplit}` : `DS team ${vnd(gm.lockRevenue)} ÷ ${p.lockSplit}`) : ''],
    otherBonus: [adj('bonus'), ''],
    contractBonus:[a.contractBonus||0,'Theo từng HĐKT trước VAT'],
    contractBonusAdjustment:[a.contractBonusAdjustment||0,'Chênh lệch với khoản đã chốt / đã trả'],
    meal: [f.mealAllowance ? (p.mealDay + p.fuelDay) * Math.max(0, days - mealOff) : 0, f.mealAllowance ? `${vnd(p.mealDay + p.fuelDay)} × ${Math.max(0, days - mealOff)} ngày` : 'Không hưởng'],
    phone: [phone, ''],
    attendanceBonus: [g === 'sale' ? 0 : f.attendanceBonus, ''],
    trip: [adj('allowance'), ''],
    overtime: [lcb / p.overtimeDays / p.hoursPerDay * inp.overtimeHours * p.overtimeRate, inp.overtimeHours ? `${inp.overtimeHours} giờ × hệ số ${p.overtimeRate}` : ''],
    socialInsurance: [f.insurance, ''],
    healthInsurance: [g === 'sale' ? 0 : inp.healthInsurance, ''],
    incomeTax: [g === 'sale' ? 0 : inp.incomeTax, ''],
    violation: [adj('deduction'), ''],
    // Sale: PC điện thoại thực chất là hoàn tạm ứng → trừ lại MAX(tạm ứng ĐT, PC ĐT) như file gốc.
    phoneDeduction: [g === 'sale' ? Math.max(phoneAdvance, phone) : phoneAdvance, g === 'sale' && phone ? `MAX(tạm ứng ĐT ${vnd(phoneAdvance)}, PC ${vnd(phone)})` : ''],
    advance: [adj('advance'), ''],
  };
  // Thử việc: chỉ LCB theo công – không năng lực, KPI, thưởng, sản lượng, phụ cấp, tăng ca, BHXH/BHYT/TNCN.
  // NHƯNG tiền đã ứng / đã ghi phạt vẫn phải trừ lại: tạm ứng, tạm ứng điện thoại (không có PC điện thoại để bù), vi phạm / bể hàng.
  if (probation) for (const key of Object.keys(amounts) as LineKey[]) {
    if (key === 'salaryByDays' || key === 'advance' || key === 'violation') continue;
    amounts[key] = key === 'phoneDeduction' ? [phoneAdvance, phoneAdvance ? 'Tạm ứng điện thoại' : ''] : [0, 'Thử việc: không áp dụng'];
  }
  const line = (key: LineKey): PayLine => ({ key, label: LINE_LABEL[key], amount: round(amounts[key][0]), note: amounts[key][1] });
  const income = GROUP_INCOME[g].map(line), deductions = GROUP_DEDUCTION[g].map(line);
  const gross = income.reduce((s, l) => s + l.amount, 0), deductionTotal = deductions.reduce((s, l) => s + l.amount, 0);
  return { ...(netPolicy&&!probation?{kpiNetBasis:{netRevenue:a.kpiNetRevenue!,issues:a.kpiNetRevenueIssues||0,rate}}:{}),group: g, positionLabel: f.positionLabel, workDays: days, baseSalary: lcb, revenue, income, deductions, gross, deductionTotal, net: gross - deductionTotal, kpi };
}

// ---------------- Thưởng quý – team Sale (sheet "Thưởng quý")
export interface QuarterMember { memberId: string; target: number; revenues: number[] }
export function computeQuarterBonus(members: readonly QuarterMember[], p: PayrollParams) {
  const rows = members.map(m => { const revenue = m.revenues.reduce((s, x) => s + x, 0); return { memberId: m.memberId, target: m.target, revenue, percent: m.target > 0 ? revenue / m.target : null }; });
  const teamRevenue = rows.reduce((s, r) => s + r.revenue, 0), teamTarget = rows.reduce((s, r) => s + r.target, 0);
  const teamPercent = teamTarget > 0 ? teamRevenue / teamTarget : 0;
  const teamOk = teamTarget > 0 && teamPercent >= p.quarterTeamMin;
  const membersOk = rows.length > 0 && rows.every(r => r.percent !== null && r.percent >= p.quarterMemberMin);
  const fund = teamOk && membersOk ? p.quarterRate * teamRevenue : 0;
  return { teamRevenue, teamTarget, teamPercent, teamOk, membersOk, fund,
    rows: rows.map(r => ({ ...r, share: teamRevenue > 0 ? r.revenue / teamRevenue : 0, bonus: teamRevenue > 0 ? round(fund * r.revenue / teamRevenue) : 0 })) };
}

/** Nhân viên tự xem lương tháng M từ ngày này của chính tháng M (trước đó ẩn; Manager luôn thấy). */
export const SALARY_OPEN_DAY = 10;
/** Ngày (YYYY-MM-DD) nhân viên bắt đầu thấy lương tháng; `today` trước ngày đó → ẩn. */
export const salaryOpensOn = (month: string) => `${month}-${String(SALARY_OPEN_DAY).padStart(2, '0')}`;
/** Nội dung chuyển khoản lương: "Chuyen luong T10" (không dấu, mọi ngân hàng đọc được). */
export const salaryTransferNote = (month: string) => 'Chuyen luong T' + Number(month.slice(5));
/** Link ảnh mã VietQR chuyển khoản lương: số tiền = thực nhận, nội dung "Chuyen luong T<tháng>", kèm tên chủ tài khoản nếu có. */
export function vietQrUrl(bankCode: string, account: string, amount: number, month: string, holder = '') {
  if (!bankCode || !account || amount <= 0) return '';
  return `https://img.vietqr.io/image/${encodeURIComponent(bankCode.toLowerCase())}-${encodeURIComponent(account)}.png?amount=${Math.round(amount)}&addInfo=${encodeURIComponent(salaryTransferNote(month))}`
    + (holder ? `&accountName=${encodeURIComponent(holder)}` : '');
}
/** Chuẩn hoá tài khoản nhận lương (dùng chung Manager sửa hồ sơ và nhân viên tự điền). Tên chủ TK: IN HOA, bỏ dấu như trên thẻ. */
export function normalizeBank(b: { bankCode?: unknown; bankAccount?: unknown; bankHolder?: unknown }) {
  const t = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
  return {
    bankCode: t(b.bankCode, 30).toLowerCase().replace(/[^a-z0-9]/g, ''),
    bankAccount: t(b.bankAccount, 30).replace(/[^\dA-Za-z]/g, ''),
    bankHolder: t(b.bankHolder, HR_LIMITS.text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'D').toUpperCase().replace(/\s+/g, ' '),
  };
}

/** % hoàn thành chỉ tiêu doanh số (null = chưa đặt chỉ tiêu). */
export const targetPercent = (revenue: number, target: number) => target > 0 ? Math.round(revenue / target * 1000) / 10 : null;
