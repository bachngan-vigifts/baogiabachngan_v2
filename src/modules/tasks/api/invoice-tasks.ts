import { tasks } from '../schema.ts';
import { readWebOrderFinancials, webFinancialDescription } from '../../sales/domain/web-order-financials.ts';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import type { InvoiceTaskRef } from '../../sales/api/invoice-task-hooks.ts';
import { customerPayments, orderProgressMarks, salesContracts, salesOrders } from '../../sales/schema.ts';
import { webStoreOrders } from '../../sales/pos-schema.ts';
import { readWebAccounting } from '../../sales/domain/web-order-accounting.ts';
import { GHN_FAILED } from '../../sales/domain/ghn-status.ts';
import { docRef } from '../../sales/domain/doc-ref.ts';
import { vietnamDate } from '../../sales/domain/sales.ts';
import { addDaysIso } from '../domain/task-config.ts';
import type { AutoTask } from './auto-tasks.ts';

const dueDate = (iso: string | null) => iso && Number.isFinite(Date.parse(iso)) ? addDaysIso(vietnamDate(new Date(iso)).iso, 1) : null;

/** Shared eligibility for accounting tasks and the order-list projection. */
const deliveredWebInvoice = () => and(sql`lower(${webStoreOrders.ghnStatus})='delivered'`,
  sql`lower(${webStoreOrders.status}) not in ('cancelled','refunded','failed','trash')`)!;
const savedWebInvoice = () => sql`${webStoreOrders.crmEditSnapshot}::jsonb->'accounting'->'invoice'`;
const issuedWebInvoice = () => sql`(${savedWebInvoice()}->>'status'='issued' and length(trim(coalesce(${savedWebInvoice()}->>'invoiceNo','')))>0)`;
const requestedWebInvoice = () => and(sql`lower(${webStoreOrders.status}) not in ('cancelled','refunded','failed','trash')`,
  sql`lower(trim(${webStoreOrders.ghnStatus})) not in (${sql.join([...GHN_FAILED].map(status => sql`${status}`), sql`,`)})`,
  or(deliveredWebInvoice(), sql`${savedWebInvoice()}->>'status'='requested'`))!;

/** A completed accounting task is handled, not evidence of an issued invoice number. */
export function webInvoiceStatus() {
  return sql<string>`case when ${issuedWebInvoice()} then 'issued' when ${requestedWebInvoice()} then
    case when exists(select 1 from ${tasks} where ${tasks.autoKey}='invoice-web:' || ${webStoreOrders.id} and ${tasks.status}='done' and ${tasks.completedBy} is not null)
      then 'handled' else 'requested' end
    else 'unknown' end`;
}

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
      requestedWebInvoice(), sql`not coalesce(${issuedWebInvoice()},false)`));
    for (const o of rows) {
      const accounting = readWebAccounting(o.crmEditSnapshot), invoice = accounting.invoice, billing = accounting.billing;
      const website = o.source === 'lock' ? 'Web LocknLock' : 'Web Minh Long';
      let items = '';
      try { const lines: unknown = JSON.parse(o.lines); if (Array.isArray(lines)) items = lines.map(l => `${String(l.sku || '')} ${String(l.name || '')} × ${Number(l.quantity) || 0}`).join('; '); } catch { /* Older snapshots may lack line details. */ }
      if (items.length > 3000) items = items.slice(0, 3000) + '… (xem đủ hàng trên đơn website)';
      const financialText = webFinancialDescription(readWebOrderFinancials(o.financialSnapshot),o.currency);
      out.push({ autoKey: `invoice-web:${o.id}`, source: 'invoice', sourceId: o.id,
        title: `${o.ghnStatus==='delivered'?'Đã giao hàng · ':''}Chờ hoá đơn – ${website} ${o.orderNo} – ${o.customerName}`,
        description: `${o.ghnStatus==='delivered'?'GHN xác nhận giao thành công':'Đã yêu cầu xuất hoá đơn'} · Mã vận đơn: ${o.ghnOrderCode || '—'}\nKhách: ${billing?.name || o.customerName} · ${o.phone} · ${invoice?.email || billing?.email || o.email}\nĐịa chỉ xuất hoá đơn: ${billing?.address || o.address}${billing?.taxCode?'\nMST: '+billing.taxCode:''}${invoice?.note?'\nGhi chú: '+invoice.note:''}${invoice?.mode==='draft'?'\nGửi bản nháp cho khách kiểm tra.':''}\nGiá trị đơn: ${new Intl.NumberFormat('vi-VN').format(o.total)} ${o.currency}\nHàng: ${items || 'Chưa có chi tiết đồng bộ'}${financialText?'\n'+financialText:''}\nMở trang đơn hàng để nhập số hoá đơn sau khi xuất.`,
        link: `/index.html#/orders/${encodeURIComponent('web:'+o.id)}`, assigneeId: null, assigneePosition: 'accounting', priority: 'normal', dueDate: dueDate(o.updatedAt) });
    }
  }
  return out;
}
