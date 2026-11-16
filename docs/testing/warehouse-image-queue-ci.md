# PR 697 CI repair

Confirmed failures in run 43775668003:

- The new warehouse-image migration had no entry in November migration coverage/deployment gates. Supabase Preview itself passed.
- Shared payroll fixtures scheduled the next care appointment on a fixed 15 November 2026. The run crossed to 16 November in Vietnam, so the real care validation correctly returned 400. Dashboard KPI/member-target tests asserted 201; other salary/KPI tests silently received no activity and calculated zero transactions.

Repair keeps the historical activity/KPI period and all production date validation unchanged. The fixture now chooses one future next-appointment date per setup, preserving an identical payload for idempotent retries. The explicit activity-edit test uses that same fixture date. No tests are skipped or assertions weakened.

The new read-only SQL gate checks both tables, columns/nullability/types, primary keys, image-hash uniqueness, RLS, status constraint and queue index. It is mapped to the existing migration and wired into API deployment. Local tests exercise repeated READ ONLY execution and reject ten partial schemas. The existing migration is unchanged; this work does not execute it on production.

Additional queue safety regression: HTTP failures/timeouts are ambiguous even when the worker accepted the image. Keep the image, callback token hash and global slot in needs_review, block later dispatches, and accept a valid late callback. A callback-confirmed terminal result consumes the token and releases the next job. HTTP failure after a completed callback cannot overwrite the completed result. This prevents automatically overlapping Madam Sen executions after a lost acknowledgement. Provider callback setup is still required before enabling production; this patch does not configure the external n8n workflow.

Validation commands:

```sh
npm run typecheck
npm run ui:build
node --import tsx --test --test-concurrency=2 tests/app/dashboard-kpi.test.ts tests/app/payroll-member-targets.test.ts tests/app/sales-activity-payroll.test.ts tests/app/independent-contract-rewards.test.ts tests/app/payroll-appsheet-policy.test.ts
node --import tsx --test --test-concurrency=2 tests/db/warehouse-image-queue-gate.test.ts tests/db/november-migration-gates.test.ts tests/app/warehouse-image-jobs.test.ts
```
