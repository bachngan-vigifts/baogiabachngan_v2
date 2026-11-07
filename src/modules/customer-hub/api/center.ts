import {
  and,
  or,
  eq,
  ne,
  exists,
  sql,
  desc,
  asc,
  count,
  inArray,
  isNull,
} from "drizzle-orm";
import type { AnyDb } from "../../../core/db/client.ts";
import { AppError } from "../../../core/errors.ts";
import {
  json,
  readJson,
  type Router,
  type RouteContext,
} from "../../../core/http/router.ts";
import { foldSql, matchAllWords, paging } from "../../../core/text/fold.ts";
import type { StaffEnv, SessionState } from "../../staff/api/auth-routes.ts";
import { employees, positions } from "../../staff/schema.ts";
import { departmentOwner } from "../../staff/api/department.ts";
import { can } from "../../staff/domain/permissions.ts";
import { seesAllAsSaleAdmin } from "../../staff/domain/roles.ts";
import { customers, customerStaff } from "../../customers/schema.ts";
import {
  salesOrders,
  salesContracts,
  salesOrderLines,
} from "../../sales/schema.ts";
import { orderScopeFor } from "../../sales/api/routes.ts";
import { vietnamDate } from "../../sales/domain/sales.ts";
import { customerActivities } from "../../care/schema.ts";
import { careScope } from "../../care/api/routes.ts";
import {
  customerCampaigns as campaigns,
  customerCampaignTargets as targets,
} from "../schema.ts";
import {
  campaignInput,
  centerWindow,
  CAMPAIGN_STATUSES,
} from "../domain/center.ts";

type Ctx = RouteContext<StaffEnv>;
type Viewer = SessionState["member"];
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const manager = (me: Viewer) => {
  if (me.role !== "manager")
    throw new AppError(403, "Chỉ Manager quản lý chiến dịch.");
};
// Same directory scope as anniversaries. Purchase values additionally use the order-level scope.
const customerScope = (db: AnyDb, me: Viewer) =>
  me.role === "manager" || seesAllAsSaleAdmin(me)
    ? undefined
    : exists(
        db
          .select({ id: customerStaff.customerId })
          .from(customerStaff)
          .where(
            and(
              eq(customerStaff.customerId, customers.id),
              or(
                eq(customerStaff.memberId, me.id),
                departmentOwner(customerStaff.memberId, me),
              ),
            ),
          ),
      );
const approved = and(
  eq(customers.approvalStatus, "approved"),
  eq(customers.isRetail, false),
);
const targetScope = (db: AnyDb, me: Viewer) =>
  and(
    approved,
    customerScope(db, me),
    me.role === "manager" ? undefined : eq(targets.assigneeId, me.id),
  );
const campaignScope = (db: AnyDb, me: Viewer) =>
  me.role === "manager"
    ? undefined
    : exists(
        db
          .select({ id: targets.id })
          .from(targets)
          .innerJoin(customers, eq(customers.id, targets.customerId))
          .where(
            and(eq(targets.campaignId, campaigns.id), targetScope(db, me)),
          ),
      );
