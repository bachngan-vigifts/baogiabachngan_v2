import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, positions } from '../../staff/schema.ts';
import { hrAdjustments, hrAttendance, hrMonthInputs, hrPayslips, hrSalaryProfiles } from '../schema.ts';
import {
  ADJUSTMENT_KINDS, ATTENDANCE_STATUSES, DATE_RE, EMPTY_PROFILE, HR_LIMITS, MONTH_INPUT_KEYS, PAY_SCHEMES, RESPONSIBILITY_MODES, computePayroll, isMonth, monthRange,
  parseMonthInputs, parseParams, summarizeAttendance,
  type PayLine, type PayScheme, type PayslipFigures, type SalaryProfile,
} from '../domain/payroll.ts';

type Ctx = RouteContext<StaffEnv>;
const actor = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
/** Doanh số tháng của nhân viên (để tính hoa hồng). Bơm vào từ app/router.ts (module staff-hub) để `hr` không phụ thuộc `sales`. */
export type RevenueOf = (db: AnyDb, memberId: string, month: string) => Promise<number>;

// ---------------- Đọc (dùng cho trang chi tiết nhân viên)
/** Mức lương áp dụng cho tháng: bản có effective_month mới nhất ≤ tháng. */
export async function profileFor(db: AnyDb, memberId: string, month: string): Promise<SalaryProfile & { effectiveMonth: string | null; note: string }> {
  const [p] = await db.select().from(hrSalaryProfiles).where(and(eq(hrSalaryProfiles.memberId, memberId), lte(hrSalaryProfiles.effectiveMonth, month)))
    .orderBy(desc(hrSalaryProfiles.effectiveMonth)).limit(1);
  return p ? { baseSalary: p.baseSalary, allowance: p.allowance, standardDays: p.standardDays, revenueTarget: p.revenueTarget, commissionRate: p.commissionRate, insurance: p.insurance,
      scheme: p.scheme, params: parseParams(p.params), effectiveMonth: p.effectiveMonth, note: p.note }
    : { ...EMPTY_PROFILE, effectiveMonth: null, note: '' };
}

/** Toàn bộ dữ liệu lương / ngày công của một tháng + phiếu lương (đã chốt, hoặc tạm tính từ `revenue`). */
export async function payrollOf(db: AnyDb, memberId: string, month: string, revenue: number) {
  const r = monthRange(month);
  const [profile, history, attendance, adjustments, [slip], [monthInputs]] = await Promise.all([
    profileFor(db, memberId, month),
    db.select().from(hrSalaryProfiles).where(eq(hrSalaryProfiles.memberId, memberId)).orderBy(desc(hrSalaryProfiles.effectiveMonth)).limit(36),
    db.select({ date: hrAttendance.workDate, status: hrAttendance.status, note: hrAttendance.note }).from(hrAttendance)
      .where(and(eq(hrAttendance.memberId, memberId), gte(hrAttendance.workDate, r.from), lte(hrAttendance.workDate, r.to))).orderBy(asc(hrAttendance.workDate)),
    db.select({ id: hrAdjustments.id, kind: hrAdjustments.kind, amount: hrAdjustments.amount, reason: hrAdjustments.reason, createdAt: hrAdjustments.createdAt, createdByName: employees.name })
      .from(hrAdjustments).leftJoin(employees, eq(employees.id, hrAdjustments.createdBy))
      .where(and(eq(hrAdjustments.memberId, memberId), eq(hrAdjustments.month, month))).orderBy(asc(hrAdjustments.createdAt)),
    db.select().from(hrPayslips).where(and(eq(hrPayslips.memberId, memberId), eq(hrPayslips.month, month))).limit(1),
    db.select({ data: hrMonthInputs.data }).from(hrMonthInputs).where(and(eq(hrMonthInputs.memberId, memberId), eq(hrMonthInputs.month, month))).limit(1),
  ]);
  const days = summarizeAttendance(attendance), inputs = parseMonthInputs(monthInputs?.data);
  const estimate = computePayroll({ profile, workedDays: days.worked, revenue, adjustments, inputs });
  return {
    profile, history: history.map(h => ({ effectiveMonth: h.effectiveMonth, baseSalary: h.baseSalary, allowance: h.allowance, standardDays: h.standardDays,
      revenueTarget: h.revenueTarget, commissionRate: h.commissionRate, insurance: h.insurance, scheme: h.scheme, params: parseParams(h.params), note: h.note, updatedAt: h.updatedAt })),
    inputs,
    attendance, attendanceSummary: { ...days, standardDays: profile.standardDays, daysInMonth: r.days },
    adjustments: adjustments.map(a => ({ ...a, createdByName: a.createdByName ?? '' })),
    /** Đã chốt → số liệu chụp lại lúc chốt; chưa chốt → tạm tính theo dữ liệu hiện tại. */
    payslip: slip ? { ...pick(slip), scheme: slip.scheme, lines: parseLines(slip.lines), kpiCv: null as number | null, status: slip.status, confirmedAt: slip.confirmedAt, paidAt: slip.paidAt, note: slip.note } : { ...estimate, status: 'estimate' as const, confirmedAt: null, paidAt: null, note: '' },
    locked: !!slip,
  };
}
function parseLines(raw: string): PayLine[] {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}
const pick = (s: typeof hrPayslips.$inferSelect): PayslipFigures => ({
  standardDays: s.standardDays, workedDays: s.workedDays, baseSalary: s.baseSalary, salaryByDays: s.salaryByDays, allowance: s.allowance,
  revenue: s.revenue, commissionRate: s.commissionRate, commission: s.commission, bonus: s.bonus, extraAllowance: s.extraAllowance,
  deduction: s.deduction, advance: s.advance, insurance: s.insurance, gross: s.gross, net: s.net,
});

