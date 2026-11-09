import { and, asc, gte, inArray, isNull, lte } from "drizzle-orm";
import type { StaffEnv } from "../../staff/api/auth-routes.ts";
import { sepayTransactions as bank } from "../../integrations/schema.ts";
import { parseSepayPayment } from "../../integrations/domain/sepay-payment.ts";
import { ingestPayment } from "./sepay-payment-store.ts";

/** Reuse the existing 5-minute SePay pull worker; no timers, provider calls or POS page hooks. */
export async function retryNearbySepay(env: StaffEnv) {
  const now = (env.nowSec?.() ?? Date.now() / 1000) * 1000;
  const rows = await env.db
    .select()
    .from(bank)
    .where(
      and(
        inArray(bank.status, ["review", "unmatched"]),
        isNull(bank.paymentId),
        gte(bank.transactionAt, new Date(now - 15 * 60_000).toISOString()),
        lte(bank.transactionAt, new Date(now - 5 * 60_000).toISOString()),
      ),
    )
    .orderBy(asc(bank.transactionAt), asc(bank.id))
    .limit(30);
  let matched = 0;
  for (const row of rows) {
    const payment = parseSepayPayment(JSON.parse(row.payload));
    const result = await ingestPayment(
      env,
      payment,
      undefined,
      undefined,
      "nearby",
    );
    if (result.status === "matched") matched++;
  }
  return { examined: rows.length, matched };
}
