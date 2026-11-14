# Quick early-request creation

The green “+ Tạo đơn lấy hàng nhanh” entry on `#/early-requests` opens `#/early-requests/new`. On mobile the visible primary control is a green plus with the full accessible name. Permission comes from the existing purchase-options response; direct navigation without create permission shows an error and does not render the picker.

The page reuses the purchase-incoming picker in purchase-only mode: search SKU/name, filter supplier/due dates, choose one or several approved source orders per SKU, set quantity per order and pickup date. Source CRM and supplier order numbers are shown. Every SKU must have an explicitly selected source in this flow. The form creates a draft using the existing transactional `/purchase-early-requests` endpoint; supplier submission is a later explicit action from the saved request. It does not receive inventory.

Duplicate clicks are blocked while saving. An unchanged retry uses the same idempotency key, including after an unsuccessful response following a committed save. A late successful response cannot redirect after the user has left the creation page. Unsaved choices are not persisted across browser reloads; this is not a background/offline upload queue. Quantities are remaining purchase receipts, not reservations of all other draft requests; the existing server revalidates eligibility/quantities when saving and submitting, and receiving checks its own remaining budget.

The ordinary incoming page keeps its existing modal workflow. Creation mode avoids loading saved-request history and uses labelled cards on mobile; receipt-form CSS is separate. No API/schema/migration/RLS change is needed.

Validation:

```sh
npm run typecheck
npm run ui:build
node --import tsx --test --test-concurrency=2 tests/app/purchase-incoming-ui.test.ts tests/app/early-request-page.test.ts tests/app/purchase-early-requests.test.ts tests/app/early-order-sources.test.ts tests/app/purchase-incoming.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/early-quick-create.mjs
```

Chromium uses the real CRM/router with isolated local PGlite at 1280px and 430px. It checks green entry/route, supplier filtering, explicit sources, two purchase orders for one SKU, invalid/excess quantity, required date, duplicate click, committed-save retry with unchanged key, correct saved allocations, navigation away during an in-flight save, unauthorized direct navigation, no inventory transactions and no supplier submission. Existing background warehouse task source-sync is allowed separately from draft writes. Screenshots are under `/workspace/artifacts/early-quick-create/`; all records are synthetic.
