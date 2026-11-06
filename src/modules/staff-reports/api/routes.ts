/**
 * BÁO CÁO TUẦN Sale / Sale Admin – khu vực `business`. Xem domain/weekly.ts cho hạn nộp, điểm, công thức Tiền trách nhiệm.
 *  GET  /staff-reports/me?month                 các tuần của tháng (trạng thái, điểm) + việc cần nộp
 *  GET  /staff-reports/week?period[&memberId]   số liệu CRM tự tính + nháp + báo cáo + lịch sử nộp (memberId: chỉ Manager)
 *  PUT  /staff-reports/draft                    lưu nháp (không tính là đã nộp)
 *  POST /staff-reports                          nộp chính thức / nộp lại (tuần phải kết thúc; giữ giờ nộp đầu; đã duyệt thì khoá)
 *  GET  /staff-reports/review?month             Manager: mọi Sale / Sale Admin × tuần của tháng
 *  POST /staff-reports/:id/review               Manager: Đạt / Chưa đạt (bắt buộc lý do) / Miễn (bắt buộc lý do)
 * Nhân viên chỉ xem / nộp báo cáo của chính mình – kiểm tra ở máy chủ.
 */
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { salesContracts, salesOrders } from '../../sales/schema.ts';
import { quotations } from '../../quotes/schema.ts';
import { activityFacts } from '../../care/api/kpi-facts.ts';
import type { SaleTargetOf, WeeklyReportPointsOf } from '../../../core/contracts/weekly-report.ts';
import { staffWeeklyReportDrafts, staffWeeklyReportVersions, staffWeeklyReports } from '../schema.ts';
import {
  WEEKLY_LIMITS, WEEKLY_POSITIONS, WEEKLY_REVIEWS, WEEKLY_REVIEW_LABEL, addDays, appliesTo, canSubmitWeek, isWeek, mondayOf, monthPoints, vnDay,
  weekScore, weekStarted, weekState, weeklyDeadline, weeklyOpensAt, weeksOfMonth, type WeeklyReview,
} from '../domain/weekly.ts';

type Ctx = Parameters<Parameters<Router<StaffEnv>['get']>[1]>[0];
const me = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
const text = (v: unknown, max: number = WEEKLY_LIMITS.text) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const reports = (m: { role: string; positionId?: string | null }) => m.role === 'employee' && WEEKLY_POSITIONS.includes(m.positionId as never);
const isManager = (m: { role: string }) => m.role === 'manager';

/** Thành viên phải nộp báo cáo tuần (đang làm, chức vụ Sale / Sale Admin). */
async function reporters(db: AnyDb, ids?: readonly string[]) {
  return db.select({ id: employees.id, name: employees.name, positionId: employees.positionId }).from(employees)
    .where(and(eq(employees.role, 'employee'), inArray(employees.positionId, [...WEEKLY_POSITIONS]), isNull(employees.deletedAt), ids ? inArray(employees.id, [...ids]) : undefined))
    .orderBy(asc(employees.name));
}
/** Điểm báo cáo tuần theo tháng cho bảng lương (chỉ người phải nộp, tháng đã áp dụng). */
export const weeklyPointsFor: WeeklyReportPointsOf = async (db, month, memberIds) => {
  const out = new Map<string, Awaited<ReturnType<WeeklyReportPointsOf>> extends Map<string, infer V> ? V : never>();
  if (!appliesTo(month) || !memberIds.length) return out;
  const people = await reporters(db, memberIds), weeks = weeksOfMonth(month);
  if (!people.length) return out;
  const rows = await db.select({ memberId: staffWeeklyReports.memberId, period: staffWeeklyReports.period, submittedAt: staffWeeklyReports.submittedAt, review: staffWeeklyReports.review })
    .from(staffWeeklyReports).where(and(inArray(staffWeeklyReports.memberId, people.map(p => p.id)), inArray(staffWeeklyReports.period, weeks)));
  const now = nowIso();
  for (const p of people) {
    const mine = new Map(rows.filter(r => r.memberId === p.id).map(r => [r.period, { submittedAt: r.submittedAt, review: r.review as WeeklyReview }]));
    const m = monthPoints(month, mine, now);
    out.set(p.id, { points: m.points, required: m.required, weeks: m.weeks });
  }
  return out;
};

