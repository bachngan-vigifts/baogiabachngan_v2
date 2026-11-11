# Notification recipient scope

Reviewed 2026-11-11 against main `6fcf312d`. No production writes, test notifications to real devices, schema changes or permission changes were made.

## Observed production evidence (read-only aggregates)

In the database's last-seven-days window, `packing` notifications included 30 to the IT position and 22 to Design. With **current** warehouse assignments, 410 packing notification records with a non-null order warehouse fall outside the receiving position's assigned warehouses: sales-lock 159, sales-ml 159, IT 28, Design 22, sale-admin 14, warehouse 14, sale 14. These are notification rows, not unique orders or confirmed device deliveries. Permission/assignment history was not reconstructed; this comparison alone does not establish authorization at the original send time.

The current IT position has `data_scope=all` and `page.packing`, but no assigned warehouse. The old packing recipient query used page visibility to select the whole team. Read access alone should not subscribe this position to warehouse operations. Historical Design notifications also exist although its current grants do not include the packing page.

The aggregate of order/contract/quote pending notifications to delegated employee approvers returned no rows in this window. The broad approver selection is therefore a source-level issue/future exposure, not evidence that these specific events were misdelivered to employees in production.

## Rules applied

- Candidate lists still originate from the existing business workflows. The new filter narrows them; it does not subscribe everyone with read access.
- Active, non-deleted staff only. Deduplicate and exclude actor/exceptions in `notifyMany`.
- Orders/contracts: owner/creator/requesting party and configured own/position/department/all scope, relevant page permission, and the existing hard POS store boundary. Accountants retain the existing cross-company order-read scope.
- Pending approvals: approval flag and source scope. Transfer approvals retain the existing counterpart-position matrix and private-warehouse restrictions; they are not replaced with generic warehouse assignment logic.
- Packing/warehouse tasks: relevant action/page permission plus the source warehouse assignment. Read-all scope alone is insufficient. POS warehouse is derived from its shift/counter when the order has no direct warehouse. Before warehouse assignment is configured, the Warehouse team remains the legacy operational fallback. Unknown/unmapped warehouses fail closed once assignment is configured.
- Transfer shipping/completion: source warehouse operators/requester as appropriate. Receipt: destination warehouse staff. Manager retains company-wide authority.
- Cash/return approval: current approval authority and existing drawer/store boundary. Automatic tasks inherit their source document boundary and stop notifying a group after a specific assignee takes over.
- Persisted bell notifications are checked against current scope before exposing previews or marking them read. Already delivered operating-system push messages cannot be recalled.
- New persisted notifications and Web Push share the same explicitly authorized recipient IDs. Lookup failures skip delivery and log a routing error, rather than falling back to a broad role.

Departments come from the position permission model (`staff_positions.department_id`), matching CRM authorization; HR work-company/work-department fields are not independently treated as grants. No new branch model was invented.

## Validation

Validation: 40/40 targeted regression tests passed; an additional private-warehouse visibility guard was followed by a 12/12 transfer/recipient regression run. Typecheck passed.

Targeted tests use real Drizzle/PGlite tables, router/session authorization and synthetic fixtures. They cover encrypted Web Push recipient IDs, own/department scope, page/approval revocation, active/deleted users, read-all IT without warehouse responsibility, POS/web/cash cross-store isolation, source tasks, and legacy role-targeted previews/read-all/read IDs. Existing approval, receipt, task, invoice and cash tests are retained.

Command (Node 22.22.0, no production network calls):

```sh
node --import tsx --test --test-reporter=spec --test-concurrency=4 \
  tests/app/notification-recipient-scope.test.ts tests/app/notifications.test.ts \
  tests/app/pos-notifications.test.ts tests/app/quote-approval.test.ts \
  tests/app/transfer-approval-policy.test.ts tests/app/transfer-receive.test.ts \
  tests/app/tasks.test.ts tests/app/task-peers.test.ts tests/app/invoice-tasks.test.ts \
  tests/app/cash-tasks.test.ts tests/app/pos-access.test.ts
npm run typecheck
```

Local API timing: same DB with 30 targeted notes over 5 orders, one warm-up then 5 requests. Median authenticated in-process `GET /notifications`: before 11.19 ms, after 45.74 ms. Extra cost is current recipient authorization. This is PGlite/local handler timing, **not** production page load, TTFB, browser rendering or push latency. The `/pulse` timestamp retains its existing indexed aggregate and does not load the permission directory. Results are in `performance.json`.

Production rollout still requires merging/deploying the PR, then verifying actual notifications for representative employees/warehouses. No migration is needed and stored notification history is not deleted.

## CI module-boundary correction

The full CI architecture test caught the initial recipient resolver importing business modules from the notifications module. The document resolver now lives in `src/app/notification-recipient-scope.ts`; `app/router.ts` injects it through a small notifications contract, matching the existing task/inventory hook pattern. The notifications module only imports permitted dependencies. Missing wiring fails closed through the existing send error handling. No architecture allowlist or test assertion was relaxed.

Verification after this correction: architecture + recipient/Web Push/POS tests 14/14 passed; typecheck passed. Earlier business validation remains applicable because the document recipient rules were moved unchanged.
