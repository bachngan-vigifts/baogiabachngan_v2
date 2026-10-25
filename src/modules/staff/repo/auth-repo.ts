import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { authAttempts, credentials, employees, positionPermissions, positions, sessions } from '../schema.ts';
import { RATE_WINDOW_SECONDS, sha256Hex, type MemberRow } from '../domain/session.ts';

/**
 * Truy vấn xác thực. Mỗi hàm là một thao tác nhỏ; những chuỗi cần nguyên tử dùng transaction PostgreSQL.
 * `now` là giây Unix, truyền vào để test điều khiển được thời gian.
 */
const memberColumns = {
  id: employees.id, name: employees.name, phone: employees.phone, email: employees.email, role: employees.role,
  positionId: employees.positionId, positionName: positions.name, active: employees.active, avatarKey: employees.avatarKey, approver: employees.canApprove,
};

/** Xoá bộ đếm thử của một khoá (vd đăng nhập đúng thì xoá bộ đếm của tài khoản). */
export async function clearAttempts(db: AnyDb, key: string): Promise<void> {
  await db.delete(authAttempts).where(eq(authAttempts.key, sha256Hex(key)));
}

/**
 * Đếm một lần thử và trả về tổng số lần trong cửa sổ hiện tại. MỘT câu lệnh duy nhất (upsert có RETURNING)
 * nên hai yêu cầu đồng thời không đếm sót. Khoá được băm SHA-256 trước khi lưu (không lưu email/IP thô).
 */
export async function countAttempt(db: AnyDb, key: string, now: number): Promise<number> {
  const rows = await db.insert(authAttempts).values({ key: sha256Hex(key), count: 1, expires: now + RATE_WINDOW_SECONDS })
    .onConflictDoUpdate({
      target: authAttempts.key,
      set: {
        count: sql`CASE WHEN ${authAttempts.expires} <= ${now} THEN 1 ELSE ${authAttempts.count} + 1 END`,
        expires: sql`CASE WHEN ${authAttempts.expires} <= ${now} THEN excluded.expires ELSE ${authAttempts.expires} END`,
      },
    }).returning({ count: authAttempts.count });
  return rows[0]!.count;
}

/** Phiên hợp lệ: chưa hết hạn, tài khoản còn hoạt động, và phiên cùng "phiên bản" với thông tin đăng nhập (đổi mật khẩu = huỷ mọi phiên cũ). */
export async function findSessionMember(db: AnyDb, tokenHash: string, now: number): Promise<(MemberRow & { active: boolean; sessionExpires: number }) | null> {
  // Quyền của chức vụ đi kèm phiên (một truy vấn): mọi kiểm tra quyền trong yêu cầu dùng chung (domain/permissions.ts).
  const perms = sql<string[]>`coalesce((select array_agg(${positionPermissions.permission}) from ${positionPermissions} where ${positionPermissions.positionId} = ${employees.positionId}), '{}')`;
  const rows = await db.select({ ...memberColumns, sessionExpires: sessions.expires, perms, dataScope: positions.dataScope, departmentId: positions.departmentId }).from(sessions)
    .innerJoin(employees, eq(employees.id, sessions.memberId))
    .innerJoin(credentials, eq(credentials.memberId, employees.id))
    .leftJoin(positions, eq(positions.id, employees.positionId))
    .where(and(eq(sessions.hash, tokenHash), gt(sessions.expires, now), eq(employees.active, true), eq(sessions.version, credentials.version)))
    .limit(1);
  return rows[0] ?? null;
}

/** Chuẩn hoá số điện thoại ngay trong SQL (cùng quy tắc `normalizePhone`) để so khớp số đã lưu ở mọi dạng. */
export const phoneKeySql = (col: unknown) => sql`regexp_replace(regexp_replace(${col}, '[^0-9]', '', 'g'), '^84([0-9]{9,10})$', '0\\1')`;

/**
 * Đăng nhập bằng số điện thoại: chỉ tài khoản khách hàng, và số phải thuộc đúng MỘT tài khoản
 * (trùng số thì không cho đăng nhập bằng số, phải dùng email).
 */
export async function findLoginRowByPhone(db: AnyDb, phone: string) {
  const rows = await db.select({ ...memberColumns, passwordHash: credentials.passwordHash, version: credentials.version })
    .from(employees).innerJoin(credentials, eq(credentials.memberId, employees.id)).leftJoin(positions, eq(positions.id, employees.positionId))
    .where(and(eq(employees.role, 'customer'), sql`${phoneKeySql(employees.phone)} = ${phone}`)).limit(2);
  return rows.length === 1 ? rows[0]! : null;
}

