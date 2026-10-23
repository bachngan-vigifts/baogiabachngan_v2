import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { clientIp, limit, type StaffEnv } from '../../staff/api/auth-routes.ts';
import { RATE_LIMITS } from '../../staff/domain/session.ts';
import { AppError } from '../../../core/errors.ts';
import { hashPassword } from '../../../core/auth/password.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import { credentials, employees, sessions } from '../../staff/schema.ts';
import { newToken, sha256Hex } from '../../staff/domain/session.ts';
import { normalizePhone } from '../../staff/domain/login-id.ts';
import { phoneKeySql } from '../../staff/repo/auth-repo.ts';
import { customers } from '../../customers/schema.ts';
import { customerAccounts } from '../schema.ts';
import { INVITE_DOMAIN, INVITE_TTL_SECONDS, isRegistrationInvite, type PartnerKind } from '../domain/registration.ts';
import { PHONE_ONLY_DOMAIN } from '../domain/portal.ts';

/**
 * Tài khoản NCC nằm ở module suppliers (suppliers đã phụ thuộc portal) → portal không import ngược, đọc / ghi qua hook
 * nối ở src/app/router.ts (cài đặt: suppliers/api/registration-hooks.ts).
 */
type Tx = Parameters<Parameters<AnyDb['transaction']>[0]>[0];
export const supplierRegistrationHooks: {
  boundSupplier?: (db: AnyDb | Tx, memberId: string) => Promise<string | undefined>;
  bindSupplier?: (db: AnyDb | Tx, p: { memberId: string; supplierId: string; actorId: string; at: string }) => Promise<void>;
  supplierOf?: (db: AnyDb | Tx, memberId: string, supplierId: string) => Promise<{ name: string; active: boolean } | undefined>;
} = {};
const supplierHooks = () => {
  const h = supplierRegistrationHooks;
  if (!h.boundSupplier || !h.bindSupplier || !h.supplierOf) throw new AppError(503, 'Chưa nối đăng ký tài khoản NCC.');
  return h as Required<typeof h>;
};
const invalid = () => new AppError(400, 'Link đăng ký đã hết hạn, đã dùng hoặc bị thu hồi. Vui lòng nhờ nhân viên cấp lại.');
const text = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const makeToken = (kind: PartnerKind, entityId: string) => `${newToken()}.${kind}.${encodeURIComponent(entityId)}`;
const link = (origin: string, token: string) => `${origin}/register.html#invite=${encodeURIComponent(token)}`;

/** The binding is part of the hashed secret. Editing a URL or moving its account cannot retarget an invite. */
export function registrationHash(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 800 || !/^[a-f0-9]{64}\.(customer|supplier)\..+$/.test(raw)) throw invalid();
  return sha256Hex(raw);
}

export async function issuePartnerInvite(db: AnyDb, p: { kind: PartnerKind; entityId: string; entityName: string; actorId: string; origin: string; now: number; discounts?: object; memberId?: string }) {
  const token = makeToken(p.kind, p.entityId), at = new Date().toISOString();
  const memberId = p.memberId || `INV-${crypto.randomUUID()}`;
  await db.transaction(async tx => {
    if (p.memberId) {
      const [m] = await tx.select().from(employees).where(eq(employees.id, memberId)).for('update');
      if (!m || !m.active || !isRegistrationInvite(m.email) || m.role !== p.kind || m.positionId !== p.kind || m.deletedAt) throw invalid();
      const [binding] = p.kind === 'customer'
        ? await tx.select({ id: customerAccounts.customerId }).from(customerAccounts).where(eq(customerAccounts.memberId, memberId))
        : [{ id: await supplierHooks().boundSupplier(tx, memberId) }];
      if (binding?.id !== p.entityId) throw invalid();
      const rows = await tx.update(credentials).set({ activationHash: sha256Hex(token), activationExpires: p.now + INVITE_TTL_SECONDS })
        .where(and(eq(credentials.memberId, memberId), isNull(credentials.passwordHash))).returning({ id: credentials.memberId });
      if (!rows.length) throw invalid();
    } else {
      await tx.insert(employees).values({ id: memberId, email: `invite-${crypto.randomUUID()}${INVITE_DOMAIN}`, name: `Chờ đăng ký · ${p.entityName}`, phone: '', role: p.kind, positionId: p.kind, active: true, createdAt: at });
      await tx.insert(credentials).values({ memberId, activationHash: sha256Hex(token), activationExpires: p.now + INVITE_TTL_SECONDS, version: 0 });
      if (p.kind === 'customer') await tx.insert(customerAccounts).values({ memberId, customerId: p.entityId, ownerId: p.actorId, createdBy: p.actorId, discounts: JSON.stringify(p.discounts || {}), createdAt: at, updatedAt: at });
      else await supplierHooks().bindSupplier(tx, { memberId, supplierId: p.entityId, actorId: p.actorId, at });
    }
  });
  return { memberId, url: link(p.origin, token), expiresAt: (p.now + INVITE_TTL_SECONDS) * 1000 };
}

