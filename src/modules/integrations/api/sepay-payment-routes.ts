import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import { customerPayments, salesContracts, salesOrders } from '../../sales/schema.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { sepayTransactions } from '../schema.ts';
import { decideSepayMatch, normalizeSepayReference, parseSepayPayment } from '../domain/sepay-payment.ts';

export function registerSepayPaymentRoutes(router: Router<StaffEnv>) {
  router.post('/integrations/sepay/payment', async c => {
    const body = await readJson(c.req, 32_000), payment = parseSepayPayment(body), receivedAt = new Date().toISOString();
    const result = await c.env.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'sepay:' + payment.providerId}))`);
      const [old] = await tx.select().from(sepayTransactions).where(eq(sepayTransactions.providerId, payment.providerId)).limit(1);
      if (old) {
        if (old.amount !== payment.amount || old.accountNumber !== payment.accountNumber || old.content !== payment.content)
          throw new AppError(409, 'Mã giao dịch SePay đã tồn tại với nội dung khác.');
        return { duplicate: true, status: old.status, orderId: old.orderId, paymentId: old.paymentId, reason: old.reason };
      }
      const normalized = normalizeSepayReference(payment.content);
      const normalizedField = (field: unknown) => sql<string>`upper(regexp_replace(coalesce(${field},''),'[^A-Za-z0-9]','','g'))`;
      const candidates = await tx.select({ order: salesOrders, contractNo: salesContracts.contractNo,
        paid: sql<number>`coalesce((select sum(p.amount) from ${customerPayments} p where p.order_id=${salesOrders.id} and p.voided_at is null),0)::float8` })
        .from(salesOrders).leftJoin(salesContracts, eq(salesContracts.orderId, salesOrders.id))
        .where(and(inArray(salesOrders.status, ['confirmed', 'delivering', 'delivered']), or(
          sql`position(${normalizedField(salesOrders.orderNo)} in ${normalized}) > 0 and ${salesOrders.orderNo} <> ''`,
          sql`position(${normalizedField(salesOrders.quoteNo)} in ${normalized}) > 0 and ${salesOrders.quoteNo} <> ''`,
          sql`position(${normalizedField(salesOrders.sapoOrderCode)} in ${normalized}) > 0 and coalesce(${salesOrders.sapoOrderCode},'') <> ''`,
          sql`position(${normalizedField(salesContracts.contractNo)} in ${normalized}) > 0 and coalesce(${salesContracts.contractNo},'') <> ''`,
        ))).limit(3);
      const matches = candidates.map(x => ({ id: x.order.id, outstanding: Math.max(0, x.order.total - Number(x.paid || 0)), order: x.order }));
      const decision = decideSepayMatch(matches, payment.amount);
      let paymentId: string | null = null;
      if (decision.status === 'matched') {
        const hit = matches[0]!, id = crypto.randomUUID(); paymentId = id;
        await tx.insert(customerPayments).values({ id, orderId: hit.order.id, customerId: hit.order.customerId, amount: payment.amount,
          paidAt: payment.transactionAt, method: 'transfer', reference: 'SEPAY:' + payment.providerId,
          note: payment.content, paymentSource: 'sepay_auto', createdBy: hit.order.ownerId, createdAt: receivedAt });
      }
      const transactionId = crypto.randomUUID();
      await tx.insert(sepayTransactions).values({ id: transactionId, providerId: payment.providerId, transferType: payment.transferType,
        amount: payment.amount, accountNumber: payment.accountNumber, transactionAt: payment.transactionAt, content: payment.content,
        status: decision.status, reason: decision.reason, orderId: decision.orderId ?? null, paymentId, payload: payment.payload, receivedAt });
      return { duplicate: false, status: decision.status, orderId: decision.orderId ?? null, paymentId, reason: decision.reason };
    });
    return json({ success: true, ...result });
  }, 'sepay-sync');
}
