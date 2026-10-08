import { and, asc, count, desc, eq, gte, isNotNull, isNull, lt, lte, type SQL } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { foldSql, matchAllWords, paging } from '../../../core/text/fold.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { customers } from '../../customers/schema.ts';
import { customerActivities } from '../schema.ts';
import { CARE_RESULT_LABEL, CARE_RESULTS, CARE_TYPE_LABEL, CARE_TYPES, cleanCare, followUpState } from '../domain/care.ts';

/*
 * API CHĂM SÓC KHÁCH HÀNG (/care):
 *  GET    /care/config          danh mục hình thức / kết quả (giao diện dùng chung, không chép tay)
 *  GET    /care                 danh sách: ?view=log (nhật ký, mặc định) | follow-ups (hẹn chăm sóc chưa xong)
 *                                lọc: q, type, result, customerId, from, to (ngày), owner (chỉ Manager)
 *  GET    /care/:id             một dòng
 *  POST   /care                 ghi một lần chăm sóc (người ghi = người đăng nhập)
 *  PUT    /care/:id             sửa (người ghi hoặc Manager; `revision` chống ghi đè)
 *  POST   /care/:id/done        đánh dấu hẹn chăm sóc đã xong / mở lại ({ done: boolean })
 *  DELETE /care/:id             xoá (người ghi hoặc Manager)
 * Quyền xem: nhân viên chỉ thấy dòng mình ghi; Manager thấy tất cả.
 */
type Ctx = RouteContext<StaffEnv>;
type Viewer = Pick<SessionState['member'], 'id' | 'role'>;
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const isManager = (m: Viewer) => m.role === 'manager';

/** Điều kiện xem được: Manager tất cả, nhân viên dòng mình ghi. Dùng chung cho trang chi tiết khách (customer-hub). */
export const careScope = (m: Viewer): SQL | undefined => (isManager(m) ? undefined : eq(customerActivities.ownerId, m.id));

/** Ngày hôm nay theo giờ Việt Nam (YYYY-MM-DD). */
export const vnToday = (now = new Date()) => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
/** Mốc đầu ngày (giờ Việt Nam) của một ngày YYYY-MM-DD, dạng ISO UTC – để lọc `occurred_at`. */
const dayStart = (iso: string) => new Date(Date.parse(iso + 'T00:00:00+07:00')).toISOString();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const columns = {
  a: customerActivities, customerName: customers.name, customerPhone: customers.phone, ownerName: employees.name,
};
type Row = { a: typeof customerActivities.$inferSelect; customerName: string; customerPhone: string; ownerName: string };
const present = (r: Row, me: Viewer, today: string) => ({
  ...r.a, customerName: r.customerName, customerPhone: r.customerPhone, ownerName: r.ownerName,
  typeLabel: CARE_TYPE_LABEL[r.a.type], resultLabel: CARE_RESULT_LABEL[r.a.result],
  followUp: followUpState(r.a.nextAt, r.a.nextDoneAt, today), canEdit: isManager(me) || r.a.ownerId === me.id,
});
const baseQuery = (c: Ctx) => c.env.db.select(columns).from(customerActivities)
  .innerJoin(customers, eq(customers.id, customerActivities.customerId)).innerJoin(employees, eq(employees.id, customerActivities.ownerId));

/** Một dòng người xem được (không có quyền → 404, không lộ là có tồn tại). */
async function loadOne(c: Ctx, id: string) {
  const me = viewer(c);
  const [row] = await baseQuery(c).where(and(eq(customerActivities.id, id), careScope(me))).limit(1);
  if (!row) throw new AppError(404, 'Không tìm thấy lần chăm sóc này.');
  return row;
}
async function ensureCustomer(c: Ctx, id: string) {
  const [k] = await c.env.db.select({ id: customers.id }).from(customers).where(eq(customers.id, id)).limit(1);
  if (!k) throw new AppError(400, 'Không tìm thấy khách hàng.');
}

