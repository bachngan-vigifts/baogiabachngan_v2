import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { canApprove } from '../modules/staff/domain/permissions.ts';
import type { Router } from '../core/http/router.ts';
import { json } from '../core/http/router.ts';
import type { SessionState, StaffEnv } from '../modules/staff/api/auth-routes.ts';
import { customers, customerStaff } from '../modules/customers/schema.ts';
import { quotations } from '../modules/quotes/schema.ts';
import { quotationPredicate } from '../modules/quotes/api/department-access.ts';
import { customerPayments, deliveries, packingSlips, paymentSchedules, salesContracts, salesOrders } from '../modules/sales/schema.ts';
import { isAccountant, orderScopeFor } from '../modules/sales/api/routes.ts';
import { isWarehouse } from '../modules/sales/api/packing-routes.ts';
import { vietnamDate } from '../modules/sales/domain/sales.ts';
import { customerStockRequests } from '../modules/portal/schema.ts';
import { customerActivities } from '../modules/care/schema.ts';
import { tasks } from '../modules/tasks/schema.ts';
import { OPEN_STATUSES } from '../modules/tasks/domain/task-config.ts';
import { listPurchases } from '../modules/suppliers/api/purchase-store.ts';

/**
 * SƠ ĐỒ QUY TRÌNH (trang #/flow) – API CHỈ ĐỌC, một lượt gọi trả số liệu + vài việc gần nhất cho mọi khối.
 *
 * Cấu trúc để dễ sửa:
 *  - Mỗi khối trên sơ đồ = một hàm trong `NODES` (khoá = id khối, trùng `trial-ui/flow-config.js`).
 *  - Mỗi hàm tự áp ĐÚNG quyền xem của trang tương ứng (dùng lại scope đã export của module) và trả
 *    `{ metrics, items }`, hoặc `null` khi vai trò này không thấy khối đó.
 *  - Nút thao tác trên từng việc: hàm chỉ trả TÊN thao tác (`actions: ['approve-quote']`) khi người xem được phép;
 *    cách gọi API của thao tác khai báo ở `ITEM_ACTIONS` trong `trial-ui/flow-config.js`. Máy chủ vẫn kiểm tra lại quyền khi thao tác.
 *  - Thêm khối mới: thêm hàm ở đây + khai báo khối trong `flow-config.js`. Không cần sửa phần vẽ.
 * Không gọi các handler có ghi dữ liệu (GET /packing đóng phiếu, GET /tasks sinh việc tự động).
 */
type Db = StaffEnv['db'];
type Member = SessionState['member'];
export type Tone = '' | 'ok' | 'warn' | 'danger';
export interface FlowMetric { key: string; label: string; value: number; tone?: Tone; money?: boolean }
export interface FlowItem { id: string; title: string; sub: string; badge?: string; tone?: Tone; hash: string; actions?: string[]; revision?: number }
export interface FlowNode { metrics: FlowMetric[]; items: FlowItem[] }
interface Ctx { db: Db; me: Member; manager: boolean; warehouse: boolean; accountant: boolean; today: string }

const ITEMS = 6;
const ex = (q: SQL) => sql`exists (${q})`, notEx = (q: SQL) => sql`not exists (${q})`;
const n = (v: unknown) => Number(v ?? 0);
const total = async (q: Promise<{ n: number }[]>) => n((await q)[0]?.n);
const ddmm = (iso: string | null | undefined) => iso ? iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '';
const orderHash = (orderId: string, hasContract: boolean) => (hasContract ? '#/contracts/' : '#/orders/') + encodeURIComponent(orderId);
const hasContract = ex(sql`select 1 from ${salesContracts} where ${salesContracts.orderId} = ${salesOrders.id}`);
/** Đơn còn tính công nợ (như `debtCounts`): không huỷ; nháp chỉ tính khi HĐKT đã ký / hoàn tất. */
const debtCounted = and(ne(salesOrders.status, 'cancelled'), or(ne(salesOrders.status, 'draft'),
  ex(sql`select 1 from ${salesContracts} where ${salesContracts.orderId} = ${salesOrders.id} and ${salesContracts.status} in ('signed', 'completed')`)));

