# Edge resource audit — 18 November 2026

Status: code/test change only. No production migration, cron change, deployment, connection-string change, index, or business-data repair was performed for this investigation. Production improvement must be measured after an approved rollout.

## Evidence before changes

Window: **18/11/2026 00:00–09:47 Asia/Ho_Chi_Minh**, equivalent to `2026-11-17T17:00:00Z`–`2026-11-18T02:47:00Z`. Read-only unified Supabase logs for project `taceqfnsorewelsbdckg`.

Joined `function_edge_logs.execution_id` to `function_logs.execution_id` / `event_type=Shutdown`:

| Route suffix | 546 responses | Shutdown reason | Maximum CPU (ms) | Maximum reported memory (MiB) |
| --- | ---: | --- | ---: | ---: |
| `/integrations/sapo/pull` | 6 | CPUTime | 2039 | 72.9 |
| `/integrations/ghn/pos-lock/pull` | 4 | CPUTime | 2002 | 58.7 |
| `/integrations/warehouse-work/reconcile` | 2 | CPUTime | 2002 | 58.7 |
| `/catalog-snapshot` | 1 | CPUTime | 2034 | 32.4 |
| `/notifications/read` | 2 | CPUTime | 2000 | 41.2 |

All fifteen responses carry `sb_error_code=WORKER_RESOURCE_LIMIT`. Sapo failed five times on version 2262 and once on 2270; GHN/warehouse/notifications failures were already present on 2262. Function version 2278 was observed active when investigation began; that deployment concerned Drive permissions. Do not attribute earlier CPU failures solely to the 2270 deployment.

There were **32 total HTTP 503s**, of which **28** explicitly carry `SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED` (mean 235 ms, maximum 461 ms; no worker version/execution ID). The other four have no platform error code and took approximately 11.6 seconds; they remain unclassified. No matching `API database unavailable` log was found in this window. A deployment overlap is temporal evidence, not proof of causation.

Example safe correlation IDs:

- Sapo 546, `2026-11-18T02:37:20.554Z`: execution `9880b677-dda2-4413-9331-a0592fdcaac2`, request `01a1ec83-c8aa-7dc6-a4af-03aeb4cde59e`.
- Catalog 546, `2026-11-18T02:34:13.430Z`: execution `9cd1f938-30fa-4bea-8c9a-aaf1812e297a`, request `01a1ec81-2294-7d61-9536-ca6e66c278b3`.
- Platform 503, `2026-11-18T02:30:16.058Z`: request `01a1ec7d-9546-75e3-ae95-c60f8e52b0a9`; execution ID absent.

Code-confirmed amplification:

- Sapo processes staff, up to 12 customer pages, 12 product pages, six stock pages and four pages per document kind inside one request. Cursor persistence occurs only at request completion. Product imports issue an upsert for every SKU, price policy and warehouse separately.
- GHN performs up to 100 POS + 100 Lock web + 100 Minh Long web reads sequentially, then scans up to 500 stock-repair candidates. A process-local throttle is not cross-isolate exclusion. Unchanged web rows do not advance `updatedAt`, so oldest-first polling can starve subsequent rows.
- Warehouse repair runs all five rule families and reconciles them together. Scoped receipt reminders previously still loaded the entire receiving calendar/history before filtering. Packing descriptions repeatedly filtered all lines per slip and constructed a number formatter per number.
- Catalog full snapshot reads every active product using `select *`, all prices, and all stock. Actual counts: **12,064 active products, 72,300 prices, 24,550 stock rows**. The Edge wrapper then decoded every JSON response to text and created another Blob for gzip.
- Notification visibility launches up to 100 permission checks at once; marking read performs one write per note.

Application slow logs show direct DB mode, up to **358 queries / request** for warehouse repair and **210** for GHN. Their logged slow-request p95 values were 9,219 ms and 16,123 ms respectively (not the distribution of all requests). Notifications reached 30 concurrent requests per isolate. These measurements establish workload/concurrency pressure, not the CPU share of an individual helper.

**Not proven:** the exact per-helper production CPU breakdown; an out-of-memory cause for these fifteen requests; all 24 pooler timeouts belonging to CRM; a single SQL query causing the failures; deployment causing platform degradation. Multiple routes may share a worker, so a request receiving 546 does not prove it alone consumed the entire CPU allowance.

## Database and query checks

`index.ts` acquires a shared lifecycle client per active isolate, not a connection per row. Direct mode uses `max=1`; the optional transaction-pooler path uses `prepare:false`. Health and application logs showed the direct lifecycle/configuration branch. This label is not independent proof of the actual hostname/port or Supavisor transaction-mode configuration; those server-only endpoint settings were not exposed in the collected evidence. Nothing in this change switches the DB URL, enables the canary, raises pool size, or changes compute. Supavisor/PgBouncer logs do not expose a CRM request/application correlation in the evidence collected; timestamps alone cannot attribute those 24 timeouts.

