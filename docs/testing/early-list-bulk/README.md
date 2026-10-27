# Early-request numbering and batch index actions

All evidence uses synthetic local PGlite fixtures. No production records were received or confirmed during verification.

## Before

Request headers were labeled with the first eight characters of a UUID rather than the shared document-number format. The index had no row selection or confirmation/receiving actions. Manager had to open each request, confirm supplier slips individually, return to the index, and repeat. Quick receiving was available only inside request details or incoming-history cards.

## Changes

- Checkbox immediately before the request number. Select the eligible visible page, select individual headers, or clear. Selection clears on filters, pagination, reload and route changes; no hidden selection carries into another page.
- Manager confirmation re-reads chosen headers and previews only pending allocations. Existing atomic batch endpoint and 300-allocation limit apply. Accepted/rejected/draft lines are untouched. Confirmation does not receive stock.
- Quick receiving reuses the existing full review form with warehouse, date, editable quantities and explicit CRM-only/Sapo choice. Every line shows its request and source purchase order. Pending/rejected/fully received quantities are excluded.
- Source balance is shared across selected requests referencing the same purchase line. Defaults distribute in displayed page order; combined quantities cannot exceed the source balance. The server still validates concurrent changes transactionally.
- Receipt requests are sequential per request/source purchase order, each with its own stable idempotency key. A partly completed batch freezes its body, skips confirmed sources and safely retries the unknown source. The batch is not an all-or-nothing transaction; partial progress is displayed.
- Existing receiving and Manager permissions are unchanged. No dependency, pricing, inventory posting or Sapo dispatch logic changes.
- Persisted `ticket_number` uses `PXH_NNN_DDMMYYYY`, based on Vietnam creation date. The API adds this field to authorized request rows; search, incoming annotations, calendar and warehouse links display the same value. UUID URLs, receipt provenance and existing identifiers remain intact.
- Migration `20261027113713_early_request_numbers.sql` backfills old headers in creation order, including deleted parents, and leaves assigned numbers unchanged on repeated deploys. A unique index and transaction advisory lock protect daily sequences. A deferred insert trigger assigns numbers at commit after purchase/source locks, including records created by the previous API during rolling deployment. No new privileges or security-definer functions. The migration is explicitly included before API deployment.
- Editing/submitting/retrying preserves the number; split children get independent numbers; deleted numbers remain reserved. Three or more sequence digits are supported. UI falls back to the old ID label while an older API is still running.

## Interaction count

Two pending requests, starting and ending on the index: prior path requires 8 taps (open, review confirmation, confirm, Back for each); now 4 (two checkboxes, batch action, confirm). After selecting requests, confirmation needs 2 taps.

Quick receipt: after selection, opening the review and confirming are 2 action taps. Choosing the required warehouse/Sapo option and editing quantities are additional interactions; these deliberate review steps remain.

## Verification

- `npm run typecheck`, `npm run ui:build`.
- Five direct UI tests (including persisted-number checkbox labels): eligibility/reset, exact pending allocation set/double-submit, oversized/stale requests, fresh selected request scope/page order.
- Existing Manager UI, batch confirmation, scoped receiving and trial UI tests: 16 tests, all pass.
- `scripts/testing/early-list-bulk.mjs`: real local router/PGlite/Chromium at 360, 390, 430, 768, 1280px. Two requests confirmed together, exact separate receipt provenance/stock, filter selection reset, no overflow or JS errors. Shared-source quantity overflow rejected before writing. Simulated lost response after commit retries the identical body/key and does not post stock again. Fractional shared balances keep valid 0.001-step defaults; pending selected requests are excluded from receipts. Unauthorized employee cannot select or batch act.
- `scripts/testing/early-quick-receive.mjs`: prior single-slip flow regression across five widths, scoped quantities, other supplier excluded, CRM-only and Sapo outbox choice, committed-response retry, focus and double-submit protection.
- Three additional real-DB tests cover the shared numbering format, Vietnam day rollover, immutability/retry, search/portal/calendar/incoming surfaces, unique concurrent creates, split/replay and migration backfill/repeatability/unique constraints. The migration comparison preserves all old header fields and stock counts.
- Before the numbering addition, the full repository run executed 260 test files: 258 passed directly; bootstrap subprocess and PHP-runtime environment failures both passed on targeted rerun with the required runtime. Final CI must rerun the full suite for the numbering migration; this report does not claim that CI is green before completion.

Screenshots: [mobile list](list-390.png), [mobile receipt](receive-390.png), [desktop list](list-1280.png). Machine-readable browser results: [results.json](results.json).
