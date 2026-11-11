import { desc, eq } from "drizzle-orm";
import { AppError } from "../../../core/errors.ts";
import { json, readJson, type Router } from "../../../core/http/router.ts";
import { paging } from "../../../core/text/fold.ts";
import type { StaffEnv, SessionState } from "../../staff/api/auth-routes.ts";
import { sepayTransactions } from "../../integrations/schema.ts";
import {
  parseSepayPayment,
  type SepayPayment,
} from "../../integrations/domain/sepay-payment.ts";
import { ingestPayment } from "./sepay-payment-store.ts";

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
