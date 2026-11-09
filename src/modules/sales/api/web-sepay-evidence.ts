import { sql, type SQLWrapper } from "drizzle-orm";
import { sepayTransactions as bank } from "../../integrations/schema.ts";
import { posRegisters, webStoreOrders as web } from "../pos-schema.ts";
import { WEB_PAYMENT_BLOCKED_STATUSES } from "../domain/web-order-outcome.ts";
import { GHN_FAILED } from "../domain/ghn-status.ts";
const values = (items: Iterable<string>) =>
  sql.join(
    [...items].map((value) => sql`${value}`),
    sql`, `,
  );

/** A verified bank statement is evidence in its own right; never fabricate Woo's date_paid. */
export const validWebSepay = (
  amount: SQLWrapper = bank.amount,
  account: SQLWrapper = bank.accountNumber,
  method: SQLWrapper = bank.matchMethod,
  matchedAt: SQLWrapper = bank.matchedOrderAt,
) => sql<boolean>`coalesce(
 (${method}<>'amount_time' or (${web.orderedAtVerified} and ${web.orderedAt}=${matchedAt})) and ${web.id} is not null and ${web.source} in ('lock','minhlong') and ${web.currency}='VND' and ${web.total}=${amount}
 and regexp_replace(lower(trim(${web.status})),'^wc-','') not in (${values(WEB_PAYMENT_BLOCKED_STATUSES)})
 and regexp_replace(lower(trim(${web.ghnStatus})),'^wc-','') not in (${values(GHN_FAILED)})
 and not coalesce((${web.crmEditSnapshot}::jsonb->>'sourceConflict')::boolean,false)
 and coalesce((${web.crmEditSnapshot}::jsonb->>'revision')::int,0)=0
 and lower(${web.paymentMethod}) !~ '(cod|nhận hàng|nhan hang|tiền mặt|tien mat)'
 and lower(${web.paymentMethod}) ~ '(qr|sepay|bacs|bank|chuyển khoản|chuyen khoan|transfer)'
 and exists(select 1 from ${posRegisters} sr where sr.id=${web.registerId} and sr.active
  and regexp_replace(sr.bank_account,'[[:space:]]','','g')=${account}),false)`;

export const webSepayPaidAt = () => sql<
  string | null
>`(select sb.transaction_at from ${bank} sb
 where sb.web_order_id=${web.id} and sb.status='matched' and ${validWebSepay(sql`sb.amount`, sql`sb.account_number`, sql`sb.match_method`, sql`sb.matched_order_at`)} limit 1)`;
