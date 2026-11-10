# CRM intermittent latency — measured investigation, 10 November 2026

All operational timestamps below use UTC; Vietnam time is UTC+7. Production work was read-only: log/stat queries, bounded EXPLAIN ANALYZE SELECTs (5s statement timeout, READ ONLY transactions), three public auth-config probes and existing public image GETs. No migration, connection setting, pool capacity, compute, index, RLS or Storage object was changed by the investigation.

## Confirmed findings and fixes

1. **POS stock preload query is expensive, and can hold up the shared direct client.**
   - UI: `trial-ui/pos.js:refreshStockSnapshot` → GET `/pos/stock-snapshot` → `pos-routes.ts` → `pos-stock-snapshot.ts:readPosStockSnapshot` → products/prices/ledger stock, barcode batch and reservations.
   - PostgreSQL auto_explain at `2026-11-10 00:33:34.248 UTC` reports 11,115.620ms for its sku/price/qty scan, application `postgres.js`, session `6af2664f.173950`. The exact SQL shape matches the metadata-free preload, not the paged product list. Its brand/name transliteration/regex is evaluated over the full catalog.
   - Function slow log, execution `04f711d8-ec28-4caa-b233-974e88c29e94`: stock snapshot ends `00:33:38.605`, total18,775ms, readiness871ms,39 business queries. SQL log falls inside that request interval. Concurrent public auth-config reports0 business queries yet readiness6,927ms; other reads in the same isolate show the same readiness delay. This supports shared-client/probe queuing, rather than proving a Supavisor quota incident.
   - **Correlation caveat:** logged query_id `-4778443033376470974` currently points to different SQL in pg_stat_statements. SQL text matching identifies statement `4635181618632353283` (observed mean721.46ms/max12,457.22ms across3,471 calls). Do not join solely by that log ID or claim a unique gateway request ID without a request/SQL span tag. The historical gateway search did not yield a one-to-one match for the18.775s request.
   - Read-only production EXPLAIN: old query2,493.146/540.831ms; equivalent bulk predicate227.084/189.480ms, alternated order for the second pair. Both return1,849 rows; shared block hits18,735→1,343; physical reads0. Existing index scans/merge plan becomes a hash plan with fewer block visits. The other family predicate also measured1,498.153→626.570ms, identical10,714 rows and18,738→1,343 shared hits. These are two SELECT measurements, not a user-facing p95 or LCP claim.
   - Fix only the bulk preload: reject an opposite family by its short brand first, otherwise run the original full brand+name expression. Combined-name fallback preserves matches spanning brand/name boundaries. Paged catalog retains its original early-LIMIT predicate. Compared all12,044 production products:0 predicate mismatches for the measured Lock scope. Fixture tests cover both families, mixed/common registers, accents, combining marks and boundary cases. Permissions, reservations, checkout and actual stock deductions are unchanged.

2. **Public login configuration unnecessarily waited for DB readiness.**
   - `/auth-config` handler reads only deployment configuration. Edge entrypoint nevertheless awaited its shared `select1` probe before entering the router.
   - Same-isolate historical evidence above shows6.927s of readiness with0 business queries. Three live public GETs in Seoul before the fix: DB readiness155.3/124.3/126.2ms, server159.0/125.3/126.9ms; total client1,071.0/518.5/417.6ms. No response body, key or session was recorded.
   - Fix: skip the readiness probe only for exact GET `/api/staff/auth-config`. Normal router authorization remains; authenticated reads, all writes, and other paths retain readiness. Tests exercise the real Edge handler with a failed DB and the real public router with a DB proxy that throws on access.

3. **Combined menu badges bypassed background priority.**
   - `openWorkspace` starts page loading plus `loadAll/loadBadges` → `/badges` → authorized batched tasks/navigation/chat/care/stock routes. Existing background classification listed the individual endpoints but omitted `/badges`.
   - Production slow-log subset includes37 queries for this request and long tails. Controlled real-CRM/router browser traces show it starts alongside products/orders/POS foreground requests. Fix classifies the combined endpoint as background. All four traces after the fix place badge dispatch after the primary page API completes. Number of requests is unchanged; no blanket retry/caching or permissions changes.

## Checks which did not justify changes

