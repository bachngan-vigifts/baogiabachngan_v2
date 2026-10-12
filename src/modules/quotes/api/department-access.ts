import { or, sql, type SQL } from 'drizzle-orm';
import { quotations } from '../schema.ts';
import { quotationScope, quotationEditScope, type Viewer } from '../domain/access.ts';
import { departmentOwner } from '../../staff/api/department.ts';
/** Keep explicit shares and add DB-checked department membership. Values remain bound. */
export function quotationPredicate(viewer: Viewer, edit = false): SQL {
  const scope = edit ? quotationEditScope(viewer) : quotationScope(viewer);
  const fragments = scope.sql.replace(/\bq\./g, 'staff_quotations.').split('?');
  const existing = sql.join(fragments.flatMap((s, i) => i < scope.bindings.length ? [sql.raw(s), sql`${scope.bindings[i]}`] : [sql.raw(s)]), sql.raw(''));
  return or(existing, departmentOwner(quotations.creatorId, viewer), departmentOwner(quotations.assigneeId, viewer))!;
}