async function campaignFor(db: AnyDb, me: Viewer, id: string) {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), campaignScope(db, me)))
    .limit(1);
  if (!row)
    throw new AppError(
      404,
      "Không tìm thấy chiến dịch trong phạm vi được xem.",
    );
  return row;
}
function history(
  db: AnyDb,
  me: Viewer,
  window: ReturnType<typeof centerWindow>,
) {
  return db
    .select({
      customerId: salesOrders.customerId,
      lastDate: sql<string>`max(${salesOrders.orderDate})`.as("last_date"),
      periodOrders:
        sql<number>`sum(case when ${salesOrders.orderDate} >= ${window.from} and ${salesOrders.orderDate} < ${window.to} then 1 else 0 end)`
          .mapWith(Number)
          .as("period_orders"),
      periodValue:
        sql<number>`sum(case when ${salesOrders.orderDate} >= ${window.from} and ${salesOrders.orderDate} < ${window.to} then ${salesOrders.total} else 0 end)`
          .mapWith(Number)
          .as("period_value"),
    })
    .from(salesOrders)
    .leftJoin(
      salesContracts,
      and(
        eq(salesContracts.orderId, salesOrders.id),
        ne(salesContracts.status, "cancelled"),
      ),
    )
    .where(
      and(
        ne(salesOrders.status, "cancelled"),
        sql`${salesOrders.orderDate} <= ${window.today}`,
        or(
          ne(salesOrders.status, "draft"),
          inArray(salesContracts.status, ["signed", "completed"]),
        ),
        orderScopeFor(me),
      ),
    )
    .groupBy(salesOrders.customerId)
    .as("customer_history");
}
async function validateTargets(db: AnyDb, ids: string[], assigneeId: string) {
  const [row] = await db
    .select({ member: employees, dataScope: positions.dataScope })
    .from(employees)
    .leftJoin(positions, eq(positions.id, employees.positionId))
    .where(
      and(
        eq(employees.id, assigneeId),
        eq(employees.active, true),
        isNull(employees.deletedAt),
        inArray(employees.role, ["employee", "manager"]),
      ),
    )
    .limit(1);
  if (!row) throw new AppError(400, "Chọn nhân viên đang hoạt động.");
  const approvedCustomers = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(inArray(customers.id, ids), approved));
  if (approvedCustomers.length !== ids.length)
    throw new AppError(400, "Chỉ chọn khách doanh nghiệp đã duyệt.");
  const assignee = { ...row.member, dataScope: row.dataScope };
  if (assignee.role === "manager" || seesAllAsSaleAdmin(assignee)) return;
  // Assignment never grants customer access. One batch checks explicit owner/shared memberships.
  const memberships = await db
    .select({ id: customerStaff.customerId })
    .from(customerStaff)
    .where(
      and(
        inArray(customerStaff.customerId, ids),
        eq(customerStaff.memberId, assigneeId),
      ),
    );
  if (memberships.length !== ids.length)
    throw new AppError(
      400,
      "Cần phụ trách hoặc chia sẻ khách cho nhân viên trước khi phân công chiến dịch.",
    );
}
function targetInput(body: Record<string, unknown>) {
  if (
    !Array.isArray(body.customerIds) ||
    body.customerIds.length < 1 ||
    body.customerIds.length > 100 ||
    body.customerIds.some((id) => typeof id !== "string" || !id.trim()) ||
    typeof body.assigneeId !== "string"
  )
    throw new AppError(400, "Chọn từ 1 đến 100 khách và nhân viên phụ trách.");
  return {
    ids: [...new Set(body.customerIds as string[])],
    assigneeId: body.assigneeId,
  };
}

