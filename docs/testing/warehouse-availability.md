# Warehouse rewarded dispatch and approved payroll

Manager opens **Kho của tôi** → **Giao việc có thưởng**. New work defaults to one workload point; choose a due date and standard minutes. Auto recipient reserves the longest-idle eligible worker. When nobody is free, the job stays in the explicit dispatch queue. Existing todo backlogs are never automatically adopted.

- Free: no pending offer, working or blocked job. Completed/submitted work frees the worker before Manager review.
- Waiting acceptance: the offer reserves one slot. After five minutes Manager sees a reminder and can reoffer to another free worker, with a reason.
- Working: starts on **Nhận việc**. Blocked still occupies the slot. Employee cannot receive a second rewarded job.
- Rework: retains owner and first-pass error, queues behind their active work. Queue/Manager waiting is excluded from measured working time, employee response delay remains included.
- Legacy in-progress tasks also block new dispatch. Multiple old active jobs show a warning for reconciliation.

Dispatch/start/release transactions share a PostgreSQL advisory lock and employee/task row locks. Create has a stable request UUID and payload hash: an identical retry returns the original job; changed content conflicts. Auto dispatch runs during create/configure/completion and every 15 seconds while the warehouse screen is active, visible and not editing a form. No external scheduler is required for newly released work.

## Monthly reward

Existing score weights/rates are retained. Monthly fund is **per worker**, multiplied by the score factor (90+: 100%; 80+: 80%; 70+: 50%; below 70: 0%). No extra attendance scaling is added. A Manager must confirm results/waits; unknown fund or incomplete scoring blocks official approval. Current-month demo stays read-only.

Official approval after month end freezes the amount in the existing unique employee/month snapshot, tagged `payrollBonus.version = 1`. It becomes one **Thưởng công việc Kho** income line in that month's open payroll, employee payslip, quick sheet and Excel. It also counts as bonus in profit staff costs. Old preview-only approvals are excluded to avoid retroactive payment. No adjustment records or automatic bank transfers are created.

Approval and HR confirmation share the payroll transaction lock (before warehouse lock). Frozen/paid slips prevent reward approval. Reopening an unpaid slip recalculates the same approved source once; paid slips stay immutable. Payroll confirmation fingerprints include the approved amount.

## Deployment

Apply `migrations/postgres/20261110041042_warehouse_dispatch_availability.sql` before API deploy. It only adds auto_dispatch, queued_at, offered_at and creation_hash. RLS/grants, old runs and approved snapshots remain intact. `scripts/sql/assert-warehouse-workspace.sql` gates deployment. Production migration was applied through Supabase migration tooling under that exact version; do not rerun unrelated migration-history repairs.

## Verification

- `node --import tsx --test --test-concurrency=1 tests/app/warehouse-availability.test.ts tests/app/warehouse-payroll.test.ts tests/app/warehouse-workspace.test.ts`: native PostgreSQL17, pool20: 17 tests passed, including concurrent dispatch and payroll closing.
- PGlite: new dispatch/payroll files passed, ensuring CI engine compatibility.
- `PLAYWRIGHT_MODULE=<installed playwright> node --import tsx scripts/testing/warehouse-availability.mjs`: local CRM/router, blocked external requests; Manager1440 and390, worker390, screenshots inspected. Covers blocked/free transitions, queue handoff/rework, stable retry after simulated saved-but-lost response, zero JS errors/no horizontal overflow. Official prior-month approval and reward columns in quick/group payroll also exercised. Artifacts `/tmp/warehouse-availability-browser`.
- Native HR/payroll/profit regression: 74 tests pass. Sheet/export PGlite suites pass; typecheck and UI build pass. Full CI recorded on the PR.

No production tasks, score approvals, payslips or payments are created by these tests.
