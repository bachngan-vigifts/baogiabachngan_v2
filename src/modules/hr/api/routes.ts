import { payrollEntry, registerQuickPayroll } from './quick-entry.ts';
import type {CrmFactsOf} from '../../../core/contracts/sales-payroll.ts';
import {payrollLock} from '../../../core/db/payroll-lock.ts';
import {reserveAwards,releaseAwards,payAwards} from './contract-bonuses.ts';
import { and, desc, eq, inArray, isNull,lte } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { hrAdjustments, hrAttendance, hrPayrollInputs, hrPayrollMonths, hrPayrollSettings, hrPayslips, hrSalaryProfiles } from '../schema.ts';
import { PARAM_FIELDS, validateParams } from '../domain/params.ts';
import {
  ADJUSTMENT_KINDS, ATTENDANCE_STATUSES, DATE_RE, GROUP_DEDUCTION, GROUP_INCOME, GROUP_LABEL, HR_LIMITS, LINE_LABEL, PAYROLL_GROUPS,
  RESPONSIBILITY_MODES,salaryKpiEligible, isMonth, monthRange,daysInMonth, vietQrUrl,
} from '../domain/payroll.ts';
import { buildPayroll, paramsFor, payslipView, type PayrollRow, type RevenueOf } from './payroll-data.ts';

export { payrollOf, type RevenueOf } from './payroll-data.ts';

type Ctx = RouteContext<StaffEnv>;
const actor = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();

// ---------------- Kiểm tra đầu vào
async function staffMember(db: AnyDb, id: string) {
  const [m] = await db.select({ id: employees.id, role: employees.role }).from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt))).limit(1);
  if (!m || m.role === 'customer' || m.role === 'supplier') throw new AppError(404, 'Không tìm thấy nhân viên.');
  return m.id;
}
const num = (v: unknown, label: string, max: number = HR_LIMITS.maxSalary) => {
  const n = v === '' || v === undefined || v === null ? 0 : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new AppError(400, `${label} không hợp lệ.`);
  return n;
};
/** Số tuỳ chọn: trống → null (lấy tự động). */
const optNum = (v: unknown, label: string, max: number = HR_LIMITS.maxSalary) => v === '' || v === undefined || v === null ? null : num(v, label, max);
const month = (v: unknown) => { if (!isMonth(v)) throw new AppError(400, 'Tháng không hợp lệ (YYYY-MM).'); return v; };
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const oneOf = <T extends string>(v: unknown, list: readonly T[], label: string, fallback: T): T => {
  if (v === undefined || v === null || v === '') return fallback;
  if (!(list as readonly unknown[]).includes(v)) throw new AppError(400, `${label} không hợp lệ.`);
  return v as T;
};
async function assertOpen(db: AnyDb, memberId: string, m: string) {
  const [slip] = await db.select({ status: hrPayslips.status }).from(hrPayslips).where(and(eq(hrPayslips.memberId, memberId), eq(hrPayslips.month, m))).limit(1);
  if (slip) throw new AppError(409, `Lương tháng ${m.slice(5)}/${m.slice(0, 4)} đã chốt. Mở lại phiếu lương trước khi sửa.`);
}
/** Lưu phiếu lương đã chốt: tổng + toàn bộ chi tiết (JSON). */
const slipValues = (row: PayrollRow, me: string, note: string) => ({
  memberId: row.member.id, status: 'confirmed' as const, payrollGroup: row.calc.group, workDays: row.calc.workDays,
  gross: row.calc.gross, deductionTotal: row.calc.deductionTotal, net: row.calc.net,
  data: JSON.stringify({ ...row.calc,snapshotVersion:2,calculationContext:row.context, bank: { code: row.profile.bankCode, account: row.profile.bankAccount, holder: row.profile.bankHolder } }),
  note, confirmedBy: me, confirmedAt: nowIso(),
});

