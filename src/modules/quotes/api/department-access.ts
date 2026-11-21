import { eq, or, sql, type SQL } from 'drizzle-orm';
import { quotations } from '../schema.ts';
import { quotationScope, quotationEditScope, type Viewer } from '../domain/access.ts';
import { departmentOwner } from '../../staff/api/department.ts';
import { seesAllAsSaleAdmin } from '../../staff/domain/roles.ts';
import { canApprove } from '../../staff/domain/permissions.ts';
/**
 * Keep explicit shares and add DB-checked department membership. Values remain bound.
 * XEM (không sửa): phạm vi "Toàn công ty" (Sale Admin) thấy mọi báo giá; người được duyệt thấy báo giá đang chờ duyệt.
 */
export function quotationPredicate(viewer: Viewer & { dataScope?: string | null; approver?: boolean | null }, edit = false, includeSupport=true): SQL {
  if (!edit && seesAllAsSaleAdmin(viewer)) return sql`true`;
  const scope = edit ? quotationEditScope(viewer,includeSupport) : quotationScope(viewer);
  const fragments = scope.sql.replace(/\bq\./g, 'staff_quotations.').split('?');
  const existing = sql.join(fragments.flatMap((s, i) => i < scope.bindings.length ? [sql.raw(s), sql`${scope.bindings[i]}`] : [sql.raw(s)]), sql.raw(''));
  return or(existing, departmentOwner(quotations.creatorId, viewer), departmentOwner(quotations.assigneeId, viewer),
    !edit && viewer.role !== 'manager' && canApprove(viewer) ? eq(quotations.approvalStatus, 'pending') : undefined)!;
}
