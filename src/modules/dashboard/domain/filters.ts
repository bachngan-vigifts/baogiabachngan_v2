import { AppError } from '../../../core/errors.ts';
import type { PolicyMember } from '../../staff/domain/area-policy.ts';
import { canAccessArea } from '../../staff/domain/area-policy.ts';
import { can, type PermissionMember } from '../../staff/domain/permissions.ts';

export function dashboardFilters(query: URLSearchParams, member: PolicyMember & { id: string }, today: string) {
  if (!canAccessArea(member, 'business')) throw new AppError(403, 'Bạn không có quyền xem doanh số.');
  // Manager và người có quyền "Doanh số toàn công ty" (mặc định Kế toán) xem cả công ty, lọc theo nhóm / nhân viên.
  const manager = member.role === 'manager' || can(member as PermissionMember, 'dashboard.all');
  const from = query.get('from') ?? today.slice(0, 7), to = query.get('to') ?? from;
  const month = (x: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(x) && Number(x.slice(0, 4)) >= 2000 && Number(x.slice(0, 4)) <= 2100;
  const index = (x: string) => Number(x.slice(0, 4)) * 12 + Number(x.slice(5));
  if (!month(from) || !month(to) || index(to) < index(from) || index(to) - index(from) > 11) throw new AppError(400, 'Chọn kỳ hợp lệ, tối đa 12 tháng.');
  const owner = query.get('owner') || undefined, group = query.get('group') || undefined;
  if (!manager && (group || (owner && owner !== member.id))) throw new AppError(403, 'Bạn chỉ xem được khách hàng và doanh số của chính mình.');
  const integer = (key: string, fallback: number, max: number) => {
    const raw = query.get(key); if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) throw new AppError(400, 'Bộ lọc không hợp lệ.');
    return Number(raw);
  };
  const next = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5)), 1)).toISOString().slice(0, 10);
  const months: string[] = [];
  for (let n = index(from); n <= index(to); n++) months.push(`${Math.floor((n - 1) / 12)}-${String((n - 1) % 12 + 1).padStart(2, '0')}`);
  return { manager, owner: manager ? owner : member.id, group: manager ? group : undefined, from: from + '-01', next, months,
    neglectDays: integer('neglectDays', 30, 365), page: integer('page', 1, 100000), today };
}
