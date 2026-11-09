import {
  and,
  desc,
  eq,
  inArray,
  ne,
  or,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { AppError } from "../../../core/errors.ts";
import { json, readJson, type Router } from "../../../core/http/router.ts";
import { foldSql, paging } from "../../../core/text/fold.ts";
import type { StaffEnv, SessionState } from "../../staff/api/auth-routes.ts";
import { sepayTransactions } from "../../integrations/schema.ts";
import {
  decideSepayMatch,
  parseSepayPayment,
  sepayPaidDate,
  sepayReferenceCandidates,
  type SepayPayment,
} from "../../integrations/domain/sepay-payment.ts";
import { customerPayments, salesContracts, salesOrders } from "../schema.ts";
import { posRegisters, posShifts } from "../pos-schema.ts";
import { debtCounts } from "../domain/sales.ts";
import { netReceivables } from "./pos-return-credit.ts";
import { cashAudit, cashLock } from "./cash-store.ts";
import { heldCashForOrder } from "./cash-collections.ts";

/** Ingestion belongs to sales: integrations owns the provider inbox, never imports sales. */
async function ingestPayment(
  env: StaffEnv,
  payment: SepayPayment,
  actorId?: string,
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
      if (old.paymentId || old.status === "matched")
        return {
          duplicate: true,
          status: old.status,
          orderId: old.orderId,
          paymentId: old.paymentId,
          reason: old.reason,
        };
    }
    const references = sepayReferenceCandidates(payment.content);
    // Constant bounded set, bound JSON parameter, identical Vietnamese folding on stored references.
    const values = sql`(select jsonb_array_elements_text(${JSON.stringify(references)}::jsonb))`;
    const referenceMatches = (field: SQLWrapper) =>
      inArray(
        sql`upper(regexp_replace(${foldSql(field)}, '[^a-z0-9]', '', 'g'))`,
        values,
      );
    const candidates = references.length
      ? await tx
          .select({ id: salesOrders.id })
          .from(salesOrders)
          .leftJoin(salesContracts, eq(salesContracts.orderId, salesOrders.id))
          .where(
            and(
              ne(salesOrders.status, "cancelled"),
              or(
                ne(salesOrders.status, "draft"),
                inArray(salesContracts.status, ["signed", "completed"]),
              ),
              or(
                referenceMatches(salesOrders.orderNo),
                referenceMatches(salesOrders.quoteNo),
                referenceMatches(salesOrders.sapoOrderCode),
                referenceMatches(salesContracts.contractNo),
              ),
            ),
          )
          .limit(3)
      : [];
    let matches: { id: string; outstanding: number }[] = candidates.map(
      (x) => ({ id: x.id, outstanding: 0 }),
    );
    let blockedReason = "";
    let target: typeof salesOrders.$inferSelect | undefined;
    if (candidates.length === 1) {
      // Shared by checkout, manual receipts, COD, returns and cancellation. Do not lock only a provider ID.
      await cashLock(tx);
      [target] = await tx
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.id, candidates[0]!.id))
        .for("update");
      const [contract] = await tx
        .select({ status: salesContracts.status })
        .from(salesContracts)
        .where(eq(salesContracts.orderId, candidates[0]!.id))
        .limit(1);
      if (!target || !debtCounts(target.status, contract?.status)) matches = [];
      else {
        let accountAllowed = (env.sepayReceiptAccounts || []).includes(
          payment.accountNumber,
        );
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
        matches = [{ id: target.id, outstanding }];
      }
    }
    const decision =
      blockedReason && matches.length === 1
        ? {
            status: "review" as const,
            reason: blockedReason,
            orderId: matches[0]!.id,
          }
        : decideSepayMatch(matches, payment.amount);
    const receivedAt = new Date().toISOString();
    let paymentId: string | null = null;
    if (decision.status === "matched" && target) {
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
        "sepay.reconcile",
        "sepay_transaction",
        old!.id,
        { ...row, providerId: payment.providerId },
      );
    return { duplicate: !!old, ...row };
  });
}

export function registerSepayPaymentRoutes(router: Router<StaffEnv>): void {
  router.post(
    "/integrations/sepay/payment",
    async (c) => {
      const payment = parseSepayPayment(await readJson(c.req, 32_000));
      return json({ success: true, ...(await ingestPayment(c.env, payment)) });
    },
    "sepay-sync",
  );

  router.get(
    "/admin/sepay-transactions",
    async (c) => {
      const status = c.url.searchParams.get("status") || "review";
      if (!["matched", "unmatched", "review"].includes(status))
        throw new AppError(400, "Trạng thái đối soát không hợp lệ.");
      const { limit, offset } = paging(c.url, 50, 100);
      const rows = await c.env.db
        .select({
          id: sepayTransactions.id,
          providerId: sepayTransactions.providerId,
          amount: sepayTransactions.amount,
          accountNumber: sepayTransactions.accountNumber,
          transactionAt: sepayTransactions.transactionAt,
          content: sepayTransactions.content,
          status: sepayTransactions.status,
          reason: sepayTransactions.reason,
          orderId: sepayTransactions.orderId,
          paymentId: sepayTransactions.paymentId,
        })
        .from(sepayTransactions)
        .where(
          eq(
            sepayTransactions.status,
            status as "matched" | "unmatched" | "review",
          ),
        )
        .orderBy(desc(sepayTransactions.receivedAt), desc(sepayTransactions.id))
        .limit(limit)
        .offset(offset);
      return json({ transactions: rows });
    },
    "admin",
  );

  router.post(
    "/admin/sepay-transactions/:id/reconcile",
    async (c) => {
      await readJson(c.req, 2_000);
      const [row] = await c.env.db
        .select()
        .from(sepayTransactions)
        .where(eq(sepayTransactions.id, c.params.id!))
        .limit(1);
      if (!row) throw new AppError(404, "Không tìm thấy giao dịch SePay.");
      const actorId = (c.state.session as SessionState).member.id;
      let payment: SepayPayment;
      try {
        payment = parseSepayPayment(JSON.parse(row.payload));
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          409,
          "Dữ liệu giao dịch đã lưu không hợp lệ; cần đối soát chứng từ gốc.",
        );
      }
      return json({
        success: true,
        ...(await ingestPayment(c.env, payment, actorId)),
      });
    },
    "admin",
  );
}
