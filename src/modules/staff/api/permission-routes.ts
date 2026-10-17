import { and, asc, count, desc, eq } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router, type RouteContext } from '../../../core/http/router.ts';
import { departments, employees, permissionLog, positionPermissions, positions } from '../schema.ts';
import { DATA_SCOPES, DATA_SCOPE_LABEL, PERMISSIONS, PERMISSION_KEYS, SYSTEM_POSITIONS, can, type DataScope } from '../domain/permissions.ts';
import { isUniqueViolation } from '../repo/member-repo.ts';
import type { SessionState, StaffEnv } from './auth-routes.ts';

/**
 * TRANG PHÂN QUYỀN (docs/PHAN-QUYEN.md) – Manager hoặc chức vụ có quyền "Quản lý phân quyền".
 *  GET    /permissions                    phòng ban, chức vụ (quyền + phạm vi dữ liệu + số người), danh mục quyền, nhật ký
 *  PUT    /permissions/positions/:id      sửa chức vụ: tên, phòng ban, phạm vi dữ liệu, danh sách quyền
 *  POST   /permissions/positions          thêm chức vụ (có thể chép quyền từ chức vụ khác)
 *  DELETE /permissions/positions/:id      xoá chức vụ tự thêm, chưa ai giữ
 *  POST / PUT / DELETE /permissions/departments[/:id]   thêm / đổi tên / xoá phòng ban (xoá khi không còn chức vụ)
 * Chức vụ Manager / NCC / Khách hàng không sửa được ở đây. Đổi quyền có hiệu lực ngay ở yêu cầu kế tiếp (quyền đọc theo phiên).
 */
