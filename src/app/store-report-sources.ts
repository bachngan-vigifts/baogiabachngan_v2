import { and, gte, inArray, lte } from 'drizzle-orm';
import type { StoreAttendanceOf, StoreTargetOf } from '../core/contracts/store-report.ts';
import { teamPayrollRevenues } from './team-payroll-revenues.ts';
import { paramsFor } from '../modules/hr/api/payroll-data.ts';
import { monthRange, storeBonusRate, storeBonusTiers, summarizeAttendance } from '../modules/hr/domain/payroll.ts';
import { hrAttendance } from '../modules/hr/schema.ts';

/**
 * Nguồn cho báo cáo CHT (store không import HR / lương): chỉ tiêu + mốc thưởng DS cửa hàng theo đúng cấu hình nguồn doanh số
 * cửa hàng và tham số lương của tháng; công chấm HR để đối chiếu ngày công. Cửa hàng chưa nằm trong cấu hình → configured=false.
 */
export const storeTargetOf: StoreTargetOf = async (db, registerId, month) => {
  const facts = await teamPayrollRevenues(db, month);
  if (!facts) return { configured: false, reason: 'Chưa cấu hình nguồn doanh số cửa hàng cho tháng này.' };
  const group = facts.bn.registerId === registerId ? 'bn' : facts.lock.registerId === registerId ? 'lock' : null;
  if (!group) return { configured: false, reason: 'Cửa hàng này chưa được gán chỉ tiêu trong cấu hình nguồn doanh số cửa hàng.' };
  const t = facts[group], { params } = await paramsFor(db, month);
  const rate = storeBonusRate(params, t.revenue, facts.target);
  return { configured: true, policyMonth: facts.policyMonth, target: facts.target, revenue: t.revenue, crm: t.crm, pos: t.pos, issues: t.issues,
    ratio: facts.target > 0 ? t.revenue / facts.target : 0, rate, tiers: storeBonusTiers(params, group, facts.bonusMode, facts.target).tiers,
    bonusEstimate: Math.round(t.revenue * rate) };
};

export const storeAttendanceOf: StoreAttendanceOf = async (db, memberIds, month) => {
  const out = new Map<string, { worked: number; recorded: number }>();
  if (!memberIds.length) return out;
  const r = monthRange(month);
  const rows = await db.select({ memberId: hrAttendance.memberId, status: hrAttendance.status }).from(hrAttendance)
    .where(and(inArray(hrAttendance.memberId, [...memberIds]), gte(hrAttendance.workDate, r.from), lte(hrAttendance.workDate, r.to)));
  for (const id of memberIds) { const s = summarizeAttendance(rows.filter(x => x.memberId === id)); out.set(id, { worked: s.worked, recorded: s.recorded }); }
  return out;
};
