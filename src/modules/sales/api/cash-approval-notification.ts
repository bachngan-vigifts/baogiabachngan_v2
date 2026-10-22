import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, positionPermissions } from '../../staff/schema.ts';
import { notifyMany } from '../../notifications/api/routes.ts';
import { cashAccess } from './cash-store.ts';
import { posStoreScopeFor } from './pos-access.ts';
import { cashEntryName } from '../domain/cash.ts';
import { cashTasksChanged } from './invoice-task-hooks.ts';

/** Người duyệt thu/chi xem được két này (Manager + người được chỉ định duyệt, đúng cửa hàng), trừ người lập. */
async function cashApprovers(env: StaffEnv, drawerId: string, createdBy: string) {
  const people = await env.db.select().from(employees).where(and(eq(employees.active, true), isNull(employees.deletedAt),
    or(eq(employees.role, 'manager'), and(eq(employees.role, 'employee'), eq(employees.canApprove, true)))));
  const ids = [...new Set(people.map(p => p.positionId).filter((id): id is string => !!id))];
  const grants = ids.length ? await env.db.select().from(positionPermissions).where(inArray(positionPermissions.positionId, ids)) : [];
  const targets: string[] = [];
  for (const p of people) {
    if (p.id === createdBy) continue;
    try { cashAccess({ ...p, positionName: null, perms: grants.filter(g => g.positionId === p.positionId).map(g => g.permission) }); } catch { continue; }
    const scope = await posStoreScopeFor(env.db, p);
    if (scope && !scope.scope.drawers.includes(drawerId)) continue;
    targets.push(p.id);
  }
  return targets;
}

export async function notifyCashApproval(env: StaffEnv, entry: {
  id: string; entryNo: string; drawerId: string; kind: string; reason: string; amount: number; createdBy: string;
}) {
  await cashTasksChanged(env);
  return notifyMany(env, await cashApprovers(env, entry.drawerId, entry.createdBy), {
    eventType: 'cash_entry_pending', title: 'Phiếu thu/chi chờ duyệt',
    body: `${entry.entryNo} · ${cashEntryName(entry)} · ${entry.amount.toLocaleString('vi-VN')} đ`,
    url: `/index.html#/cash?drawerId=${encodeURIComponent(entry.drawerId)}&entryId=${encodeURIComponent(entry.id)}`,
    actorId: entry.createdBy, data: { cashEntryId: entry.id, drawerId: entry.drawerId },
  });
}

/** Yêu cầu đổi / trả / hoàn tiền POS mới: báo người duyệt của đúng cửa hàng, mở thẳng yêu cầu của bill. */
export async function notifyPosReturnApproval(env: StaffEnv, ret: {
  id: string; returnNo: string; orderId: string; drawerId: string; total: number; reason: string; createdBy: string;
}) {
  await cashTasksChanged(env);
  return notifyMany(env, await cashApprovers(env, ret.drawerId, ret.createdBy), {
    eventType: 'pos_return_pending', title: 'Yêu cầu đổi / trả hàng chờ duyệt',
    body: `${ret.returnNo} · ${ret.total.toLocaleString('vi-VN')} đ · ${ret.reason.slice(0, 120)}`,
    url: `/index.html#/cash?returnOrderId=${encodeURIComponent(ret.orderId)}`,
    actorId: ret.createdBy, data: { returnId: ret.id, orderId: ret.orderId },
  });
}

/** Báo người duyệt thu/chi của đúng két (dùng cho lệch tiền đầu/cuối ca). */
export async function notifyCashApprovers(env: StaffEnv, drawerId: string, createdBy: string, note: {
  eventType: string; title: string; body: string; url: string; data?: Record<string, unknown>;
}) {
  await cashTasksChanged(env);
  return notifyMany(env, await cashApprovers(env, drawerId, createdBy), { ...note, actorId: createdBy });
}
