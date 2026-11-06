import {computeKpiCv,kpiTargetsOf} from '../domain/kpi-cv.ts';
import {kpiBonusRate,netKpiBonusRate,salaryTransferNote,vietQrUrl} from '../domain/payroll.ts';
import type {TeamRevenueOf,CrmFactsOf} from '../../../core/contracts/sales-payroll.ts';
import {awardHistory,proposeAwards} from './contract-bonuses.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {AppError} from '../../../core/errors.ts';
import {revenueTargetsFor,targetKey} from './revenue-target-data.ts';
import { and, asc, desc, eq, gte, inArray, isNull, lte, notInArray } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { departments, employees } from '../../staff/schema.ts';
import { hrAdjustments, hrAttendance, hrPayrollInputs, hrPayrollMonths, hrPayrollSettings, hrPayslips, hrSalaryProfiles } from '../schema.ts';
import { mergeParams, appsheetKpiApplies, type PayrollParams } from '../domain/params.ts';
import {
  EMPTY_GROUP_MONTH, EMPTY_INPUT, isProbation, computePayslip,salaryKpiEligible, defaultProfileFor, computeQuarterBonus, monthRange, quarterMonths, summarizeAttendance,
  type GroupMonth, type PayrollInput, type PayslipCalc, type SalaryProfile,
} from '../domain/payroll.ts';

/**
 * Doanh số đơn hàng trên hệ thống theo người phụ trách và tháng: Map<memberId, { 'YYYY-MM': số tiền }>.
 * Bơm vào từ app/router.ts (module staff-hub) để `hr` không phụ thuộc module bán hàng.
 */
export type RevenueOf = (db: AnyDb, months: readonly string[]) => Promise<Map<string, Record<string, number>>>;

type ProfileRow = typeof hrSalaryProfiles.$inferSelect;
/** Chưa có hồ sơ lương → mặc định theo chức vụ (`effectiveMonth: null`). */
const toProfile = (p: ProfileRow | undefined, positionId?: string | null): SalaryProfile & { effectiveMonth: string | null; note: string; legacyRevenueTarget?:number;registeredRevenueTarget?:number|null;revenueTargetSource?:'registration'|'profile'|'company' } => p ? {
  payrollGroup: p.payrollGroup, positionLabel: p.positionLabel, baseSalary: p.baseSalary, capacityCoef: p.capacityCoef,
  responsibilityMode: p.responsibilityMode, responsibility: p.responsibility, mealAllowance: p.mealAllowance, phoneAllowance: p.phoneAllowance,
  attendanceBonus: p.attendanceBonus, kpiEligible:salaryKpiEligible(positionId),kpiEnabled:salaryKpiEligible(positionId)&&p.kpiEnabled,fixedKpi:salaryKpiEligible(positionId)?p.fixedKpi:null,contractBonusEnabled:p.contractBonusEnabled, teamBonus: p.teamBonus, outputRate: p.outputRate, revenueTarget: p.revenueTarget, kpiNewCustomersTarget: p.kpiNewCustomersTarget, kpiTransactionsTarget: p.kpiTransactionsTarget, kpiContractsTarget: p.kpiContractsTarget,
  insurance: p.insurance, bankCode: p.bankCode, bankAccount: p.bankAccount, bankHolder: p.bankHolder, effectiveMonth: p.effectiveMonth, note: p.note,
} : { ...defaultProfileFor(positionId), effectiveMonth: null, note: '' };
const toInput = (r: typeof hrPayrollInputs.$inferSelect | undefined): PayrollInput & { note: string } => r ? {
  workDays: r.workDays, overtimeHours: r.overtimeHours, lateCount: r.lateCount, leaveHours: r.leaveHours, revenue: r.revenue, outputQty: r.outputQty, healthInsurance: r.healthInsurance, incomeTax: r.incomeTax,
  quarterBonus: r.quarterBonus, kpiNewCustomers: r.kpiNewCustomers, kpiTransactions: r.kpiTransactions, kpiContracts: r.kpiContracts, kpiRevenue: r.kpiRevenue,
  kpiMerchDays: r.kpiMerchDays, kpiTripDays: r.kpiTripDays, kpiOverride: r.kpiOverride, note: r.note,
} : { ...EMPTY_INPUT, note: '' };

