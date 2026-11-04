import { eq } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import type { RouteContext } from '../../../core/http/router.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { webStoreOrders } from '../pos-schema.ts';
import { vietnamDate } from '../domain/sales.ts';
import { webOrderBucket } from '../domain/web-order-outcome.ts';
import {
  canEditWebAccounting,
  parseWebBilling,
  parseWebInvoice,
  parseWebInvoiceRequest,
  readWebAccounting,
  type WebAccounting,
} from '../domain/web-order-accounting.ts';
import { webDocumentDetail } from './web-order-documents.ts';
import { invoiceTasksChanged } from './invoice-task-hooks.ts';

type Ctx = RouteContext<StaffEnv>;
type Action = 'invoice' | 'request' | 'billing';

/** Only accounting metadata changes. Web/GHN remains the sole owner of stock and receipts. */
export async function updateWebAccounting(
  c: Ctx,
  body: Record<string, unknown>,
  action: Action,
): Promise<{ ok: true; updated: boolean; replayed: boolean }> {
  const member = (c.state.session as SessionState).member;
  if (!canEditWebAccounting(member))
    throw new AppError(403, 'Bạn không có quyền cập nhật hoá đơn.');
  const id = c.params.id!.slice(4),
    access = await webDocumentDetail(c, id);
  const fields =
    action === 'invoice'
      ? parseWebInvoice(body, vietnamDate().iso)
      : action === 'request'
        ? parseWebInvoiceRequest(body)
        : parseWebBilling(body);
  const saved = await c.env.db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(webStoreOrders)
      .where(eq(webStoreOrders.id, id))
      .for('update');
    if (!order || order.registerId !== access.document.registerId)
      throw new AppError(
        404,
        'Không tìm thấy đơn website trong phạm vi được xem.',
      );
    if (webOrderBucket(order.status, order.ghnStatus) === 'cancelled')
      throw new AppError(
        409,
        'Đơn đã huỷ hoặc hoàn; cần xử lý hoá đơn theo quy trình điều chỉnh.',
      );
    const current = readWebAccounting(order.crmEditSnapshot),
      now = new Date().toISOString();
    if (action === 'request' && current.invoice?.status === 'issued')
      throw new AppError(409, 'Đơn đã có số hoá đơn.', 'INVOICE_ISSUED');
    const previous = action === 'billing' ? current.billing : current.invoice;
    // Lost responses can be retried without incrementing the revision or adding another audit.
    if (
      previous &&
      Object.entries(fields).every(
        ([key, value]) => previous[key as keyof typeof previous] === value,
      ) &&
      (action !== 'invoice' || current.invoice?.status === 'issued')
    )
      return { updated: false, replayed: true };
    if (
      !Number.isSafeInteger(body.revision) ||
      body.revision !== current.revision
    )
      throw new AppError(
        409,
        'Thông tin hoá đơn vừa thay đổi. Tải lại đơn trước khi lưu.',
        'WEB_ACCOUNTING_CHANGED',
      );
    const next: WebAccounting = { ...current, revision: current.revision + 1 };
    if (action === 'billing') next.billing = parseWebBilling(body);
    else if (action === 'request')
      next.invoice = {
        ...current.invoice,
        ...parseWebInvoiceRequest(body),
        status: 'requested',
        invoiceNo: '',
        invoiceDate: '',
        requestedAt: current.invoice?.requestedAt || now,
        requestedBy: current.invoice?.requestedBy ?? member.id,
        requestedByName: current.invoice?.requestedByName || member.name,
      };
    else
      next.invoice = {
        ...current.invoice,
        ...parseWebInvoice(body, vietnamDate().iso),
        status: 'issued',
        email: current.invoice?.email || current.billing?.email || order.email,
        mode: current.invoice?.mode || 'issue',
        note: current.invoice?.note || '',
        requestedAt: current.invoice?.requestedAt || now,
        issuedAt: now,
        issuedBy: member.id,
        issuedByName: member.name,
      };
    const snapshot: Record<string, unknown> = JSON.parse(
      order.crmEditSnapshot || '{}',
    );
    await tx
      .update(webStoreOrders)
      .set({
        crmEditSnapshot: JSON.stringify({ ...snapshot, accounting: next }),
        updatedAt: now,
      })
      .where(eq(webStoreOrders.id, id));
    await tx
      .insert(auditLogs)
      .values({
        id: crypto.randomUUID(),
        actorId: member.id,
        module: 'sales',
        action: `web-order-${action}`,
        entityType: 'web-store-order',
        entityId: id,
        createdAt: now,
        data: JSON.stringify({ before: current, after: next }),
      });
    return { updated: true, replayed: false };
  });
  if (!saved.replayed)
    await invoiceTasksChanged(c.env, { webOrderId: id }, member.id);
  return { ok: true, ...saved };
}
