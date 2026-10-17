import { and, count, desc, eq, gte, isNull, lte, notInArray } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router, type RouteContext } from '../../../core/http/router.ts';
import { writeAudit } from '../../../core/audit.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { admsLogs, admsMembers, admsSyncState } from '../adms-schema.ts';
import { admsCode, admsConfig, admsRange, fetchAdmsLogs } from '../domain/adms.ts';

type Ctx = RouteContext<StaffEnv>;
const actor = (c: Ctx) => (c.state.session as SessionState).member;
// Dữ liệu chấm công cùng phạm vi riêng tư của bảng lương: mọi endpoint chỉ Manager.
export function registerAdmsRoutes(router: Router<StaffEnv>) {
  router.get('/hr/adms', async c => {
    let configured = true;
    try { admsConfig(c.env.adms); } catch { configured = false; }
    if (!configured) return json({ configured: false, companyId: null, lastSync: null });
    const companyId = c.env.adms!.companyId;
    const [lastSync] = await c.env.db.select().from(admsSyncState).where(eq(admsSyncState.companyId, companyId)).limit(1);
    return json({ configured: true, companyId, lastSync: lastSync ?? null });
  }, 'admin');

  router.post('/hr/adms/sync', async c => {
    const config = admsConfig(c.env.adms), b = await readJson(c.req, 1000), { from, to } = admsRange(b.from, b.to);
    const logs = await fetchAdmsLogs(config, from, to), at = new Date().toISOString(), me = actor(c).id;
    const inserted = await c.env.db.transaction(async tx => {
      let n = 0;
      for (let i = 0; i < logs.length; i += 200) {
        const added = await tx.insert(admsLogs).values(logs.slice(i, i + 200).map(l => ({ ...l, importedAt: at })))
          .onConflictDoNothing({ target: [admsLogs.companyId, admsLogs.logId] }).returning({ id: admsLogs.logId });
        n += added.length;
      }
      const state = { companyId: config.companyId, fromDate: from, toDate: to, syncedAt: at, syncedBy: me, fetched: logs.length };
      await tx.insert(admsSyncState).values(state).onConflictDoUpdate({ target: admsSyncState.companyId, set: state });
      return n;
    });
    await writeAudit(c.env.db, { actorId: me, module: 'hr', action: 'hr.adms.sync', entityType: 'hr_adms', entityId: String(config.companyId),
      data: { from, to, fetched: logs.length, inserted } });
    return json({ ok: true, fetched: logs.length, inserted, existing: logs.length - inserted, syncedAt: at });
  }, 'admin');

  router.get('/hr/adms/logs', async c => {
    const { companyId } = admsConfig(c.env.adms), { from, to } = admsRange(c.url.searchParams.get('from'), c.url.searchParams.get('to'));
    const page = Number(c.url.searchParams.get('page') || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new AppError(400, 'Trang không hợp lệ.');
    const rawCode = c.url.searchParams.get('empCode'), code = rawCode ? admsCode(rawCode) : '';
    const where = and(eq(admsLogs.companyId, companyId), gte(admsLogs.checkTime, from + ' 00:00:00'), lte(admsLogs.checkTime, to + ' 23:59:59'), code ? eq(admsLogs.empCode, code) : undefined);
    const [total] = await c.env.db.select({ n: count() }).from(admsLogs).where(where);
    const logs = await c.env.db.select({ logId: admsLogs.logId, empCode: admsLogs.empCode, fullName: admsLogs.fullName,
      checkTime: admsLogs.checkTime, punchState: admsLogs.punchState, deviceSerial: admsLogs.deviceSerial,
      memberId: admsMembers.memberId, memberName: employees.name }).from(admsLogs)
      .leftJoin(admsMembers, and(eq(admsMembers.companyId, admsLogs.companyId), eq(admsMembers.empCode, admsLogs.empCode)))
      .leftJoin(employees, eq(employees.id, admsMembers.memberId))
      .where(where).orderBy(desc(admsLogs.checkTime), desc(admsLogs.logId)).limit(100).offset((page - 1) * 100);
    return json({ logs, page, limit: 100, total: total!.n });
  }, 'admin');

  router.get('/hr/adms/mappings', async c => {
    const { companyId } = admsConfig(c.env.adms);
    const mappings = await c.env.db.select().from(admsMembers).where(eq(admsMembers.companyId, companyId));
    const members = await c.env.db.select({ id: employees.id, name: employees.name, active: employees.active }).from(employees)
      .where(and(isNull(employees.deletedAt), notInArray(employees.role, ['customer', 'supplier']))).orderBy(employees.name);
    return json({ mappings, members });
  }, 'admin');

  router.put('/hr/adms/mappings', async c => {
    const { companyId } = admsConfig(c.env.adms), b = await readJson(c.req, 1000), empCode = admsCode(b.empCode);
    if (typeof b.memberId !== 'string' || !b.memberId || b.memberId.length > 100) throw new AppError(400, 'Chọn nhân viên CRM.');
    const [member] = await c.env.db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, b.memberId),
      isNull(employees.deletedAt), notInArray(employees.role, ['customer', 'supplier']))).limit(1);
    if (!member) throw new AppError(404, 'Không tìm thấy nhân viên CRM.');
    const values = { companyId, empCode, memberId: member.id, updatedAt: new Date().toISOString(), updatedBy: actor(c).id };
    try { await c.env.db.insert(admsMembers).values(values).onConflictDoUpdate({ target: [admsMembers.companyId, admsMembers.empCode], set: values }); }
    catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } });
      if (code.code === '23505' || code.cause?.code === '23505') throw new AppError(409, 'Nhân viên này đã ghép mã máy khác. Bỏ ghép mã cũ trước.');
      throw e;
    }
    await writeAudit(c.env.db, { actorId: actor(c).id, module: 'hr', action: 'hr.adms.map', entityType: 'hr_adms', entityId: empCode, data: { memberId: member.id } });
    return json({ ok: true });
  }, 'admin');

  router.delete('/hr/adms/mappings/:code', async c => {
    const { companyId } = admsConfig(c.env.adms), empCode = admsCode(c.params.code);
    await c.env.db.delete(admsMembers).where(and(eq(admsMembers.companyId, companyId), eq(admsMembers.empCode, empCode)));
    await writeAudit(c.env.db, { actorId: actor(c).id, module: 'hr', action: 'hr.adms.unmap', entityType: 'hr_adms', entityId: empCode });
    return json({ ok: true });
  }, 'admin');
}