- Current source does not create a Supabase SDK client for each product image. Public thumbnails are stable128px list/320px grid transform URLs; originals remain for detail/export. Private/signed paths retain their existing mechanism.
- Browser traces on Home, Products, Orders and POS use synthetic accounts/data and real public images;8 initial thumbnails on Products and8 on POS,0 original thumbnail requests,0 repeated API paths,0 JS errors. No private production browsing/session was available. This bounds the finding to these initial flows; it does not rule out duplicate requests or N+1 on every action/page.
- Query-budget test compares product lists of1 vs50 rows and POS preload with/without metadata: fixed query counts, no query-per-result growth. Existing batched barcode lookup and client lifecycle are retained.
- One client is shared only while requests/background work use it; direct mode max1 and final close are deliberate protections against accumulating idle sockets. This investigation does not increase connections or replace the lifecycle.
- Matched route/region cohorts show slower Singapore requests, but they are observational groups, not an A/B experiment. Examples: stock snapshot p50Seoul1,391ms(n483) vsSingapore8,860ms(n21); products521ms(n485) vs5,443ms(n5). Existing regional routing/fallback was not changed; the user's specific reason for falling back still needs their browser timing/attempt report.
- For10Nov06:00–07:00UTC, Storage edge origin times: resized public images147x200,p951,264.9ms,max3,074ms;416x304,p95237.25ms. Public originals49x200,p951,115.6ms;51x304,p95221ms. Other Storage6x200,p952,723.25ms. These are gateway-origin metrics, not browser page load or pure DB time. Original requests cannot be assigned to list/detail/export from these logs alone.
- For9Nov07:00→10Nov07:00UTC, oneFATAL08006 is `connection to client lost` at9Nov10:34:21.516, applicationpostgres.js. It has no request tag identifying a CRM screen. Other08006 records are LOG severity and must not be counted as FATAL.
- Supavisor events read at10Nov04:44:01 are info-level `No subscribers ... shutting down` and `shutting down gracefully`, not a client-limit rejection. In the inspected24h message search no actual max-client/pool-limit rejection was found. The relevant earlier claim remains unconfirmed without the exact event ID/text.
- PgBouncer timeouts inspected in00:00→05:30UTC are77 `idle_timeout` events, not query_wait_timeout/client_login_timeout. This does not exclude a different historical window.

## Timing interpretation

Existing Server-Timing `db` is readiness elapsed: client initialization, connection/probe scheduling and the probe round trip. It is **not** a measure of all query execution or an isolated pool wait. `app` includes DB-client queue waits, DB round trips, business work and serialization. PostgreSQL EXPLAIN/statement stats measure server execution; Storage origin metrics and browser transfer/LCP/CLS are separate measurements. No unsupported subtraction is used to label the remainder as pure network or pure pool wait.

UI paired traces are local CRM/router measurements with synthetic data and real public image reads, not production-page timings. Products LCP660→684ms; Orders596→620ms; Home896→928ms; POS1,956→916ms. Single-trial network/cache variance is significant; **do not attribute the POS LCP change solely to this patch**. CLS stays below0.024. Image requests/bytes stay essentially unchanged; the verified client change is scheduling, not fewer requests.

## Reproduction and artifacts

- `npm run typecheck`; `npm run ui:build`; targeted tests: pos-catalog-brand, pos-stock-preload, crm-query-budget, request-priority-ui, edge-db-lifecycle, product-image-thumbnails, api-region-request, speed-log-ui.
- Browser: save original request-priority.js, provide `PRODUCT_IMAGE_SAMPLES` as a file containing up to8 existing public product-image URLs, set `BASELINE_PRIORITY_FILE`, run `PHASE=before/after node --import tsx scripts/testing/crm-measured-performance.mjs` with installed Playwright/Chromium. Output `/tmp/crm-measured-performance/{before,after}` contains normalized network summaries, screenshots and Performance traces. No HAR/auth headers or production response bodies are exported.
- Safe aggregated log/query evidence: `crm-performance-evidence.json`. Browser summaries: `crm-performance-browser-summary.json`.
- Missing for complete production attribution: user's sanitized “Đo tốc độ” report during a slow interaction (UTC timestamp/route/attempts/region/read times), exact pool-limit event IDs, and a request-to-query tag/span for the historical SQL. Do not request session tokens or connection strings.