/** Số liệu tuần của một nhân viên (chỉ dữ liệu của chính người đó). */
async function weekFacts(db: AnyDb, memberId: string, monday: string, targetOf?: SaleTargetOf) {
  const sunday = addDays(monday, 6), next = addDays(monday, 7), month = sunday.slice(0, 7);
  const counted = and(eq(salesOrders.ownerId, memberId), ne(salesOrders.status, 'cancelled'), ne(salesOrders.status, 'draft'));
  const quoteOwner = sql<string>`coalesce(${quotations.assigneeId}, ${quotations.creatorId})`;
  const quoteDay = sql<string>`coalesce(nullif(${quotations.quoteDate}, ''), substr(${quotations.createdAt}, 1, 10))`;
  const [week, mtd, newCustomers, quotes, contracts, care, target] = await Promise.all([
    db.select({ revenue: sql<number>`coalesce(sum(${salesOrders.total}),0)`.mapWith(Number), orders: sql<number>`count(*)`.mapWith(Number) }).from(salesOrders)
      .where(and(counted, gte(salesOrders.orderDate, monday), lte(salesOrders.orderDate, sunday))),
    db.select({ revenue: sql<number>`coalesce(sum(${salesOrders.total}),0)`.mapWith(Number) }).from(salesOrders)
      .where(and(counted, gte(salesOrders.orderDate, month + '-01'), lte(salesOrders.orderDate, sunday))),
    db.select({ n: sql<number>`count(distinct ${salesOrders.customerId})`.mapWith(Number) }).from(salesOrders)
      .where(and(counted, gte(salesOrders.orderDate, monday), lte(salesOrders.orderDate, sunday), sql`${salesOrders.customerId} is not null`,
        sql`not exists (select 1 from ${salesOrders} o2 where o2.customer_id = ${salesOrders.customerId} and o2.status not in ('cancelled','draft') and o2.order_date < ${monday})`)),
    db.select({ sent: sql<number>`count(*)`.mapWith(Number),
      won: sql<number>`count(*) filter (where exists (select 1 from ${salesOrders} o where o.quote_id = ${quotations.id} and o.status <> 'cancelled'))`.mapWith(Number) })
      .from(quotations).where(and(eq(quoteOwner, memberId), gte(quoteDay, monday), lte(quoteDay, sunday))),
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId))
      .where(and(eq(salesOrders.ownerId, memberId), inArray(salesContracts.status, ['signed', 'completed']), gte(salesContracts.signedDate, monday), lte(salesContracts.signedDate, sunday))),
    activityFacts(db, monday, next, [memberId]),
    targetOf ? targetOf(db, memberId, month) : Promise.resolve(null),
  ]);
  return { from: monday, to: sunday, revenue: week[0]?.revenue ?? 0, orders: week[0]?.orders ?? 0, newCustomers: newCustomers[0]?.n ?? 0,
    transactions: care.counts.get(memberId) ?? 0, quotesSent: quotes[0]?.sent ?? 0, quotesWon: quotes[0]?.won ?? 0, contracts: contracts[0]?.n ?? 0,
    month: { month, revenue: mtd[0]?.revenue ?? 0, target, ratio: target ? (mtd[0]?.revenue ?? 0) / target : null } };
}
function inputsOf(b: Record<string, unknown>) {
  return { highlights: text(b.highlights), keyCustomers: text(b.keyCustomers), nextWeekPlan: text(b.nextWeekPlan), support: text(b.support) };
}
function problems(v: ReturnType<typeof inputsOf>) {
  const out: string[] = [];
  if (v.highlights.length < 3) out.push('Nhập kết quả nổi bật tuần.');
  if (v.keyCustomers.length < 3) out.push('Nhập khách trọng điểm đang theo và bước tiếp.');
  if (v.nextWeekPlan.length < 3) out.push('Nhập kế hoạch tuần tới.');
  return out;
}

