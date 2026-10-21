import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, positionPermissions } from '../../staff/schema.ts';
import { notifyMany } from '../../notifications/api/routes.ts';
import { cashAccess } from './cash-store.ts';
import { posStoreScopeFor } from './pos-access.ts';
import { cashEntryName } from '../domain/cash.ts';

export async function notifyCashApproval(env: StaffEnv, entry: {
  id: string; entryNo: string; drawerId: string; kind: string; reason: string; amount: number; createdBy: string;
}) {
  const people = await env.db.select().from(employees).where(and(eq(employees.active, true), isNull(employees.deletedAt),
    or(eq(employees.role, 'manager'), and(eq(employees.role, 'employee'), eq(employees.canApprove, true)))));
  const ids = [...new Set(people.map(p => p.positionId).filter((id): id is string => !!id))];
  const grants = ids.length ? await env.db.select().from(positionPermissions).where(inArray(positionPermissions.positionId, ids)) : [];
  const targets: string[] = [];
  for (const p of people) {
    if (p.id === entry.createdBy) continue;
    try { cashAccess({ ...p, positionName: null, perms: grants.filter(g => g.positionId === p.positionId).map(g => g.permission) }); } catch { continue; }
    const scope = await posStoreScopeFor(env.db, p);
    if (scope && !scope.scope.drawers.includes(entry.drawerId)) continue;
    targets.push(p.id);
  }
  return notifyMany(env, targets, {
    eventType: 'cash_entry_pending', title: 'Phiếu thu/chi chờ duyệt',
    body: `${entry.entryNo} · ${cashEntryName(entry)} · ${entry.amount.toLocaleString('vi-VN')} đ`,
    url: `/index.html#/cash?drawerId=${encodeURIComponent(entry.drawerId)}&entryId=${encodeURIComponent(entry.id)}`,
    actorId: entry.createdBy, data: { cashEntryId: entry.id, drawerId: entry.drawerId },
  });
}
