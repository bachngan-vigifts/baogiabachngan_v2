import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { quotations } from '../../quotes/schema.ts';
import { customerStockRequests } from '../../portal/schema.ts';
import { customers } from '../../customers/schema.ts';
import { customerPayments, deliveries, deliveryLines, packingSlipLines, packingSlips, paymentSchedules, salesContracts, salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { PACKING_SOURCE_LABEL } from '../../sales/domain/packing.ts';
import { docRef } from '../../sales/domain/doc-ref.ts';
import { progressOf } from '../../sales/api/progress.ts';
import { debtCounts, receivable, vietnamDate } from '../../sales/domain/sales.ts';
import { sapoInventoryDocs } from '../../integrations/schema.ts';
import { tasks } from '../schema.ts';
import { openPurchases } from '../../suppliers/api/purchase-store.ts';
import { dueFollowUps } from '../../care/api/routes.ts';
import { CARE_TYPE_LABEL } from '../../care/domain/care.ts';
import { addDaysIso, isOpen, type TaskPriority, type TaskSource } from '../domain/task-config.ts';
/** Số HĐKT theo bản ghi (bản ghi có HĐKT hiện là HĐKT, không phải đơn hàng). */
async function contractNoMap(db: StaffEnv['db'], orderIds: string[]) {
  const rows = orderIds.length ? await db.select({ orderId: salesContracts.orderId, no: salesContracts.contractNo }).from(salesContracts).where(inArray(salesContracts.orderId, orderIds)) : [];
  return new Map(rows.map(r => [r.orderId, r.no]));
}

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
  /** Giao cho nhóm (id chức vụ, vd. 'warehouse') khi không có người nhận cụ thể. */
  assigneePosition?: string | null;
}
type Db = StaffEnv['db'];
type Rule = (db: Db, today: string) => Promise<AutoTask[]>;
const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : null);
const fmt = (iso: string | null) => iso ? iso.split('-').reverse().join('/') : '';
const vnd = (n: number) => new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';

