import { and, asc, eq, isNull } from 'drizzle-orm';
import type { RouteContext } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { can } from '../../staff/domain/permissions.ts';
import { positions } from '../../staff/schema.ts';
import { defaultPosRegister } from '../domain/pos-register.ts';
import { posRegisters, posShifts } from '../pos-schema.ts';
import { allowedRegister, posScope } from './pos-access.ts';

const member = (c: RouteContext<StaffEnv>) => (c.state.session as SessionState).member;

/**
 * Quầy nhân viên được bán. Manager / người cấu hình POS: mọi quầy. NVBH / CHT Lock, Minh Long: quầy của cửa hàng mình.
 * Nhân viên khác: quầy đang mở ca của chính mình, hoặc quầy mặc định theo chức vụ; không có thì không bán được quầy nào.
 */
export async function allowedPosRegisters(c: RouteContext<StaffEnv>, db: Pick<StaffEnv['db'], 'select'> = c.env.db) {
  const m = member(c);
  const regs = (await db.select().from(posRegisters).where(eq(posRegisters.active, true)).orderBy(asc(posRegisters.name))).filter(r => allowedRegister(c, r.id));
  if (posScope(c)) return { regs, ids: new Set(regs.map(r => r.id)), all: false };
  if (m.role === 'manager' || can(m, 'pos.configure')) return { regs, ids: new Set(regs.map(r => r.id)), all: true };
  const [[current], [position]] = await Promise.all([
    db.select({ registerId: posShifts.registerId }).from(posShifts).where(and(eq(posShifts.memberId, m.id), isNull(posShifts.closedAt))).limit(1),
    m.positionId ? db.select({ name: positions.name }).from(positions).where(eq(positions.id, m.positionId)).limit(1) : Promise.resolve([]),
  ]);
  const id = (current && regs.some(r => r.id === current.registerId) ? current.registerId : '') || defaultPosRegister(m.positionId, position?.name, regs);
  return { regs: regs.filter(r => r.id === id), ids: new Set(id ? [id] : []), all: false };
}

/** Chặn bán / mở ca / xem tồn ở quầy không được giao (kiểm ở máy chủ, không chỉ ẩn ở giao diện). */
/** `db`: truyền giao dịch đang mở (vd. đang khoá két) để không chờ một kết nối khác. */
export async function assertSellRegister(c: RouteContext<StaffEnv>, registerId: string, db: Pick<StaffEnv['db'], 'select'> = c.env.db) {
  const scope = await allowedPosRegisters(c, db);
  if (!scope.all && !scope.ids.has(registerId)) throw new AppError(403, 'Bạn chỉ được bán tại quầy được giao. Nhờ Manager phân quầy theo chức vụ.', 'POS_REGISTER_NOT_ALLOWED');
}