export async function findLoginRow(db: AnyDb, email: string) {
  const rows = await db.select({ ...memberColumns, passwordHash: credentials.passwordHash, version: credentials.version })
    .from(employees).innerJoin(credentials, eq(credentials.memberId, employees.id)).leftJoin(positions, eq(positions.id, employees.positionId))
    .where(eq(employees.email, email)).limit(1);
  return rows[0] ?? null;
}

/** Tạo phiên mới và dọn phiên/lần thử đã hết hạn trong cùng một lô. */
/** Gia hạn phiên đang dùng (phiên "trượt"): đặt lại hạn = bây giờ + thời hạn phiên. */
export async function extendSession(db: AnyDb, tokenHash: string, expires: number) {
  await db.update(sessions).set({ expires }).where(eq(sessions.hash, tokenHash));
}

export async function createSession(db: AnyDb, p: { tokenHash: string; memberId: string; version: number; now: number; lifetime: number }) {
  await db.transaction(async tx => {
    await tx.insert(sessions).values({ hash: p.tokenHash, memberId: p.memberId, version: p.version, expires: p.now + p.lifetime });
    await tx.delete(sessions).where(lte(sessions.expires, p.now));
    await tx.delete(authAttempts).where(lte(authAttempts.expires, p.now));
  });
}

export const deleteSession = (db: AnyDb, tokenHash: string) => db.delete(sessions).where(eq(sessions.hash, tokenHash)).execute();

export async function findActivation(db: AnyDb, tokenHash: string, now: number) {
  const rows = await db.select({ memberId: credentials.memberId, email: employees.email, expires: credentials.activationExpires })
    .from(credentials).innerJoin(employees, eq(employees.id, credentials.memberId))
    .where(and(eq(employees.active, true), eq(credentials.activationHash, tokenHash), gt(credentials.activationExpires, now))).limit(1);
  return rows[0] ?? null;
}

/**
 * Đặt mật khẩu bằng liên kết kích hoạt. Câu UPDATE chỉ thành công nếu liên kết CÒN NGUYÊN (chưa dùng, chưa hết hạn),
 * nên hai người bấm cùng lúc thì chỉ một người thắng. Trả về false nếu liên kết đã bị dùng.
 */
export async function completeActivation(db: AnyDb, p: { memberId: string; email: string; tokenHash: string; passwordHash: string; now: number }): Promise<boolean> {
  return db.transaction(async tx => {
    const rows = await tx.update(credentials)
      .set({ passwordHash: p.passwordHash, activationHash: null, activationExpires: null, version: sql`${credentials.version} + 1` })
      .where(and(eq(credentials.memberId, p.memberId), eq(credentials.activationHash, p.tokenHash), gt(credentials.activationExpires, p.now)))
      .returning({ memberId: credentials.memberId });
    if (!rows.length) return false;
    await tx.delete(sessions).where(eq(sessions.memberId, p.memberId));
    await tx.delete(authAttempts).where(eq(authAttempts.key, sha256Hex('email:' + p.email)));
    return true;
  });
}

export async function getPasswordHash(db: AnyDb, memberId: string): Promise<string | null> {
  const rows = await db.select({ h: credentials.passwordHash }).from(credentials).where(eq(credentials.memberId, memberId)).limit(1);
  return rows[0]?.h ?? null;
}

/** Đổi mật khẩu: tăng phiên bản và xoá MỌI phiên của người đó (kể cả phiên hiện tại – phải đăng nhập lại). */
export async function changePassword(db: AnyDb, memberId: string, passwordHash: string) {
  await db.transaction(async tx => {
    await tx.update(credentials).set({ passwordHash, activationHash:null, activationExpires:null, version: sql`${credentials.version} + 1` }).where(eq(credentials.memberId, memberId));
    await tx.delete(sessions).where(eq(sessions.memberId, memberId));
  });
}

/** Keep the current password/sessions valid while sending a one-use recovery link.
 * A mail failure rolls back the token update; serialized credential locks prevent concurrent sends replacing each other mid-send.
 */
export async function issuePortalPasswordReset(db: AnyDb, p: { email: string; audience?: 'supplier' | 'customer'; tokenHash: string; expires: number }, deliver: (member: {email:string;role:'supplier'|'customer'})=>Promise<void>) {
  return db.transaction(async tx => {
    const [member] = await tx.select({id:employees.id,email:employees.email,role:employees.role,active:employees.active})
      .from(employees).innerJoin(credentials,eq(credentials.memberId,employees.id))
      .where(eq(employees.email,p.email)).for('update');
    if (!member?.active || !['supplier','customer'].includes(member.role) || member.email.endsWith('.invalid') || (p.audience && member.role !== p.audience)) return;
    await tx.update(credentials).set({activationHash:p.tokenHash,activationExpires:p.expires}).where(eq(credentials.memberId,member.id));
    await deliver({email:member.email,role:member.role as 'supplier'|'customer'});
  });
}
