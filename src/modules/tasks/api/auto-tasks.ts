import { and, eq, gte, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { quotations } from '../../quotes/schema.ts';
import { customerStockRequests } from '../../portal/schema.ts';
import { customers } from '../../customers/schema.ts';
import { customerPayments, deliveries, deliveryLines, paymentSchedules, salesContracts, salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { debtCounts, receivable, vietnamDate } from '../../sales/domain/sales.ts';
import { sapoInventoryDocs } from '../../integrations/schema.ts';
import { tasks } from '../schema.ts';
import { addDaysIso, isOpen, type TaskPriority, type TaskSource } from '../domain/task-config.ts';

/**
 * VIỆC TỰ SINH. Mỗi quy tắc đọc trạng thái hiện tại của nghiệp vụ và trả danh sách việc CẦN có lúc này.
 * `reconcileAutoTasks` so với bảng `tasks` (theo `auto_key`):
 *  - việc cần có mà chưa có → tạo;
 *  - việc tự sinh đang mở mà không còn cần (đã duyệt / đã trả lời / đã giao…) → tự hoàn thành;
 *  - việc đang mở: cập nhật người nhận / hạn / tiêu đề theo chứng từ (vd. đổi ngày giao).
 * Thêm nguồn việc mới = thêm một quy tắc vào RULES (và một khoá ở TASK_SOURCES nếu là nguồn mới).
 */
export interface AutoTask {
  autoKey: string; source: TaskSource; sourceId: string; title: string; description?: string; link: string;
  assigneeId: string | null; priority: TaskPriority; dueDate: string | null;
}
type Db = StaffEnv['db'];
type Rule = (db: Db, today: string) => Promise<AutoTask[]>;
const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : null);
const fmt = (iso: string | null) => iso ? iso.split('-').reverse().join('/') : '';
const vnd = (n: number) => new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';

export const RULES: Record<string, Rule> = {
  /** Báo giá chờ duyệt: khách gửi → nhân viên phụ trách duyệt; nhân viên lập → Manager duyệt (chưa giao người). */
  async quoteApproval(db) {
    const rows = await db.select({ id: quotations.id, quoteNo: quotations.quoteNo, customer: quotations.customer, assigneeId: quotations.assigneeId, createdAt: quotations.createdAt,
      creatorRole: employees.role, creatorName: employees.name }).from(quotations).innerJoin(employees, eq(employees.id, quotations.creatorId))
      .where(eq(quotations.approvalStatus, 'pending')).limit(500);
    return rows.map(q => q.creatorRole === 'customer'
      ? { autoKey: `quote-customer:${q.id}`, source: 'quote' as const, sourceId: q.id, title: `Duyệt báo giá khách gửi ${q.quoteNo}`, description: `${q.customer} gửi yêu cầu báo giá từ trang khách hàng.`,
        link: `#/quotes/${q.id}`, assigneeId: q.assigneeId, priority: 'high' as const, dueDate: addDaysIso(day(q.createdAt)!, 1) }
      : { autoKey: `quote-approve:${q.id}`, source: 'quote' as const, sourceId: q.id, title: `Duyệt báo giá ${q.quoteNo}`, description: `${q.creatorName} lập cho ${q.customer}, chờ Manager duyệt.`,
        link: `#/quotes/${q.id}`, assigneeId: null, priority: 'normal' as const, dueDate: addDaysIso(day(q.createdAt)!, 1) });
  },
  /** Khách gửi đơn check tồn → nhân viên phụ trách trả lời trong ngày. */
  async stockRequests(db) {
    const rows = await db.select({ r: customerStockRequests, customerName: customers.name }).from(customerStockRequests).innerJoin(customers, eq(customers.id, customerStockRequests.customerId))
      .where(eq(customerStockRequests.status, 'open')).limit(500);
    return rows.map(({ r, customerName }) => ({ autoKey: `stock:${r.id}`, source: 'stock_request' as const, sourceId: r.id, title: `Trả lời check tồn của ${customerName}`,
      description: `${(JSON.parse(r.items) as unknown[]).length} sản phẩm cần kiểm tra tồn kho.`, link: `#/stock-requests/${r.id}`, assigneeId: r.ownerId, priority: 'high' as const, dueDate: day(r.createdAt) }));
  },
  /** Đơn khách đặt chờ xác nhận. */
  async orderConfirm(db) {
    const rows = await db.select().from(salesOrders).where(eq(salesOrders.status, 'draft')).limit(500);
    return rows.map(o => ({ autoKey: `order-confirm:${o.id}`, source: 'order' as const, sourceId: o.id, title: `Xác nhận đơn ${o.orderNo} – ${o.customerName}`,
      description: `Đơn ${vnd(o.total)} chờ xác nhận.`, link: `#/orders/${o.id}`, assigneeId: o.ownerId, priority: 'urgent' as const, dueDate: addDaysIso(o.orderDate, 1) }));
  },
  /** Đơn đã xác nhận còn hàng chưa lên lịch giao. */
  async deliverySchedule(db) {
    const orders = await db.select().from(salesOrders).where(inArray(salesOrders.status, ['confirmed', 'delivering'])).limit(500);
    if (!orders.length) return [];
    const ids = orders.map(o => o.id);
    const [lines, pending] = await Promise.all([
      db.select({ orderId: salesOrderLines.orderId, qty: salesOrderLines.qty, delivered: salesOrderLines.deliveredQty }).from(salesOrderLines).where(inArray(salesOrderLines.orderId, ids)),
      db.select({ orderId: deliveries.orderId, qty: deliveryLines.qty }).from(deliveryLines).innerJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId))
        .where(and(inArray(deliveries.orderId, ids), inArray(deliveries.status, ['planned', 'in_transit']))),
    ]);
    return orders.filter(o => {
      const left = lines.filter(l => l.orderId === o.id).reduce((s, l) => s + l.qty - l.delivered, 0);
      return left - pending.filter(p => p.orderId === o.id).reduce((s, p) => s + p.qty, 0) > 1e-9;
    }).map(o => ({ autoKey: `delivery-plan:${o.id}`, source: 'delivery' as const, sourceId: o.id, title: `Lên lịch giao đơn ${o.orderNo} – ${o.customerName}`,
      description: o.expectedDeliveryDate ? `Khách cần hàng ngày ${fmt(o.expectedDeliveryDate)}.` : 'Đơn chưa có ngày giao dự kiến.', link: `#/orders/${o.id}`,
      assigneeId: o.ownerId, priority: 'normal' as const, dueDate: o.expectedDeliveryDate ? addDaysIso(o.expectedDeliveryDate, -1) : null }));
  },
  /** Chuyến giao đến ngày (hôm nay / ngày mai / đã trễ) chưa xong. */
  async deliveryRun(db, today) {
    const rows = await db.select({ d: deliveries, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, ownerId: salesOrders.ownerId }).from(deliveries)
      .innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
      .where(and(inArray(deliveries.status, ['planned', 'in_transit']), lte(deliveries.plannedDate, addDaysIso(today, 1)))).limit(500);
    return rows.map(({ d, orderNo, customerName, ownerId }) => ({ autoKey: `delivery-run:${d.id}`, source: 'delivery' as const, sourceId: d.orderId, title: `Giao hàng ${d.deliveryNo} – ${customerName}`,
      description: `Đơn ${orderNo}${d.timeSlot ? ' · ' + d.timeSlot : ''}${d.address ? ' · ' + d.address : ''}`, link: `#/orders/${d.orderId}`,
      assigneeId: d.assigneeId ?? ownerId, priority: d.plannedDate <= today ? 'high' as const : 'normal' as const, dueDate: d.plannedDate }));
  },
  /** HĐKT đã lập chưa ký. */
  async contractSign(db) {
    const rows = await db.select({ k: salesContracts, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, ownerId: salesOrders.ownerId, orderStatus: salesOrders.status })
      .from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId)).where(and(eq(salesContracts.status, 'draft'), ne(salesOrders.status, 'cancelled'))).limit(500);
    return rows.map(({ k, orderNo, customerName, ownerId }) => ({ autoKey: `contract-sign:${k.id}`, source: 'contract' as const, sourceId: k.orderId, title: `Ký HĐKT ${k.contractNo} – ${customerName}`,
      description: `Đơn ${orderNo}. Gửi hồ sơ HĐKT cho khách ký và đánh dấu đã ký.`, link: `#/orders/${k.orderId}`, assigneeId: ownerId, priority: 'normal' as const, dueDate: addDaysIso(day(k.createdAt)!, 3) }));
  },
  /** Công nợ quá hạn (đơn đã xác nhận / HĐKT đã ký). */
  async overdueDebt(db, today) {
    const schedules = await db.select().from(paymentSchedules).where(and(isNotNull(paymentSchedules.dueDate), sql`${paymentSchedules.dueDate} < ${today}`)).limit(2000);
    const ids = [...new Set(schedules.map(s => s.orderId))]; if (!ids.length) return [];
    const [orders, allSch, pays, ks] = await Promise.all([
      db.select().from(salesOrders).where(inArray(salesOrders.id, ids)),
      db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, ids)),
      db.select({ orderId: customerPayments.orderId, amount: customerPayments.amount }).from(customerPayments).where(inArray(customerPayments.orderId, ids)),
      db.select({ orderId: salesContracts.orderId, status: salesContracts.status }).from(salesContracts).where(inArray(salesContracts.orderId, ids)),
    ]);
    return orders.flatMap(o => {
      if (!debtCounts(o.status, ks.find(k => k.orderId === o.id)?.status)) return [];
      const r = receivable(allSch.filter(s => s.orderId === o.id), pays.filter(p => p.orderId === o.id), today);
      if (r.overdue <= 0) return [];
      const oldest = allSch.filter(s => s.orderId === o.id && s.dueDate && s.dueDate < today).map(s => s.dueDate!).sort()[0] ?? today;
      return [{ autoKey: `debt-overdue:${o.id}`, source: 'receivable' as const, sourceId: o.id, title: `Thu công nợ quá hạn ${o.orderNo} – ${o.customerName}`,
        description: `Quá hạn ${vnd(r.overdue)} (còn phải thu ${vnd(r.balance)}).`, link: `#/orders/${o.id}`, assigneeId: o.ownerId, priority: 'urgent' as const, dueDate: oldest }];
    });
  },
  /** Đơn nhập hàng Sapo (60 ngày gần đây) chưa hoàn tất → theo dõi nhận hàng (chưa giao người). */
  async purchaseReceive(db, today) {
    const rows = await db.select().from(sapoInventoryDocs).where(and(eq(sapoInventoryDocs.kind, 'purchase_order'), gte(sapoInventoryDocs.createdOn, addDaysIso(today, -60)))).limit(500);
    return rows.filter(d => !/(complet|finish|cancel|received|closed|hoàn|huỷ|hủy)/i.test(d.status)).map(d => ({ autoKey: `purchase:${d.id}`, source: 'purchase' as const, sourceId: d.id,
      title: `Nhận hàng nhập ${d.code}${d.partnerName ? ' – ' + d.partnerName : ''}`, description: `${new Intl.NumberFormat('vi-VN').format(d.totalQty)} sản phẩm${d.locationName ? ' · ' + d.locationName : ''}${d.status ? ' · Sapo: ' + d.status : ''}`,
      link: '', assigneeId: null, priority: 'normal' as const, dueDate: d.createdOn ? addDaysIso(day(d.createdOn)!, 7) : null }));
  },
};