export async function registrationInfo(db: AnyDb, raw: unknown, now: number) {
  const hash = registrationHash(raw), token = raw as string;
  const [, kind, ...encodedId] = token.split('.');
  let entityId: string;
  try { entityId = decodeURIComponent(encodedId.join('.')); } catch { throw invalid(); }
  const [m] = await db.select({ id: employees.id, email: employees.email, role: employees.role, positionId: employees.positionId, deletedAt: employees.deletedAt, active: employees.active, expires: credentials.activationExpires })
    .from(credentials).innerJoin(employees, eq(employees.id, credentials.memberId))
    .where(and(eq(credentials.activationHash, hash), gt(credentials.activationExpires, now), isNull(credentials.passwordHash))).limit(1);
  if (!m || !m.active || !isRegistrationInvite(m.email) || m.role !== kind || m.positionId !== kind || m.deletedAt) throw invalid();
  if (kind === 'customer') {
    const [r] = await db.select({ id: customers.id, name: customers.name, approval: customers.approvalStatus }).from(customerAccounts)
      .innerJoin(customers, eq(customers.id, customerAccounts.customerId)).where(and(eq(customerAccounts.memberId, m.id), eq(customerAccounts.customerId, entityId))).limit(1);
    if (!r || r.approval === 'pending') throw invalid();
    return { memberId: m.id, kind: 'customer' as const, entityName: r.name, expiresAt: m.expires! * 1000 };
  }
  const r = await supplierHooks().supplierOf(db, m.id, entityId);
  if (!r?.active) throw invalid();
  return { memberId: m.id, kind: 'supplier' as const, entityName: r.name, expiresAt: m.expires! * 1000 };
}

export async function completeRegistration(db: AnyDb, body: Record<string, unknown>, now: number, iterations?: number) {
  const initial = await registrationInfo(db, body.token, now);
  const name = text(body.name, 200), phoneRaw = text(body.phone, 40), phone = normalizePhone(phoneRaw);
  let email = text(body.email, 254).toLowerCase();
  if (!name) throw new AppError(400, 'Nhập họ tên người đăng ký.');
  if (phoneRaw && !phone) throw new AppError(400, 'Số điện thoại không hợp lệ.');
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('.invalid'))) throw new AppError(400, 'Email không hợp lệ.');
  if (!email && (initial.kind === 'supplier' || !phone)) throw new AppError(400, initial.kind === 'supplier' ? 'Nhập email để NCC đăng nhập.' : 'Nhập email hoặc số di động để đăng nhập.');
  if (!email) email = `kh-${crypto.randomUUID()}${PHONE_ONLY_DOMAIN}`;
  const passwordHash = await hashPassword(body.password, iterations);
  await db.transaction(async tx => {
    // Serialise registrations; check identity duplicates after taking this lock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('partner-registration-identities'))`);
    const [locked] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, initial.memberId)).for('update');
    if (!locked) throw invalid();
    await registrationInfo(tx as unknown as AnyDb, body.token, now);
    const [duplicate] = await tx.select({ id: employees.id }).from(employees)
      .where(and(ne(employees.id, initial.memberId), sql`lower(${employees.email})=${email}`)).limit(1);
    if (duplicate) throw new AppError(409, 'Email này đã có tài khoản. Vui lòng đăng nhập tài khoản hiện có hoặc liên hệ nhân viên phụ trách.');
    if (phone && initial.kind === 'customer') {
      const [dupPhone] = await tx.select({ id: employees.id }).from(employees).where(and(ne(employees.id, initial.memberId), eq(employees.role, 'customer'), sql`${phoneKeySql(employees.phone)}=${phone}`)).limit(1);
      if (dupPhone) throw new AppError(409, 'Số điện thoại này đã dùng cho một tài khoản khách khác.');
    }
    const done = await tx.update(credentials).set({ passwordHash, activationHash: null, activationExpires: null, version: sql`${credentials.version}+1` })
      .where(and(eq(credentials.memberId, initial.memberId), eq(credentials.activationHash, registrationHash(body.token)), gt(credentials.activationExpires, now), isNull(credentials.passwordHash)))
      .returning({ id: credentials.memberId });
    if (!done.length) throw invalid();
    // Role, position, entity binding, owner and discounts are never read from the public form.
    await tx.update(employees).set({ name, email, phone }).where(eq(employees.id, initial.memberId));
    await tx.delete(sessions).where(eq(sessions.memberId, initial.memberId));
  });
  return { ok: true, login: email.endsWith(PHONE_ONLY_DOMAIN) ? phone : email, portal: initial.kind === 'customer' ? '/customer.html' : '/supplier.html' };
}

/** Đăng ký qua link mời (công khai – kiểm mã mời băm + hạn dùng, giới hạn số lần thử như kích hoạt tài khoản). */
export function registerPartnerRegistrationRoutes(router: Router<StaffEnv>) {
  const nowSec = (c: RouteContext<StaffEnv>) => (c.env.nowSec ?? (() => Math.floor(Date.now() / 1000)))();
  router.post('/registration-info', async c => {
    const body = await readJson(c.req, 4096);
    await limit(c, 'ip:' + clientIp(c.req.headers), RATE_LIMITS.ip);
    registrationHash(body.token);
    const info = await registrationInfo(c.env.db, body.token, nowSec(c));
    return json({ kind: info.kind, entityName: info.entityName, expiresAt: info.expiresAt });
  }, 'public');

  router.post('/register-partner', async c => {
    const body = await readJson(c.req, 4096);
    await limit(c, 'ip:' + clientIp(c.req.headers), RATE_LIMITS.ip);
    const hash = registrationHash(body.token);
    await limit(c, 'registration:' + hash, RATE_LIMITS.activation);
    return json(await completeRegistration(c.env.db, body, nowSec(c), c.env.passwordIterations));
  }, 'public');
}
