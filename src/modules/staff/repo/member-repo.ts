import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { credentials, employees, positions, sessions, staffSapoLinks } from '../schema.ts';
import type { Role } from '../domain/roles.ts';

/** Truy vấn quản lý nhân viên. Mọi câu UPDATE kèm điều kiện "người thao tác là Manager đang hoạt động" (phòng thủ nhiều lớp, như bản cũ). */
const actorIsManager = (actorId: string) =>
  sql`EXISTS (SELECT 1 FROM staff_members actor WHERE actor.id = ${actorId} AND actor.active = true AND actor.role = 'manager')`;

export async function listMembers(db: AnyDb) {
  const members = await db.select({
    id: employees.id, name: employees.name, email: employees.email, phone: employees.phone, role: employees.role,
    positionId: employees.positionId, active: employees.active,
    activated: sql<number>`CASE WHEN ${credentials.passwordHash} IS NULL THEN 0 ELSE 1 END`,
  }).from(employees).leftJoin(credentials, eq(credentials.memberId, employees.id)).where(ne(employees.role, 'customer')).orderBy(asc(employees.id));
  // Tài khoản khách hàng quản lý ở trang Khách hàng, không nằm trong danh sách nhân viên / chức vụ chọn được.
  const list = await db.select({ id: positions.id, name: positions.name }).from(positions).where(ne(positions.id, 'customer')).orderBy(asc(positions.name));
  return { members: members.map(m => ({ ...m, active: m.active ? 1 : 0 })), positions: list };
}

export const positionExists = async (db: AnyDb, id: string) => (await db.select({ id: positions.id }).from(positions).where(eq(positions.id, id)).limit(1)).length > 0;
/** Tài khoản khách hàng (không sửa/xoá ở trang Nhân viên). */
export const isCustomerMember = async (db: AnyDb, id: unknown) => typeof id === 'string' && (await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), eq(employees.role, 'customer'))).limit(1)).length > 0;

/** Email đã có người dùng chưa (không phân biệt hoa/thường như bản cũ), loại trừ một nhân viên khi sửa. */
export async function emailTaken(db: AnyDb, email: string, excludeId?: string) {
  const same = sql`lower(${employees.email}) = lower(${email})`;
  const rows = await db.select({ id: employees.id }).from(employees).where(excludeId === undefined ? same : and(same, ne(employees.id, excludeId))).limit(1);
  return rows.length > 0;
}

export const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
};

export async function createMember(db: AnyDb, p: { id: string; email: string; name: string; phone: string; role: Role; positionId: string; createdAt: string; tokenHash: string; expires: number }) {
  await db.transaction(async tx => {
    await tx.insert(employees).values({ id: p.id, email: p.email, name: p.name, role: p.role, positionId: p.positionId, active: true, createdAt: p.createdAt, phone: p.phone });
    await tx.insert(credentials).values({ memberId: p.id, activationHash: p.tokenHash, activationExpires: p.expires, version: 0 });
  });
}

export const findActiveMember = async (db: AnyDb, id: unknown) =>
  (await db.select({ id: employees.id, email: employees.email }).from(employees).where(and(eq(employees.id, String(id ?? '')), eq(employees.active, true))).limit(1))[0] ?? null;
export const memberExists = async (db: AnyDb, id: unknown) =>
  (await db.select({ id: employees.id }).from(employees).where(eq(employees.id, String(id ?? ''))).limit(1)).length > 0;
export const isSapoLinked = async (db: AnyDb, sapoId: unknown) =>
  (await db.select({ m: staffSapoLinks.memberId }).from(staffSapoLinks).where(eq(staffSapoLinks.sapoId, String(sapoId ?? ''))).limit(1)).length > 0;

/** Sửa hồ sơ + chức vụ + khoá/mở, đồng thời huỷ mọi phiên của người đó (quyền đổi thì phải đăng nhập lại). Trả về số dòng đã sửa. */
export async function updateMember(db: AnyDb, actorId: string, p: { id: string; name: string; email: string; phone: string; role: Role; positionId: string; active: boolean }): Promise<number> {
  return db.transaction(async tx => {
    const rows = await tx.update(employees).set({ name: p.name, email: p.email, phone: p.phone, role: p.role, positionId: p.positionId, active: p.active })
      .where(and(eq(employees.id, p.id), actorIsManager(actorId))).returning({ id: employees.id });
    if (rows.length) await tx.delete(sessions).where(eq(sessions.memberId, p.id));
    return rows.length;
  });
}

/** "Xoá" nhân viên = khoá tài khoản (không xoá dữ liệu vì báo giá, đơn... còn tham chiếu) + huỷ mọi phiên. */
export async function deactivateMember(db: AnyDb, actorId: string, id: string): Promise<number> {
  return db.transaction(async tx => {
    const rows = await tx.update(employees).set({ active: false })
      .where(and(eq(employees.id, id), ne(employees.id, actorId), actorIsManager(actorId))).returning({ id: employees.id });
    if (rows.length) await tx.delete(sessions).where(eq(sessions.memberId, id));
    return rows.length;
  });
}

/** Cấp lại liên kết kích hoạt: xoá mật khẩu, tăng phiên bản (huỷ phiên cũ ngay cả khi chưa bị xoá) và xoá mọi phiên. */
export async function resetCredentials(db: AnyDb, memberId: string, tokenHash: string, expires: number) {
  await db.transaction(async tx => {
    await tx.update(credentials).set({ activationHash: tokenHash, activationExpires: expires, passwordHash: null, version: sql`${credentials.version} + 1` }).where(eq(credentials.memberId, memberId));
    await tx.delete(sessions).where(eq(sessions.memberId, memberId));
  });
}

export async function updatePhone(db: AnyDb, id: string, phone: string): Promise<number> {
  return (await db.update(employees).set({ phone }).where(eq(employees.id, id)).returning({ id: employees.id })).length;
}