/**
 * Lương – chỉ Manager (khu vực 'admin'). Nhân viên xem lương của chính mình ở trang chi tiết nhân viên.
 *  GET/PUT /hr/settings                          tham số lương công ty (áp dụng từ tháng)
 *  PUT     /hr/months/:month                     số liệu chung của nhóm: DS Bách Ngân, DS TB 6 tháng, DS team Lock, chi thưởng quý
 *  GET     /hr/payroll/:month                    bảng lương công ty (3 bảng + tổng hợp + chuyển khoản)
 *  POST    /hr/payroll/:month/confirm            chốt lương mọi người chưa chốt trong tháng
 *  PUT     /hr/members/:id/salary                hồ sơ lương áp dụng từ một tháng
 *  PUT     /hr/members/:id/inputs/:month         số liệu tháng (ngày công, tăng ca, DS, sản lượng, KPI CV, BHYT, TNCN, thưởng quý)
 *  PUT     /hr/members/:id/attendance/:month     chấm công nhiều ngày: { days: { 'YYYY-MM-DD': status | '' } }
 *  POST    /hr/members/:id/adjustments · DELETE /hr/adjustments/:adjId   thưởng khác, công tác, vi phạm, tạm ứng, tạm ứng điện thoại
 *  POST    /hr/members/:id/payslips/:month       chốt · POST …/paid đã trả · DELETE mở lại (chưa trả)
 */