/** Tham số áp dụng cho tháng (bản mới nhất có effective_month ≤ tháng; chưa có → mặc định). */
export async function paramsFor(db: AnyDb, month: string): Promise<{ params: PayrollParams; effectiveMonth: string | null }> {
  const [s] = await db.select().from(hrPayrollSettings).where(lte(hrPayrollSettings.effectiveMonth, month)).orderBy(desc(hrPayrollSettings.effectiveMonth)).limit(1);
  let saved: unknown = {}; try { saved = s ? JSON.parse(s.params) : {}; } catch { /* hỏng → mặc định */ }
  return { params: mergeParams(saved), effectiveMonth: s?.effectiveMonth ?? null };
}
export async function groupMonthOf(db: AnyDb, month: string): Promise<GroupMonth & { note: string }> {
  const [g] = await db.select().from(hrPayrollMonths).where(eq(hrPayrollMonths.month, month)).limit(1);
  return g ? { bnRevenue: g.bnRevenue, bnAvgRevenue: g.bnAvgRevenue, lockRevenue: g.lockRevenue, payQuarterBonus: g.payQuarterBonus, note: g.note } : { ...EMPTY_GROUP_MONTH, note: '' };
}
/** Hồ sơ lương áp dụng cho tháng của nhiều người (mỗi người: bản effective_month mới nhất ≤ tháng). */
async function profilesFor(db: AnyDb, month: string, memberIds?: readonly string[]) {
  const rows = await db.select().from(hrSalaryProfiles)
    .where(and(lte(hrSalaryProfiles.effectiveMonth, month), memberIds ? inArray(hrSalaryProfiles.memberId, [...memberIds]) : undefined))
    .orderBy(desc(hrSalaryProfiles.effectiveMonth));
  const map = new Map<string, ProfileRow>();
  for (const r of rows) if (!map.has(r.memberId)) map.set(r.memberId, r);
  return map;
}

/**
 * Thưởng quý tự tính cho team Sale (tháng cuối quý, khi bật "chi trả thưởng quý"): Map<memberId, tiền>.
 * Team = người thuộc bảng Sale có tính KPI; chỉ tiêu quý = chỉ tiêu DS tháng × 3; DS = DS nhập tay hoặc DS hệ thống từng tháng.
 */
async function quarterBonuses(db: AnyDb, month: string, params: PayrollParams, gm: GroupMonth, revenueOf: RevenueOf) {
  const q = quarterMonths(month);
  if (!q.isQuarterEnd || !gm.payQuarterBonus) return { map: new Map<string, number>(), detail: null };
  const profiles=await profilesFor(db,month),positions=await db.select({id:employees.id,positionId:employees.positionId}).from(employees).where(inArray(employees.id,[...profiles.keys()]));
  const team=[...profiles.values()].filter(p=>p.payrollGroup==='sale'&&p.kpiEnabled&&salaryKpiEligible(positions.find(m=>m.id===p.memberId)?.positionId));
  if (!team.length) return { map: new Map<string, number>(), detail: null };
  const ids = team.map(p => p.memberId);
  const [inputs, revenues,registered] = await Promise.all([
    db.select({ memberId: hrPayrollInputs.memberId, month: hrPayrollInputs.month, revenue: hrPayrollInputs.revenue }).from(hrPayrollInputs)
      .where(and(inArray(hrPayrollInputs.memberId, ids), inArray(hrPayrollInputs.month, q.months))),
    revenueOf(db, q.months),
    revenueTargetsFor(db,q.months,ids),
  ]);
  const detail = computeQuarterBonus(team.map(p => ({
    memberId: p.memberId, target: q.months.reduce((sum,m)=>sum+(registered.get(targetKey(p.memberId,m))??(p.revenueTarget||params.kpiRevenue)),0),
    revenues: q.months.map(m => inputs.find(i => i.memberId === p.memberId && i.month === m)?.revenue ?? revenues.get(p.memberId)?.[m] ?? 0),
  })), params);
  return { map: new Map(detail.rows.map(r => [r.memberId, r.bonus])), detail: { ...detail, quarter: q.quarter, months: q.months } };
}