// ---------------- Kiểm tra đầu vào
async function staffMember(db: AnyDb, id: string) {
  const [m] = await db.select({ id: employees.id, role: employees.role }).from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt))).limit(1);
  if (!m || m.role === 'customer' || m.role === 'supplier') throw new AppError(404, 'Không tìm thấy nhân viên.');
  return m.id;
}
const money = (v: unknown, label: string, max: number = HR_LIMITS.maxSalary) => {
  const n = v === '' || v === undefined || v === null ? 0 : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new AppError(400, `${label} không hợp lệ.`);
  return Math.round(n);
};
const month = (v: unknown) => { if (!isMonth(v)) throw new AppError(400, 'Tháng không hợp lệ (YYYY-MM).'); return v; };
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
async function assertOpen(db: AnyDb, memberId: string, m: string) {
  const [slip] = await db.select({ status: hrPayslips.status }).from(hrPayslips).where(and(eq(hrPayslips.memberId, memberId), eq(hrPayslips.month, m))).limit(1);
  if (slip) throw new AppError(409, `Lương tháng ${m.slice(5)}/${m.slice(0, 4)} đã chốt. Mở lại phiếu lương trước khi sửa.`);
}

/**
 * Lương / ngày công / thưởng phạt – chỉ Manager sửa (khu vực 'admin'). Nhân viên xem của chính mình ở trang chi tiết nhân viên.
 *  PUT    /hr/members/:id/salary                 mức lương áp dụng từ một tháng
 *  PUT    /hr/members/:id/attendance/:month      chấm công nhiều ngày một lượt: { days: { 'YYYY-MM-DD': status | '' } } ('' = xoá)
 *  POST   /hr/members/:id/adjustments            thưởng / phụ cấp thêm / khấu trừ / tạm ứng
 *  DELETE /hr/adjustments/:adjId
 *  POST   /hr/members/:id/payslips/:month        chốt lương (chụp số liệu) · POST …/paid đánh dấu đã trả · DELETE mở lại (chưa trả)
 */
