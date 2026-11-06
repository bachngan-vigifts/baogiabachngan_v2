import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { DashboardStore, DashboardStoreOf } from '../core/contracts/dashboard-store.ts';
import { teamPayrollBreakdown } from './team-payroll-revenues.ts';
import { paramsFor } from '../modules/hr/api/payroll-data.ts';
import { monthRange, monthlyStoreBonus, storeBonusTiers } from '../modules/hr/domain/payroll.ts';
import { salesOrders } from '../modules/sales/schema.ts';
import { posRegisters, posShifts } from '../modules/sales/pos-schema.ts';
import { employees } from '../modules/staff/schema.ts';
import { storeManagers } from '../modules/store/schema.ts';

/**
 * Doanh số chung từng cửa hàng cho Tổng quan: tổng lấy đúng nguồn bảng lương (CRM của nhóm lương + POS của quầy), mốc và
 * tỷ lệ thưởng theo tham số lương của tháng. Chi tiết từng người: DS CRM của người đó + DS POS các ca người đó mở.
 * Không trả lương, chỉ tỷ lệ thưởng và thưởng DS cửa hàng tạm tính (như nhau cho mọi người cùng cửa hàng).
 */
export const dashboardStoreOf: DashboardStoreOf = async (db, month) => {
  const team = await teamPayrollBreakdown(db, month);
  if (!team) return null;
  const { facts } = team, from = monthRange(month).from;
  const next = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 1)).toISOString().slice(0, 10);
  const registerIds = [facts.bn.registerId, facts.lock.registerId];
  const [{ params }, registers, pos, managers] = await Promise.all([
    paramsFor(db, month),
    db.select({ id: posRegisters.id, name: posRegisters.name }).from(posRegisters).where(inArray(posRegisters.id, registerIds)),
    // Cùng điều kiện đơn POS với DS cửa hàng của bảng lương, chia theo người mở ca.
    db.select({ registerId: posShifts.registerId, memberId: posShifts.memberId, revenue: sql<number>`coalesce(sum(${salesOrders.subtotal}),0)`.mapWith(Number) })
      .from(salesOrders).innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
      .where(and(eq(salesOrders.channel, 'pos'), inArray(salesOrders.status, ['confirmed', 'delivering', 'delivered']), gte(salesOrders.orderDate, from), lt(salesOrders.orderDate, next), inArray(posShifts.registerId, registerIds)))
      .groupBy(posShifts.registerId, posShifts.memberId),
    db.select({ registerId: storeManagers.registerId, memberId: storeManagers.memberId }).from(storeManagers).where(inArray(storeManagers.registerId, registerIds)),
  ]);
  const ids = [...new Set([...team.members.map(m => m.id), ...pos.map(p => p.memberId), ...managers.map(m => m.memberId)])];
  const people = ids.length ? await db.select({ id: employees.id, name: employees.name, active: employees.active, deletedAt: employees.deletedAt }).from(employees).where(inArray(employees.id, ids)) : [];
  const person = new Map(people.map(p => [p.id, p]));
  const stores: DashboardStore[] = [];
  for (const key of ['bn', 'lock'] as const) {
    const t = facts[key], reg = registers.find(r => r.id === t.registerId);
    if (!reg) continue;
    const manager = managers.find(m => m.registerId === t.registerId)?.memberId;
    const rows = new Map<string, { crm: number; pos: number }>();
    for (const m of team.members) if (m.group === key) rows.set(m.id, { crm: m.crm, pos: 0 });
    for (const p of pos) if (p.registerId === t.registerId) { const r = rows.get(p.memberId) ?? { crm: 0, pos: 0 }; r.pos += p.revenue; rows.set(p.memberId, r); }
    if (manager && !rows.has(manager)) rows.set(manager, { crm: 0, pos: 0 });
    const members = [...rows].flatMap(([id, r]) => {
      const e = person.get(id);
      // Tài khoản đã xoá chỉ hiện khi có doanh số trong tháng.
      if (!e || (e.deletedAt && !r.crm && !r.pos)) return [];
      return [{ id, name: e.name, active: e.active && !e.deletedAt, storeManager: id === manager, crm: r.crm, pos: r.pos, total: r.crm + r.pos }];
    }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'vi'));
    const { tiers, split } = storeBonusTiers(params, key, facts.bonusMode, facts.target);
    const rate = [...tiers].reverse().find(x => t.revenue >= x.at)?.rate ?? 0;
    stores.push({ key, registerId: t.registerId, name: reg.name, target: facts.target, revenue: t.revenue, crm: t.crm, pos: t.pos, issues: t.issues,
      bonusMode: facts.bonusMode, split, tiers, rate, bonusPerPerson: Math.round(monthlyStoreBonus(params, key, t.revenue, facts.bonusMode)), members });
  }
  return { month, policyMonth: facts.policyMonth, stores };
};