export function registerCareRoutes(router: Router<StaffEnv>) {
  router.get('/care/config', () => json({
    types: CARE_TYPES.map(k => ({ key: k, label: CARE_TYPE_LABEL[k] })), results: CARE_RESULTS.map(k => ({ key: k, label: CARE_RESULT_LABEL[k] })),
  }), 'business');

  router.get('/care', async c => {
    const me = viewer(c), p = c.url.searchParams, today = vnToday(), { limit, offset } = paging(c.url, 100, 300);
    const followUps = p.get('view') === 'follow-ups';
    const type = p.get('type'), result = p.get('result'), from = p.get('from') ?? '', to = p.get('to') ?? '', owner = p.get('owner');
    const scope = careScope(me);
    const filters = and(
      scope,
      isManager(me) && owner ? eq(customerActivities.ownerId, owner) : undefined,
      p.get('customerId') ? eq(customerActivities.customerId, p.get('customerId')!) : undefined,
      type && (CARE_TYPES as readonly string[]).includes(type) ? eq(customerActivities.type, type as typeof CARE_TYPES[number]) : undefined,
      result && (CARE_RESULTS as readonly string[]).includes(result) ? eq(customerActivities.result, result as typeof CARE_RESULTS[number]) : undefined,
      DATE.test(from) ? gte(customerActivities.occurredAt, dayStart(from)) : undefined,
      DATE.test(to) ? lt(customerActivities.occurredAt, dayStart(new Date(Date.parse(to + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10))) : undefined,
      matchAllWords(foldSql(customers.name, customerActivities.subject, customerActivities.content, customerActivities.contactName, customerActivities.nextAction), p.get('q')),
      followUps ? and(isNotNull(customerActivities.nextAt), isNull(customerActivities.nextDoneAt)) : undefined,
    );
    const pending = and(scope, isNotNull(customerActivities.nextAt), isNull(customerActivities.nextDoneAt));
    const [rows, [{ total = 0 } = {}], [{ overdue = 0 } = {}], [{ dueToday = 0 } = {}]] = await Promise.all([
      baseQuery(c).where(filters)
        .orderBy(...(followUps ? [asc(customerActivities.nextAt), asc(customers.name)] : [desc(customerActivities.occurredAt), desc(customerActivities.createdAt)]))
        .limit(limit).offset(offset),
      c.env.db.select({ total: count() }).from(customerActivities).innerJoin(customers, eq(customers.id, customerActivities.customerId)).where(filters),
      c.env.db.select({ overdue: count() }).from(customerActivities).where(and(pending, lt(customerActivities.nextAt, today))),
      c.env.db.select({ dueToday: count() }).from(customerActivities).where(and(pending, eq(customerActivities.nextAt, today))),
    ]);
    return json({ activities: rows.map(r => present(r, me, today)), total, today, counts: { overdue, today: dueToday } });
  }, 'business');

  router.get('/care/:id', async c => json({ activity: present(await loadOne(c, c.params.id!), viewer(c), vnToday()) }), 'business');

  router.post('/care', async c => {
    const me = viewer(c), today = vnToday(), v = cleanCare(await readJson(c.req, 20_000), today);
    await ensureCustomer(c, v.customerId);
    const id = crypto.randomUUID(), now = new Date().toISOString();
    await c.env.db.insert(customerActivities).values({ id, ...v, ownerId: me.id, nextDoneAt: null, createdAt: now, updatedAt: now });
    return json({ activity: present(await loadOne(c, id), me, today) }, 201);
  }, 'business');

  router.put('/care/:id', async c => {
    const me = viewer(c), today = vnToday(), body = await readJson(c.req, 20_000), { a: old } = await loadOne(c, c.params.id!);
    if (body.revision !== undefined && Number(body.revision) !== old.revision) throw new AppError(409, 'Dòng này vừa được người khác sửa. Tải lại rồi sửa tiếp.');
    // Giữ nguyên ngày hẹn cũ (đã qua) thì vẫn lưu được; đổi ngày hẹn thì phải từ hôm nay trở đi.
    const keepOld = !!old.nextAt && body.nextAt === old.nextAt;
    const v = cleanCare(body, keepOld && old.nextAt! < today ? old.nextAt! : today);
    if (v.customerId !== old.customerId) await ensureCustomer(c, v.customerId);
    const now = new Date().toISOString();
    const nextDoneAt = v.nextAt && v.nextAt === old.nextAt ? old.nextDoneAt : null;
    await c.env.db.update(customerActivities).set({ ...v, nextDoneAt, revision: old.revision + 1, updatedAt: now })
      .where(and(eq(customerActivities.id, old.id), eq(customerActivities.revision, old.revision)));
    return json({ activity: present(await loadOne(c, old.id), me, today) });
  }, 'business');

  router.post('/care/:id/done', async c => {
    const me = viewer(c), body = await readJson(c.req, 1000), { a: old } = await loadOne(c, c.params.id!);
    if (!old.nextAt) throw new AppError(409, 'Lần chăm sóc này không có lịch hẹn.');
    const now = new Date().toISOString();
    await c.env.db.update(customerActivities).set({ nextDoneAt: body.done === false ? null : now, revision: old.revision + 1, updatedAt: now }).where(eq(customerActivities.id, old.id));
    return json({ activity: present(await loadOne(c, old.id), me, vnToday()) });
  }, 'business');

  router.delete('/care/:id', async c => {
    const { a } = await loadOne(c, c.params.id!);
    await c.env.db.delete(customerActivities).where(eq(customerActivities.id, a.id));
    return json({ ok: true });
  }, 'business');
}

/** Đánh dấu lịch hẹn đã xong khi việc tự sinh tương ứng được hoàn thành (chỉ khi ngày hẹn chưa bị dời). */
export async function completeFollowUp(db: StaffEnv['db'], activityId: string, nextAt: string) {
  const now = new Date().toISOString();
  await db.update(customerActivities).set({ nextDoneAt: now, updatedAt: now })
    .where(and(eq(customerActivities.id, activityId), eq(customerActivities.nextAt, nextAt), isNull(customerActivities.nextDoneAt)));
}

/** Lịch hẹn chưa xong có ngày hẹn đến hết `lastDay` (cho việc tự sinh). */
export async function dueFollowUps(db: StaffEnv['db'], lastDay: string) {
  return db.select({ id: customerActivities.id, customerId: customerActivities.customerId, ownerId: customerActivities.ownerId, nextAt: customerActivities.nextAt,
    nextAction: customerActivities.nextAction, subject: customerActivities.subject, type: customerActivities.type, customerName: customers.name })
    .from(customerActivities).innerJoin(customers, eq(customers.id, customerActivities.customerId))
    .where(and(isNotNull(customerActivities.nextAt), isNull(customerActivities.nextDoneAt), lte(customerActivities.nextAt, lastDay))).limit(1000);
}
