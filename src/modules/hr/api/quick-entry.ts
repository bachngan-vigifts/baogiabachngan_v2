import { and, eq } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { payrollLock } from '../../../core/db/payroll-lock.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { hrAdjustments, hrPayrollInputs, hrSalaryProfiles } from '../schema.ts';
import { isMonth, daysInMonth, HR_LIMITS } from '../domain/payroll.ts';
import { buildPayroll, type PayrollRow, type RevenueOf } from './payroll-data.ts';
import type { CrmFactsOf } from '../../../core/contracts/sales-payroll.ts';

const prefix = 'payroll-quick:';
const kinds = ['bonus', 'allowance', 'deduction', 'advance', 'phone_advance'] as const;
const optional = new Set(['workDays', 'revenue', 'quarterBonus', 'kpiOverride', 'kpiNewCustomers', 'kpiTransactions', 'kpiContracts', 'kpiRevenue']);
const inputLimits: Record<string, number> = { workDays: 31, overtimeHours: 400, revenue: 1e13, outputQty: 1e13,
  quarterBonus: HR_LIMITS.maxSalary, healthInsurance: HR_LIMITS.maxSalary, incomeTax: HR_LIMITS.maxSalary,
  kpiOverride: 10, kpiNewCustomers: 1e6, kpiTransactions: 1e6, kpiContracts: 1e6, kpiRevenue: 1e13, kpiMerchDays: 31, kpiTripDays: 31 };
const profileLimits: Record<string, number> = { baseSalary: HR_LIMITS.maxSalary, capacityCoef: 100, responsibility: HR_LIMITS.maxSalary,
  phoneAllowance: HR_LIMITS.maxSalary, attendanceBonus: HR_LIMITS.maxSalary, insurance: HR_LIMITS.maxSalary, outputRate: HR_LIMITS.maxSalary };
const numeric = (v: unknown, max: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new AppError(400, 'Chỉ số lương không hợp lệ.');
  return v;
};
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new AppError(400, 'Dữ liệu nhập nhanh không hợp lệ.');
  return v as Record<string, unknown>;
};
export function payrollEntry(row: PayrollRow, month: string) {
  const adjustments = [...row.adjustments].sort((a, b) => a.id.localeCompare(b.id));
  return { version: sha256Hex(JSON.stringify({ month, profile: row.profile, input: row.input, adjustments })),
    inputs: row.input, profile: row.profile,
    adjustments: Object.fromEntries(kinds.map(k => [k, adjustments.filter(a => a.id.startsWith(prefix) && a.kind === k).reduce((s, a) => s + a.amount, 0)])),
    existingAdjustments: Object.fromEntries(kinds.map(k => [k, adjustments.filter(a => !a.id.startsWith(prefix) && a.kind === k).reduce((s, a) => s + a.amount, 0)])) };
}

/** One locked transaction for all changed staff; stale rows and confirmed slips are never overwritten. */
export function registerQuickPayroll(router: Router<StaffEnv>, deps: { revenueOf: RevenueOf; crmFactsOf?: CrmFactsOf }) {
  router.put('/hr/payroll/:month/entries', async c => {
    const month = c.params.month;
    if (!isMonth(month)) throw new AppError(400, 'Tháng không hợp lệ.');
    const body = await readJson(c.req, 250_000);
    if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 100) throw new AppError(400, 'Mỗi lần lưu từ 1 đến 100 nhân viên.');
    const changes = body.rows.map(object), ids = changes.map(r => r.memberId);
    if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new AppError(400, 'Danh sách nhân viên không hợp lệ.');
    const me = (c.state.session as SessionState).member.id;
    await c.env.db.transaction(async db => {
      await payrollLock(db as any);
      const board = await buildPayroll(db as any, month, deps.revenueOf, ids as string[], deps.crmFactsOf);
      for (const change of changes) {
        const row = board.rows.find(r => r.member.id === change.memberId);
        if (!row) throw new AppError(404, 'Không tìm thấy nhân viên.');
        if (row.slip) throw new AppError(409, 'Phiếu lương đã chốt. Mở lại phiếu trước khi sửa.');
        if (change.version !== payrollEntry(row, month).version) throw new AppError(409, `Số liệu của ${row.member.name} đã thay đổi. Tải lại bảng trước khi lưu.`, 'PAYROLL_CHANGED');
        if (change.month !== undefined && change.month !== month) throw new AppError(400, 'Dữ liệu nhập thuộc tháng khác.');
        const now = new Date().toISOString(), id = row.member.id;
        if (change.inputs) {
          const patch = object(change.inputs), values: Record<string, number | null> = {};
          for (const [key, value] of Object.entries(patch)) {
            if (!Object.hasOwn(inputLimits, key)) throw new AppError(400, 'Chỉ số lương không được hỗ trợ.');
            values[key] = value === null && optional.has(key) ? null : numeric(value, inputLimits[key]!);
            if (['healthInsurance', 'incomeTax'].includes(key)) values[key] = Math.round(values[key]!);
          }
          const data = { ...row.input, ...values };
          if (data.kpiMerchDays + data.kpiTripDays > daysInMonth(month)) throw new AppError(400, 'Tổng ngày làm hàng và công tác vượt số ngày trong tháng.');
          const value = { ...data, memberId: id, month, updatedBy: me, updatedAt: now };
          await db.insert(hrPayrollInputs).values(value).onConflictDoUpdate({ target: [hrPayrollInputs.memberId, hrPayrollInputs.month], set: value });
        }
        if (change.profile) {
          const patch = object(change.profile), values: Record<string, number | boolean> = {};
          for (const [key, value] of Object.entries(patch)) {
            if (key === 'mealAllowance' && typeof value === 'boolean') values[key] = value;
            else {
              if (!Object.hasOwn(profileLimits, key)) throw new AppError(400, 'Cài đặt lương không được hỗ trợ.');
              values[key] = numeric(value, profileLimits[key]!);
              if (!['capacityCoef', 'outputRate'].includes(key)) values[key] = Math.round(values[key] as number);
            }
          }
          const { effectiveMonth: _e, kpiEligible: _k, ...profile } = row.profile;
          const value = { ...profile, ...values, memberId: id, effectiveMonth: month, updatedBy: me, updatedAt: now };
          await db.insert(hrSalaryProfiles).values(value).onConflictDoUpdate({ target: [hrSalaryProfiles.memberId, hrSalaryProfiles.effectiveMonth], set: value });
        }
        if (change.adjustments) for (const [kind, value] of Object.entries(object(change.adjustments))) {
          if (!(kinds as readonly string[]).includes(kind)) throw new AppError(400, 'Loại khoản không hợp lệ.');
          const amount = Math.round(numeric(value, HR_LIMITS.maxAmount));
          const key = prefix + sha256Hex(JSON.stringify([id, month, kind]));
          // Only replace the quick-entry row; preserve independently recorded advances and their reasons.
          if (!amount) await db.delete(hrAdjustments).where(and(eq(hrAdjustments.id, key), eq(hrAdjustments.memberId, id), eq(hrAdjustments.month, month)));
          else await db.insert(hrAdjustments).values({ id: key, memberId: id, month, kind: kind as typeof kinds[number], amount,
            reason: 'Nhập nhanh bảng lương', createdBy: me, createdAt: now }).onConflictDoUpdate({ target: hrAdjustments.id, set: { amount, createdBy: me, createdAt: now } });
        }
      }
    });
    return json({ ok: true, saved: changes.length });
  }, 'admin');
}
