import { AppError } from '../../../core/errors.ts';
import { Router, json, readJson, type RouteContext } from '../../../core/http/router.ts';
import { ACTIVATION_TTL_SECONDS, SELF_MESSAGES, activationLink, assertNotSelf, cleanMemberUpdate, cleanNewMember, cleanPhone, memberRole, newMemberId } from '../domain/members.ts';
import { newToken, sha256Hex } from '../domain/session.ts';
import * as repo from '../repo/member-repo.ts';
import { CUSTOMER_POSITION_ID } from '../domain/roles.ts';
import { and, eq, isNull, notInArray } from 'drizzle-orm';
import { departments, employees, permissionLog } from '../schema.ts';
import type { SessionState, StaffEnv } from './auth-routes.ts';

type Ctx = RouteContext<StaffEnv>;
const now = (c: Ctx) => (c.env.nowSec ?? (() => Math.floor(Date.now() / 1000)))();
const actor = (c: Ctx) => (c.state.session as SessionState).member;
const CUSTOMER_MSG = 'Tài khoản khách hàng được tạo và quản lý ở trang Khách hàng.';

/** Quản lý nhân viên – khu vực 'admin' (chỉ Manager; chốt quyền đã chạy trước handler). Port từ `/admin/member*` bản cũ. */
export function registerMemberRoutes(router: Router<StaffEnv>): void {
  router.get('/admin/members', async c => json(await repo.listMembers(c.env.db)), 'admin');

  // Organizational labels only: Leader / work department never grant permissions.
  router.put('/admin/members/:id/employment', async c => {
    const b=await readJson(c.req,2000),id=c.params.id!,db=c.env.db;
    if(![null,'BN','VG'].includes(b.workCompany as any)||typeof b.isLeader!=='boolean'||!(b.workDepartmentId===null||typeof b.workDepartmentId==='string'))throw new AppError(400,'Đơn vị, phòng ban hoặc Leader không hợp lệ.');
    if(b.workDepartmentId&&!(await db.select({id:departments.id}).from(departments).where(eq(departments.id,String(b.workDepartmentId))).limit(1)).length)throw new AppError(400,'Phòng ban không tồn tại.');
    const employment={workCompany:b.workCompany as 'BN'|'VG'|null,workDepartmentId:b.workDepartmentId ? String(b.workDepartmentId):null,isLeader:b.isLeader};
    await db.transaction(async tx=>{
      const [m]=await tx.update(employees).set(employment).where(and(eq(employees.id,id),isNull(employees.deletedAt),notInArray(employees.role,['customer','supplier']))).returning({name:employees.name});
      if(!m)throw new AppError(404,'Không tìm thấy nhân viên.');
      await tx.insert(permissionLog).values({id:crypto.randomUUID(),at:new Date().toISOString(),by:actor(c).id,action:'Cập nhật đơn vị / phòng ban / Leader',detail:JSON.stringify({memberId:id,...employment})});
    });
    return json({ok:true,employment});
  }, 'admin');

  router.post('/admin/members', async c => {
    const body = await readJson(c.req, 4096);
    const input = cleanNewMember(body);
    if (input.positionId === CUSTOMER_POSITION_ID) throw new AppError(400, CUSTOMER_MSG);
    if (!await repo.positionExists(c.env.db, input.positionId)) throw new AppError(400, 'Chức vụ không hợp lệ.');
    if (await repo.emailTaken(c.env.db, input.email)) throw new AppError(409, 'Email này đã có tài khoản. Vui lòng kiểm tra danh sách nhân viên.');
    const id = newMemberId(), token = newToken(), role = memberRole(input.positionId);
    try {
      await repo.createMember(c.env.db, { id, ...input, role, createdAt: new Date().toISOString(), tokenHash: sha256Hex(token), expires: now(c) + ACTIVATION_TTL_SECONDS });
    } catch (e) { if (repo.isUniqueViolation(e)) throw new AppError(409, 'Email này đã có tài khoản.'); throw e; }
    return json({ member: { id, name: input.name, email: input.email, phone: input.phone, role, positionId: input.positionId }, url: activationLink(c.url.origin, input.email, token) }, 201);
  }, 'admin');

  router.put('/admin/member-phone', async c => {
    const { id, phone } = cleanPhone(await readJson(c.req, 4096));
    if (!await repo.updatePhone(c.env.db, id, phone)) throw new AppError(404, 'Không tìm thấy nhân viên.');
    return json({ ok: true });
  }, 'admin');

  router.post('/admin/reset', async c => {
    const body = await readJson(c.req, 4096);
    assertNotSelf(actor(c).id, body.id, SELF_MESSAGES.reset);
    const target = await repo.findActiveMember(c.env.db, body.id);
    if (!target) throw new AppError(404, 'Không tìm thấy nhân viên đang hoạt động.');
    const token = newToken();
    await repo.resetCredentials(c.env.db, target.id, sha256Hex(token), now(c) + ACTIVATION_TTL_SECONDS);
    return json({ url: activationLink(c.url.origin, target.email, token) });
  }, 'admin');

  router.delete('/admin/member', async c => {
    const body = await readJson(c.req, 4096);
    assertNotSelf(actor(c).id, body.id, SELF_MESSAGES.remove);
    if (!await repo.memberExists(c.env.db, body.id)) throw new AppError(404, 'Không tìm thấy nhân viên.');
    if (!await repo.deactivateMember(c.env.db, actor(c).id, String(body.id))) throw new AppError(404, 'Không tìm thấy nhân viên.');
    return json({ ok: true });
  }, 'admin');

  /** Xoá hẳn nhân viên khỏi danh sách (khác "Khoá": khoá thì còn trong danh sách và mở lại được). */
  router.delete('/admin/members/:id', async c => {
    const id = c.params.id!;
    assertNotSelf(actor(c).id, id, SELF_MESSAGES.remove);
    if (await repo.isCustomerMember(c.env.db, id)) throw new AppError(400, CUSTOMER_MSG);
    if (!await repo.deleteMember(c.env.db, actor(c).id, id, new Date().toISOString())) throw new AppError(404, 'Không tìm thấy nhân viên.');
    return json({ ok: true });
  }, 'admin');

  /**
   * Cờ "Được duyệt" (phê duyệt báo giá, khách mới, sản phẩm mới, đơn / HĐKT, đơn mua NCC): CHỈ Manager bật / tắt –
   * khu vực 'admin' chỉ Manager vào được, câu UPDATE kiểm lại người thao tác là Manager. Ghi nhật ký phân quyền.
   */
  router.put('/admin/members/:id/approver', async c => {
    const body = await readJson(c.req, 1_000), m = actor(c);
    if (m.role !== 'manager') throw new AppError(403, 'Chỉ Manager chỉ định người được duyệt.');
    if (typeof body.approver !== 'boolean') throw new AppError(400, 'Thiếu giá trị bật / tắt.');
    const name = await repo.setApprover(c.env.db, m.id, c.params.id!, body.approver);
    if (!name) throw new AppError(404, 'Không tìm thấy nhân viên (Manager luôn được duyệt; NCC / khách hàng không áp dụng).');
    await c.env.db.insert(permissionLog).values({ id: crypto.randomUUID(), at: new Date().toISOString(), by: m.id,
      action: body.approver ? 'Cấp quyền duyệt' : 'Thu quyền duyệt', detail: name });
    return json({ ok: true, approver: body.approver });
  }, 'admin');

  router.put('/admin/member', async c => {
    const body = await readJson(c.req, 4096);
    if (await repo.isSapoLinked(c.env.db, body.id)) throw new AppError(409, 'Hồ sơ này đã hợp nhất. Vui lòng chỉnh hồ sơ web đang sử dụng.');
    assertNotSelf(actor(c).id, body.id, SELF_MESSAGES.update);
    const input = cleanMemberUpdate(body);
    if (input.positionId === CUSTOMER_POSITION_ID || await repo.isCustomerMember(c.env.db, input.id)) throw new AppError(400, CUSTOMER_MSG);
    if (!await repo.positionExists(c.env.db, input.positionId)) throw new AppError(400, 'Chức vụ không hợp lệ.');
    if (await repo.emailTaken(c.env.db, input.email, input.id)) throw new AppError(409, 'Email này đã có tài khoản.');
    const role = memberRole(input.positionId);
    let changed: number;
    try { changed = await repo.updateMember(c.env.db, actor(c).id, { ...input, role }); }
    catch (e) { if (repo.isUniqueViolation(e)) throw new AppError(409, 'Email này đã có tài khoản.'); throw e; }
    if (!changed) throw new AppError(404, 'Không tìm thấy nhân viên.');
    return json({ ok: true, member: { id: input.id, name: input.name, email: input.email, phone: input.phone, role, positionId: input.positionId, active: input.active } });
  }, 'admin');
}