/** Chạy mọi quy tắc rồi đồng bộ bảng `tasks`. Một quy tắc lỗi không chặn các quy tắc khác. */
export async function reconcileAutoTasks(db: Db, now = new Date()) {
  const today = vietnamDate(now).iso, stamp = now.toISOString();
  const wanted = new Map<string, AutoTask>();
  for (const [name, rule] of Object.entries(RULES)) {
    try { for (const t of await rule(db, today)) wanted.set(t.autoKey, t); } catch (e) { console.error('auto task rule failed', name, e instanceof Error ? e.message : e); }
  }
  const existing = await db.select({ id: tasks.id, autoKey: tasks.autoKey, status: tasks.status, assigneeId: tasks.assigneeId, dueDate: tasks.dueDate, title: tasks.title, description: tasks.description, priority: tasks.priority })
    .from(tasks).where(isNotNull(tasks.autoKey));
  const byKey = new Map(existing.map(t => [t.autoKey!, t]));
  const fresh = [...wanted.values()].filter(t => !byKey.has(t.autoKey));
  if (fresh.length) await db.insert(tasks).values(fresh.map(t => ({ id: crypto.randomUUID(), title: t.title, description: t.description ?? '', status: 'todo' as const, priority: t.priority, source: t.source,
    sourceId: t.sourceId, link: t.link, autoKey: t.autoKey, assigneeId: t.assigneeId, createdBy: null, dueDate: t.dueDate, createdAt: stamp, updatedAt: stamp }))).onConflictDoNothing();
  let closed = 0, updated = 0;
  for (const t of existing) {
    if (!isOpen(t.status)) continue;
    const w = wanted.get(t.autoKey!);
    if (!w) { await db.update(tasks).set({ status: 'done', completedAt: stamp, completedBy: null, updatedAt: stamp, revision: sql`${tasks.revision} + 1` }).where(eq(tasks.id, t.id)); closed++; continue; }
    // Mức ưu tiên chỉ đặt lúc tạo (nhân viên có thể nâng / hạ). Giữ người nhận đã được giao tay cho việc "chưa giao" (Manager tự phân công); còn lại theo chứng từ.
    const assigneeId = w.assigneeId ?? t.assigneeId;
    if (assigneeId !== t.assigneeId || w.dueDate !== t.dueDate || w.title !== t.title || (w.description ?? '') !== t.description) {
      await db.update(tasks).set({ assigneeId, dueDate: w.dueDate, title: w.title, description: w.description ?? '', updatedAt: stamp }).where(eq(tasks.id, t.id)); updated++;
    }
  }
  return { created: fresh.length, closed, updated };
}