export function registerCustomerCenterRoutes(router: Router<StaffEnv>) {
  router.get(
    "/customers/center/opportunities",
    async (c) => {
      const db = c.env.db,
        me = viewer(c),
        p = c.url.searchParams,
        today = vietnamDate().iso;
      const window = centerWindow(
        p.get("month") || today.slice(0, 7),
        today,
        p.has("days") ? Number(p.get("days")) : 180,
      );
      const kind = p.get("kind") || "period";
      if (!["period", "dormant"].includes(kind))
        throw new AppError(400, "Loại cơ hội không hợp lệ.");
      const h = history(db, me, window),
        scope = and(approved, customerScope(db, me));
      const filter = and(
        scope,
        kind === "period"
          ? sql`${h.periodOrders} > 0`
          : sql`${h.lastDate} <= ${window.cutoff}`,
        matchAllWords(
          foldSql(
            customers.name,
            customers.contact,
            customers.phone,
            customers.customerCode,
          ),
          p.get("q"),
        ),
      );
      const { limit, offset } = paging(c.url, 20, 100);
      const [totals, list] = await Promise.all([
        db
          .select({ total: count() })
          .from(customers)
          .innerJoin(h, eq(h.customerId, customers.id))
          .where(filter),
        db
          .select({
            id: customers.id,
            name: customers.name,
            contact: customers.contact,
            phone: customers.phone,
            lastOrderDate: h.lastDate,
            periodOrders: h.periodOrders,
            periodValue: h.periodValue,
          })
          .from(customers)
          .innerJoin(h, eq(h.customerId, customers.id))
          .where(filter)
          .orderBy(desc(h.lastDate), asc(customers.id))
          .limit(limit)
          .offset(offset),
      ]);
      const ids = list.map((r) => r.id);
      const last = ids.length
        ? await db
            .selectDistinctOn([salesOrders.customerId], {
              customerId: salesOrders.customerId,
              id: salesOrders.id,
              total: salesOrders.total,
            })
            .from(salesOrders)
            .leftJoin(
              salesContracts,
              and(
                eq(salesContracts.orderId, salesOrders.id),
                ne(salesContracts.status, "cancelled"),
              ),
            )
            .where(
              and(
                inArray(salesOrders.customerId, ids),
                ne(salesOrders.status, "cancelled"),
                sql`${salesOrders.orderDate} <= ${today}`,
                or(
                  ne(salesOrders.status, "draft"),
                  inArray(salesContracts.status, ["signed", "completed"]),
                ),
                orderScopeFor(me),
              ),
            )
            .orderBy(
              asc(salesOrders.customerId),
              desc(salesOrders.orderDate),
              desc(salesOrders.id),
            )
        : [];
      const orderIds = last.map((r) => r.id);
      const lines = orderIds.length
        ? await db
            .select({
              orderId: salesOrderLines.orderId,
              products: sql<string>`left(string_agg(${salesOrderLines.name} || ' × ' || ${salesOrderLines.qty}::text, ', ' order by ${salesOrderLines.lineNo}), 500)`,
            })
            .from(salesOrderLines)
            .where(inArray(salesOrderLines.orderId, orderIds))
            .groupBy(salesOrderLines.orderId)
        : [];
      return json({
        ...window,
        kind,
        total: totals[0]!.total,
        limit,
        offset,
        customers: list.map((r) => {
          const o = last.find((o) => o.customerId === r.id);
          return {
            ...r,
            lastOrderId: o?.id ?? null,
            lastValue: o?.total ?? null,
            products: lines.find((l) => l.orderId === o?.id)?.products ?? "",
          };
        }),
      });
    },
    "business",
  );

  router.get(
    "/customers/center/counts",
    async (c) => {
      const db = c.env.db,
        me = viewer(c),
        today = vietnamDate().iso,
        p = c.url.searchParams;
      const window = centerWindow(
          p.get("month") || today.slice(0, 7),
          today,
          p.has("days") ? Number(p.get("days")) : 180,
        ),
        h = history(db, me, window);
      const [opportunities, running] = await Promise.all([
        db
          .select({
            period:
              sql<number>`count(*) filter (where ${h.periodOrders} > 0)`.mapWith(
                Number,
              ),
            dormant:
              sql<number>`count(*) filter (where ${h.lastDate} <= ${window.cutoff})`.mapWith(
                Number,
              ),
          })
          .from(customers)
          .innerJoin(h, eq(h.customerId, customers.id))
          .where(and(approved, customerScope(db, me))),
        db
          .select({ total: count() })
          .from(campaigns)
          .where(
            and(
              eq(campaigns.status, "active"),
              sql`${campaigns.startDate} <= ${today} and ${campaigns.endDate} >= ${today}`,
              campaignScope(db, me),
            ),
          ),
      ]);
      return json({
        ...window,
        ...opportunities[0],
        campaigns: running[0]!.total,
      });
    },
    "business",
  );

  router.get(
    "/customers/center/campaigns",
    async (c) => {
      const db = c.env.db,
        me = viewer(c),
        { limit, offset } = paging(c.url, 20, 100);
      const where = and(
        campaignScope(db, me),
        matchAllWords(
          foldSql(campaigns.name, campaigns.note),
          c.url.searchParams.get("q"),
        ),
      );
      const [rows, totals] = await Promise.all([
        db
          .select()
          .from(campaigns)
          .where(where)
          .orderBy(desc(campaigns.createdAt), asc(campaigns.id))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(campaigns).where(where),
      ]);
      const ids = rows.map((r) => r.id);
      const progress = ids.length
        ? await db
            .select({
              id: targets.campaignId,
              assigned: count(),
              contacted: sql<number>`count(${customerActivities.id})`.mapWith(
                Number,
              ),
              completed:
                sql<number>`count(*) filter (where ${customerActivities.completion} = 'completed')`.mapWith(
                  Number,
                ),
            })
            .from(targets)
            .innerJoin(customers, eq(customers.id, targets.customerId))
            .innerJoin(campaigns, eq(campaigns.id, targets.campaignId))
            .leftJoin(
              customerActivities,
              and(
                eq(customerActivities.id, targets.activityId),
                eq(customerActivities.customerId, targets.customerId),
                eq(customerActivities.ownerId, targets.assigneeId),
                sql`to_char(${customerActivities.occurredAt}::timestamptz at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') between ${campaigns.startDate} and ${campaigns.endDate}`,
              ),
            )
            .where(and(inArray(targets.campaignId, ids), targetScope(db, me)))
            .groupBy(targets.campaignId)
        : [];
      return json({
        campaigns: rows.map((row) => ({
          ...row,
          progress: progress.find((p) => p.id === row.id) ?? {
            assigned: 0,
            contacted: 0,
            completed: 0,
          },
        })),
        total: totals[0]!.total,
        limit,
        offset,
        canManage: me.role === "manager",
      });
    },
    "business",
  );

  router.get(
    "/customers/center/campaigns/:id",
    async (c) => {
      const db = c.env.db,
        me = viewer(c),
        campaign = await campaignFor(db, me, c.params.id!),
        { limit, offset } = paging(c.url, 20, 100);
      const where = and(
        eq(targets.campaignId, campaign.id),
        targetScope(db, me),
        matchAllWords(
          foldSql(customers.name, customers.phone, customers.contact),
          c.url.searchParams.get("q"),
        ),
      );
      const [rows, totals] = await Promise.all([
        db
          .select({
            id: targets.id,
            customerId: customers.id,
            name: customers.name,
            phone: customers.phone,
            contact: customers.contact,
            assigneeId: targets.assigneeId,
            assigneeName: employees.name,
            revision: targets.revision,
            activityId: targets.activityId,
            completion: customerActivities.completion,
            content: customerActivities.content,
            occurredAt: customerActivities.occurredAt,
          })
          .from(targets)
          .innerJoin(customers, eq(customers.id, targets.customerId))
          .innerJoin(employees, eq(employees.id, targets.assigneeId))
          .leftJoin(
            customerActivities,
            and(
              eq(customerActivities.id, targets.activityId),
              eq(customerActivities.customerId, targets.customerId),
              eq(customerActivities.ownerId, targets.assigneeId),
              sql`to_char(${customerActivities.occurredAt}::timestamptz at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') between ${campaign.startDate} and ${campaign.endDate}`,
            ),
          )
          .where(where)
          .orderBy(asc(customers.name), asc(targets.id))
          .limit(limit)
          .offset(offset),
        db
          .select({ total: count() })
          .from(targets)
          .innerJoin(customers, eq(customers.id, targets.customerId))
          .where(where),
      ]);
      return json({
        campaign,
        targets: rows,
        total: totals[0]!.total,
        limit,
        offset,
        canManage: me.role === "manager",
      });
    },
    "business",
  );

  router.post(
    "/customers/center/campaigns",
    async (c) => {
      const db = c.env.db,
        me = viewer(c);
      manager(me);
      const body = await readJson(c.req),
        input = campaignInput(body),
        { ids, assigneeId } = targetInput(body);
      const result = await db.transaction(async (tx) => {
        await validateTargets(tx, ids, assigneeId);
        const now = new Date().toISOString(),
          id = crypto.randomUUID();
        const [campaign] = await tx
          .insert(campaigns)
          .values({
            ...input,
            id,
            createdBy: me.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        await tx.insert(targets).values(
          ids.map((customerId) => ({
            id: crypto.randomUUID(),
            campaignId: id,
            customerId,
            assigneeId,
            createdAt: now,
            updatedAt: now,
          })),
        );
        return campaign;
      });
      return json({ campaign: result }, 201);
    },
    "business",
  );

  router.put(
    "/customers/center/campaigns/:id",
    async (c) => {
      const db = c.env.db,
        me = viewer(c);
      manager(me);
      const body = await readJson(c.req);
      if (
        !CAMPAIGN_STATUSES.includes(
          body.status as (typeof CAMPAIGN_STATUSES)[number],
        )
      )
        throw new AppError(400, "Trạng thái không hợp lệ.");
      const [row] = await db
        .update(campaigns)
        .set({
          status: body.status as (typeof CAMPAIGN_STATUSES)[number],
          revision: sql`${campaigns.revision} + 1`,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(campaigns.id, c.params.id!),
            eq(campaigns.revision, Number(body.revision) || 0),
          ),
        )
        .returning();
      if (!row)
        throw new AppError(
          409,
          "Chiến dịch đã thay đổi hoặc không còn tồn tại. Hãy tải lại.",
        );
      return json({ campaign: row });
    },
    "business",
  );

  router.post(
    "/customers/center/campaigns/:id/targets",
    async (c) => {
      const db = c.env.db,
        me = viewer(c);
      manager(me);
      const body = await readJson(c.req),
        { ids, assigneeId } = targetInput(body);
      await db.transaction(async (tx) => {
        const [campaign] = await tx
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, c.params.id!))
          .for("update");
        if (!campaign) throw new AppError(404, "Không tìm thấy chiến dịch.");
        if (!["active", "draft"].includes(campaign.status))
          throw new AppError(409, "Chiến dịch đã kết thúc.");
        await validateTargets(tx, ids, assigneeId);
        const now = new Date().toISOString();
        await tx
          .insert(targets)
          .values(
            ids.map((customerId) => ({
              id: crypto.randomUUID(),
              campaignId: campaign.id,
              customerId,
              assigneeId,
              createdAt: now,
              updatedAt: now,
            })),
          )
          .onConflictDoNothing({
            target: [targets.campaignId, targets.customerId],
          });
      });
      return json({ ok: true });
    },
    "business",
  );

  router.put(
    "/customers/center/campaigns/:id/targets/:targetId/activity",
    async (c) => {
      const db = c.env.db,
        me = viewer(c),
        body = await readJson(c.req);
      // Both capabilities are required: customer-center visibility and existing care permission.
      if (!can(me, "page.care"))
        throw new AppError(403, "Chưa được cấp quyền chăm sóc.");
      const campaign = await campaignFor(db, me, c.params.id!);
      const result = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, campaign.id))
          .for("update");
        if (locked?.status !== "active")
          throw new AppError(
            409,
            "Chỉ ghi kết quả cho chiến dịch đang hoạt động.",
          );
        const [target] = await tx
          .select({ t: targets })
          .from(targets)
          .innerJoin(customers, eq(customers.id, targets.customerId))
          .where(
            and(
              eq(targets.id, c.params.targetId!),
              eq(targets.campaignId, campaign.id),
              targetScope(tx, me),
            ),
          )
          .for("update", { of: targets });
        if (!target)
          throw new AppError(
            404,
            "Không tìm thấy phân công trong phạm vi được xem.",
          );
        const [activity] = await tx
          .select()
          .from(customerActivities)
          .where(
            and(
              eq(customerActivities.id, String(body.activityId ?? "")),
              careScope(me),
            ),
          )
          .for("update");
        const day = activity
          ? new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Ho_Chi_Minh",
            }).format(new Date(activity.occurredAt))
          : "";
        if (
          !activity ||
          activity.customerId !== target.t.customerId ||
          activity.ownerId !== target.t.assigneeId ||
          day < locked.startDate ||
          day > locked.endDate
        )
          throw new AppError(
            400,
            "Chọn giao dịch thật của đúng khách, đúng nhân viên và trong thời gian chiến dịch.",
          );
        if (target.t.activityId === activity.id) return target.t; // retry after a lost response
        if (target.t.revision !== Number(body.revision))
          throw new AppError(409, "Phân công đã thay đổi. Hãy tải lại.");
        const [used] = await tx
          .select({ id: targets.id })
          .from(targets)
          .where(eq(targets.activityId, activity.id));
        if (used)
          throw new AppError(409, "Giao dịch đã được gắn với một chiến dịch.");
        const [row] = await tx
          .update(targets)
          .set({
            activityId: activity.id,
            revision: sql`${targets.revision} + 1`,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(targets.id, target.t.id))
          .returning();
        return row;
      });
      return json({ target: result });
    },
    "business",
  );
}
