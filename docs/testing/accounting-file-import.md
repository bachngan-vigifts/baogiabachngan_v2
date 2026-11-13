# Nhập file SKU / SL vào sổ kế toán

PR #652 retains the manual document form (up to 5,000 lines) and adds a separate **Nhập file SKU / SL · 30.000 dòng** action beside it. Select a legal entity/book first. The new wizard reads the first Excel/CSV sheet, offers a two-column XLSX template, accepts at most 30,000 rows/20 MB, and parses in a dedicated worker with a 45-second bound. SKU cells should be Text; quantity accepts a positive number with up to 3 decimals. Formulas, extra columns, corrupt/oversized files and an over-limit used worksheet range are rejected without starting a server job.

## Durable workflow

1. Parse and back up source SKU/quantity rows in device IndexedDB before creating a job. No credentials/tokens or product prices are stored in this backup. Cache quota failure stops before creating the job.
2. Create an owner-bound job with book/entity, date/kind/reference, file SHA-256 and total row count. A repeated create with the same ID must match the original metadata.
3. Send sequential 500-row chunks. Each chunk and its receipt commit in one DB transaction. Each receipt has a server-computed canonical hash; an identical resend returns the prior receipt and a different resend is rejected. No giant 30,000-row request or page with 30,000 editable inputs.
4. Resolve the current CRM **Giá bán lẻ** policy (regular list price before VAT, never wholesale/purchase/+VAT fallback). Store unit price, price timestamp, name, unit and rounded quantity × price per staged row. Prices are captured per chunk; accepted chunks are not revalued on retry. This is the user-selected selling-price valuation, not accounting purchase cost; no automatic tax/8% default.
5. Keep original Excel row numbers and durable error codes for missing SKU, unavailable product, missing unit/price, invalid quantity/value and duplicate SKU, including duplicates in earlier chunks. Continue validation through all chunks so the error report is complete. Unknown products are not created and errors are not silently skipped. Download the report as UTF-8 CSV with formula-safe escaping.
6. Only after all rows are received and all errors are resolved can the owner explicitly create **one draft**. A transaction inserts the header and performs a single server-side INSERT SELECT of all staged lines, then marks the job completed. Failed finalization rolls everything back; replay returns the same document ID. Manager approval remains separate and still prevents a second opening for one book. Physical inventory is untouched.

The wizard can pause after an in-flight chunk, close and reload. **Closing the tab stops sending further chunks; it does not run as a background server worker.** Open the same account/book, select the recent job and press Continue to resume from server receipts. If IndexedDB was cleared/evicted, select the original file: its SHA-256 must match. Changing the file cannot replace accepted chunks; cancel and create a new job for corrected data. Server progress persists independently of device storage. Other users, even other permitted accounting users, cannot inspect or resume the owner's staging jobs. Role loss/session expiration stops requests.

The three private staging tables are additive, RLS-enabled and deny PUBLIC/anon/authenticated direct access. Migration: `20261113062905_accounting_resumable_imports.sql`. The new read-only deploy gate and November coverage mapping are wired before API deploy. This migration has **not** been applied to production as part of this work.

## Reports and limits

The old 10,000-line entity report ceiling would reject a 30,000-line opening. It is now bounded at 50,000 total historical lines/2,000 document headers per legal entity, with explicit errors rather than truncated calculations. Both manual writes and import finalization check the entity line budget before commit. Financial totals are still computed over complete data; the UI requests only 50 stock rows and 25 alerts per page. Fingerprint lookups use one JSON-bound SQL parameter to avoid PostgreSQL's parameter limit for a large alert set. Document review shows 50 rows/page.

## Validation

All data below are isolated synthetic records; no production imports/stock changes were performed.

- `npm run typecheck`; `npm run ui:build`; `git diff --check`.
- `node --import tsx --test tests/accounting-resumable-import.test.ts tests/accounting-file-import.test.ts tests/accounting-domain.test.ts tests/accounting-workspace.test.ts tests/architecture.test.ts tests/db/november-migration-gates.test.ts tests/app/stamp-ui-version.test.ts tests/app/trial-ui.test.ts`: **37 pass**.
- `PLAYWRIGHT_MODULE=... node --import tsx scripts/testing/accounting-workspace.mjs`: existing manual/5k forms and Manager/Accounting/denied roles at 320/390/430/1440, no JS errors/overflow/footer collisions.
- `PLAYWRIGHT_MODULE=... node --import tsx scripts/testing/accounting-import-resume.mjs`: real 30,000-row XLSX through the actual UI/API/PostgreSQL WASM, 60 chunks; close mid-request, page reload, offline/online continuation, lost COMMIT acknowledgement, finalization replay, missing SKU and duplicate SKUs, error CSV, cancellation, device cache eviction, wrong original file and cache quota failure before job creation. Screenshots: `/tmp/accounting-import-resume`.

Backend tests deliberately fail the 251st insert in a chunk and in finalization, then verify there are no partial rows/receipts/documents. They also cover concurrent repeat posts, changed retry bodies, out-of-order chunks, premature finalization, cancellation, exhausted network retries, expired sessions and owner/role isolation. The migration/gate replay is idempotent and read-only; exposure to authenticated and a missing column are rejected by the gate. The architecture dependency map explicitly declares Accounting's existing Staff/Catalog/Sales/Suppliers dependencies.

Representative local 30k measurements: upload/validation 4.6 s, atomic draft finalization 410 ms, approval 380 ms, complete report computation with a paged response 537 ms. Concurrent local test runs vary; these are **not production throughput guarantees**. No production DB TCP connection was killed and no real user data were used for load testing. No standalone lint script is configured; type/build/asset/whitespace checks apply.
