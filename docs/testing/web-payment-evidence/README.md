# Website payment claims and verified collections

WooCommerce can fill `date_paid` when a user/plugin moves an order to processing/completed. The previous read projections treated that date as collection of the entire order, including when there was no bank proof. The same assumption suggested zero COD.

The shared payment projection now distinguishes source claims from a valid matched bank transaction using the existing amount/account/currency/store/source-conflict safeguards:

- Valid bank evidence: paid, original amount; no new receipt.
- Website paid date without proof: unknown, `paymentEvidence=website`, explicit pending-reconciliation label, null paid and outstanding. No invented debt or collection.
- Explicit source unpaid (date null): existing unpaid/debt behavior.
- Missing metadata or source conflict: unknown. A stale bank link cannot override a conflict.

POS, web document detail/list/summary and SePay nearby preview use the same interpretation. Order totals, Woo snapshots, stock, existing GHN/COD, receipts, auth and RLS remain unchanged. Cancelled orders remain excluded from financial summaries.

For new shipments on website-only claims, the UI requires an explicit operational payment review. Direct GHN creation also requires an explicitly entered COD, checked again under the source row lock. The review is not a receipt, does not mark paid and is recorded in the existing audit log. Existing shipment replay returns the existing code without another create. Unedited website bridge orders retain the bridge's shipping/COD handling and require the same operational review.

## Validation

`npm run typecheck`, `npm run ui:build`, architecture and UI checks. API regression tests cover both websites, source-paid/no-bank, partial bank event staying in review, matched proof, source conflicts, filters, summary consistency, null/missing metadata and unchanged financial/stock records. Direct GHN tests cover missing/null/blank COD, review false, explicit zero COD and idempotent replay. DOM tests cover the direct and bridge review forms.

`scripts/testing/web-payment-evidence.mjs` opens the real local CRM/router with synthetic data in Chromium at 390 and 1280 px. It checks the POS/detail labels, blank COD and unchecked review. External network is blocked; no real carrier requests or production business writes occur.

## Rollout / rollback

No migration. Merge after required CI, deploy API through `Triển khai API`, then UI through `Triển khai giao diện` (which waits for the matching API commit). Verify deployed function graph/version and public static assets. Authenticated production order checks require a legitimate CRM session; never obtain session credentials from database rows.

Rollback by reverting this PR and deploying API/UI through the same workflows. No data restoration is required, because this change does not rewrite payment snapshots, bank transactions, receipts or existing shipping records. Reverting restores the earlier interpretation of website dates and its known risk; prefer a corrective fix if only presentation needs adjustment.