export function registerHrRoutes(router: Router<StaffEnv>, deps: { revenueOf: RevenueOf;crmFactsOf?:CrmFactsOf }) {
  registerQuickPayroll(router, deps);
  const write=(fn:(c:Ctx)=>Promise<Response>)=>async(c:Ctx)=>c.env.db.transaction(async tx=>{await payrollLock(tx as any);return fn({...c,env:{...c.env,db:tx as any}});});
  router.get('/hr/settings', async c => {
    const m = c.url.searchParams.get('month'), db = c.env.db;
    const cur = await paramsFor(db, isMonth(m) ? m : new Date().toISOString().slice(0, 7));
    const versions = await db.select({ effectiveMonth: hrPayrollSettings.effectiveMonth, updatedAt: hrPayrollSettings.updatedAt }).from(hrPayrollSettings).orderBy(desc(hrPayrollSettings.effectiveMonth)).limit(36);
    return json({ ...cur, fields: PARAM_FIELDS, versions });
  }, 'admin');

  router.put('/hr/settings', write(async c => {
    const b = await readJson(c.req, 20_000), m = month(b.effectiveMonth), err = validateParams(b.params);
    if (err) throw new AppError(400, err);
    const previous=(await paramsFor(c.env.db,m)).params;
    const params = Object.fromEntries(PARAM_FIELDS.map(f => [f.key, Number((b.params as Record<string, unknown>)[f.key] ?? (/^(salesAutomation|saleKpiNet|contractBonus|contractStar|contractLiquidation)/.test(f.key)?previous[f.key]:f.value))]));
    const policyError=validateParams(params);if(policyError)throw new AppError(400,policyError);
    const row = { effectiveMonth: m, params: JSON.stringify(params), updatedBy: actor(c).id, updatedAt: nowIso() };
    await c.env.db.insert(hrPayrollSettings).values(row).onConflictDoUpdate({ target: hrPayrollSettings.effectiveMonth, set: { params: row.params, updatedBy: row.updatedBy, updatedAt: row.updatedAt } });
    return json({ ok: true });
  }), 'admin');

  router.put('/hr/months/:month', write(async c => {
    const m = month(c.params.month), b = await readJson(c.req, 4_000);
    const row = { month: m, bnRevenue: num(b.bnRevenue, 'DS Bách Ngân', 1e13), bnAvgRevenue: num(b.bnAvgRevenue, 'DS TB 6 tháng', 1e13), lockRevenue: num(b.lockRevenue, 'DS team Lock', 1e13),
      payQuarterBonus: b.payQuarterBonus === true, note: text(b.note, HR_LIMITS.note), updatedBy: actor(c).id, updatedAt: nowIso() };
    const { month: _m, ...set } = row;
    await c.env.db.insert(hrPayrollMonths).values(row).onConflictDoUpdate({ target: hrPayrollMonths.month, set });
    return json({ ok: true });
  }), 'admin');

  router.get('/hr/payroll/:month', async c => {
    const b = await buildPayroll(c.env.db, month(c.params.month), deps.revenueOf,undefined,deps.crmFactsOf);
    const rows = b.rows.map(r => {
      const slip = payslipView(r);
      return { member: r.member, entry: payrollEntry(r), profile: { payrollGroup: r.profile.payrollGroup, positionLabel: r.profile.positionLabel, hasProfile: r.profile.effectiveMonth !== null,
          bankCode: r.profile.bankCode, bankAccount: r.profile.bankAccount, bankHolder: r.profile.bankHolder },
        payslip: slip, qr: vietQrUrl(r.profile.bankCode, r.profile.bankAccount, slip.net, b.month) };
    });
    // Tổng chỉ tính người đã có hồ sơ lương / phiếu đã chốt (người chưa có hồ sơ hiện riêng để Manager thiết lập).
    const counted = rows.filter(r => r.profile.hasProfile || r.payslip.status !== 'estimate');
    const totals = PAYROLL_GROUPS.map(g => { const list = counted.filter(r => r.payslip.group === g);
      return { group: g, label: GROUP_LABEL[g], people: list.length, gross: list.reduce((s, r) => s + r.payslip.gross, 0), deductions: list.reduce((s, r) => s + r.payslip.deductionTotal, 0), net: list.reduce((s, r) => s + r.payslip.net, 0) }; });
    return json({ month: b.month, params: b.params, paramsMonth: b.paramsMonth, groupMonth: b.groupMonth, quarter: b.quarter,confirmationHash:b.confirmationHash, rows, totals,
      columns: { income: GROUP_INCOME, deductions: GROUP_DEDUCTION, labels: LINE_LABEL, groups: GROUP_LABEL } });
  }, 'admin');

  router.post('/hr/payroll/:month/confirm', write(async c => {
    const m=month(c.params.month),me=actor(c).id,body=await readJson(c.req,2000),db=c.env.db,b=await buildPayroll(db,m,deps.revenueOf,undefined,deps.crmFactsOf,true);
    const open=b.rows.filter(r=>!r.slip&&r.profile.effectiveMonth!==null);
    if(open.some(r=>r.calc.kpiNetBasis?.issues&&r.calc.kpiNetBasis.rate>0))throw new AppError(409,'Có đơn chưa đối chiếu được hoa hồng khách hàng. Kiểm tra báo giá nguồn trước khi chốt lương.','KPI_NET_UNVERIFIED');
    if(open.some(r=>r.calc.salesCrm?.apply||r.calc.kpiNetBasis)&&body.confirmationHash!==b.confirmationHash)throw new AppError(409,'Số liệu lương đã đổi. Xem lại rồi chốt.','PAYROLL_CHANGED');
    for(const row of open){const runId=crypto.randomUUID();await db.insert(hrPayslips).values({...slipValues(row,me,''),data:JSON.stringify({...JSON.parse(slipValues(row,me,'').data),runId}),month:m});if(row.calc.salesCrm?.bonusApply??row.calc.salesCrm?.apply)await reserveAwards(db,row.member.id,m,runId,row.calc.salesCrm.awards);}
    return json({ok:true,confirmed:open.length});
  }), 'admin');

  router.put('/hr/members/:id/salary', write(async c => {
    const db = c.env.db, id = await staffMember(db, c.params.id!), b = await readJson(c.req, 6_000);
    const [person]=await db.select({positionId:employees.positionId}).from(employees).where(eq(employees.id,id));const eligible=salaryKpiEligible(person?.positionId);
    if(!eligible&&(b.kpiEnabled===true||b.fixedKpi!==undefined&&b.fixedKpi!==null&&b.fixedKpi!==''))throw new AppError(400,'Sale Admin không áp dụng KPI; chỉ bật thưởng sao HĐKT và thưởng thanh lý.');
    const [prior]=await db.select().from(hrSalaryProfiles).where(and(eq(hrSalaryProfiles.memberId,id),lte(hrSalaryProfiles.effectiveMonth,month(b.effectiveMonth)))).orderBy(desc(hrSalaryProfiles.effectiveMonth)).limit(1);
    const row = {
      memberId: id, effectiveMonth: month(b.effectiveMonth),
      payrollGroup: oneOf(b.payrollGroup, PAYROLL_GROUPS, 'Bảng lương', 'sale'), positionLabel: text(b.positionLabel, 60).toUpperCase(),
      baseSalary: Math.round(num(b.baseSalary, 'Lương cơ bản')), capacityCoef: num(b.capacityCoef, 'Hệ số năng lực', 100),
      responsibilityMode: oneOf(b.responsibilityMode, RESPONSIBILITY_MODES, 'Cách tính trách nhiệm', 'fixed'), responsibility: Math.round(num(b.responsibility, 'Trách nhiệm')),
      mealAllowance: b.mealAllowance !== false, phoneAllowance: Math.round(num(b.phoneAllowance, 'Phụ cấp điện thoại')), attendanceBonus: Math.round(num(b.attendanceBonus, 'Chuyên cần')),
      kpiEnabled: eligible&&b.kpiEnabled === true,fixedKpi:!eligible?null:b.fixedKpi===undefined?prior?.fixedKpi??null:optNum(b.fixedKpi,'KPI cố định',10),contractBonusEnabled:b.contractBonusEnabled===undefined?prior?.contractBonusEnabled??false:b.contractBonusEnabled===true, teamBonus: b.teamBonus === true, outputRate: num(b.outputRate, 'Đơn giá sản lượng'),
      revenueTarget: Math.round(num(b.revenueTarget, 'Chỉ tiêu DS', 1e13)), insurance: Math.round(num(b.insurance, 'BHXH')),
      bankCode: text(b.bankCode, 30).toLowerCase().replace(/[^a-z0-9]/g, ''), bankAccount: text(b.bankAccount, 30).replace(/[^\dA-Za-z]/g, ''), bankHolder: text(b.bankHolder, HR_LIMITS.text).toUpperCase(),
      note: text(b.note, HR_LIMITS.note), updatedBy: actor(c).id, updatedAt: nowIso(),
    };
    if(row.payrollGroup!=='sale'&&(row.contractBonusEnabled||row.fixedKpi!==null))throw new AppError(400,'KPI cố định và thưởng HĐKT chỉ áp dụng bảng Sale & Văn phòng.');
    const { memberId: _m, effectiveMonth: _e, ...set } = row;
    await db.insert(hrSalaryProfiles).values(row).onConflictDoUpdate({ target: [hrSalaryProfiles.memberId, hrSalaryProfiles.effectiveMonth], set });
    return json({ ok: true });
  }), 'admin');

  router.put('/hr/members/:id/inputs/:month', write(async c => {
    const db = c.env.db, id = await staffMember(db, c.params.id!), m = month(c.params.month), b = await readJson(c.req, 6_000);
    await assertOpen(db, id, m);
    const kpiOverride = optNum(b.kpiOverride, 'KPI chốt', 10);
    const row = {
      memberId: id, month: m, workDays: optNum(b.workDays, 'Ngày làm việc', 31), overtimeHours: num(b.overtimeHours, 'Giờ tăng ca', 400),
      revenue: optNum(b.revenue, 'DS tháng', 1e13), outputQty: num(b.outputQty, 'Sản lượng', 1e13),
      kpiNewCustomers: optNum(b.kpiNewCustomers, 'KH mới', 1e6), kpiTransactions: optNum(b.kpiTransactions, 'Giao dịch', 1e6), kpiContracts: optNum(b.kpiContracts, 'Số HĐ', 1e6),
      kpiRevenue: optNum(b.kpiRevenue, 'DS cá nhân', 1e13), kpiMerchDays: num(b.kpiMerchDays, 'Ngày làm hàng', 31), kpiTripDays: num(b.kpiTripDays, 'Ngày công tác', 31), kpiOverride,
      healthInsurance: Math.round(num(b.healthInsurance, 'BHYT')), incomeTax: Math.round(num(b.incomeTax, 'Thuế TNCN')),
      quarterBonus: optNum(b.quarterBonus, 'Thưởng quý'), note: text(b.note, HR_LIMITS.note), updatedBy: actor(c).id, updatedAt: nowIso(),
    };
    if(row.kpiMerchDays+row.kpiTripDays>daysInMonth(m))throw new AppError(400,'Tổng ngày làm hàng và công tác vượt số ngày trong tháng.');
    const { memberId: _m, month: _mo, ...set } = row;
    await db.insert(hrPayrollInputs).values(row).onConflictDoUpdate({ target: [hrPayrollInputs.memberId, hrPayrollInputs.month], set });
    return json({ ok: true });
  }), 'admin');

  router.put('/hr/members/:id/attendance/:month', write(async c => {
    const db = c.env.db, id = await staffMember(db, c.params.id!), m = month(c.params.month), b = await readJson(c.req, 20_000);
    await assertOpen(db, id, m);
    const days = b.days && typeof b.days === 'object' ? Object.entries(b.days as Record<string, unknown>) : [];
    if (!days.length || days.length > 31) throw new AppError(400, 'Chọn ngày cần chấm công.');
    const set: { date: string; status: typeof ATTENDANCE_STATUSES[number] }[] = [], clear: string[] = [];
    for (const [date, st] of days) {
      if (!DATE_RE.test(date) || date.slice(0, 7) !== m || Number(date.slice(8)) > monthRange(m).days) throw new AppError(400, `Ngày ${date} không thuộc tháng ${m}.`);
      if (st === '' || st === null) clear.push(date);
      else if ((ATTENDANCE_STATUSES as readonly unknown[]).includes(st)) set.push({ date, status: st as typeof ATTENDANCE_STATUSES[number] });
      else throw new AppError(400, 'Trạng thái chấm công không hợp lệ.');
    }
    const now = nowIso(), me = actor(c).id;
    await db.transaction(async tx => {
      if (clear.length) await tx.delete(hrAttendance).where(and(eq(hrAttendance.memberId, id), inArray(hrAttendance.workDate, clear)));
      for (const s of set) await tx.insert(hrAttendance).values({ memberId: id, workDate: s.date, status: s.status, recordedBy: me, updatedAt: now })
        .onConflictDoUpdate({ target: [hrAttendance.memberId, hrAttendance.workDate], set: { status: s.status, recordedBy: me, updatedAt: now } });
    });
    return json({ ok: true });
  }), 'admin');

  router.post('/hr/members/:id/adjustments', write(async c => {
    const db = c.env.db, id = await staffMember(db, c.params.id!), b = await readJson(c.req, 4_000), m = month(b.month);
    if (!(ADJUSTMENT_KINDS as readonly unknown[]).includes(b.kind)) throw new AppError(400, 'Chọn loại khoản (thưởng, công tác, vi phạm, tạm ứng…).');
    const amount = Math.round(num(b.amount, 'Số tiền', HR_LIMITS.maxAmount));
    if (amount <= 0) throw new AppError(400, 'Nhập số tiền lớn hơn 0.');
    await assertOpen(db, id, m);
    const adj = { id: crypto.randomUUID(), memberId: id, month: m, kind: b.kind as typeof ADJUSTMENT_KINDS[number], amount, reason: text(b.reason, HR_LIMITS.reason), createdBy: actor(c).id, createdAt: nowIso() };
    await db.insert(hrAdjustments).values(adj);
    return json({ id: adj.id }, 201);
  }), 'admin');

  router.delete('/hr/adjustments/:adjId', write(async c => {
    const db = c.env.db, [a] = await db.select().from(hrAdjustments).where(eq(hrAdjustments.id, c.params.adjId!)).limit(1);
    if (!a) throw new AppError(404, 'Không tìm thấy khoản này.');
    await assertOpen(db, a.memberId, a.month);
    await db.delete(hrAdjustments).where(eq(hrAdjustments.id, a.id));
    return json({ ok: true });
  }), 'admin');

  router.post('/hr/members/:id/payslips/:month', write(async c => {
    const db = c.env.db, id = await staffMember(db, c.params.id!), m = month(c.params.month), b = await readJson(c.req, 2_000);
    await assertOpen(db, id, m);
    const board=await buildPayroll(db,m,deps.revenueOf,[id],deps.crmFactsOf,true),[row]=board.rows;
    if(row?.calc.kpiNetBasis?.issues&&row.calc.kpiNetBasis.rate>0)throw new AppError(409,'Có đơn chưa đối chiếu được hoa hồng khách hàng. Kiểm tra báo giá nguồn trước khi chốt lương.','KPI_NET_UNVERIFIED');
    if (!row || row.profile.effectiveMonth === null) throw new AppError(400, 'Chưa đặt hồ sơ lương cho nhân viên này.');
    if((row.calc.salesCrm?.apply||row.calc.kpiNetBasis)&&b.confirmationHash!==board.confirmationHash)throw new AppError(409,'Số liệu lương đã đổi. Xem lại rồi chốt.','PAYROLL_CHANGED');
    const runId=crypto.randomUUID(),values=slipValues(row,actor(c).id,text(b.note,HR_LIMITS.note));
    await db.insert(hrPayslips).values({...values,data:JSON.stringify({...JSON.parse(values.data),runId}),month:m});
    if(row.calc.salesCrm?.bonusApply??row.calc.salesCrm?.apply)await reserveAwards(db,id,m,runId,row.calc.salesCrm.awards);
    return json({ ok: true, net: row.calc.net }, 201);
  }), 'admin');

  router.post('/hr/members/:id/payslips/:month/paid', write(async c => {
    const [slip]=await c.env.db.select({net:hrPayslips.net}).from(hrPayslips).where(and(eq(hrPayslips.memberId,c.params.id!),eq(hrPayslips.month,month(c.params.month))));if(slip&&slip.net<0)throw new AppError(409,'Phiếu lương âm cần đối soát khoản phải thu; không đánh dấu đã trả.');
    const done = await c.env.db.update(hrPayslips).set({ status: 'paid', paidAt: nowIso() })
      .where(and(eq(hrPayslips.memberId, c.params.id!), eq(hrPayslips.month, month(c.params.month)), eq(hrPayslips.status, 'confirmed'))).returning({ m: hrPayslips.month });
    if (!done.length) throw new AppError(404, 'Chưa chốt lương tháng này (hoặc đã trả).');
    await payAwards(c.env.db,c.params.id!,month(c.params.month));
    return json({ ok: true });
  }), 'admin');

  router.delete('/hr/members/:id/payslips/:month', write(async c => {
    await releaseAwards(c.env.db,c.params.id!,month(c.params.month));
    const done = await c.env.db.delete(hrPayslips)
      .where(and(eq(hrPayslips.memberId, c.params.id!), eq(hrPayslips.month, month(c.params.month)), eq(hrPayslips.status, 'confirmed'))).returning({ m: hrPayslips.month });
    if (!done.length) throw new AppError(409, 'Chỉ mở lại được phiếu lương đã chốt mà chưa trả.');
    return json({ ok: true });
  }), 'admin');
}