const NODES: Record<string, (x: Ctx) => Promise<FlowNode | null>> = {
  // ------------------------------------------------ KHÁCH HÀNG
  async customers({ db, me, manager, warehouse }) {
    if (warehouse) return null;
    const pendingWhere = and(eq(customers.approvalStatus, 'pending'), canApprove(me) ? undefined : eq(customers.createdBy, me.id));
    const mine = ex(sql`select 1 from ${customerStaff} where ${customerStaff.customerId} = ${customers.id} and ${customerStaff.memberId} = ${me.id} and ${customerStaff.role} = 'owner'`);
    const [pending, owned, rows] = await Promise.all([
      total(db.select({ n: count() }).from(customers).where(pendingWhere)),
      total(db.select({ n: count() }).from(customers).where(mine)),
      db.select({ id: customers.id, name: customers.name, phone: customers.phone, status: customers.approvalStatus, createdAt: customers.createdAt }).from(customers)
        .where(or(pendingWhere, mine)).orderBy(sql`${customers.approvalStatus} = 'pending' desc`, desc(customers.createdAt)).limit(ITEMS),
    ]);
    return {
      metrics: [{ key: 'pending', label: manager ? 'Khách mới chờ duyệt' : 'Khách mình tạo chờ duyệt', value: pending, tone: pending ? 'warn' : '' }, { key: 'mine', label: 'Khách tôi phụ trách', value: owned }],
      items: rows.map(r => ({ id: r.id, title: r.name, sub: [r.phone, r.createdAt ? 'tạo ' + ddmm(r.createdAt) : ''].filter(Boolean).join(' · '),
        badge: r.status === 'pending' ? 'Chờ duyệt' : '', tone: r.status === 'pending' ? 'warn' as const : '' as const, hash: '#/customers/' + encodeURIComponent(r.id),
        actions: r.status === 'pending' && canApprove(me) ? ['approve-customer'] : [] })),
    };
  },

  async 'stock-requests'({ db, me, manager, warehouse }) {
    if (warehouse) return null;
    const where = and(eq(customerStockRequests.status, 'open'), manager ? undefined : eq(customerStockRequests.ownerId, me.id));
    const [open, rows] = await Promise.all([
      total(db.select({ n: count() }).from(customerStockRequests).where(where)),
      db.select({ id: customerStockRequests.id, customer: customers.name, items: customerStockRequests.items, createdAt: customerStockRequests.createdAt })
        .from(customerStockRequests).leftJoin(customers, eq(customers.id, customerStockRequests.customerId)).where(where).orderBy(asc(customerStockRequests.createdAt)).limit(ITEMS),
    ]);
    const lines = (raw: string) => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v.length : 0; } catch { return 0; } };
    return {
      metrics: [{ key: 'open', label: 'Khách hỏi tồn chưa trả lời', value: open, tone: open ? 'danger' : '' }],
      items: rows.map(r => ({ id: r.id, title: r.customer || 'Khách hàng', sub: `${lines(r.items)} mã · gửi ${ddmm(r.createdAt)}`, badge: 'Chưa trả lời', tone: 'danger' as const, hash: '#/stock-requests/' + encodeURIComponent(r.id) })),
    };
  },

  async care({ db, me, manager, warehouse, today }) {
    if (warehouse) return null;
    const due = and(manager ? undefined : eq(customerActivities.ownerId, me.id), isNotNull(customerActivities.nextAt), isNull(customerActivities.nextDoneAt));
    const [overdue, dueToday, rows] = await Promise.all([
      total(db.select({ n: count() }).from(customerActivities).where(and(due, lt(customerActivities.nextAt, today)))),
      total(db.select({ n: count() }).from(customerActivities).where(and(due, eq(customerActivities.nextAt, today)))),
      db.select({ id: customerActivities.id, customer: customers.name, nextAt: customerActivities.nextAt, nextAction: customerActivities.nextAction, ownerId: customerActivities.ownerId })
        .from(customerActivities).innerJoin(customers, eq(customers.id, customerActivities.customerId)).where(and(due, lte(customerActivities.nextAt, today)))
        .orderBy(asc(customerActivities.nextAt)).limit(ITEMS),
    ]);
    return {
      metrics: [{ key: 'overdue', label: 'Quá hạn chăm sóc', value: overdue, tone: overdue ? 'danger' : '' }, { key: 'today', label: 'Hẹn hôm nay', value: dueToday, tone: dueToday ? 'warn' : '' }],
      items: rows.map(r => ({ id: r.id, title: r.customer, sub: [r.nextAction, 'hẹn ' + ddmm(r.nextAt)].filter(Boolean).join(' · '),
        badge: r.nextAt! < today ? 'Quá hạn' : 'Hôm nay', tone: r.nextAt! < today ? 'danger' as const : 'warn' as const, hash: '#/care',
        actions: manager || r.ownerId === me.id ? ['care-done'] : [] })),
    };
  },

  // ------------------------------------------------ KINH DOANH
  async quotes({ db, me, manager, warehouse }) {
    if (warehouse) return null;
    const scope = quotationPredicate(me);
    const noOrder = notEx(sql`select 1 from ${salesOrders} where ${salesOrders.quoteId} = ${quotations.id} and ${salesOrders.status} <> 'cancelled'`);
    const pendingW = and(scope, eq(quotations.approvalStatus, 'pending')), readyW = and(scope, eq(quotations.approvalStatus, 'approved'), noOrder);
    const cols = { id: quotations.id, quoteNo: quotations.quoteNo, customer: quotations.customer, status: quotations.approvalStatus, revision: quotations.revision, updatedAt: quotations.updatedAt };
    const [pending, ready, pRows, rRows] = await Promise.all([
      total(db.select({ n: count() }).from(quotations).where(pendingW)),
      total(db.select({ n: count() }).from(quotations).where(readyW)),
      db.select(cols).from(quotations).where(pendingW).orderBy(asc(quotations.updatedAt)).limit(ITEMS),
      db.select(cols).from(quotations).where(readyW).orderBy(desc(quotations.updatedAt)).limit(ITEMS),
    ]);
    return {
      metrics: [{ key: 'pending', label: 'Báo giá chờ duyệt', value: pending, tone: pending ? 'warn' : '' }, { key: 'ready', label: 'Đã duyệt, chưa sinh đơn', value: ready, tone: ready ? 'ok' : '' }],
      items: [...pRows, ...rRows].slice(0, ITEMS).map(r => ({ id: r.id, title: r.quoteNo, sub: r.customer, revision: r.revision,
        badge: r.status === 'pending' ? 'Chờ duyệt' : 'Chưa sinh đơn', tone: r.status === 'pending' ? 'warn' as const : 'ok' as const, hash: '#/quotes/' + encodeURIComponent(r.id),
        actions: r.status === 'pending' && canApprove(me) ? ['approve-quote'] : r.status === 'approved' ? ['make-order'] : [] })),
    };
  },

  async orders(x) { return salesDocs(x, false); },
  async contracts(x) { return salesDocs(x, true); },

  // ------------------------------------------------ MUA HÀNG (đơn mua NCC, cùng phạm vi xem với trang #/purchases)
  async purchase({ db, me, today }) {
    const rows = await listPurchases(db, me, { openOnly: true, limit: 500 }, today);
    const has = (f: (r: typeof rows[number]) => boolean) => rows.filter(f);
    const draft = has(r => r.state === 'draft' && r.submitted), waiting = has(r => r.state === 'awaiting_confirmation'), late = has(r => r.late);
    const receive = has(r => (r.state === 'confirmed' || r.state === 'partially_received') && !r.late), sapo = has(r => r.sapoPending > 0);
    const tag = (r: typeof rows[number]): [string, Tone] => r.late ? ['Quá hẹn', 'danger'] : r.sapoPending ? ['Chờ nhập Sapo', 'warn'] : r.state === 'draft' ? (r.submitted ? ['Chờ duyệt', 'warn'] : ['Nháp', '']) 
      : r.state === 'awaiting_confirmation' ? ['Chờ NCC xác nhận', ''] : ['Chờ nhận', 'ok'];
    const queue = [...late, ...sapo, ...draft, ...waiting, ...receive].filter((r, i, all) => all.findIndex(x => x.id === r.id) === i);
    return {
      metrics: [
        { key: 'draft', label: 'Chờ duyệt', value: draft.length, tone: draft.length ? 'warn' : '' },
        { key: 'confirm', label: 'Chờ NCC xác nhận', value: waiting.length },
        { key: 'late', label: 'Quá hẹn', value: late.length, tone: late.length ? 'danger' : '' },
        { key: 'receive', label: 'Chờ nhận hàng', value: receive.length, tone: receive.length ? 'ok' : '' },
        { key: 'sapo', label: 'Chờ nhập Sapo', value: sapo.length, tone: sapo.length ? 'warn' : '' },
      ],
      items: queue.slice(0, ITEMS).map(r => { const [badge, tone] = tag(r); return { id: r.id, title: r.ticketNumber, sub: `${r.supplierName ?? ''}${r.arrivalDate ? ' · hẹn ' + ddmm(r.arrivalDate) : ''}`,
        badge, tone, hash: '#/purchases/' + encodeURIComponent(r.id) }; }),
    };
  },

  // ------------------------------------------------ KHO HÀNG
  async packing({ db, me, manager, warehouse, today }) {
    const scope = manager || warehouse ? undefined : orderScopeFor(me);
    const base = (status: 'draft' | 'sent' | 'packed') => and(eq(packingSlips.status, status), scope);
    const q = (w: SQL | undefined) => db.select({ n: count() }).from(packingSlips).innerJoin(salesOrders, eq(salesOrders.id, packingSlips.orderId)).where(w);
    const [draft, sent, packedToday, rows] = await Promise.all([
      total(q(base('draft'))), total(q(base('sent'))),
      total(q(and(base('packed'), sql`${packingSlips.packedAt}::timestamptz >= ${today + 'T00:00:00+07:00'}::timestamptz`))),
      db.select({ id: packingSlips.id, slipNo: packingSlips.slipNo, customer: salesOrders.customerName, status: packingSlips.status, due: salesOrders.expectedDeliveryDate })
        .from(packingSlips).innerJoin(salesOrders, eq(salesOrders.id, packingSlips.orderId)).where(and(inArray(packingSlips.status, ['sent', 'draft']), scope))
        .orderBy(sql`${packingSlips.status} = 'sent' desc`, sql`${salesOrders.expectedDeliveryDate} asc nulls last`).limit(ITEMS),
    ]);
    return {
      metrics: [{ key: 'sent', label: 'Chờ kho đóng gói', value: sent, tone: sent ? 'warn' : '' }, { key: 'draft', label: 'Phiếu nháp chưa gửi kho', value: draft }, { key: 'packed', label: 'Đã đóng hôm nay', value: packedToday, tone: packedToday ? 'ok' : '' }],
      items: rows.map(r => ({ id: r.id, title: r.slipNo, sub: [r.customer, r.due ? 'giao ' + ddmm(r.due) : ''].filter(Boolean).join(' · '),
        badge: r.status === 'sent' ? 'Chờ đóng' : 'Nháp', tone: r.status === 'sent' ? 'warn' as const : '' as const, hash: '#/packing/' + encodeURIComponent(r.id) })),
    };
  },

  // ------------------------------------------------ GIAO HÀNG
  async deliveries({ db, me, warehouse, today }) {
    const scope = warehouse ? undefined : orderScopeFor(me);
    const active = and(inArray(deliveries.status, ['planned', 'in_transit']), scope);
    const q = (w: SQL | undefined) => db.select({ n: count() }).from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).where(w);
    const [late, dueToday, moving, rows] = await Promise.all([
      total(q(and(active, lt(deliveries.plannedDate, today)))),
      total(q(and(active, eq(deliveries.plannedDate, today)))),
      total(q(and(eq(deliveries.status, 'in_transit'), scope))),
      db.select({ id: deliveries.id, no: deliveries.deliveryNo, customer: salesOrders.customerName, date: deliveries.plannedDate, slot: deliveries.timeSlot, status: deliveries.status })
        .from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).where(and(active, lte(deliveries.plannedDate, today)))
        .orderBy(asc(deliveries.plannedDate), asc(deliveries.timeSlot)).limit(ITEMS),
    ]);
    return {
      metrics: [{ key: 'late', label: 'Trễ lịch giao', value: late, tone: late ? 'danger' : '' }, { key: 'today', label: 'Giao hôm nay', value: dueToday, tone: dueToday ? 'warn' : '' }, { key: 'moving', label: 'Đang trên đường', value: moving }],
      items: rows.map(r => ({ id: r.id, title: r.customer, sub: [r.no, ddmm(r.date), r.slot].filter(Boolean).join(' · '),
        badge: r.status === 'in_transit' ? 'Đang giao' : r.date < today ? 'Trễ' : 'Hôm nay', tone: r.date < today ? 'danger' as const : 'warn' as const, hash: '#/deliveries',
        actions: r.status === 'planned' ? ['ship-start', 'ship-done'] : ['ship-done'] })),
    };
  },

  // ------------------------------------------------ KẾ TOÁN
  async invoices({ db, me, warehouse }) {
    if (warehouse) return null;
    const scope = orderScopeFor(me);
    const requested = and(eq(salesOrders.invoiceStatus, 'requested'), scope);
    const notAsked = and(eq(salesOrders.status, 'delivered'), eq(salesOrders.invoiceStatus, 'none'), scope);
    const [req, none, rows] = await Promise.all([
      total(db.select({ n: count() }).from(salesOrders).where(requested)),
      total(db.select({ n: count() }).from(salesOrders).where(notAsked)),
      db.select({ id: salesOrders.id, no: salesOrders.orderNo, customer: salesOrders.customerName, at: salesOrders.invoiceRequestedAt, contract: sql<boolean>`${hasContract}` })
        .from(salesOrders).where(requested).orderBy(asc(salesOrders.invoiceRequestedAt)).limit(ITEMS),
    ]);
    return {
      metrics: [{ key: 'requested', label: 'Chờ xuất hoá đơn', value: req, tone: req ? 'warn' : '' }, { key: 'none', label: 'Đã giao, chưa yêu cầu HĐ', value: none, tone: none ? 'danger' : '' }],
      items: rows.map(r => ({ id: r.id, title: r.customer, sub: [r.no, r.at ? 'yêu cầu ' + ddmm(r.at) : ''].filter(Boolean).join(' · '), badge: 'Chờ xuất HĐ', tone: 'warn' as const, hash: orderHash(r.id, !!r.contract) })),
    };
  },

  async receivables({ db, me, warehouse, today }) {
    if (warehouse) return null;
    // Thu tiền áp vào kỳ đến hạn sớm nhất trước (như `receivable`): quá hạn = phần đến hạn trước hôm nay chưa thu đủ.
    const dueBefore = sql<number>`coalesce((select sum(${paymentSchedules.amount}) from ${paymentSchedules} where ${paymentSchedules.orderId} = ${salesOrders.id} and ${paymentSchedules.dueDate} < ${today}), 0)`;
    const scheduled = sql<number>`coalesce((select sum(${paymentSchedules.amount}) from ${paymentSchedules} where ${paymentSchedules.orderId} = ${salesOrders.id}), 0)`;
    const paid = sql<number>`coalesce((select sum(${customerPayments.amount}) from ${customerPayments} where ${customerPayments.orderId} = ${salesOrders.id} and ${customerPayments.voidedAt} is null), 0)`;
    const rows = await db.select({ id: salesOrders.id, no: salesOrders.orderNo, customer: salesOrders.customerName, contract: sql<boolean>`${hasContract}`,
      overdue: sql<number>`greatest(${dueBefore} - ${paid}, 0)`.mapWith(Number), balance: sql<number>`greatest(${scheduled} - ${paid}, 0)`.mapWith(Number) })
      .from(salesOrders).where(and(debtCounted, orderScopeFor(me), sql`${scheduled} > ${paid}`));
    const late = rows.filter(r => r.overdue > 0).sort((a, b) => b.overdue - a.overdue);
    return {
      metrics: [{ key: 'overdueCount', label: 'Đơn quá hạn thu', value: late.length, tone: late.length ? 'danger' : '' },
        { key: 'overdue', label: 'Tiền quá hạn', value: late.reduce((s, r) => s + r.overdue, 0), tone: late.length ? 'danger' : '', money: true },
        { key: 'balance', label: 'Còn phải thu', value: rows.reduce((s, r) => s + r.balance, 0), money: true }],
      items: late.slice(0, ITEMS).map(r => ({ id: r.id, title: r.customer, sub: r.no, badge: 'Quá hạn ' + new Intl.NumberFormat('vi-VN').format(Math.round(r.overdue)) + ' đ', tone: 'danger' as const, hash: orderHash(r.id, !!r.contract) })),
    };
  },
};

