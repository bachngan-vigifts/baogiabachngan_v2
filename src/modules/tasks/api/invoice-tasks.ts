import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { can, type PermissionMember } from '../../staff/domain/permissions.ts';
import type { InvoiceTaskRef } from '../../sales/api/invoice-task-hooks.ts';
import { customerPayments, orderProgressMarks, paymentSchedules, salesContracts, salesOrders } from '../../sales/schema.ts';
import { webStoreOrders } from '../../sales/pos-schema.ts';
import { docRef } from '../../sales/domain/doc-ref.ts';
import { debtCounts, receivable, vietnamDate } from '../../sales/domain/sales.ts';
import { openPurchases } from '../../suppliers/api/purchase-store.ts';
import { addDaysIso } from '../domain/task-config.ts';
import type { AutoTask } from './auto-tasks.ts';

const dueDate = (iso: string | null) => iso && Number.isFinite(Date.parse(iso)) ? addDaysIso(vietnamDate(new Date(iso)).iso, 1) : null;

/** Also used on task reads to repair old/missed events without a cron or migration. */
export async function invoiceTasks(db: StaffEnv['db'], ref?: InvoiceTaskRef): Promise<AutoTask[]> {
  const out: AutoTask[] = [], now = new Date().toISOString();
  if (!ref || 'orderId' in ref) {
    const scope = ref ? eq(salesOrders.id, ref.orderId) : undefined;
    const delivered = or(eq(salesOrders.status, 'delivered'), sql`exists (select 1 from ${orderProgressMarks} where ${orderProgressMarks.orderId}=${salesOrders.id} and ${orderProgressMarks.stage}='delivered')`)!;
    // Bank intents/QR alone are not receipts. A counter sale needs a real transfer and full payment.
    const transferPaid = sql`exists (select 1 from ${customerPayments} p where p.order_id=${salesOrders.id} and p.method='transfer' and p.voided_at is null and p.amount>0)
      and (select coalesce(sum(p.amount),0) from ${customerPayments} p where p.order_id=${salesOrders.id} and p.voided_at is null)>=${salesOrders.total}`;
    await db.update(salesOrders).set({ invoiceStatus: 'requested', invoiceRequestedAt: now, invoiceRequestedBy: null,
      invoiceRequestNote: 'Tự động: đơn đã hoàn thành, chờ xuất hoá đơn.',
      invoiceEmail: sql`coalesce(nullif(${salesOrders.invoiceEmail},''),${salesOrders.email})`, updatedAt: now,
      revision: sql`${salesOrders.revision}+1` })
      .where(and(scope, eq(salesOrders.invoiceStatus, 'none'), inArray(salesOrders.status, ['confirmed', 'delivering', 'delivered']), delivered,
        or(ne(salesOrders.channel, 'pos'), ne(salesOrders.fulfillmentMode, 'counter'), transferPaid)));
    const rows = await db.select({ o: salesOrders, contractNo: salesContracts.contractNo, delivered: sql<boolean>`${delivered}` }).from(salesOrders)
      .leftJoin(salesContracts, eq(salesContracts.orderId, salesOrders.id))
      .where(and(scope, eq(salesOrders.invoiceStatus, 'requested'), inArray(salesOrders.status, ['confirmed', 'delivering', 'delivered'])));
    for (const { o, contractNo, delivered } of rows) {
      const doc = docRef(o.id, o.orderNo, contractNo);
      const stage = delivered ? 'Đã giao hàng · Chờ hoá đơn' : 'Yêu cầu xuất hoá đơn';
      out.push({ autoKey: `invoice:${o.id}`, source: 'invoice', sourceId: o.id,
        title: `${stage} – ${doc.label} – ${o.customerName}`,
        description: `${new Intl.NumberFormat('vi-VN').format(o.total)} đ${o.taxCode ? ' · MST ' + o.taxCode : ''}${o.invoiceMode === 'draft' ? ' · GỬI BẢN NHÁP cho khách kiểm tra' : ' · Phát hành chính thức'}${o.invoiceEmail ? ' · Gửi tới: ' + o.invoiceEmail : ''}${o.invoiceRequestNote ? ' · ' + o.invoiceRequestNote : ''}. Nhập số hoá đơn vào ${contractNo ? 'HĐKT' : 'đơn'} sau khi xuất.`,
        link: doc.link, assigneeId: null, assigneePosition: 'accounting', priority: 'normal',
        dueDate: dueDate(o.invoiceRequestedAt) });
    }
  }
  if (!ref || 'webOrderId' in ref) {
    const rows = await db.select().from(webStoreOrders).where(and(ref ? eq(webStoreOrders.id, ref.webOrderId) : undefined,
      sql`lower(${webStoreOrders.ghnStatus})='delivered'`, sql`lower(${webStoreOrders.status}) not in ('cancelled','refunded','failed','trash')`));
    for (const o of rows) {
      const website = o.source === 'lock' ? 'Web LocknLock' : 'Web Minh Long';
      let items = '';
      try { const lines: unknown = JSON.parse(o.lines); if (Array.isArray(lines)) items = lines.map(l => `${String(l.sku || '')} ${String(l.name || '')} × ${Number(l.quantity) || 0}`).join('; '); } catch { /* Older snapshots may lack line details. */ }
      if (items.length > 3000) items = items.slice(0, 3000) + '… (xem đủ hàng trên đơn website)';
      out.push({ autoKey: `invoice-web:${o.id}`, source: 'invoice', sourceId: o.id,
        title: `Đã giao hàng · Chờ hoá đơn – ${website} ${o.orderNo} – ${o.customerName}`,
        description: `GHN xác nhận giao thành công · Mã vận đơn: ${o.ghnOrderCode || '—'}\nKhách: ${o.customerName} · ${o.phone} · ${o.email}\nĐịa chỉ: ${o.address}\nGiá trị đơn: ${new Intl.NumberFormat('vi-VN').format(o.total)} ${o.currency}\nHàng: ${items || 'Chưa có chi tiết đồng bộ'}\nXuất hoá đơn, ghi số hoá đơn vào Trao đổi và hoàn thành nhiệm vụ.`,
        link: '', assigneeId: null, assigneePosition: 'accounting', priority: 'normal', dueDate: dueDate(o.updatedAt) });
    }
  }
  return out;
}

