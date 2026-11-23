# Request permission to edit an approved quote

Employees who already have edit access to a quote can click **Sửa báo giá**, enter a reason, and ask a Manager for permission. The existing quote remains approved and unchanged while the request is pending or rejected. Managers see a notification, an item in **Cần duyệt → Báo giá**, and **Duyệt yêu cầu sửa** on the quote. Only Managers may accept/reject; delegated quote approvers do not gain this power.

An approval grants the requesting employee one successful save against that exact quote revision. It does not add access to another quote or override current ownership/shares/department rules. The successful save increments the revision and resets approval to draft, even for an unchanged payload. The employee must submit the new revision for approval. The mobile save action also stops at draft after using this permission, rather than immediately submitting automatically. Manager edits retain their existing behavior.

Approved linked orders/contracts remain locked for employees. Existing quote save hooks run when requesting permission, when approving it, and when saving. These hooks lock the linked order and preserve its quantity, stock and document checks. A linked draft becoming approved after the grant blocks the later employee save. A grant never bypasses private cost protection, attachment checks, quote revision checks, or the quote's current edit scope.

## Persistence and concurrency

No new tables, migration, RLS policy or production write is required for this code change. Requests and decisions are append-only records in the existing RLS-enabled `audit_logs`, with `module=quote-edit`, `entity_type=quotation`, and quote ID. Requested events carry revision/reason and requester identity; decisions refer to the exact request ID. Reads use the existing entity index. These business approval records are written directly in the transaction, not through the best-effort generic audit writer: if persistence fails, permission is not granted.

Request, decision and quote save lock the quote row. Repeated requests return the existing unresolved request; repeated identical decisions return success without another notification. Opposite or stale decisions fail. Authorization is based on request identity and revision, not timestamp ordering. A Manager save invalidates prior grants through the revision change. Inbox items ignore changed revisions and quotes no longer approved. Removing/restricting a share or deactivating the employee is rechecked; Managers can still reject requests belonging to deactivated employees. There is no automatic expiry timer or generic log-pruning job introduced by this change.

Notifications are sent after commit through the existing notification functions. The inbox and audit state remain the source of truth if Web Push is unavailable. Removing approval audit records would fail closed; do not purge them as disposable diagnostics.

## Checks

```sh
npm run typecheck
npm run ui:build
node --import tsx tests/app/quote-edit-requests.test.ts
node --import tsx tests/app/contract-amendments.test.ts
node --import tsx tests/app/mobile-quote-capture.test.ts
node --import tsx --test --test-concurrency=2 tests/app/quote-edit-requests.test.ts tests/app/quote-approval.test.ts tests/app/quote-approval-steps.test.ts tests/app/approval-inbox.test.ts tests/app/approvals.test.ts tests/app/approval-roles.test.ts tests/app/department-access.test.ts tests/app/quote-purchase-cost-ui.test.ts tests/app/trial-ui.test.ts tests/app/quote-mobile-ui.test.ts tests/app/quote-device-draft.test.ts tests/app/contract-quote-terms.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/quote-edit-requests.mjs
```

The API tests use the real router/PostgreSQL migrations in local PGlite: pending/rejected requests cannot edit, only Managers decide, other employees cannot reuse grants, view-only shares cannot request, revoked shares cannot save, supplier/anonymous requests are blocked, stale/cross-quote decisions fail, duplicate requests/decisions do not duplicate notifications, private costs remain protected, and approved linked orders block earlier grants.

The browser script uses the actual local CRM/router at 1440px and 430px with synthetic employee/Manager sessions. It checks cancel/reopen resets, double-click suppression, reason text displayed without HTML execution, full reason readability, rejection reason validation, visible dialog actions, no horizontal dialog overflow, permission unlocking and save returning to draft. Screenshots default to `/workspace/artifacts/quote-edit-requests`. Production records and external push/Sapo endpoints are not used. PGlite validates atomic behavior but is not a load/concurrency benchmark against a live PostgreSQL server.

The older isolated VM tests must provide the new dependencies as well: the contract amendment harness registers the real edit-request routes and state reader, models row locking, and returns no audit events when testing an unpermitted employee. The mobile capture harness supplies the edit-control renderer and checks both locked and explicitly permitted states. These fixtures retain the API edit/delete and download gates; production checks are not relaxed for test compatibility.