export interface PayrollRow {
  member: { id: string; name: string; active: boolean; positionId: string | null };
  profile: ReturnType<typeof toProfile>; input: ReturnType<typeof toInput>;
  attendanceDays: number; systemRevenue: number; adjustments: { id: string; kind: string; amount: number; reason: string; createdAt: string; createdByName: string }[];
  context?:unknown;calc: PayslipCalc; slip: (typeof hrPayslips.$inferSelect) | null;
}

/**
 * Bảng lương một tháng cho nhiều người (mặc định: mọi nhân viên đang làm / có hồ sơ lương). Một chỗ tính duy nhất cho
 * trang chi tiết nhân viên, bảng lương công ty và lúc chốt lương.
 */
export async function buildPayroll(db: AnyDb, month: string, revenueOf: RevenueOf, onlyIds?: readonly string[],crmFactsOf?:CrmFactsOf,lock=false,teamRevenueOf?:TeamRevenueOf) {
  const r = monthRange(month);
  const [{ params, effectiveMonth }, gm, profiles] = await Promise.all([paramsFor(db, month), groupMonthOf(db, month), profilesFor(db, month, onlyIds)]);
  const teamRevenue=teamRevenueOf?await teamRevenueOf(db,month):null;
  if(teamRevenue){gm.bnRevenue=teamRevenue.bn.revenue;gm.lockRevenue=teamRevenue.lock.revenue;gm.teamRevenue=teamRevenue;}
  const members = await db.select({ id: employees.id, name: employees.name, active: employees.active, positionId: employees.positionId, workCompany:employees.workCompany, workDepartment:departments.name, isLeader:employees.isLeader }).from(employees).leftJoin(departments,eq(departments.id,employees.workDepartmentId))
    .where(and(isNull(employees.deletedAt), notInArray(employees.role, ['customer', 'supplier']), onlyIds ? inArray(employees.id, [...onlyIds]) : undefined))
    .orderBy(asc(employees.name));
  const list = onlyIds ? members : members.filter(m => m.active || profiles.has(m.id));
  const ids = list.map(m => m.id);
  if (!ids.length) return { month, params, paramsMonth: effectiveMonth, groupMonth: gm, rows: [] as PayrollRow[], quarter: null };
  const [inputs, adjustments, attendance, slips, revenues, quarter,registered] = await Promise.all([
    db.select().from(hrPayrollInputs).where(and(eq(hrPayrollInputs.month, month), inArray(hrPayrollInputs.memberId, ids))),
    db.select({ id: hrAdjustments.id, memberId: hrAdjustments.memberId, kind: hrAdjustments.kind, amount: hrAdjustments.amount, reason: hrAdjustments.reason, createdAt: hrAdjustments.createdAt, createdByName: employees.name })
      .from(hrAdjustments).leftJoin(employees, eq(employees.id, hrAdjustments.createdBy))
      .where(and(eq(hrAdjustments.month, month), inArray(hrAdjustments.memberId, ids))).orderBy(asc(hrAdjustments.createdAt)),
    db.select({ memberId: hrAttendance.memberId, status: hrAttendance.status }).from(hrAttendance)
      .where(and(inArray(hrAttendance.memberId, ids), gte(hrAttendance.workDate, r.from), lte(hrAttendance.workDate, r.to))),
    db.select().from(hrPayslips).where(and(eq(hrPayslips.month, month), inArray(hrPayslips.memberId, ids))),
    revenueOf(db, [month]),
    quarterBonuses(db, month, params, gm, revenueOf),
    revenueTargetsFor(db,[month],ids),
  ]);
  const from=String(params.contractBonusFrom||0).replace(/^(\d{4})(\d{2})$/,'$1-$2'),kpiFrom=String(params.salesAutomationFrom||0).replace(/^(\d{4})(\d{2})$/,'$1-$2');
  const appsheet = appsheetKpiApplies(params,month);
  if(appsheet&&!crmFactsOf)throw new AppError(503,'Chưa có nguồn doanh số ghi nhận cho KPI AppSheet.','CRM_FACTS_NOT_READY');
  const netFrom=String(params.saleKpiNetFrom||0).replace(/^(\d{4})(\d{2})$/,'$1-$2'),netPolicy=!!crmFactsOf&&(appsheet||netFrom!=='0'&&month>=netFrom);
  const kpiEnabled=!!crmFactsOf&&kpiFrom!=='0'&&month>=kpiFrom,bonusEnabled=!!crmFactsOf&&from!=='0'&&month>=from,enabled=kpiEnabled||bonusEnabled||netPolicy;
  const kpiApply=kpiEnabled&&params.salesAutomationApply===1,bonusApply=bonusEnabled&&params.contractBonusApply===1;
  const history=bonusEnabled?await awardHistory(db):{accounts:[],entries:[]};
  const facts=enabled?await crmFactsOf!(db,month,[...new Set(history.accounts.map(a=>a.contractId))],lock,appsheet?{approvedOnly:true}:undefined):{members:new Map(),contracts:[]};
  const awards=bonusEnabled?await proposeAwards(db,month,from,facts.contracts,history,m=>paramsFor(db,m)):[];
  const rows: PayrollRow[] = list.map(m => {
    const profile = toProfile(profiles.get(m.id), m.positionId), input = toInput(inputs.find(i => i.memberId === m.id));
    const target=registered.get(targetKey(m.id,month));
    profile.legacyRevenueTarget=profile.revenueTarget;profile.registeredRevenueTarget=target??null;
    profile.revenueTargetSource=target!==undefined?'registration':profile.revenueTarget>0?'profile':'company';
    if(target!==undefined)profile.revenueTarget=target;
    const adj = adjustments.filter(a => a.memberId === m.id).map(({ memberId: _m, ...a }) => ({ ...a, createdByName: a.createdByName ?? '' }));
    const attendanceDays = summarizeAttendance(attendance.filter(a => a.memberId === m.id)).worked, systemRevenue = revenues.get(m.id)?.[month] ?? 0;
    const fact=facts.members.get(m.id),auto={newCustomers:fact?.newCustomers||0,transactions:fact?.transactions||0,contracts:fact?.contracts||0},resolved={...input};
    if(kpiEnabled&&profile.kpiEnabled)for(const [key,value]of Object.entries({kpiNewCustomers:auto.newCustomers,kpiTransactions:auto.transactions,kpiContracts:auto.contracts}))if((resolved as any)[key]===null)(resolved as any)[key]=value;
    if(appsheet&&profile.kpiEnabled){
      resolved.kpiRevenue = fact?.netRevenue || 0;
      // One canonical CRM source, rather than stale saved counters. Explicit KPI override remains visible.
      if(kpiEnabled){resolved.kpiNewCustomers=auto.newCustomers;resolved.kpiTransactions=auto.transactions;resolved.kpiContracts=auto.contracts;}
    }
    const probation=isProbation(profile.positionLabel);
    const ownAwards=probation?[]:awards.filter(a=>a.memberId===m.id&&(!a.isNew||profile.contractBonusEnabled&&(!netPolicy||profile.kpiEligible===false)));
    const calc = computePayslip({profile,params,kpiPolicy:appsheet?'appsheet':'legacy',input:kpiApply?resolved:appsheet?{...input,kpiRevenue:resolved.kpiRevenue}:input,adjustments:adj,attendanceDays,systemRevenue,groupMonth:gm,quarterBonusAuto:quarter.map.get(m.id)??0,...(netPolicy&&profile.payrollGroup==='sale'&&profile.kpiEnabled&&profile.kpiEligible!==false?{kpiNetRevenue:fact?.netRevenue||0,kpiNetRevenueIssues:fact?.netRevenueIssues||0}:{}),
     contractBonus:bonusApply?ownAwards.filter(a=>a.isNew).reduce((n,a)=>n+a.amount,0):0,contractBonusAdjustment:bonusApply?ownAwards.filter(a=>!a.isNew).reduce((n,a)=>n+a.amount,0):0});
    if(teamRevenue&&!probation&&profile.teamBonus&&(profile.payrollGroup==='bn'||profile.payrollGroup==='lock')){const t=teamRevenue[profile.payrollGroup];calc.teamRevenueBasis={target:teamRevenue.target,revenue:t.revenue,crm:t.crm,pos:t.pos,issues:t.issues,policyMonth:teamRevenue.policyMonth,bonusMode:teamRevenue.bonusMode};}
    calc.employment={company:m.workCompany,department:m.workDepartment,leader:m.isLeader};
    if(enabled&&!probation){const previewKpi=kpiEnabled&&profile.kpiEnabled?computeKpiCv({...resolved,kpiOverride:profile.fixedKpi??resolved.kpiOverride},params,kpiTargetsOf(params,profile),input.revenue??systemRevenue,appsheet?'appsheet':'legacy'):null;calc.salesCrm={apply:bonusApply||kpiApply&&profile.kpiEnabled,bonusApply,kpiApply:kpiApply&&profile.kpiEnabled,from,kpiEligible:profile.kpiEligible!==false,facts:auto,awards:ownAwards,previewKpi,kpiBonusPreview:Math.round((netPolicy?Math.max(0,fact?.netRevenue||0):(input.revenue??systemRevenue))*(netPolicy?netKpiBonusRate(params,previewKpi?.used??null):kpiBonusRate(params,previewKpi?.used??null)))};}
    return { member: m, profile, input, attendanceDays, systemRevenue, adjustments: adj, calc, slip: slips.find(s => s.memberId === m.id) ?? null };
  });
  for(const row of rows){if(![row.calc.gross,row.calc.deductionTotal,row.calc.net].every(Number.isSafeInteger))throw new AppError(400,'Tổng tiền vượt giới hạn tính toán an toàn. Kiểm tra tham số.');row.context={params,paramsMonth:effectiveMonth,profile:row.profile,input:row.input,systemRevenue:row.systemRevenue,attendanceDays:row.attendanceDays};}
  const confirmationHash=sha256Hex(JSON.stringify({month,params,profiles:rows.map(r=>r.profile),inputs:rows.map(r=>r.input),calc:rows.map(r=>r.calc),adjustments:rows.map(r=>r.adjustments)}));
  return { month, params, paramsMonth: effectiveMonth, groupMonth: gm, rows, quarter: quarter.detail,confirmationHash };
}