type Ctx = RouteContext<StaffEnv>;
const me = (c: Ctx) => (c.state.session as SessionState).member;
/** Chức vụ có sẵn từ đầu: code còn dựa vào mã (kho, kế toán, sale admin…) nên không xoá được – vẫn đổi tên / quyền được. */
const BUILT_IN = new Set([...SYSTEM_POSITIONS, 'sale', 'sale-admin', 'sales-ml', 'sales-lock', 'warehouse', 'accounting']);
const fail = (status: number, message: string): never => { throw new AppError(status, message); };
const guard = (c: Ctx) => { if (!can(me(c), 'perm.manage')) fail(403, 'Chỉ Manager hoặc người được cấp quyền "Quản lý phân quyền" dùng được trang này.'); };
const name = (v: unknown, what: string) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!s || s.length > 60) fail(400, `Nhập tên ${what} (tối đa 60 ký tự).`);
  return s;
};
/** Mã từ tên: "Trưởng phòng Kinh doanh" → "truong-phong-kinh-doanh". */
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'chuc-vu';
const permLabel = (k: string) => PERMISSIONS.find(p => p.key === k)?.label ?? k;
type Tx = Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
async function log(db: StaffEnv['db'] | Tx, by: string, action: string, detail: string) {
  await db.insert(permissionLog).values({ id: crypto.randomUUID(), at: new Date().toISOString(), by, action, detail });
}
async function uniqueId(db: StaffEnv['db'], table: typeof positions | typeof departments, base: string) {
  for (let i = 0; i < 50; i++) {
    const id = i ? `${base}-${i + 1}` : base;
    if (!(await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1)).length) return id;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
const conflict = (e: unknown, msg: string) => { if (isUniqueViolation(e)) fail(409, msg); throw e; };

export function registerPermissionRoutes(router: Router<StaffEnv>): void {
  router.get('/permissions', async c => {
    guard(c);
    const db = c.env.db;
    const [deps, pos, perms, members, logs] = await Promise.all([
      db.select().from(departments).orderBy(asc(departments.sortOrder), asc(departments.name)),
      db.select().from(positions).orderBy(asc(positions.name)),
      db.select().from(positionPermissions),
      db.select({ positionId: employees.positionId, n: count() }).from(employees).where(and(eq(employees.active, true))).groupBy(employees.positionId),
      db.select({ at: permissionLog.at, action: permissionLog.action, detail: permissionLog.detail, by: employees.name }).from(permissionLog)
        .leftJoin(employees, eq(employees.id, permissionLog.by)).orderBy(desc(permissionLog.at)).limit(40),
    ]);
    return json({
      canEdit: true, myPosition: me(c).positionId,
      catalog: PERMISSIONS.map(({ key, group, label, hint }) => ({ key, group, label, hint: hint ?? '' })),
      scopes: DATA_SCOPES.map(k => ({ key: k, label: DATA_SCOPE_LABEL[k] })),
      departments: deps.map(d => ({ id: d.id, name: d.name, sortOrder: d.sortOrder })),
      positions: pos.filter(p => p.id !== 'customer' && p.id !== 'supplier').map(p => ({
        id: p.id, name: p.name, departmentId: p.departmentId, dataScope: p.dataScope, members: Number(members.find(m => m.positionId === p.id)?.n ?? 0),
        perms: p.id === 'manager' ? PERMISSIONS.map(x => x.key) : perms.filter(x => x.positionId === p.id).map(x => x.permission),
        system: SYSTEM_POSITIONS.has(p.id), builtIn: BUILT_IN.has(p.id),
      })),
      log: logs,
    });
  }, 'business');

  router.put('/permissions/positions/:id', async c => {
    guard(c);
    const id = c.params.id!, body = await readJson(c.req, 16_000), db = c.env.db, m = me(c);
    if (SYSTEM_POSITIONS.has(id)) fail(400, 'Chức vụ Manager / NCC / Khách hàng có quyền cố định, không sửa ở đây.');
    const [old] = await db.select().from(positions).where(eq(positions.id, id)).limit(1);
    if (!old) fail(404, 'Không tìm thấy chức vụ.');
    const set: Partial<typeof positions.$inferInsert> = {}, notes: string[] = [];
    if (body.name !== undefined) { const n = name(body.name, 'chức vụ'); if (n !== old!.name) { set.name = n; notes.push(`đổi tên "${old!.name}" → "${n}"`); } }
    if (body.departmentId !== undefined) {
      const d = body.departmentId === null || body.departmentId === '' ? null : String(body.departmentId);
      if (d && !(await db.select({ id: departments.id }).from(departments).where(eq(departments.id, d)).limit(1)).length) fail(400, 'Phòng ban không hợp lệ.');
      if (d !== old!.departmentId) { set.departmentId = d; notes.push('đổi phòng ban'); }
    }
    if (body.dataScope !== undefined) {
      if (!(DATA_SCOPES as readonly string[]).includes(String(body.dataScope))) fail(400, 'Phạm vi dữ liệu không hợp lệ.');
      if (body.dataScope !== old!.dataScope) { set.dataScope = body.dataScope as DataScope; notes.push(`phạm vi dữ liệu: ${DATA_SCOPE_LABEL[old!.dataScope as DataScope] ?? old!.dataScope} → ${DATA_SCOPE_LABEL[body.dataScope as DataScope]}`); }
    }
    let next: string[] | null = null;
    if (body.perms !== undefined) {
      if (!Array.isArray(body.perms) || body.perms.some((k: unknown) => typeof k !== 'string' || !PERMISSION_KEYS.has(k))) fail(400, 'Danh sách quyền không hợp lệ.');
      next = [...new Set(body.perms as string[])];
    }
    await db.transaction(async tx => {
      if (Object.keys(set).length) await tx.update(positions).set(set).where(eq(positions.id, id)).catch(e => conflict(e, 'Tên chức vụ đã có.'));
      if (next) {
        const cur = (await tx.select({ k: positionPermissions.permission }).from(positionPermissions).where(eq(positionPermissions.positionId, id))).map(r => r.k);
        const add = next.filter(k => !cur.includes(k)), del = cur.filter(k => !next!.includes(k));
        if (del.length) for (const k of del) await tx.delete(positionPermissions).where(and(eq(positionPermissions.positionId, id), eq(positionPermissions.permission, k)));
        if (add.length) await tx.insert(positionPermissions).values(add.map(k => ({ positionId: id, permission: k })));
        if (add.length) notes.push('cấp: ' + add.map(permLabel).join(', '));
        if (del.length) notes.push('bỏ: ' + del.map(permLabel).join(', '));
      }
      if (notes.length) await log(tx, m.id, 'Sửa chức vụ', `${set.name ?? old!.name}: ${notes.join('; ')}`);
    });
    return json({ ok: true, changed: notes.length });
  }, 'business');

  router.post('/permissions/positions', async c => {
    guard(c);
    const body = await readJson(c.req, 4_000), db = c.env.db, n = name(body.name, 'chức vụ');
    const departmentId = body.departmentId ? String(body.departmentId) : null;
    if (departmentId && !(await db.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId)).limit(1)).length) fail(400, 'Phòng ban không hợp lệ.');
    const copy = body.copyFrom ? String(body.copyFrom) : '';
    const src = copy ? (await db.select().from(positions).where(eq(positions.id, copy)).limit(1))[0] : undefined;
    if (copy && (!src || SYSTEM_POSITIONS.has(copy))) fail(400, 'Chức vụ mẫu không hợp lệ.');
    const id = await uniqueId(db, positions, slug(n));
    await db.transaction(async tx => {
      await tx.insert(positions).values({ id, name: n, departmentId, dataScope: src?.dataScope ?? 'own' }).catch(e => conflict(e, 'Tên chức vụ đã có.'));
      const perms = src ? (await tx.select({ k: positionPermissions.permission }).from(positionPermissions).where(eq(positionPermissions.positionId, src.id))).map(r => r.k) : [];
      if (perms.length) await tx.insert(positionPermissions).values(perms.map(k => ({ positionId: id, permission: k })));
      await log(tx, me(c).id, 'Thêm chức vụ', n + (src ? ` (chép quyền từ ${src.name})` : ''));
    });
    return json({ id }, 201);
  }, 'business');

  router.delete('/permissions/positions/:id', async c => {
    guard(c);
    const id = c.params.id!, db = c.env.db;
    if (BUILT_IN.has(id)) fail(400, 'Chức vụ có sẵn của hệ thống không xoá được (vẫn đổi tên / quyền được).');
    const [p] = await db.select().from(positions).where(eq(positions.id, id)).limit(1);
    if (!p) fail(404, 'Không tìm thấy chức vụ.');
    const [used] = await db.select({ n: count() }).from(employees).where(eq(employees.positionId, id));
    if (used!.n) fail(409, `Còn ${used!.n} nhân viên (kể cả đã khoá / đã xoá) giữ chức vụ này. Chuyển họ sang chức vụ khác trước.`);
    await db.transaction(async tx => { await tx.delete(positions).where(eq(positions.id, id)); await log(tx, me(c).id, 'Xoá chức vụ', p!.name); });
    return json({ ok: true });
  }, 'business');

  router.post('/permissions/departments', async c => {
    guard(c);
    const body = await readJson(c.req, 2_000), db = c.env.db, n = name(body.name, 'phòng ban');
    const id = await uniqueId(db, departments, slug(n));
    const [last] = await db.select({ s: departments.sortOrder }).from(departments).orderBy(desc(departments.sortOrder)).limit(1);
    await db.insert(departments).values({ id, name: n, sortOrder: (last?.s ?? 0) + 1, createdAt: new Date().toISOString() }).catch(e => conflict(e, 'Tên phòng ban đã có.'));
    await log(db, me(c).id, 'Thêm phòng ban', n);
    return json({ id }, 201);
  }, 'business');

  router.put('/permissions/departments/:id', async c => {
    guard(c);
    const body = await readJson(c.req, 2_000), db = c.env.db, n = name(body.name, 'phòng ban');
    const [d] = await db.select().from(departments).where(eq(departments.id, c.params.id!)).limit(1);
    if (!d) fail(404, 'Không tìm thấy phòng ban.');
    if (n !== d!.name) {
      await db.update(departments).set({ name: n }).where(eq(departments.id, d!.id)).catch(e => conflict(e, 'Tên phòng ban đã có.'));
      await log(db, me(c).id, 'Đổi tên phòng ban', `"${d!.name}" → "${n}"`);
    }
    return json({ ok: true });
  }, 'business');

  router.delete('/permissions/departments/:id', async c => {
    guard(c);
    const db = c.env.db, [d] = await db.select().from(departments).where(eq(departments.id, c.params.id!)).limit(1);
    if (!d) fail(404, 'Không tìm thấy phòng ban.');
    const [used] = await db.select({ n: count() }).from(positions).where(eq(positions.departmentId, d!.id));
    if (used!.n) fail(409, `Phòng ban còn ${used!.n} chức vụ. Chuyển các chức vụ sang phòng khác trước.`);
    await db.transaction(async tx => { await tx.delete(departments).where(eq(departments.id, d!.id)); await log(tx, me(c).id, 'Xoá phòng ban', d!.name); });
    return json({ ok: true });
  }, 'business');
}
