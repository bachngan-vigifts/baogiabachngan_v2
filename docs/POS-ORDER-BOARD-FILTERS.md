# POS store order board filters

`GET /pos/orders` retains the existing server-side register scope and business permission.
New parameters: `source=all|pos|web|cod`, `ownerId`, inclusive `from`/`to` (YYYY-MM-DD), `payment=all|paid|debt|unknown`. Existing `q` and `status` remain supported. Invalid dates/ranges/enums return 400.

Sources are disjoint: POS = POS orders other than COD; COD = POS orders with fulfillmentMode=cod; Web = website orders (including web COD). Web orders currently have no CRM salesperson, so an employee filter excludes them. Employee options come only from orders in the authorized selected register.

The server reads the complete register dataset (removes the previous 500-per-source caps), applies source/staff/dates/payment/search, then calculates status counts. Status selection then filters rows and financial totals. Totals are split by currency, include VAT and exclude cancelled orders. Revenue here is order value, before returns/refunds; this definition is displayed beside the total. This board does not change accounting or stock formulas.

POS paid amount sums customer_payments excluding voided receipts, consistent with existing order debt queries. Remaining amount is max(0,total-paid). Cancelled orders do not appear in payment-specific filters. Woo status/payment method/GHN status alone never proves collection.

The existing Woo integration optionally accepts standard `date_paid_gmt` / `date_paid`. A timestamp means fully paid according to Woo; explicit null means unpaid. Omission means unknown for legacy orders or preserves the previous evidence. Paid evidence is kept as optional `payment.paidAt` in the existing financial_snapshot JSON, without a migration. Price-detail updates retain prior paid evidence; payment-only events retain financial details. Existing orders without evidence display "Chưa rõ thanh toán" and are not added to known paid/debt sums. Backfill using the existing authenticated Woo bridge is needed to classify those old web orders. No backfill or live writes are performed by this change.

UI uses DOM nodes/textContent, labeled responsive filters, reset, status badges, server summary, and ignores outdated board responses. Store selection resets employee selection; all filters are included in subsequent board refreshes.

Validation: typecheck, UI build, focused board domain/API tests (501 same-source orders, voided receipt, dates, employee, source, scope, explicit web paid evidence and replay/update preservation), existing POS/access/UI/web financial tests. Browser and live checks are reported separately in the PR; no production orders, receipts, notifications or shipping actions are created for testing.
