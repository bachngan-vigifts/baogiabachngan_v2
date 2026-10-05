import { AppError } from '../../../core/errors.ts';
import { Router, json, readJson, type RouteContext } from '../../../core/http/router.ts';
import { ACTIVATION_TTL_SECONDS, SELF_MESSAGES, activationLink, assertNotSelf, cleanMemberUpdate, cleanNewMember, cleanPhone, memberRole, newMemberId } from '../domain/members.ts';
import { newToken, sha256Hex } from '../domain/session.ts';
import * as repo from '../repo/member-repo.ts';
import type { SessionState, StaffEnv } from './auth-routes.ts';

type Ctx = RouteContext<StaffEnv>;
const now = (c: Ctx) => (c.env.nowSec ?? (() => Math.floor(Date.now() / 1000)))();
const actor = (c: Ctx) => (c.state.session as SessionState).member;

/** Quản lý nhân viên – khu vực 'admin' (chỉ Manager; chốt quyền đã chạy trước handler). Port từ `/admin/member*` bản cũ. */
export function registerMemberRoutes(router: Router<StaffEnv>): void {
  router.get('/admin/members', async c => json(await repo.listMembers(c.env.db)), 'admin');

  router.post('/admin/members', async c => {
    const body = await readJson(c.req, 4096);
    const input = cleanNewMember(body);
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

  router.put('/admin/member', async c => {
    const body = await readJson(c.req, 4096);
    if (await repo.isSapoLinked(c.env.db, body.id)) throw new AppError(409, 'Hồ sơ này đã hợp nhất. Vui lòng chỉnh hồ sơ web đang sử dụng.');
    assertNotSelf(actor(c).id, body.id, SELF_MESSAGES.update);
    const input = cleanMemberUpdate(body);
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