export function registerHrRoutes(router: Router<StaffEnv>, deps: { revenueOf: RevenueOf }) {
  router.put('/hr/members/:id/salary', async c => {
    const db = c.env.db, id = await staffMember(db, c.params.id!), b = await readJson(c.req, 4_000);
    const standardDays = Number(b.standardDays ?? 26), commissionRate = Number(b.commissionRate ?? 0);
    if (!Number.isFinite(standardDays) || standardDays <= 0 || standardDays > 31) throw new AppError(400, 'Ngày công chuẩn phải từ 1 đến 31.');
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) throw new AppError(400, '% hoa hồng phải từ 0 đến 100.');
    const scheme = (b.scheme ?? 'basic') as PayScheme;
    if (!(PAY_SCHEMES as readonly unknown[]).includes(scheme)) throw new AppError(400, 'Cách tính lương không hợp lệ.');
    const pr = (b.params && typeof b.params === 'object' ? b.params : {}) as Record<string, unknown>;
    if (pr.responsibilityMode !== undefined && !(RESPONSIBILITY_MODES as readonly unknown[]).includes(pr.responsibilityMode)) throw new AppError(400, 'Cách tính trách nhiệm không hợp lệ.');
    const params = JSON.stringify({
      capabilityCoef: money(pr.capabilityCoef, 'Hệ số năng lực', 1000), responsibility: money(pr.responsibility, 'Trách nhiệm'),
      responsibilityMode: pr.responsibilityMode ?? 'fixed', meal: pr.meal === true, outputRate: Math.min(Math.max(Number(pr.outputRate) || 0, 0), 1e7),
    });
    const row = { memberId: id, effectiveMonth: month(b.effectiveMonth), baseSalary: money(b.baseSalary, 'Lương cơ bản'), allowance: money(b.allowance, 'Phụ cấp'),
      standardDays, revenueTarget: money(b.revenueTarget, 'Chỉ tiêu doanh số', 1e13), commissionRate, insurance: money(b.insurance, 'Bảo hiểm'), scheme, params,
      note: text(b.note, HR_LIMITS.note), updatedBy: actor(c).id, updatedAt: nowIso() };
    const { memberId: _m, effectiveMonth: _e, ...set } = row;
    await db.insert(hrSalaryProfiles).values(row).onConflictDoUpdate({ target: [hrSalaryProfiles.memberId, hrSalaryProfiles.effectiveMonth], set });
    return json({ ok: true });
  }, 'admin');

  router.put('/hr/members/:id/attendance/:month', async c => {
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
  }, 'admin');

  router.put('/hr/members/:id/inputs/:month', async c => {
    const db = c.env.db, id = await staffMember(db, c.params.id!), m = month(c.params.month), b = await readJson(c.req, 4_000);
    await assertOpen(db, id, m);
    const raw = (b.inputs && typeof b.inputs === 'object' ? b.inputs : {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      if (!(MONTH_INPUT_KEYS as readonly string[]).includes(k)) throw new AppError(400, `Khoản "${k}" không hợp lệ.`);
      if (v !== '' && v !== null && !(Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1e13)) throw new AppError(400, `Giá trị "${k}" không hợp lệ.`);
    }
    const data = JSON.stringify(parseMonthInputs(raw)), now = nowIso(), me = actor(c).id;
    await db.insert(hrMonthInputs).values({ memberId: id, month: m, data, updatedBy: me, updatedAt: now })
      .onConflictDoUpdate({ target: [hrMonthInputs.memberId, hrMonthInputs.month], set: { data, updatedBy: me, updatedAt: now } });
    return json({ ok: true });
  }, 'admin');

  /** Bảng lương tổng của một tháng: mọi nhân viên đang làm, phiếu đã chốt hoặc tạm tính (để Manager tải file Excel). */
  router.get('/hr/payroll/:month', async c => {
    const db = c.env.db, m = month(c.params.month);
    const staff = await db.select({ id: employees.id, name: employees.name, role: employees.role, position: positions.name }).from(employees)
      .leftJoin(positions, eq(positions.id, employees.positionId)).where(and(isNull(employees.deletedAt), eq(employees.active, true))).orderBy(asc(employees.name));
    const rows = [];
    for (const e of staff) {
      if (e.role === 'customer' || e.role === 'supplier') continue;
      const p = await payrollOf(db, e.id, m, await deps.revenueOf(db, e.id, m));
      if (p.payslip.status === 'estimate' && !p.profile.effectiveMonth) continue; // chưa đặt mức lương: không đưa vào bảng lương
      rows.push({ id: e.id, name: e.name, position: e.position ?? '', scheme: p.payslip.scheme, status: p.payslip.status, workedDays: p.payslip.workedDays, standardDays: p.payslip.standardDays,
        gross: p.payslip.gross, deduction: p.payslip.deduction + p.payslip.insurance + p.payslip.advance, net: p.payslip.net, lines: p.payslip.lines });
    }
    return json({ month: m, rows, total: { gross: rows.reduce((s, r) => s + r.gross, 0), deduction: rows.reduce((s, r) => s + r.deduction, 0), net: rows.reduce((s, r) => s + r.net, 0) } });
  }, 'admin');

  router.post('/hr/members/:id/adjustments', async c => {
    const db = c.env.db, id = await staffMember(db, c.params.id!), b = await readJson(c.req, 4_000), m = month(b.month);
    if (!(ADJUSTMENT_KINDS as readonly unknown[]).includes(b.kind)) throw new AppError(400, 'Chọn loại khoản (thưởng, phụ cấp, khấu trừ, tạm ứng).');
    const amount = money(b.amount, 'Số tiền', HR_LIMITS.maxAmount);
    if (amount <= 0) throw new AppError(400, 'Nhập số tiền lớn hơn 0.');
    await assertOpen(db, id, m);
    const adj = { id: crypto.randomUUID(), memberId: id, month: m, kind: b.kind as typeof ADJUSTMENT_KINDS[number], amount, reason: text(b.reason, HR_LIMITS.reason), createdBy: actor(c).id, createdAt: nowIso() };
    await db.insert(hrAdjustments).values(adj);
    return json({ id: adj.id }, 201);
  }, 'admin');

  router.delete('/hr/adjustments/:adjId', async c => {
    const db = c.env.db, [a] = await db.select().from(hrAdjustments).where(eq(hrAdjustments.id, c.params.adjId!)).limit(1);
    if (!a) throw new AppError(404, 'Không tìm thấy khoản này.');
    await assertOpen(db, a.memberId, a.month);
    await db.delete(hrAdjustments).where(eq(hrAdjustments.id, a.id));
    return json({ ok: true });
  }, 'admin');

  router.post('/hr/members/:id/payslips/:month', async c => {
    const db = c.env.db, id = await staffMember(db, c.params.id!), m = month(c.params.month), b = await readJson(c.req, 2_000);
    await assertOpen(db, id, m);
    const p = await payrollOf(db, id, m, await deps.revenueOf(db, id, m));
    if (p.payslip.status !== 'estimate') throw new AppError(409, 'Lương tháng này đã chốt.');
    const { status: _s, confirmedAt: _c, paidAt: _p, note: _n, lines, kpiCv: _k, scheme, ...figures } = p.payslip;
    await db.insert(hrPayslips).values({ memberId: id, month: m, status: 'confirmed', ...figures, scheme, lines: JSON.stringify(lines), note: text(b.note, HR_LIMITS.note), confirmedBy: actor(c).id, confirmedAt: nowIso() });
    return json({ ok: true, net: figures.net }, 201);
  }, 'admin');

  router.post('/hr/members/:id/payslips/:month/paid', async c => {
    const done = await c.env.db.update(hrPayslips).set({ status: 'paid', paidAt: nowIso() })
      .where(and(eq(hrPayslips.memberId, c.params.id!), eq(hrPayslips.month, month(c.params.month)), eq(hrPayslips.status, 'confirmed'))).returning({ m: hrPayslips.month });
    if (!done.length) throw new AppError(404, 'Chưa chốt lương tháng này (hoặc đã trả).');
    return json({ ok: true });
  }, 'admin');

  router.delete('/hr/members/:id/payslips/:month', async c => {
    const done = await c.env.db.delete(hrPayslips)
      .where(and(eq(hrPayslips.memberId, c.params.id!), eq(hrPayslips.month, month(c.params.month)), eq(hrPayslips.status, 'confirmed'))).returning({ m: hrPayslips.month });
    if (!done.length) throw new AppError(409, 'Chỉ mở lại được phiếu lương đã chốt mà chưa trả.');
    return json({ ok: true });
  }, 'admin');
}
