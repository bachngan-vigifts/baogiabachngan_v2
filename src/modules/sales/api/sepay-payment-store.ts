import {sepayManualAccountApproved} from './sepay-manual-account.ts';
import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { AppError } from "../../../core/errors.ts";
import { foldSql } from "../../../core/text/fold.ts";
import type { StaffEnv } from "../../staff/api/auth-routes.ts";
import { sepayTransactions } from "../../integrations/schema.ts";
import {
  decideSepayMatch,
  sepayPaidDate,
  sepayReferenceCandidates,
  type SepayPayment,
} from "../../integrations/domain/sepay-payment.ts";
import { customerPayments, salesContracts, salesOrders } from "../schema.ts";
import { posRegisters, posShifts } from "../pos-schema.ts";
import { debtCounts } from "../domain/sales.ts";
import { netReceivables } from "./pos-return-credit.ts";
import { cashAudit, cashLock, type CashDb } from "./cash-store.ts";
import { heldCashForOrder } from "./cash-collections.ts";
import {
  sepayPosIntent,
  type SepayManualChoice,
} from "../domain/sepay-page.ts";
import {decideWebSepay,saveWebSepay,isLockWebQrPayment} from './sepay-web-store.ts';
import { applyNearbySepay } from './sepay-proximity-store.ts';

export async function assertSepayCrmSource(
  db: CashDb,
  event: { content: string; orderId: string | null; webOrderId?: string | null; accountNumber?: string },
): Promise<void> {
  if (event.webOrderId || await isLockWebQrPayment(db,event)) throw new AppError(409, 'Giao dịch thuộc đơn web; không gắn vào đơn CRM khác.');
  if (sepayPosIntent(event.content))
    throw new AppError(
      409,
      "Giao dịch có mã QR POS; cần xử lý trong luồng POS, không gắn vào đơn CRM khác.",
    );
  if (event.orderId) {
    const [source] = await db
      .select({ channel: salesOrders.channel })
      .from(salesOrders)
      .where(eq(salesOrders.id, event.orderId))
      .limit(1);
    if (source?.channel === "pos")
      throw new AppError(
        409,
        "Giao dịch đã xác định thuộc đơn POS; cần xử lý tại POS.",
      );
  }
}

