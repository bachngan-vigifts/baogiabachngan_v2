# Batch actions from the early-request index

All evidence uses synthetic local PGlite fixtures. No production records were received or confirmed during verification.

## Before

The index had no row selection or confirmation/receiving actions. Manager had to open each request, confirm supplier slips individually, return to the index, and repeat. Quick receiving was available only inside request details or incoming-history cards.

## Changes

- Checkbox immediately before the request number. Select the eligible visible page, select individual headers, or clear. Selection clears on filters, pagination, reload and route changes; no hidden selection carries into another page.
- Manager confirmation re-reads chosen headers and previews only pending allocations. Existing atomic batch endpoint and 300-allocation limit apply. Accepted/rejected/draft lines are untouched. Confirmation does not receive stock.
- Quick receiving reuses the existing full review form with warehouse, date, editable quantities and explicit CRM-only/Sapo choice. Every line shows its request and source purchase order. Pending/rejected/fully received quantities are excluded.
- Source balance is shared across selected requests referencing the same purchase line. Defaults distribute in displayed page order; combined quantities cannot exceed the source balance. The server still validates concurrent changes transactionally.
- Receipt requests are sequential per request/source purchase order, each with its own stable idempotency key. A partly completed batch freezes its body, skips confirmed sources and safely retries the unknown source. The batch is not an all-or-nothing transaction; partial progress is displayed.
- Existing receiving and Manager permissions are unchanged. No API, schema, dependency, pricing, inventory posting or Sapo dispatch logic changes.

## Interaction count

Two pending requests, starting and ending on the index: prior path requires 8 taps (open, review confirmation, confirm, Back for each); now 4 (two checkboxes, batch action, confirm). After selecting requests, confirmation needs 2 taps.

Quick receipt: after selection, opening the review and confirming are 2 action taps. Choosing the required warehouse/Sapo option and editing quantities are additional interactions; these deliberate review steps remain.

## Verification

- `npm run typecheck`, `npm run ui:build`.
- Four new direct UI tests: eligibility/reset, exact pending allocation set/double-submit, oversized/stale requests, fresh selected request scope/page order.
- Existing Manager UI, batch confirmation, scoped receiving and trial UI tests: 16 tests, all pass.
- `scripts/testing/early-list-bulk.mjs`: real local router/PGlite/Chromium at 360, 390, 430, 768, 1280px. Two requests confirmed together, exact separate receipt provenance/stock, filter selection reset, no overflow or JS errors. Shared-source quantity overflow rejected before writing. Simulated lost response after commit retries the identical body/key and does not post stock again. Fractional shared balances keep valid 0.001-step defaults; pending selected requests are excluded from receipts. Unauthorized employee cannot select or batch act.
- `scripts/testing/early-quick-receive.mjs`: prior single-slip flow regression across five widths, scoped quantities, other supplier excluded, CRM-only and Sapo outbox choice, committed-response retry, focus and double-submit protection.
- Full repository suite status is recorded in the PR description once completed.

Screenshots: [mobile list](list-390.png), [mobile receipt](receive-390.png), [desktop list](list-1280.png). Machine-readable browser results: [results.json](results.json).