export const RULES: Record<string, Rule> = {
  /**
   * Hẹn chăm sóc khách (nhật ký chăm sóc) tới mốc "nhắc tôi trước" (1 ngày / 1 tuần / 1 tháng trước ngày hẹn) → việc cho nhân viên phụ trách. Khoá gồm ngày hẹn: dời hẹn = việc mới;
   * bấm "Đã chăm sóc" ở trang Chăm sóc KH → việc tự hoàn thành.
   */
  async careFollowUps(db, today) {
    const rows = await dueFollowUps(db, today);
    return rows.map(r => ({ autoKey: `care:${r.id}:${r.nextAt}`, source: 'care' as const, sourceId: r.id,
      title: `Chăm sóc lại ${r.customerName}${r.contactName ? ' – ' + r.contactName : ''}`.slice(0, 200),
      description: `Lần trước (${CARE_TYPE_LABEL[r.type].toLowerCase()}): ${(r.nextAction || r.content || r.subject).slice(0, 300)}`,
      link: `#/care/${r.id}`, assigneeId: r.ownerId, priority: r.nextAt! < today ? 'high' as const : 'normal' as const, dueDate: r.nextAt }));
  },
  /** Báo giá chờ duyệt (khách gửi hoặc nhân viên lập): việc chưa giao người – Manager / người được duyệt duyệt (người phụ trách có thông báo riêng). */
  async quoteApproval(db) {
    const rows = await db.select({ id: quotations.id, quoteNo: quotations.quoteNo, customer: quotations.customer, assigneeId: quotations.assigneeId, createdAt: quotations.createdAt,
      creatorRole: employees.role, creatorName: employees.name }).from(quotations).innerJoin(employees, eq(employees.id, quotations.creatorId))
      .where(eq(quotations.approvalStatus, 'pending')).limit(500);
    return rows.map(q => q.creatorRole === 'customer'
      ? { autoKey: `quote-customer:${q.id}`, source: 'quote' as const, sourceId: q.id, title: `Duyệt báo giá khách gửi ${q.quoteNo}`, description: `${q.customer} gửi yêu cầu báo giá từ trang khách hàng.`,
        link: `#/quotes/${q.id}`, assigneeId: null, priority: 'high' as const, dueDate: addDaysIso(day(q.createdAt)!, 1) }
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
  /** Đơn / HĐKT nháp (nhân viên, Manager hay khách tạo) chờ Manager duyệt – việc chưa giao người: Manager thấy và duyệt. */
  async orderConfirm(db) {
    const rows = await db.select({ o: salesOrders, contractNo: salesContracts.contractNo }).from(salesOrders).leftJoin(salesContracts, eq(salesContracts.orderId, salesOrders.id))
      .where(and(eq(salesOrders.status, 'draft'), isNotNull(salesOrders.submittedAt))).limit(500); // nháp chưa gửi duyệt: chưa giao việc cho Manager
    return rows.map(({ o, contractNo }) => { const ref = docRef(o.id, o.orderNo, contractNo);
      return { autoKey: `order-confirm:${o.id}`, source: (contractNo ? 'contract' : 'order') as 'contract' | 'order', sourceId: o.id, title: `Duyệt ${ref.label} – ${o.customerName}`,
        description: `${contractNo ? 'HĐKT' : 'Đơn'} ${vnd(o.total)} chờ Manager duyệt.`, link: ref.link, assigneeId: null, priority: 'urgent' as const, dueDate: addDaysIso(o.orderDate, 1) }; });
  },
  /** Đơn đã xác nhận còn hàng chưa lên lịch giao. */
  async deliverySchedule(db) {
    const orders = await db.select().from(salesOrders).where(inArray(salesOrders.status, ['confirmed', 'delivering'])).limit(500);
    if (!orders.length) return [];
    const ids = orders.map(o => o.id), kNo = await contractNoMap(db, ids);
    const [lines, pending] = await Promise.all([
      db.select({ orderId: salesOrderLines.orderId, qty: salesOrderLines.qty, delivered: salesOrderLines.deliveredQty }).from(salesOrderLines).where(inArray(salesOrderLines.orderId, ids)),
      db.select({ orderId: deliveries.orderId, qty: deliveryLines.qty }).from(deliveryLines).innerJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId))
        .where(and(inArray(deliveries.orderId, ids), inArray(deliveries.status, ['planned', 'in_transit']))),
    ]);
    return orders.filter(o => {
      const left = lines.filter(l => l.orderId === o.id).reduce((s, l) => s + l.qty - l.delivered, 0);
      return left - pending.filter(p => p.orderId === o.id).reduce((s, p) => s + p.qty, 0) > 1e-9;
    }).map(o => { const ref = docRef(o.id, o.orderNo, kNo.get(o.id)); return { autoKey: `delivery-plan:${o.id}`, source: 'delivery' as const, sourceId: o.id, title: `Lên lịch giao ${ref.label} – ${o.customerName}`,
      description: o.expectedDeliveryDate ? `Khách cần hàng ngày ${fmt(o.expectedDeliveryDate)}.` : `${ref.kind === 'contract' ? 'HĐKT' : 'Đơn'} chưa có ngày giao dự kiến.`, link: ref.link,
      assigneeId: o.ownerId, priority: 'normal' as const, dueDate: o.expectedDeliveryDate ? addDaysIso(o.expectedDeliveryDate, -1) : null }; });
  },
  /** Chuyến giao đến ngày (hôm nay / ngày mai / đã trễ) chưa xong. */
  async deliveryRun(db, today) {
    const rows = await db.select({ d: deliveries, orderNo: salesOrders.orderNo, contractNo: salesContracts.contractNo, customerName: salesOrders.customerName, ownerId: salesOrders.ownerId }).from(deliveries)
      .innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).leftJoin(salesContracts, eq(salesContracts.orderId, deliveries.orderId))
      .where(and(inArray(deliveries.status, ['planned', 'in_transit']), lte(deliveries.plannedDate, addDaysIso(today, 1)))).limit(500);
    return rows.map(({ d, orderNo, contractNo, customerName, ownerId }) => ({ autoKey: `delivery-run:${d.id}`, source: 'delivery' as const, sourceId: d.orderId, title: `Giao hàng ${d.deliveryNo} – ${customerName}`,
      description: `${docRef(d.orderId, orderNo, contractNo).Label}${d.timeSlot ? ' · ' + d.timeSlot : ''}${d.address ? ' · ' + d.address : ''}`, link: docRef(d.orderId, orderNo, contractNo).link,
      assigneeId: d.assigneeId ?? ownerId, priority: d.plannedDate <= today ? 'high' as const : 'normal' as const, dueDate: d.plannedDate }));
  },
  /** HĐKT đã lập chưa ký. */
  async contractSign(db) {
    const rows = await db.select({ k: salesContracts, customerName: salesOrders.customerName, ownerId: salesOrders.ownerId, orderStatus: salesOrders.status })
      .from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId)).where(and(eq(salesContracts.status, 'draft'), ne(salesOrders.status, 'cancelled'))).limit(500);
    return rows.map(({ k, customerName, ownerId }) => ({ autoKey: `contract-sign:${k.id}`, source: 'contract' as const, sourceId: k.orderId, title: `Ký HĐKT ${k.contractNo} – ${customerName}`,
      description: 'Gửi hồ sơ HĐKT cho khách ký; khách ký xong báo Manager đánh dấu "Đã ký".', link: `#/contracts/${k.orderId}`, assigneeId: ownerId, priority: 'normal' as const, dueDate: addDaysIso(day(k.createdAt)!, 3) }));
  },
  /** Công nợ quá hạn (đơn đã xác nhận / HĐKT đã ký). */
  async overdueDebt(db, today) {
    // Chỉ đơn còn nợ (tổng kỳ > đã thu, không tính phiếu huỷ) có kỳ đã quá hạn – lọc trong SQL, không cắt cụt theo số dòng.
    const due = sql`(SELECT coalesce(sum(s2.amount), 0) FROM ${paymentSchedules} s2 WHERE s2.order_id = ${paymentSchedules.orderId})`;
    const paid = sql`(SELECT coalesce(sum(p.amount), 0) FROM ${customerPayments} p WHERE p.order_id = ${paymentSchedules.orderId} AND p.voided_at IS NULL)`;
    const ids = (await db.selectDistinct({ id: paymentSchedules.orderId }).from(paymentSchedules)
      .where(and(isNotNull(paymentSchedules.dueDate), sql`${paymentSchedules.dueDate} < ${today}`, sql`${due} > ${paid}`))).map(r => r.id);
    if (!ids.length) return [];
    const [orders, allSch, pays, ks] = await Promise.all([
      db.select().from(salesOrders).where(inArray(salesOrders.id, ids)),
      db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, ids)),
      db.select({ orderId: customerPayments.orderId, amount: customerPayments.amount }).from(customerPayments).where(and(inArray(customerPayments.orderId, ids), isNull(customerPayments.voidedAt))),
      db.select({ orderId: salesContracts.orderId, status: salesContracts.status, no: salesContracts.contractNo }).from(salesContracts).where(inArray(salesContracts.orderId, ids)),
    ]);
    return orders.flatMap(o => {
      if (!debtCounts(o.status, ks.find(k => k.orderId === o.id)?.status)) return [];
      const r = receivable(allSch.filter(s => s.orderId === o.id), pays.filter(p => p.orderId === o.id), today);
      if (r.overdue <= 0) return [];
      const oldest = allSch.filter(s => s.orderId === o.id && s.dueDate && s.dueDate < today).map(s => s.dueDate!).sort()[0] ?? today;
      const ref = docRef(o.id, o.orderNo, ks.find(k => k.orderId === o.id)?.no);
      return [{ autoKey: `debt-overdue:${o.id}`, source: 'receivable' as const, sourceId: o.id, title: `Thu công nợ quá hạn ${ref.label} – ${o.customerName}`,
        description: `Quá hạn ${vnd(r.overdue)} (còn phải thu ${vnd(r.balance)}).`, link: ref.link, assigneeId: o.ownerId, priority: 'urgent' as const, dueDate: oldest },
      // Nhóm Kế toán theo dõi song song (đối chiếu tiền về, nhắc người phụ trách) – tự đóng khi khách trả hết phần quá hạn.
      { autoKey: `debt-overdue-acc:${o.id}`, source: 'receivable' as const, sourceId: o.id, title: `Theo dõi nợ quá hạn ${ref.label} – ${o.customerName}`,
        description: `Quá hạn ${vnd(r.overdue)} (còn phải thu ${vnd(r.balance)}). Đối chiếu tiền về và nhắc người phụ trách thu.`, link: ref.link,
        assigneeId: null, assigneePosition: 'accounting', priority: 'high' as const, dueDate: oldest }];
    });
  },
  /** Đơn nhập hàng Sapo (60 ngày gần đây) chưa hoàn tất → theo dõi nhận hàng (chưa giao người). */
  async purchaseReceive(db, today) {
    const rows = await db.select().from(sapoInventoryDocs).where(and(eq(sapoInventoryDocs.kind, 'purchase_order'), gte(sapoInventoryDocs.createdOn, addDaysIso(today, -60)))).limit(500);
    return rows.filter(d => !/(complet|finish|cancel|received|closed|hoàn|huỷ|hủy)/i.test(d.status)).map(d => ({ autoKey: `purchase:${d.id}`, source: 'purchase' as const, sourceId: d.id,
      title: `Nhận hàng nhập ${d.code}${d.partnerName ? ' – ' + d.partnerName : ''}`, description: `${new Intl.NumberFormat('vi-VN').format(d.totalQty)} sản phẩm${d.locationName ? ' · ' + d.locationName : ''}${d.status ? ' · Sapo: ' + d.status : ''}`,
      link: '', assigneeId: null, assigneePosition: 'warehouse', priority: 'normal' as const, dueDate: d.createdOn ? addDaysIso(day(d.createdOn)!, 7) : null }));
  },
  /**
   * Đơn mua NCC (trang #/purchases): chờ Manager duyệt → chờ NCC xác nhận (Manager ghi nhận thay) → kho nhận khi tới hẹn → kho nhập Sapo
   * → Kế toán trả NCC khi tới kỳ (≤ 3 ngày). Quá hẹn giao mà chưa nhận đủ → người lập đơn theo dõi NCC. Mỗi bước xong thì việc tự hoàn thành.
   */
  async supplierPurchases(db, today) {
    const out: AutoTask[] = [];
    for (const p of await openPurchases(db, today)) {
      const base = { source: 'purchase' as const, sourceId: p.id, link: `#/purchases/${p.id}` }, who = `${p.ticketNumber} – ${p.supplierName ?? ''}`;
      // Nháp chưa gửi duyệt không giao việc cho Manager.
      if (p.state === 'draft' && p.submitted) out.push({ ...base, autoKey: `po-approve:${p.id}`, title: `Duyệt đơn mua ${who}`, description: `${p.lineCount} mã · ${new Intl.NumberFormat('vi-VN').format(p.ordered)} sản phẩm. Nhập giá mua / chiết khấu / lịch trả rồi duyệt.`,
        assigneeId: null, priority: 'high', dueDate: addDaysIso(day(p.createdAt)!, 1) });
      if (p.state === 'awaiting_confirmation') out.push({ ...base, autoKey: `po-confirm:${p.id}`, title: `Chờ NCC xác nhận ${who}`, description: 'Gửi PDF đơn mua cho NCC; NCC xác nhận qua điện thoại / email thì Manager bấm "Ghi nhận NCC xác nhận" kèm ngày hẹn.',
        assigneeId: null, priority: 'normal', dueDate: p.approvedAt ? addDaysIso(day(p.approvedAt)!, 2) : null });
      if (p.late) out.push({ ...base, autoKey: `po-late:${p.id}`, title: `Quá hẹn nhận hàng ${who}`, description: `Hẹn ${fmt(p.arrivalDate)}, còn thiếu ${new Intl.NumberFormat('vi-VN').format(p.missing)}. Liên hệ NCC hỏi ngày giao mới.`,
        assigneeId: p.createdBy, priority: 'urgent', dueDate: p.arrivalDate || null });
      if ((p.state === 'confirmed' || p.state === 'partially_received') && p.arrivalDate && p.arrivalDate <= addDaysIso(today, 1)) out.push({ ...base, autoKey: `po-receive:${p.id}`,
        title: `Nhận hàng ${who}`, description: `Còn thiếu ${new Intl.NumberFormat('vi-VN').format(p.missing)} sản phẩm. Kiểm đếm, ghi đạt / hỏng theo từng mã trên đơn mua.`,
        assigneeId: null, assigneePosition: 'warehouse', priority: p.arrivalDate <= today ? 'high' : 'normal', dueDate: p.arrivalDate });
      if (p.sapoPending > 0) out.push({ ...base, autoKey: `po-sapo:${p.id}`, title: `Nhập kho Sapo ${who}`, description: `${p.sapoPending} phiếu nhận chưa nhập kho Sapo (hoặc lỗi). Nhập trên Sapo rồi ghi mã phiếu Sapo vào phiếu nhận.`,
        assigneeId: null, assigneePosition: 'warehouse', priority: 'high', dueDate: today });
      if ((p.balance ?? 0) > 0 && p.nextDueDate && p.nextDueDate <= addDaysIso(today, 3)) out.push({ ...base, autoKey: `po-pay:${p.id}:${p.nextDueDate}`, title: `Trả NCC ${who}`,
        description: `Kỳ ${vnd(p.nextDueAmount ?? 0)} hạn ${fmt(p.nextDueDate)} · còn nợ ${vnd(p.balance ?? 0)}. Ghi khoản trả kèm chứng từ trên đơn mua.`,
        assigneeId: null, assigneePosition: 'accounting', priority: p.nextDueDate < today ? 'urgent' : 'high', dueDate: p.nextDueDate });
    }
    return out;
  },
  /** Đơn đến hạn giao (hôm nay / ngày mai / đã trễ) mà chưa giao xong → nhân viên phụ trách. */
  async orderDue(db, today) {
    const rows = await db.select().from(salesOrders)
      .where(and(inArray(salesOrders.status, ['confirmed', 'delivering']), isNotNull(salesOrders.expectedDeliveryDate), lte(salesOrders.expectedDeliveryDate, addDaysIso(today, 1)))).limit(500);
    const kNo = await contractNoMap(db, rows.map(o => o.id));
    return rows.map(o => {
      const late = o.expectedDeliveryDate! < today, ref = docRef(o.id, o.orderNo, kNo.get(o.id));
      return { autoKey: `order-due:${o.id}`, source: 'delivery' as const, sourceId: o.id, title: `${late ? 'Trễ hạn giao' : 'Đến hạn giao'} ${ref.label} – ${o.customerName}`,
        description: `Hạn giao ${fmt(o.expectedDeliveryDate)}. Kiểm tra hàng, yêu cầu kho đóng hàng và giao cho khách.`, link: ref.link, assigneeId: o.ownerId,
        priority: late ? 'urgent' as const : 'high' as const, dueDate: o.expectedDeliveryDate };
    });
  },
  /**
   * Phiếu đóng gói đã gửi kho → việc "Đóng gói" cho nhóm Kho (mở trang phiếu #/packing/<id>, kho không cần quyền xem đơn).
   * Kho xác nhận đã đóng (kèm ảnh) hoặc phiếu bị huỷ thì việc tự hoàn thành.
   */
  async packingSlips(db, today) {
    const rows = await db.select({ s: packingSlips, orderNo: salesOrders.orderNo, contractNo: salesContracts.contractNo, customerName: salesOrders.customerName, due: salesOrders.expectedDeliveryDate })
      .from(packingSlips).innerJoin(salesOrders, eq(salesOrders.id, packingSlips.orderId)).leftJoin(salesContracts, eq(salesContracts.orderId, packingSlips.orderId))
      .where(eq(packingSlips.status, 'sent')).limit(500);
    if (!rows.length) return [];
    const lines = await db.select().from(packingSlipLines).where(inArray(packingSlipLines.slipId, rows.map(r => r.s.id)));
    const n = (v: number) => new Intl.NumberFormat('vi-VN').format(v);
    return rows.map(({ s, orderNo, contractNo, customerName, due }) => ({ autoKey: `slip:${s.id}`, source: 'packing' as const, sourceId: s.id,
      title: `Đóng gói ${s.slipNo} – ${customerName}`,
      description: [`${docRef(s.orderId, orderNo, contractNo).Label} · ${PACKING_SOURCE_LABEL[s.source]}${s.sourceNote ? ': ' + s.sourceNote : ''}${s.totalWeight ? ` · ~${n(s.totalWeight)} kg` : ''}`,
        ...lines.filter(l => l.slipId === s.id).map(l => `- ${l.name}: ${n(l.qty)} ${l.unit}`), s.note ? `Ghi chú: ${s.note}` : '', 'Đóng xong: mở phiếu, chụp 1–3 ảnh và xác nhận.'].filter(Boolean).join('\n'),
      link: `#/packing/${s.id}`, assigneeId: null, assigneePosition: 'warehouse', priority: due && due <= addDaysIso(today, 1) ? 'urgent' as const : 'high' as const,
      dueDate: due ? addDaysIso(due, -1) : null }));
  },
  /**
   * Tiến trình sản phẩm (đơn / HĐKT có phí in): kho đã xuất (đóng gói xong) → việc "In mẫu" cho người phụ trách;
   * hoàn thành "In mẫu" → việc "Sản xuất". Hoàn thành việc = bước trên thanh tiến trình xong (xem tasks/api/routes.ts);
   * Manager bấm xong nhanh trên thanh tiến trình thì việc tự đóng.
   */
  async productionSteps(db) {
    const orders = await db.select().from(salesOrders).where(inArray(salesOrders.status, ['confirmed', 'delivering'])).limit(500);
    if (!orders.length) return [];
    const ids = orders.map(o => o.id), [progress, kNo] = await Promise.all([progressOf(db, ids), contractNoMap(db, ids)]);
    return orders.flatMap(o => {
      const p = progress.get(o.id); if (!p?.printing) return [];
      const ref = docRef(o.id, o.orderNo, kNo.get(o.id)), base = { sourceId: o.id, link: ref.link, assigneeId: o.ownerId, priority: 'high' as const, dueDate: o.expectedDeliveryDate };
      if (p.current === 'sample') return [{ ...base, autoKey: `print-sample:${o.id}`, source: 'order' as const, title: `In mẫu ${ref.label} – ${o.customerName}`,
        description: 'Kho đã xuất hàng. In mẫu, gửi khách duyệt mẫu rồi bấm hoàn thành để chuyển sang sản xuất.' }];
      if (p.current === 'production') return [{ ...base, autoKey: `production:${o.id}`, source: 'order' as const, title: `Sản xuất ${ref.label} – ${o.customerName}`,
        description: 'Mẫu đã xong. Theo dõi in / sản xuất hàng loạt, xong thì bấm hoàn thành để chuyển sang giao hàng.' }];
      return [];
    });
  },
  /**
   * Xuất hoá đơn: đơn / HĐKT đã được yêu cầu (tự động khi giao xong, hoặc nhân viên phụ trách bấm) → nhóm Kế toán.
   * Kế toán nhập số hoá đơn vào đơn (PUT /orders/:id/invoice) thì việc tự hoàn thành.
   */
  async invoiceIssue(db) {
    const rows = await db.select({ o: salesOrders, contractNo: salesContracts.contractNo }).from(salesOrders).leftJoin(salesContracts, eq(salesContracts.orderId, salesOrders.id))
      .where(and(eq(salesOrders.invoiceStatus, 'requested'), ne(salesOrders.status, 'cancelled'))).limit(500);
    return rows.map(({ o, contractNo }) => ({ autoKey: `invoice:${o.id}`, source: 'invoice' as const, sourceId: o.id,
      title: `${o.invoiceMode === 'draft' ? 'Gửi nháp hoá đơn' : 'Xuất hoá đơn'} ${contractNo ? 'HĐKT ' + contractNo : 'đơn ' + o.orderNo} – ${o.customerName}`,
      description: `${vnd(o.total)}${o.taxCode ? ' · MST ' + o.taxCode : ''}${o.invoiceMode === 'draft' ? ' · GỬI BẢN NHÁP cho khách kiểm tra' : ' · Phát hành chính thức'}${o.invoiceEmail ? ' · Gửi tới: ' + o.invoiceEmail : ''}${o.invoiceRequestNote ? ' · ' + o.invoiceRequestNote : ''}. Nhập số hoá đơn vào ${contractNo ? 'HĐKT' : 'đơn'} sau khi xuất.`,
      link: docRef(o.id, o.orderNo, contractNo).link, assigneeId: null, assigneePosition: 'accounting', priority: 'normal' as const, dueDate: o.invoiceRequestedAt ? addDaysIso(day(o.invoiceRequestedAt)!, 1) : null }));
  },
  /**
   * Xuất kho / đóng hàng: KHÔNG tự tạo – sinh khi nhân viên bấm "Yêu cầu kho đóng hàng" (POST /tasks/packing).
   * Quy tắc này chỉ giữ việc còn mở khi chuyến giao vẫn đang chờ giao; chuyến đã đi / đã giao / huỷ thì việc tự hoàn thành.
   */
  async packing(db) {
    const open = await db.select({ t: tasks, status: deliveries.status }).from(tasks).innerJoin(deliveries, eq(sql`'pack:' || ${deliveries.id}`, tasks.autoKey))
      .where(and(eq(tasks.source, 'packing'), inArray(tasks.status, ['todo', 'in_progress']))).limit(500);
    return open.filter(r => r.status === 'planned').map(({ t }) => ({ autoKey: t.autoKey!, source: 'packing' as const, sourceId: t.sourceId ?? '', title: t.title, description: t.description,
      link: t.link, assigneeId: t.assigneeId, assigneePosition: t.assigneePosition, priority: t.priority, dueDate: t.dueDate }));
  },
};