Read-only `EXPLAIN (FORMAT JSON)` of the actual unfiltered stock projection showed a sequential scan, estimated 29,435 rows / width 63 / cost 921.35. Since that query asks for the whole table, this is not evidence that an additional index would fix it. No index was proposed or created.

The customer identity deduplication directory and final warehouse dispatch retain their existing whole-directory reads, preserving matching/assignment semantics. At inspection the warehouse tables contained four parts, five active runs and one queued run; these are current counts, not a reconstruction of the incident window. Neither retained directory read is proven to be the primary CPU consumer. Further narrowing needs profiling and business-equivalence evidence.

`/pos/stock-snapshot` already filters by the register warehouse and selected policy, runs a read-only repeatable-read transaction, caps preload at 20,000 products and falls back to the paged catalog above that. Those business/read semantics are retained.

Cron metadata confirmed GHN, SePay and warehouse repair all used `*/5 * * * *`; Sapo used `7,37 * * * *`. The installed `pg_cron` is 1.6.4 and supports second-based schedules.

## Change map

- `supabase/functions/baogia-v2-api/index.ts`, `src/core/http/edge-body.ts`: forward request streams so route byte limits operate before a second full allocation; stream encoded response bytes/gzip; rewrite JSON only for login session tokens. Slow logs add a safe random trace ID and paged/legacy/job workload label; response header `x-crm-request-id` supports future correlation.
- `src/modules/catalog/api/routes.ts`, `catalogue-stock.ts`, `trial-ui/catalog-snapshot-loader.js`, `app.js`: opt-in 500-product pages read prices/stock only for page SKUs and visible active warehouses; browser assembles at most two concurrent pages, validates version/metadata, drains failures before retrying, and never caches a partial snapshot. Legacy callers retain the full response shape/order; stock deltas and unchanged responses remain supported. Warehouse held-stock fanout is capped at two.
- `src/core/http/external-request.ts`, Sapo client, GHN lookup: deadlines include response body; at most two transient read attempts with bounded exponential backoff/jitter. Sapo read timeout is 10 s, whole durable Sapo step deadline 25 s; GHN detail is 5 s. Text responses are capped at 8 MiB (Sapo) / 1 MiB (GHN), oversize pages fail explicitly. Sapo writes never retry. GHN POST **detail** is explicitly read-only; create/update/cancel are not given this retry policy.
- `src/core/jobs/sync-jobs.ts`, DB schema, `src/app/sync-job-worker.ts`, Sapo/GHN/warehouse route modules: durable coalesced jobs, globally leased single-step dispatch, fenced checkpoints, expiry recovery and three-attempt backoff/dead-letter. User requests enqueue; cron executes one bounded step. No `waitUntil` queue or per-item DB connection. Existing transactional stock/COD locks and idempotency keys remain in use. The original five-minute Sapo business lease is retained; a recovered job defers while that lease is active without exhausting its error-retry budget.
- Sapo runs one data page/phase per step, persists each cursor and retains the legacy per-cycle quotas: 3,000 incremental records, 1,500 rotating-stock products and 1,000 documents per kind, split into bounded steps. The next scheduled job resumes any remaining cursor. Price/stock upserts batch at 500 rows in the same transaction, deduplicate to the previous last-write-wins behavior and preserve missing product fields. Optional document permission failures remain warnings. The legacy `page` cursor stays in 250-row units; an old function can overlap a partial page on rollback, never skip it.
- Warehouse worker selects one source ID at a time, including open orphan task references, and only closes tasks within that source/prefix. A failed source read cannot close tasks. Scoped purchase/calendar/reminder reads receive SQL filters. Closed unrelated documents and accounting reminders are not reconciled by a partial warehouse page.
- Notifications retain per-note authorization, cap visibility fanout at two / recipient delivery at four, and bulk mark read with conflict protection. Existing RLS/auth policies are unchanged.
- Additive migration creates **only** `edge_sync_jobs`, with RLS and no client policies. Existing business tables, stock quantities and tax formulas are not changed. GHN error details retain up to 20 authorized order references plus total `errorCount`; transport/DB payloads are not logged.

## Validation and measurements

New tests cover page boundaries/overflow, stale snapshot versions, exact equality of paged vs legacy catalog ordering/values, hidden warehouse visibility, two-request browser concurrency, no partial cache, external body timeout/size limits, no write retries, bounded backoff, drained concurrency failures, gzip/login response equivalence, durable enqueue coalescing, cross-caller exclusion, expired/stale leases, three-attempt failure, router restart, Sapo resume, GHN failure/unchanged-row progress, no double stock issue, and warehouse failure-safe scoped closure.

Deterministic local Sapo comparison against the pre-change implementation: 50 SKUs × six policies × two warehouses, same PostgreSQL/PGlite fixture, warmed runs, alternating order, three runs per implementation:

