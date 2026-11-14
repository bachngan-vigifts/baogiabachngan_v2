# Draft request line editing and status colours

The draft editor accepts an exact SKU via “Mã hàng thêm thủ công” / “Thêm mã” (Enter also adds). The SKU must occur on a non-cancelled supplier purchase order in the draft's existing supplier scope. Product name/unit come from that order lookup; adding a row reuses the lookup response. Existing order selection and approved quantity checks remain authoritative at save/submit. Initial quantity is 1; edit it in the new row.

“Xoá dòng” removes a draft row. Closing without saving discards changes. Empty requests, duplicate active SKUs and over 300 distinct SKUs are rejected; API also limits total source rows. Every saved row explicitly carries its chosen source or automatic allocation, so deleting/re-adding an existing SKU cannot silently restore stale pinned quantities. Editing is locked during lookup/save; no stock, receipt or supplier confirmation is created by adding/removing rows.

Confirmed purchase action buttons, accepted early request pills (staff and supplier workspace), approved order references and confirmed cost labels use blue. Completed/fully received states retain green. These are presentation changes only.

Validation:

```sh
npm run typecheck
npm run ui:build
node --import tsx --test tests/app/purchase-early-requests.test.ts tests/app/early-order-sources.test.ts tests/app/early-request-page.test.ts tests/app/early-request-manager-ui.test.ts tests/app/early-list-bulk-ui.test.ts tests/app/purchase-incoming-ui.test.ts tests/app/supplier-workspace-review.test.ts tests/app/supplier-workspace-live.test.ts tests/app/profit-layout.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/early-draft-manual-lines.mjs
```

The browser test uses the real CRM UI/router with local PGlite fixtures at 390px and 1280px. It covers unknown/duplicate SKU, Enter, cancelled unsaved edits, removing the last row, replacement save/reopen, submit/confirm, scoped receiving of only the replacement SKU, blue confirmation button, footer geometry and JavaScript errors. Screenshots default to `/workspace/scratch/early-request-page/`. API tests cover wrong supplier, exceeding available quantity, invalid quantity, duplicate SKU, empty request, atomic failed updates, stale revisions and edit rejection after submission. No migration or production data change is required.