/** Ingestion belongs to sales: integrations owns the provider inbox, never imports sales. */
export async function ingestPayment(
  env: StaffEnv,
  payment: SepayPayment,
  actorId?: string,
  manual?: SepayManualChoice,
  mode: 'all' | 'web' | 'nearby' = 'all',
) {
  return env.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"sepay:" + payment.providerId}))`,
    );
    const [old] = await tx
      .select()
      .from(sepayTransactions)
      .where(eq(sepayTransactions.providerId, payment.providerId))
      .limit(1);
    if (old) {
      if (
        old.amount !== payment.amount ||
        old.accountNumber !== payment.accountNumber ||
        old.content !== payment.content ||
        old.transactionAt !== payment.transactionAt
      )
        throw new AppError(
          409,
          "Mã giao dịch SePay đã tồn tại với nội dung khác.",
        );
      if (old.paymentId || old.status === "matched") {
        if (manual && old.webOrderId && manual.orderId==='web:'+old.webOrderId) return { duplicate:true,status:old.status,orderId:null,paymentId:null,webOrderId:old.webOrderId,reason:old.reason };
        if (manual) {
          await cashLock(tx);
          const [receipt] = old.paymentId
            ? await tx
                .select()
                .from(customerPayments)
                .where(eq(customerPayments.id, old.paymentId))
            : [];
          if (
            !receipt ||
            receipt.voidedAt ||
            receipt.orderId !== old.orderId ||
            receipt.amount !== payment.amount ||
            receipt.method !== "transfer" ||
            old.orderId !== manual.orderId ||
            (manual.existingPaymentId &&
              manual.existingPaymentId !== receipt.id)
          )
            throw new AppError(
              409,
              "Giao dịch đã được xử lý hoặc phiếu thu đã huỷ. Tải lại để kiểm tra; không tạo thêm phiếu thu.",
            );
        }
        return {
          duplicate: true,
          status: old.status,
          orderId: old.orderId,
          paymentId: old.paymentId,
          reason: old.reason,
        };
      }
    }
    if (manual && (!actorId || !old))
      throw new AppError(
        409,
        "Không thể xác nhận giao dịch chưa có trong sổ SePay.",
      );
    const now = new Date((env.nowSec?.() ?? Date.now()/1000)*1000).toISOString();
    if (manual) {
      const [originalSource]=old?.orderId?await tx.select({channel:salesOrders.channel}).from(salesOrders).where(eq(salesOrders.id,old.orderId)).limit(1):[];
      if(originalSource?.channel==='pos'&&manual.orderId.startsWith('web:') || old?.webOrderId&&!manual.orderId.startsWith('web:'))throw new AppError(409,'Giao dịch đã xác định nguồn POS/web; không gắn sang luồng khác.');
      const [selected] = manual.orderId.startsWith('web:') ? [] : await tx.select({channel:salesOrders.channel}).from(salesOrders).where(eq(salesOrders.id,manual.orderId)).limit(1);
      if (manual.orderId.startsWith('web:') || selected?.channel === 'pos') return applyNearbySepay(tx,payment,old,now,actorId,manual);
      await assertSepayCrmSource(tx, old!);
    }
    if(mode==='nearby') {
      const [bound] = old?.orderId ? await tx.select({channel:salesOrders.channel}).from(salesOrders).where(eq(salesOrders.id,old.orderId)) : [];
      if (bound?.channel==='crm') return {duplicate:!!old,status:old!.status,reason:old!.reason,orderId:old!.orderId,paymentId:old!.paymentId};
      const webDecision=await decideWebSepay(tx,payment);
      if(webDecision) return {duplicate:!!old,...await saveWebSepay(tx,payment,webDecision,old,actorId)};
      return applyNearbySepay(tx,payment,old,now,actorId,undefined,old?.webOrderId?'web:'+old.webOrderId:old?.orderId||undefined);
    }
    if (!manual && !old?.orderId) {
      const webDecision = await decideWebSepay(tx, payment);
      if (webDecision) {
        return {duplicate: !!old, ...(await saveWebSepay(tx,payment,webDecision,old,actorId))};
      }
    }
    if (mode==='web') return {duplicate: !!old,status:old?.status||'review',reason:old?.reason||'Chờ đối soát đơn web.',orderId:old?.orderId||null,paymentId:old?.paymentId||null,webOrderId:old?.webOrderId||null};
    const references = sepayReferenceCandidates(payment.content);
    // Constant bounded set, bound JSON parameter, identical Vietnamese folding on stored references.
    const values = sql`(select jsonb_array_elements_text(${JSON.stringify(references)}::jsonb))`;
    const referenceMatches = (field: SQLWrapper) =>
      inArray(
        sql`upper(regexp_replace(${foldSql(field)}, '[^a-z0-9]', '', 'g'))`,
        values,
      );
    // Keep inactive documents in automatic ambiguity detection, as fixed on main:
    // eligibility is checked under the order lock rather than redirecting to a prefix.
    const candidates = manual
      ? [{ id: manual.orderId }]
      : references.length
        ? await tx
            .select({ id: salesOrders.id })
            .from(salesOrders)
            .leftJoin(
              salesContracts,
              eq(salesContracts.orderId, salesOrders.id),
            )
            .where(
              or(
                referenceMatches(salesOrders.orderNo),
                referenceMatches(salesOrders.quoteNo),
                referenceMatches(salesOrders.sapoOrderCode),
                referenceMatches(salesContracts.contractNo),
              ),
            )
            .limit(3)
        : [];
    let matches: { id: string; outstanding: number }[] = candidates.map(
      (x) => ({ id: x.id, outstanding: 0 }),
    );
    let blockedReason = "";
    let target: typeof salesOrders.$inferSelect | undefined;
    let approvedAccount = false;
    if (candidates.length === 1) {
      // Shared by checkout, manual receipts, COD, returns and cancellation. Do not lock only a provider ID.
      await cashLock(tx);
      [target] = await tx
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.id, candidates[0]!.id))
        .for("update");
      const [contract] = await tx
        .select({ status: salesContracts.status, contractNo: salesContracts.contractNo })
        .from(salesContracts)
        .where(eq(salesContracts.orderId, candidates[0]!.id))
        .limit(1);
      // Explicit Manager selection follows /payments: CRM can receive before approval.
      // Automatic matching still requires effective debt (signed/approved documents).
      if (!target || (manual ? target.channel !== "crm" || target.status === "cancelled" : !debtCounts(target.status, contract?.status))) matches = [];
      else {
        let accountAllowed = manual
          ? await sepayManualAccountApproved(tx,env,payment.accountNumber,contract?.contractNo)
          : (env.sepayReceiptAccounts || []).includes(payment.accountNumber);
        approvedAccount = accountAllowed && target.channel === "crm";
        if(target.channel==='crm'&&sepayPosIntent(payment.content)) blockedReason='Giao dịch có mã QR POS; không tự gắn sang chứng từ CRM.';
        if (target.channel === "pos") {
          // The existing POS QR endpoint remains responsible for checkout. Post-sale receipts require the original register's account.
          const [register] = target.shiftId
            ? await tx
                .select({ account: posRegisters.bankAccount })
                .from(posShifts)
                .innerJoin(
                  posRegisters,
                  eq(posRegisters.id, posShifts.registerId),
                )
                .where(eq(posShifts.id, target.shiftId))
                .limit(1)
            : [];
          accountAllowed =
            !!register?.account &&
            register.account.replace(/\s+/g, "") === payment.accountNumber;
          blockedReason =
            "Khoản thu POS cần được đối soát trong luồng thu tiền POS để gắn đúng ca và chứng từ.";
        }
        if (!accountAllowed)
          blockedReason =
            "Tài khoản nhận chưa được cấu hình cho tự động ghi thu; cần Manager đối soát.";
        const debt = (
          await netReceivables(
            tx,
            [target.id],
            sepayPaidDate(new Date().toISOString()),
          )
        ).get(target.id)!;
        const balance = debt.balance;
        if (!blockedReason && debt.status === "none")
          blockedReason =
            "Đơn chưa có lịch công nợ hợp lệ; cần đối soát trước khi ghi thu.";
        const held =
          target.channel === "crm" ? await heldCashForOrder(tx, target.id) : 0;
        const outstanding = Math.max(0, balance - held);
        if (!blockedReason && held > 0 && payment.amount > outstanding)
          blockedReason =
            "Đơn có tiền mặt nhân viên đang giữ chờ xác nhận; cần đối soát trước khi ghi thu thêm.";
        // An accountant may have entered this bank transfer before its webhook arrived.
        if (!blockedReason) {
          const [manual] = await tx
            .select({ id: customerPayments.id })
            .from(customerPayments)
            .where(
              and(
                eq(customerPayments.orderId, target.id),
                eq(customerPayments.method, "transfer"),
                ne(customerPayments.paymentSource, "sepay_auto"),
                ne(customerPayments.paymentSource, "pos_exchange_credit"),
                isNull(customerPayments.voidedAt),
                or(
                  eq(customerPayments.reference, "SEPAY:" + payment.providerId),
                  and(
                    eq(customerPayments.amount, payment.amount),
                    eq(
                      customerPayments.paidAt,
                      sepayPaidDate(payment.transactionAt),
                    ),
                  ),
                ),
              ),
            )
            .limit(1);
          if (manual)
            blockedReason =
              "Có phiếu chuyển khoản nhập trước trùng mã giao dịch hoặc số tiền/ngày thu; cần đối soát để tránh ghi nhận hai lần.";
        }
        matches = [{ id: target.id, outstanding }];
      }
    }
    let decision =
      blockedReason && matches.length === 1
        ? {
            status: "review" as const,
            reason: blockedReason,
            orderId: matches[0]!.id,
          }
        : decideSepayMatch(matches, payment.amount);
    if (!manual && (target?.channel === 'pos' && candidates.length===1 || !candidates.length)) return applyNearbySepay(tx,payment,old,now,actorId,undefined,target?.channel==='pos'?target.id:undefined);
    const receivedAt = new Date().toISOString();
    let paymentId: string | null = null;
    if (manual) {
      if (
        !target || target.channel !== "crm" || target.status === "cancelled"
      )
        throw new AppError(409, "Chỉ gán khoản thu thủ công vào đơn CRM/HĐKT chưa hủy.");
      if (!approvedAccount)
        throw new AppError(
          409,
          "Tài khoản nhận chưa được cấu hình cho CRM hoặc quầy đang hoạt động. Không ghi thu qua trang SePay.",
        );
      if (manual.existingPaymentId) {
        const [receipt] = await tx
          .select()
          .from(customerPayments)
          .where(
            and(
              eq(customerPayments.id, manual.existingPaymentId),
              eq(customerPayments.orderId, target.id),
            ),
          )
          .for("update");
        if (
          !receipt ||
          receipt.voidedAt ||
          receipt.method !== "transfer" ||
          !["manual", "sepay_auto"].includes(receipt.paymentSource) ||
          receipt.amount !== payment.amount ||
          receipt.paidAt !== sepayPaidDate(payment.transactionAt)
        )
          throw new AppError(
            409,
            "Phiếu thu không khớp đơn, số tiền, ngày thu hoặc đã bị huỷ.",
          );
        const [bound] = await tx
          .select({ id: sepayTransactions.id })
          .from(sepayTransactions)
          .where(
            and(
              eq(sepayTransactions.paymentId, receipt.id),
              ne(sepayTransactions.providerId, payment.providerId),
            ),
          )
          .limit(1);
        if (bound)
          throw new AppError(
            409,
            "Phiếu thu đã gắn với một giao dịch SePay khác.",
          );
        paymentId = receipt.id;
        decision = {
          status: "matched",
          reason: "Đã đối soát với phiếu thu hiện có.",
          orderId: target.id,
        };
      } else if (decision.status !== "matched")
        throw new AppError(409, decision.reason);
    }
    if (decision.status === "matched" && target && !paymentId) {
      paymentId = crypto.randomUUID();
      await tx.insert(customerPayments).values({
        id: paymentId,
        orderId: target.id,
        customerId: target.customerId,
        amount: payment.amount,
        paidAt: sepayPaidDate(payment.transactionAt),
        method: "transfer",
        reference: "SEPAY:" + payment.providerId,
        note: payment.content,
        paymentSource: "sepay_auto",
        createdBy: actorId || target.ownerId,
        createdAt: receivedAt,
        requestKey: "sepay:" + payment.providerId,
      });
    }
    const row = {
      status: decision.status,
      reason: decision.reason,
      matchMethod:manual?'manual' as const:'reference' as const,
      matchedOrderAt:target?.createdAt||null,
      orderId: decision.orderId ?? null,
      paymentId,
    };
    if (old)
      await tx
        .update(sepayTransactions)
        .set(row)
        .where(eq(sepayTransactions.id, old.id));
    else
      await tx.insert(sepayTransactions).values({
        id: crypto.randomUUID(),
        providerId: payment.providerId,
        transferType: payment.transferType,
        amount: payment.amount,
        accountNumber: payment.accountNumber,
        transactionAt: payment.transactionAt,
        content: payment.content,
        ...row,
        payload: payment.payload,
        receivedAt,
      });
    if (actorId)
      await cashAudit(
        tx,
        actorId,
        manual ? "sepay.confirm" : "sepay.reconcile",
        "sepay_transaction",
        old!.id,
        {
          ...row,
          providerId: payment.providerId,
          ...(manual
            ? {
                reason: manual.reason,
                linkedExisting: !!manual.existingPaymentId,
                previousStatus: old!.status,
                previousOrderId: old!.orderId,
              }
            : {}),
        },
      );
    // A manual first confirmation consumes an existing inbox row; it is not a receipt retry.
    return { duplicate: manual ? false : !!old, ...row };
  });
}