/** Phiếu lương để hiển thị: đã chốt → bản chụp lúc chốt; chưa chốt → tạm tính. */
export function payslipView(row: PayrollRow) {
  if (row.slip) {
    let calc: PayslipCalc;try{calc=JSON.parse(row.slip.data);if(!Array.isArray(calc.income)||!Array.isArray(calc.deductions))throw Error();}catch{calc={group:row.slip.payrollGroup,positionLabel:'',workDays:row.slip.workDays,baseSalary:0,revenue:0,income:[],deductions:[],gross:row.slip.gross,deductionTotal:row.slip.deductionTotal,net:row.slip.net,kpi:null,snapshotUnavailable:true};}
    return { ...calc, gross: row.slip.gross, deductionTotal: row.slip.deductionTotal, net: row.slip.net, status: row.slip.status, confirmedAt: row.slip.confirmedAt, paidAt: row.slip.paidAt, note: row.slip.note };
  }
  return { ...row.calc, status: 'estimate' as const, confirmedAt: null, paidAt: null, note: '' };
}

/** Dữ liệu lương / ngày công một người một tháng (trang chi tiết nhân viên). */
type BankSnap = { code: string; account: string; holder: string };
/**
 * Tài khoản chuyển lương của phiếu: phiếu đã chốt dùng tài khoản lúc chốt; phiếu chốt khi chưa có tài khoản (bản chụp trống)
 * → dùng tài khoản hiện tại trong hồ sơ lương (nhân viên điền sau khi chốt).
 */