export function registerStaffReportRoutes(router: Router<StaffEnv>, deps: { targetOf?: SaleTargetOf } = {}) {
  router.get('/staff-reports/me', async c => {
    const m = me(c), db = c.env.db, now = nowIso(), month = isMonth(c.url.searchParams.get('month')) ? c.url.searchParams.get('month')! : vnDay(now).slice(0, 7);
    if (!reports(m)) return json({ required: false, canReview: isManager(m), month });
    const weeks = weeksOfMonth(month);
    const [rows, drafts] = await Promise.all([
      db.select().from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, m.id), inArray(staffWeeklyReports.period, weeks))),
      db.select({ period: staffWeeklyReportDrafts.period, updatedAt: staffWeeklyReportDrafts.updatedAt }).from(staffWeeklyReportDrafts).where(and(eq(staffWeeklyReportDrafts.memberId, m.id), inArray(staffWeeklyReportDrafts.period, weeks))),
    ]);
    const pts = monthPoints(month, new Map(rows.map(r => [r.period, { submittedAt: r.submittedAt, review: r.review as WeeklyReview }])), now);
    const lastWeek = addDays(mondayOf(vnDay(now)), -7);
    const [last] = await db.select({ id: staffWeeklyReports.id }).from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, m.id), eq(staffWeeklyReports.period, lastWeek))).limit(1);
    return json({ required: true, applies: appliesTo(month), canReview: false, month, points: pts.points, maxPoints: pts.required,
      weeks: pts.weeks.map(w => { const r = rows.find(x => x.period === w.period);
        return { ...w, reportId: r?.id ?? null, submittedAt: r?.submittedAt ?? null, reviewNote: r?.reviewNote ?? '', draftAt: drafts.find(d => d.period === w.period)?.updatedAt ?? null }; }),
      // Nhắc: tuần trước chưa nộp, từ 08h00 thứ Hai.
      remind: !last && now >= new Date(Date.parse(addDays(lastWeek, 7) + 'T08:00:00+07:00')).toISOString() ? { period: lastWeek, deadline: weeklyDeadline(lastWeek) } : null,
      reviewLabels: WEEKLY_REVIEW_LABEL });
  }, 'business');

  router.get('/staff-reports/week', async c => {
    const m = me(c), db = c.env.db, q = c.url.searchParams, period = q.get('period'), now = nowIso();
    if (!isWeek(period)) throw new AppError(400, 'Tuần không hợp lệ (chọn thứ Hai).');
    const memberId = q.get('memberId') && q.get('memberId') !== m.id ? q.get('memberId')! : m.id;
    if (memberId !== m.id && !isManager(m)) throw new AppError(403, 'Chỉ Manager xem được báo cáo tuần của người khác.');
    if (memberId === m.id && !reports(m)) throw new AppError(403, 'Chức vụ của bạn không phải nộp báo cáo tuần.');
    const [person] = await reporters(db, [memberId]);
    if (!person) throw new AppError(404, 'Không tìm thấy nhân viên phải nộp báo cáo tuần.');
    const [[report], [draft]] = await Promise.all([
      db.select().from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, memberId), eq(staffWeeklyReports.period, period))).limit(1),
      db.select().from(staffWeeklyReportDrafts).where(and(eq(staffWeeklyReportDrafts.memberId, memberId), eq(staffWeeklyReportDrafts.period, period))).limit(1),
    ]);
    const versions = report ? await db.select({ version: staffWeeklyReportVersions.version, submittedAt: staffWeeklyReportVersions.submittedAt })
      .from(staffWeeklyReportVersions).where(eq(staffWeeklyReportVersions.reportId, report.id)).orderBy(asc(staffWeeklyReportVersions.version)) : [];
    const own = memberId === m.id, locked = !!report && report.review !== 'pending', started = weekStarted(period, now), official = canSubmitWeek(period, now);
    return json({ member: { id: person.id, name: person.name }, period, deadline: weeklyDeadline(period), opensAt: weeklyOpensAt(period), factsAt: now,
      facts: await weekFacts(db, memberId, period, deps.targetOf), canEdit: own && started && !locked, canSubmit: own && official && !locked, canReview: isManager(m) && !!report,
      blockers: [...(!started ? ['Tuần chưa bắt đầu.'] : []), ...(started && !official ? ['Tuần chưa kết thúc – chỉ lưu nháp; nộp chính thức từ 00:00 thứ Hai tuần sau.'] : []), ...(locked ? ['Báo cáo đã được duyệt – không sửa được.'] : [])],
      draft: own && draft ? { inputs: parse(draft.inputs), updatedAt: draft.updatedAt } : null, versions,
      report: report ? { ...report, data: parse(report.data), state: weekState(period, report.submittedAt, now), score: weekScore(period, { submittedAt: report.submittedAt, review: report.review as WeeklyReview }, now) } : null,
      reviewLabels: WEEKLY_REVIEW_LABEL });
  }, 'business');

  router.put('/staff-reports/draft', async c => {
    const m = me(c), db = c.env.db, b = await readJson(c.req, 30_000), period = b.period, now = nowIso();
    if (!reports(m)) throw new AppError(403, 'Chức vụ của bạn không phải nộp báo cáo tuần.');
    if (!isWeek(period)) throw new AppError(400, 'Tuần không hợp lệ (chọn thứ Hai).');
    if (!weekStarted(period, now)) throw new AppError(400, 'Tuần chưa bắt đầu.');
    const [r] = await db.select({ review: staffWeeklyReports.review }).from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, m.id), eq(staffWeeklyReports.period, period))).limit(1);
    if (r && r.review !== 'pending') throw new AppError(409, 'Báo cáo đã được duyệt, không sửa được.');
    const inputs = JSON.stringify(inputsOf((b.inputs ?? {}) as Record<string, unknown>));
    await db.insert(staffWeeklyReportDrafts).values({ memberId: m.id, period, inputs, updatedAt: now })
      .onConflictDoUpdate({ target: [staffWeeklyReportDrafts.memberId, staffWeeklyReportDrafts.period], set: { inputs, updatedAt: now } });
    return json({ ok: true, updatedAt: now });
  }, 'business');

  router.post('/staff-reports', async c => {
    const m = me(c), db = c.env.db, b = await readJson(c.req, 30_000), period = b.period, clientKey = text(b.clientKey, 80), now = nowIso();
    if (!reports(m)) throw new AppError(403, 'Chức vụ của bạn không phải nộp báo cáo tuần.');
    if (!isWeek(period)) throw new AppError(400, 'Tuần không hợp lệ (chọn thứ Hai).');
    if (clientKey.length < 8) throw new AppError(400, 'Thiếu mã chống gửi lặp. Tải lại trang rồi thử lại.');
    if (!weekStarted(period, now)) throw new AppError(400, 'Tuần chưa bắt đầu.');
    if (!canSubmitWeek(period, now)) throw new AppError(409, 'Tuần chưa kết thúc – chỉ lưu nháp được, chưa nộp chính thức.', 'WEEK_OPEN');
    const [replay] = await db.select({ id: staffWeeklyReports.id }).from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, m.id), eq(staffWeeklyReports.clientKey, clientKey))).limit(1);
    if (replay) return json({ ok: true, id: replay.id, replayed: true });
    const [locked] = await db.select({ review: staffWeeklyReports.review }).from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, m.id), eq(staffWeeklyReports.period, period))).limit(1);
    if (locked && locked.review !== 'pending') throw new AppError(409, 'Báo cáo đã được duyệt, không sửa được.');
    const inputs = inputsOf((b.inputs ?? {}) as Record<string, unknown>), issues = problems(inputs);
    if (issues.length) throw new AppError(400, issues.join(' '));
    // Số liệu CRM luôn tính ở máy chủ lúc nộp – bỏ qua mọi số liệu client gửi lên.
    const data = JSON.stringify({ facts: await weekFacts(db, m.id, period, deps.targetOf), inputs, meta: { factsAt: now, sources: ['sales_orders', 'quotations', 'sales_contracts', 'customer_activities', 'hr_revenue_targets'] } });
    const result = await db.transaction(async tx => {
      const [existing] = await tx.select().from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, m.id), eq(staffWeeklyReports.period, period))).limit(1).for('update');
      if (existing) {
        if (existing.review !== 'pending') throw new AppError(409, 'Báo cáo đã được duyệt, không sửa được.');
        const [last] = await tx.select({ v: sql<number>`coalesce(max(${staffWeeklyReportVersions.version}),0)`.mapWith(Number) }).from(staffWeeklyReportVersions).where(eq(staffWeeklyReportVersions.reportId, existing.id));
        const version = (last?.v ?? 0) + 1;
        await tx.update(staffWeeklyReports).set({ data, updatedAt: now, clientKey }).where(eq(staffWeeklyReports.id, existing.id));
        await tx.insert(staffWeeklyReportVersions).values({ id: crypto.randomUUID(), reportId: existing.id, version, data, submittedAt: now });
        await tx.delete(staffWeeklyReportDrafts).where(and(eq(staffWeeklyReportDrafts.memberId, m.id), eq(staffWeeklyReportDrafts.period, period)));
        return { status: 200, body: { ok: true, id: existing.id, version, state: weekState(period, existing.submittedAt, now) } };
      }
      const id = crypto.randomUUID();
      const inserted = await tx.insert(staffWeeklyReports).values({ id, memberId: m.id, period, data, submittedAt: now, updatedAt: now, clientKey }).onConflictDoNothing().returning({ id: staffWeeklyReports.id });
      if (!inserted.length) throw new AppError(409, 'Báo cáo tuần này vừa được nộp ở máy khác. Tải lại trang.');
      await tx.insert(staffWeeklyReportVersions).values({ id: crypto.randomUUID(), reportId: id, version: 1, data, submittedAt: now });
      await tx.delete(staffWeeklyReportDrafts).where(and(eq(staffWeeklyReportDrafts.memberId, m.id), eq(staffWeeklyReportDrafts.period, period)));
      return { status: 201, body: { ok: true, id, version: 1, state: weekState(period, now, now) } };
    });
    return json(result.body, result.status);
  }, 'business');

  router.get('/staff-reports/review', async c => {
    const m = me(c); if (!isManager(m)) throw new AppError(403, 'Chỉ Manager duyệt báo cáo tuần.');
    const db = c.env.db, now = nowIso(), month = isMonth(c.url.searchParams.get('month')) ? c.url.searchParams.get('month')! : vnDay(now).slice(0, 7);
    const weeks = weeksOfMonth(month), people = await reporters(db);
    const rows = people.length ? await db.select({ id: staffWeeklyReports.id, memberId: staffWeeklyReports.memberId, period: staffWeeklyReports.period, submittedAt: staffWeeklyReports.submittedAt, review: staffWeeklyReports.review })
      .from(staffWeeklyReports).where(and(inArray(staffWeeklyReports.memberId, people.map(p => p.id)), inArray(staffWeeklyReports.period, weeks))) : [];
    return json({ month, applies: appliesTo(month), weeks, reviewLabels: WEEKLY_REVIEW_LABEL,
      people: people.map(p => { const mine = rows.filter(r => r.memberId === p.id);
        const pts = monthPoints(month, new Map(mine.map(r => [r.period, { submittedAt: r.submittedAt, review: r.review as WeeklyReview }])), now);
        return { id: p.id, name: p.name, positionId: p.positionId, points: pts.points, weeks: pts.weeks.map(w => ({ ...w, reportId: mine.find(r => r.period === w.period)?.id ?? null })) }; }) });
  }, 'business');

  router.post('/staff-reports/:id/review', async c => {
    const m = me(c); if (!isManager(m)) throw new AppError(403, 'Chỉ Manager duyệt báo cáo tuần.');
    const b = await readJson(c.req, 4_000), db = c.env.db, review = b.review as WeeklyReview;
    if (!WEEKLY_REVIEWS.includes(review) || review === 'pending') throw new AppError(400, 'Kết quả duyệt không hợp lệ.');
    const note = text(b.note, 1000);
    if (review !== 'ok' && note.length < 3) throw new AppError(400, 'Nhập lý do (bắt buộc khi Chưa đạt hoặc Miễn).');
    const [r] = await db.select({ id: staffWeeklyReports.id }).from(staffWeeklyReports).where(eq(staffWeeklyReports.id, String(c.params.id))).limit(1);
    if (!r) throw new AppError(404, 'Không tìm thấy báo cáo.');
    await db.update(staffWeeklyReports).set({ review, reviewNote: note, reviewedBy: m.id, reviewedAt: nowIso() }).where(eq(staffWeeklyReports.id, r.id));
    return json({ ok: true });
  }, 'business');
}
