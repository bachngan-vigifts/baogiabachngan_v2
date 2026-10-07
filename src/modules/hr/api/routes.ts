import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { hrAdjustments, hrAttendance, hrPayslips, hrSalaryProfiles } from '../schema.ts';
import {
  ADJUSTMENT_KINDS, ATTENDANCE_STATUSES, DATE_RE, EMPTY_PROFILE, HR_LIMITS, computePayslip, isMonth, monthRange, summarizeAttendance,
  type PayslipFigures, type SalaryProfile,
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
  return p ? { baseSalary: p.baseSalary, allowance: p.allowance, standardDays: p.standardDays, revenueTarget: p.revenueTarget, commissionRate: p.commissionRate, insurance: p.insurance, effectiveMonth: p.effectiveMonth, note: p.note }
    : { ...EMPTY_PROFILE, effectiveMonth: null, note: '' };
}

/** Toàn bộ dữ liệu lương / ngày công của một tháng + phiếu lương (đã chốt, hoặc tạm tính từ `revenue`). */
export async function payrollOf(db: AnyDb, memberId: string, month: string, revenue: number) {
  const r = monthRange(month);
  const [profile, history, attendance, adjustments, [slip]] = await Promise.all([
    profileFor(db, memberId, month),
    db.select().from(hrSalaryProfiles).where(eq(hrSalaryProfiles.memberId, memberId)).orderBy(desc(hrSalaryProfiles.effectiveMonth)).limit(36),
    db.select({ date: hrAttendance.workDate, status: hrAttendance.status, note: hrAttendance.note }).from(hrAttendance)
      .where(and(eq(hrAttendance.memberId, memberId), gte(hrAttendance.workDate, r.from), lte(hrAttendance.workDate, r.to))).orderBy(asc(hrAttendance.workDate)),
    db.select({ id: hrAdjustments.id, kind: hrAdjustments.kind, amount: hrAdjustments.amount, reason: hrAdjustments.reason, createdAt: hrAdjustments.createdAt, createdByName: employees.name })
      .from(hrAdjustments).leftJoin(employees, eq(employees.id, hrAdjustments.createdBy))
      .where(and(eq(hrAdjustments.memberId, memberId), eq(hrAdjustments.month, month))).orderBy(asc(hrAdjustments.createdAt)),
    db.select().from(hrPayslips).where(and(eq(hrPayslips.memberId, memberId), eq(hrPayslips.month, month))).limit(1),
  ]);
  const days = summarizeAttendance(attendance);
  const estimate = computePayslip({ profile, workedDays: days.worked, revenue, adjustments });
  return {
    profile, history: history.map(h => ({ effectiveMonth: h.effectiveMonth, baseSalary: h.baseSalary, allowance: h.allowance, standardDays: h.standardDays,
      revenueTarget: h.revenueTarget, commissionRate: h.commissionRate, insurance: h.insurance, note: h.note, updatedAt: h.updatedAt })),
    attendance, attendanceSummary: { ...days, standardDays: profile.standardDays, daysInMonth: r.days },
    adjustments: adjustments.map(a => ({ ...a, createdByName: a.createdByName ?? '' })),
    /** Đã chốt → số liệu chụp lại lúc chốt; chưa chốt → tạm tính theo dữ liệu hiện tại. */
    payslip: slip ? { ...pick(slip), status: slip.status, confirmedAt: slip.confirmedAt, paidAt: slip.paidAt, note: slip.note } : { ...estimate, status: 'estimate' as const, confirmedAt: null, paidAt: null, note: '' },
    locked: !!slip,
  };
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
    const row = { memberId: id, effectiveMonth: month(b.effectiveMonth), baseSalary: money(b.baseSalary, 'Lương cơ bản'), allowance: money(b.allowance, 'Phụ cấp'),
      standardDays, revenueTarget: money(b.revenueTarget, 'Chỉ tiêu doanh số', 1e13), commissionRate, insurance: money(b.insurance, 'Bảo hiểm'),
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
    const { status: _s, confirmedAt: _c, paidAt: _p, note: _n, ...figures } = p.payslip;
    await db.insert(hrPayslips).values({ memberId: id, month: m, status: 'confirmed', ...figures, note: text(b.note, HR_LIMITS.note), confirmedBy: actor(c).id, confirmedAt: nowIso() });
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