/** Đơn hàng (luồng đơn, không HĐKT) hoặc HĐKT. */
async function salesDocs({ db, me, manager, warehouse }: Ctx, contract: boolean): Promise<FlowNode | null> {
  if (warehouse) return null;
  const scope = and(orderScopeFor(me), contract ? hasContract : sql`not ${hasContract}`);
  const q = (w: SQL | undefined) => total(db.select({ n: count() }).from(salesOrders).where(w));
  const unsigned = ex(sql`select 1 from ${salesContracts} where ${salesContracts.orderId} = ${salesOrders.id} and ${salesContracts.status} = 'draft'`);
  const [draft, confirmed, delivering, unsignedN, rows] = await Promise.all([
    // Manager chỉ đếm đơn nhân viên đã bấm "Gửi duyệt"; nhân viên đếm mọi đơn nháp của mình.
    q(and(scope, eq(salesOrders.status, 'draft'), manager ? isNotNull(salesOrders.submittedAt) : undefined)), q(and(scope, eq(salesOrders.status, 'confirmed'))), q(and(scope, eq(salesOrders.status, 'delivering'))),
    contract ? q(and(scope, ne(salesOrders.status, 'cancelled'), ne(salesOrders.status, 'draft'), unsigned)) : Promise.resolve(0),
    // Danh sách khớp số đếm: Manager không thấy đơn nháp nhân viên chưa gửi duyệt.
    db.select({ id: salesOrders.id, no: salesOrders.orderNo, customer: salesOrders.customerName, status: salesOrders.status, due: salesOrders.expectedDeliveryDate, submittedAt: salesOrders.submittedAt,
      contractNo: sql<string | null>`(select ${salesContracts.contractNo} from ${salesContracts} where ${salesContracts.orderId} = ${salesOrders.id} limit 1)` })
      .from(salesOrders).where(and(scope, manager ? or(eq(salesOrders.status, 'confirmed'), and(eq(salesOrders.status, 'draft'), isNotNull(salesOrders.submittedAt)))
        : inArray(salesOrders.status, ['draft', 'confirmed'])))
      .orderBy(sql`${salesOrders.status} = 'draft' desc`, sql`${salesOrders.expectedDeliveryDate} asc nulls last`).limit(ITEMS),
  ]);
  const metrics: FlowMetric[] = [{ key: 'draft', label: manager ? 'Chờ Manager duyệt' : 'Nháp – chờ duyệt', value: draft, tone: draft ? 'warn' : '' },
    { key: 'confirmed', label: 'Đã duyệt – chờ giao', value: confirmed, tone: confirmed ? 'ok' : '' }, { key: 'delivering', label: 'Đang giao', value: delivering }];
  if (contract) metrics.push({ key: 'unsigned', label: 'Đã duyệt, chưa ký HĐ', value: unsignedN, tone: unsignedN ? 'warn' : '' });
  return {
    metrics,
    items: rows.map(r => ({ id: r.id, title: r.customer, sub: [r.contractNo || r.no, r.due ? 'giao ' + ddmm(r.due) : ''].filter(Boolean).join(' · '),
      badge: r.status === 'draft' ? (r.submittedAt ? 'Chờ duyệt' : 'Nháp') : 'Chờ giao', tone: r.status === 'draft' ? 'warn' as const : 'ok' as const, hash: orderHash(r.id, contract) })),
  };
}

export const FLOW_NODE_IDS = Object.keys(NODES);

export function registerFlowRoutes(router: Router<StaffEnv>) {
  /** `GET /flow`: số liệu + việc gần nhất của mọi khối người xem được thấy (khối không được thấy trả `null`). */
  router.get('/flow', async c => {
    const me = (c.state.session as SessionState).member;
    const x: Ctx = { db: c.env.db, me, manager: me.role === 'manager', warehouse: isWarehouse(me), accountant: isAccountant(me), today: vietnamDate().iso };
    // Một khối lỗi (vd. thiếu bảng khi chưa chạy migration) không làm trắng cả sơ đồ: khối đó hiện rỗng.
    const entries = await Promise.all(FLOW_NODE_IDS.map(async id => {
      try { return [id, await NODES[id]!(x)] as const; }
      catch (e) { console.error('flow node failed', id, e instanceof Error ? e.message : e); return [id, { metrics: [], items: [], error: 'Không tải được số liệu khối này.' }] as const; }
    }));
    return json({ today: x.today, role: { manager: x.manager, warehouse: x.warehouse, accountant: x.accountant }, nodes: Object.fromEntries(entries) });
  }, 'business');
}