export function slipBank(view: object | null, profile: { bankCode: string; bankAccount: string; bankHolder: string }): BankSnap & { fromSnapshot: boolean } {
  const snap = (view as { bank?: BankSnap } | null)?.bank;
  return snap?.account ? { ...snap, fromSnapshot: true } : { code: profile.bankCode, account: profile.bankAccount, holder: profile.bankHolder, fromSnapshot: false };
}
/** Chuyển khoản lương tháng: tài khoản (xem `slipBank`), số tiền = thực nhận, nội dung, ảnh VietQR. */
function transferOf(view: ReturnType<typeof payslipView> | null, profile: { bankCode: string; bankAccount: string; bankHolder: string; effectiveMonth: string | null }, month: string) {
  if (!view || profile.effectiveMonth === null && view.status === 'estimate') return null;
  const bank = slipBank(view, profile);
  return { bankCode: bank.code, bankAccount: bank.account, bankHolder: bank.holder, amount: Math.max(0, Math.round(view.net)), note: salaryTransferNote(month),
    fromSnapshot: bank.fromSnapshot, qr: vietQrUrl(bank.code, bank.account, view.net, month, bank.holder) };
}
export async function payrollOf(db: AnyDb, memberId: string, month: string, revenueOf: RevenueOf,crmFactsOf?:CrmFactsOf,showAllContracts=false,teamRevenueOf?:TeamRevenueOf) {
  const r = monthRange(month);
  const [board, history, attendance] = await Promise.all([
    buildPayroll(db, month, revenueOf, [memberId],crmFactsOf,false,teamRevenueOf),
    db.select().from(hrSalaryProfiles).where(eq(hrSalaryProfiles.memberId, memberId)).orderBy(desc(hrSalaryProfiles.effectiveMonth)).limit(36),
    db.select({ date: hrAttendance.workDate, status: hrAttendance.status, note: hrAttendance.note }).from(hrAttendance)
      .where(and(eq(hrAttendance.memberId, memberId), gte(hrAttendance.workDate, r.from), lte(hrAttendance.workDate, r.to))).orderBy(asc(hrAttendance.workDate)),
  ]);
  const row = board.rows[0];
  const profile = row?.profile ?? toProfile(undefined), input = row?.input ?? toInput(undefined);
  const view=row?payslipView(row):null;
  if(view?.salesCrm&&!showAllContracts)view.salesCrm={...view.salesCrm,awards:view.salesCrm.awards.map(a=>a.fact.ownerId===memberId?a:({...a,contractId:'',accountId:'',fact:undefined,policy:undefined,reason:'Điều chỉnh thưởng HĐKT theo đối soát Manager'} as any))};
  return {
    profile, input, history: history.map(h => ({ ...toProfile(h), updatedAt: h.updatedAt })),
    attendance, attendanceSummary: { ...summarizeAttendance(attendance), standardDays: board.params.standardDays, daysInMonth: r.days },
    adjustments: row?.adjustments ?? [], systemRevenue: row?.systemRevenue ?? 0, groupMonth: board.groupMonth,
    params: board.params,confirmationHash:board.confirmationHash,systemFacts:row?.calc.salesCrm?.facts||null, payslip: view, locked: !!row?.slip,
    transfer: transferOf(view, profile, month),
  };
}
