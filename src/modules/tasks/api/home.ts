import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { HomeTasks } from '../../../core/contracts/home.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { tasks } from '../schema.ts';
import { OPEN_STATUSES, dueBucket, TASK_TEAMS, isTeam } from '../domain/task-config.ts';
import { vietnamDate } from '../../sales/domain/sales.ts';

type Ctx = RouteContext<StaffEnv>;
/** Same task scope as the board, bounded projection and two batched reads; never scans document modules inline. */
export function registerHomeTasks(router: Router<StaffEnv>, deps: { scope: (c: Ctx) => SQL | undefined; sync: (c: Ctx) => Promise<void> }) {
  router.get('/tasks/home', async c => {
    const member = (c.state.session as SessionState).member;
    const filter = c.url.searchParams.get('filter') || 'priority';
    if (!['priority','overdue','today'].includes(filter)) throw new AppError(400, 'Bộ lọc Trang chủ không hợp lệ.');
    // Keep existing event reconciliation/waitUntil behavior; no duplicate scheduler or new side effects.
    await deps.sync(c);
    const today = vietnamDate().iso, scope = member.role === 'manager' ? 'all' : 'mine';
    const overdue = sql`${tasks.dueDate} <> '' and ${tasks.dueDate} < ${today}`, dueToday = eq(tasks.dueDate,today);
    const where = and(deps.scope(c),inArray(tasks.status,[...OPEN_STATUSES]));
    const count = sql<number>`count(*)`.mapWith(Number);
    const [[counts], rows] = await Promise.all([
      c.env.db.select({open:count,overdue:sql<number>`count(*) filter(where ${overdue})`.mapWith(Number),today:sql<number>`count(*) filter(where ${dueToday})`.mapWith(Number)}).from(tasks).where(where),
      c.env.db.select({id:tasks.id,title:tasks.title,source:tasks.source,priority:tasks.priority,status:tasks.status,dueDate:tasks.dueDate,dueTime:tasks.dueTime,assigneeName:employees.name,team:tasks.assigneePosition})
        .from(tasks).leftJoin(employees,eq(employees.id,tasks.assigneeId))
        .where(and(where,filter==='overdue'?overdue:filter==='today'?dueToday:undefined))
        .orderBy(sql`case when ${overdue} then 0 when ${dueToday} then 1 else 2 end`,
          sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`,
          sql`nullif(${tasks.dueDate},'') asc nulls last`,sql`nullif(${tasks.dueTime},'') asc nulls last`,asc(tasks.createdAt),asc(tasks.id)).limit(5),
    ]);
    const totals = counts ?? {open:0,overdue:0,today:0}, total = filter==='overdue'?totals.overdue:filter==='today'?totals.today:totals.open;
    const result: HomeTasks = {today,syncedAt:new Date().toISOString(),scope,filter:filter as HomeTasks['filter'],counts:totals,total,hasMore:total>rows.length,
      tasks:rows.map(({team,...t})=>({...t,assigneeName:t.assigneeName||'',teamName:team&&isTeam(team)?TASK_TEAMS[team]:'',due:dueBucket(t.dueDate,today)}))};
    return json(result);
  }, 'business');
}