| Metric | Before | After |
| --- | ---: | ---: |
| SQL statements per batch | 453 | 55 |
| Median local wall time | 249 ms | 56 ms |
| Median local process CPU | 296 ms | 95 ms |

These are **local Node/PGlite** figures, not Deno production CPU or end-to-end CRM latency. Query-budget regression test requires at most 60 statements and verifies all 300 price / 100 stock rows, repeated SKU last-write-wins, and no loss of existing fields.

Local validation: 20 new test cases across eight files passed, together with the targeted catalog, Sapo, GHN/COD/stock, receipt reminders, warehouse assignment, notifications, Edge DB lifecycle, architecture, AI-chat integration and November schema-gate regressions. TypeScript checking, UI build and the Edge import-graph bundle passed. The full repository suite is a separate PR CI gate; local focused results are not a claim that all repository tests have run.

Reproduce the new coverage with Node 22.22:

```sh
npm run typecheck
node --import tsx --test --test-concurrency=2 tests/core/edge-resource-bounds.test.ts tests/core/sync-jobs.test.ts tests/app/edge-sync-worker.test.ts tests/app/catalog-snapshot-pages.test.ts tests/app/sapo-bulk-resource.test.ts tests/db/edge-sync-job-schema.test.ts tests/db/edge-sync-worker-cron.test.ts tests/app/edge-db-lifecycle.test.ts
npm run ui:build
```

Production before/after error rates, p95 latency, worker CPU and pool wait remain unmeasured after the change because this branch is not deployed. Platform 503s may persist independently: see [Supabase runtime limits](https://supabase.com/docs/guides/functions/limits) and [background task limits](https://supabase.com/docs/guides/functions/background-tasks).

## Reviewed deployment procedure — do not skip gates

1. Record the currently ACTIVE deployment version, exact source commit and rollback artifact; do not assume version 2278 is still current. Review the additive migration and worker schedule. In staging first, apply `migrations/postgres/20261118050000_edge_sync_jobs.sql`, then `supabase/edge-sync-jobs-cron.sql`. The latter requires pg_cron ≥1.6 and reuses the existing Vault sync secret; no token is embedded in SQL. A 1-second DB readiness check sends **no HTTP** while idle or leased; it does not run three sync services concurrently.
2. Repeat those two SQL steps on production **only after approval**. Do not apply unrelated advisor indexes or migrations. Existing producer schedules continue unchanged and enqueue work after the API deploy. Installing the worker before API deployment is safe while the new queue is empty.
3. Run `scripts/sql/assert-edge-sync-jobs.sql` and `scripts/sql/assert-edge-sync-worker.sql` read-only. It must confirm the table, RLS with no client policies, worker function and active schedule. The API deployment workflow now runs these gates before changing deployment configuration.
4. Use the existing API deployment workflow for the reviewed commit; then the dependent UI workflow. Deployment smoke GHN calls now enqueue; a 200 alone does **not** prove GHN completion. Check `/admin/sync-jobs` as Manager and the worker's `Sync job step` logs for actual progress/completion. Reload CRM to activate paged catalog loading; old tabs retain the compatible full-snapshot path until refreshed.
5. Staging: enqueue Sapo, normal GHN, terminal recheck, and warehouse jobs; kill a worker mid-step and confirm resumption / no duplicate stock or COD. Verify completed receipts/cancellations and permission revocation. In production observe existing scheduled jobs rather than create synthetic orders or stock adjustments.
6. Verify browser catalog requests contain `pageSize=500`, each page has at most 500 rows, at most two are in flight, page/stock-only/unchanged paths work, and unauthorized users cannot call worker/admin routes or see private warehouse stock.
7. Compare equivalent traffic windows, segmented by route, version and `workload`: 546 CPUTime count, `Sync job step` timing, query counts, request p95, queue oldest age/failures and provider timeout counts. Join future 546s to shutdown reason by execution ID. Track platform-coded 503 separately; attach the safe request IDs/timestamps to a Supabase support incident if it persists. Pool attribution still needs server-side application/connection timing correlation; do not infer pool wait from total request duration.

## Rollback

- Pause `edge-sync-jobs` and the Sapo/GHN/warehouse producer schedules before reverting the API; leave the unrelated SePay schedule alone. Keep queued job rows/cursors for recovery; do not drop the table or reset stock/COD/history.
- Redeploy the previously verified main API commit through the existing workflow; roll back UI if necessary. A new UI tolerates old unpaged responses; old UI tolerates the new legacy endpoint. Sapo legacy page units intentionally overlap partial new pages, avoiding missing rows on rollback.
- Do not automatically resume the old heavy schedules: they had confirmed CPU failures. Diagnose the rollout issue first, then either fix forward and re-enable the durable worker or explicitly review a reduced legacy schedule. Expired leases / idempotent writes allow safe replay after recovery.
- Never treat rolling back application code as a remedy for `SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED` without independent platform evidence. No business-data rollback or destructive down migration is required.