type Db = StaffEnv['db'];
type Member = SessionState['member'];
type TaskLike = { id: string; autoKey: string | null; sourceId: string | null; link: string; dueDate: string | null };
export type AccountingKind = 'invoice' | 'payable' | 'receivable' | 'web';
export interface AccountingTaskInfo {
  kind: AccountingKind; typeLabel: string; amount: number; subline: string; actionLabel: string;
  noLink: boolean; detail: Record<string, string | number | boolean | null>;
}

export const isAccountingMember = (m: Member) => m.role === 'manager' || m.positionId === 'accounting' || can(m as PermissionMember, 'purchases.pay');
export const accountingPrefix = (key: string | null) => key?.startsWith('invoice-web:') ? 'web' : key?.startsWith('invoice:') ? 'invoice'
  : key?.startsWith('po-pay:') ? 'payable' : key?.startsWith('debt-overdue-acc:') ? 'receivable' : null;

export async function accountingTaskInfo(db: Db, _member: Member, rows: TaskLike[], today: string) {
  const out = new Map<string, AccountingTaskInfo>();
  const ids = (kind: AccountingKind) => [...new Set(rows.filter(t => accountingPrefix(t.autoKey) === kind).map(t => t.sourceId).filter((x): x is string => !!x))];
  const orderIds = [...new Set([...ids('invoice'), ...ids('receivable')])];
  const [orders, contracts, schedules, payments, purchases, web] = await Promise.all([
    orderIds.length ? db.select().from(salesOrders).where(inArray(salesOrders.id, orderIds)) : [],
    orderIds.length ? db.select({ orderId: salesContracts.orderId, no: salesContracts.contractNo, status: salesContracts.status }).from(salesContracts).where(inArray(salesContracts.orderId, orderIds)) : [],
    ids('receivable').length ? db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, ids('receivable'))) : [],
    ids('receivable').length ? db.select().from(customerPayments).where(and(inArray(customerPayments.orderId, ids('receivable')), isNull(customerPayments.voidedAt))) : [],
    ids('payable').length ? openPurchases(db, today) : [],
    ids('web').length ? db.select().from(webStoreOrders).where(inArray(webStoreOrders.id, ids('web'))) : [],
  ]);
  for (const t of rows) {
    const kind = accountingPrefix(t.autoKey); if (!kind || !t.sourceId) continue;
    if (kind === 'invoice') {
      const o = orders.find(x => x.id === t.sourceId); if (!o) continue;
      const contractNo = contracts.find(x => x.orderId === o.id)?.no ?? '';
      out.set(t.id, { kind, typeLabel: 'Xuất HĐ', amount: o.total, subline: `${o.invoiceMode === 'draft' ? 'Gửi bản nháp' : 'Phát hành chính thức'}${o.taxCode ? ' · MST ' + o.taxCode : ''}`,
        actionLabel: contractNo ? 'Mở HĐKT' : 'Mở đơn', noLink: !t.link, detail: { value: o.total, taxCode: o.taxCode, invoiceMode: o.invoiceMode, contractNo, orderNo: o.orderNo, active: o.invoiceStatus === 'requested' } });
    } else if (kind === 'payable') {
      const p = purchases.find(x => x.id === t.sourceId); if (!p) continue;
      out.set(t.id, { kind, typeLabel: 'Trả NCC', amount: p.nextDueAmount ?? 0, subline: `Kỳ ${fmtMoney(p.nextDueAmount ?? 0)} hạn ${fmtDate(p.nextDueDate)} · còn nợ ${fmtMoney(p.balance ?? 0)}`,
        actionLabel: 'Mở đơn mua NCC', noLink: !t.link, detail: { total: p.total ?? 0, paid: Math.max(0, (p.total ?? 0) - (p.balance ?? 0)), dueAmount: p.nextDueAmount ?? 0, dueDate: p.nextDueDate, balance: p.balance ?? 0, ticketNumber: p.ticketNumber, supplierName: p.supplierName, active: (p.balance ?? 0) > 0 } });
    } else if (kind === 'receivable') {
      const o = orders.find(x => x.id === t.sourceId), k = contracts.find(x => x.orderId === t.sourceId); if (!o || !debtCounts(o.status, k?.status)) continue;
      const r = receivable(schedules.filter(x => x.orderId === o.id), payments.filter(x => x.orderId === o.id), today);
      out.set(t.id, { kind, typeLabel: 'Thu nợ', amount: r.overdue, subline: `Quá hạn ${fmtMoney(r.overdue)} · còn phải thu ${fmtMoney(r.balance)}`,
        actionLabel: k?.no ? 'Mở HĐKT' : 'Mở đơn', noLink: !t.link, detail: { overdue: r.overdue, balance: r.balance, contractNo: k?.no ?? '', orderNo: o.orderNo, active: r.overdue > 0 } });
    } else {
      const o = web.find(x => x.id === t.sourceId);
      out.set(t.id, { kind, typeLabel: 'Đơn web', amount: o?.total ?? 0, subline: `Đơn web${o?.ghnOrderCode ? ' · GHN ' + o.ghnOrderCode : ''}`,
        actionLabel: t.link ? 'Mở đơn' : 'Không có link đơn', noLink: !t.link, detail: { value: o?.total ?? 0, orderNo: o?.orderNo ?? t.sourceId, ghnOrderCode: o?.ghnOrderCode ?? '', manualCompletion: true } });
    }
  }
  return out;
}

const fmtMoney = (n: number) => new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';
const fmtDate = (v: string | null) => v ? v.split('-').reverse().join('/') : '—';