/** Chạy mọi quy tắc rồi đồng bộ bảng `tasks`. Một quy tắc lỗi không chặn các quy tắc khác. */
export async function reconcileAutoTasks(db: Db, now = new Date()) {
  const today = vietnamDate(now).iso, stamp = now.toISOString();
  const wanted = new Map<string, AutoTask>();
  let failed = false;
  for (const [name, rule] of Object.entries(RULES)) {
    try { for (const t of await rule(db, today)) wanted.set(t.autoKey, t); } catch (e) { failed = true; console.error('auto task rule failed', name, e instanceof Error ? e.message : e); }
  }
  // Người nhận phải là nhân viên còn làm việc (chưa khoá / chưa xoá, không phải NCC / khách). Người phụ trách chứng từ
  // đã nghỉ thì việc về "chưa giao" để Manager thấy và giao lại – không để việc nằm ở tài khoản không ai đăng nhập.
  const usable = new Set((await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.active, true), isNull(employees.deletedAt), notInArray(employees.role, ['customer', 'supplier'])))).map(e => e.id));
  const who = (id: string | null | undefined) => (id && usable.has(id) ? id : null);
  for (const t of wanted.values()) t.assigneeId = who(t.assigneeId);
  const existing = await db.select({ id: tasks.id, autoKey: tasks.autoKey, status: tasks.status, completedBy: tasks.completedBy, assigneeId: tasks.assigneeId, assigneePosition: tasks.assigneePosition, dueDate: tasks.dueDate, title: tasks.title, description: tasks.description, priority: tasks.priority })
    .from(tasks).where(isNotNull(tasks.autoKey));
  const byKey = new Map(existing.map(t => [t.autoKey!, t]));
  const fresh = [...wanted.values()].filter(t => !byKey.has(t.autoKey));
  const created = fresh.map(t => ({ ...t, id: crypto.randomUUID() }));
  if (created.length) await db.insert(tasks).values(created.map(t => ({ id: t.id, title: t.title, description: t.description ?? '', status: 'todo' as const, priority: t.priority, source: t.source,
    sourceId: t.sourceId, link: t.link, autoKey: t.autoKey, assigneeId: t.assigneeId, assigneePosition: t.assigneeId ? null : (t.assigneePosition ?? null), createdBy: null, dueDate: t.dueDate, createdAt: stamp, updatedAt: stamp }))).onConflictDoNothing();
  let closed = 0, updated = 0, reopened = 0;
  for (const t of existing) {
    const w = wanted.get(t.autoKey!);
    if (!isOpen(t.status)) {
      // Hệ thống tự đóng (completedBy null) mà nay lại cần (VD huỷ phiếu thu → lại quá hạn, huỷ chuyến → lại phải lên lịch): mở lại.
      if (w && t.status === 'done' && t.completedBy === null) {
        await db.update(tasks).set({ status: 'todo', completedAt: null, updatedAt: stamp, revision: sql`${tasks.revision} + 1` }).where(eq(tasks.id, t.id)); reopened++;
      }
      continue;
    }
    // Quy tắc nào lỗi lượt này thì danh sách "cần" thiếu – không đóng việc nào (tránh đóng nhầm hàng loạt), để lượt sau.
    if (!w && failed) continue;
    if (!w) { await db.update(tasks).set({ status: 'done', completedAt: stamp, completedBy: null, updatedAt: stamp, revision: sql`${tasks.revision} + 1` }).where(eq(tasks.id, t.id)); closed++; continue; }
    // Mức ưu tiên chỉ đặt lúc tạo (nhân viên có thể nâng / hạ). Việc "chưa giao" / giao cho nhóm mà đã có người nhận (giao tay / bấm Nhận việc) thì giữ người đó.
    const assigneeId = w.assigneeId ?? who(t.assigneeId), assigneePosition = assigneeId ? null : (w.assigneePosition ?? null);
    if (assigneeId !== t.assigneeId || assigneePosition !== t.assigneePosition || w.dueDate !== t.dueDate || w.title !== t.title || (w.description ?? '') !== t.description) {
      await db.update(tasks).set({ assigneeId, assigneePosition, dueDate: w.dueDate, title: w.title, description: w.description ?? '', updatedAt: stamp }).where(eq(tasks.id, t.id)); updated++;
    }
  }
  // `fresh`: việc vừa tự sinh (để đẩy thông báo cho người / nhóm nhận).
  return { created: fresh.length, closed, updated, reopened, fresh: created };
}
