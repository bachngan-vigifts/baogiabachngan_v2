import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { Router, json, readJson, type RouteContext } from '../../../core/http/router.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import { AVATAR_KEY, AVATAR_MAX_CHARS, cleanAvatar, newAvatarKey } from '../domain/avatar.ts';
import { employees, staffAvatars } from '../schema.ts';
import type { SessionState, StaffEnv } from './auth-routes.ts';

type Ctx = RouteContext<StaffEnv>;
const actor = (c: Ctx) => (c.state.session as SessionState).member;

async function setAvatar(db: AnyDb, memberId: string, dataUrl: string | null) {
  const key = dataUrl ? newAvatarKey() : null, now = new Date().toISOString();
  await db.transaction(async tx => {
    await tx.delete(staffAvatars).where(eq(staffAvatars.memberId, memberId));
    if (dataUrl) await tx.insert(staffAvatars).values({ memberId, key: key!, dataUrl, updatedAt: now });
    await tx.update(employees).set({ avatarKey: key }).where(eq(employees.id, memberId));
  });
  return key;
}
const bodyAvatar = async (c: Ctx) => cleanAvatar((await readJson(c.req, AVATAR_MAX_CHARS + 1000)).image);

/**
 * Ảnh đại diện nhân viên (hiện ở chat, danh sách nhân viên, góc tài khoản).
 *  - Mỗi người tự đổi ảnh của mình; Manager đổi được ảnh của nhân viên ở trang chi tiết nhân viên.
 *  - Mỗi lần đổi ảnh có mã mới (`avatar`) nên trình duyệt lưu đệm ảnh theo mã, không phải tải lại.
 */
export function registerAvatarRoutes(router: Router<StaffEnv>): void {
  /** Lấy nhiều ảnh một lượt theo mã: { avatars: { [key]: dataUrl } }. */
  router.get('/avatars', async c => {
    const keys = [...new Set((c.url.searchParams.get('keys') || '').split(','))].filter(k => AVATAR_KEY.test(k)).slice(0, 100);
    const rows = keys.length ? await c.env.db.select({ key: staffAvatars.key, dataUrl: staffAvatars.dataUrl }).from(staffAvatars).where(inArray(staffAvatars.key, keys)) : [];
    return json({ avatars: Object.fromEntries(rows.map(r => [r.key, r.dataUrl])) });
  }, 'self');

  router.put('/avatar', async c => json({ avatar: await setAvatar(c.env.db, actor(c).id, await bodyAvatar(c)) }), 'self');
  router.delete('/avatar', async c => json({ avatar: await setAvatar(c.env.db, actor(c).id, null) }), 'self');

  const staffMember = async (c: Ctx) => {
    const id = c.params.id!;
    const [m] = await c.env.db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), ne(employees.role, 'customer'), isNull(employees.deletedAt))).limit(1);
    if (!m) throw new AppError(404, 'Không tìm thấy nhân viên.');
    return m.id;
  };
  router.put('/admin/members/:id/avatar', async c => { const id = await staffMember(c); return json({ avatar: await setAvatar(c.env.db, id, await bodyAvatar(c)) }); }, 'admin');
  router.delete('/admin/members/:id/avatar', async c => { const id = await staffMember(c); return json({ avatar: await setAvatar(c.env.db, id, null) }); }, 'admin');
}
