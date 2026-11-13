# Accounting SKU/quantity file import

Open Accounting → select legal entity and book → View report → Documents → Nhập file SKU / SL.
The document dialog also offers a two-column XLSX template (`SKU`, `SL`). Keep SKU cells as Text.
Only the first worksheet is read. Supports XLSX/XLS/UTF-8 CSV, maximum 5,000 nonempty data rows and 5 MB. Worksheets whose used range extends beyond 5,001 rows (including header) are rejected conservatively, including formatting-only trailing rows: clear unused rows/export a fresh sheet. No silent truncation, automatic posting or production migration.

A dedicated worker parses files with a 15-second timeout. An authorized API lookup resolves names/units and the current CRM regular retail/list price for known SKUs. The selected policy is Giá bán lẻ (or an exact regular retail/list equivalent), never wholesale, purchase cost or a VAT-inclusive fallback. Production was verified read-only to have a separate Giá bán lẻ policy. No stock/supplier data or automatic tax defaults are read. Unknown SKUs require explicit name/unit. Quantities must be positive (up to 3 decimal places); comma-formatted text, formulas, duplicate SKUs and extra columns are rejected. Numeric Excel quantities use the raw number, preserving thousands-format display compatibility. SKU codes already damaged by Excel cannot be reconstructed.

Import appends to the current form atomically. Paging shows 25 editable rows; document review shows 50 rows. Closing/reopening clears the unsaved form. At the user's explicit request, imported rows are valued using the current CRM listed selling price: line total = rounded(quantity × listed unit price), with the policy and lookup timestamp recorded in the note and unit price shown per row. This is a selling-price valuation, not accounting purchase cost. Missing/invalid prices stay blank and block saving until resolved; no missing-to-zero conversion. Totals are captured in the draft, not dynamically revalued when CRM prices change. No automatic tax rates are applied. Manager must review the valuation and original evidence before posting. A 5,000-row request is saved in 200-row inserts inside one transaction. A failure rolls back all inserts and the header. Existing Manager-only approval, identity guards and duplicate opening/reference controls remain.

Existing reporting safety limits remain 2,000 headers/10,000 total lines per legal entity. New document writes are rejected before exceeding the line limit so an import cannot leave the book inaccessible to the current report. This is not a six-file workaround for a 30,000-row opening: one book can only have one approved opening. Larger opening balances require a separate staged import/reporting design.

Validation (isolated synthetic data, not production):

- `npm run typecheck`, `npm run ui:build`
- `node --import tsx --test tests/accounting-file-import.test.ts tests/accounting-domain.test.ts tests/accounting-workspace.test.ts tests/architecture.test.ts`
- `node --import tsx --test tests/app/trial-ui.test.ts`
- `PLAYWRIGHT_MODULE=... node --import tsx scripts/testing/accounting-workspace.mjs`

Chromium covers Manager/Accounting and denied roles, widths 320/390/430/1440, template download, Excel worker import of 5,000 rows (including text leading-zero SKU and numeric thousands format), 30,000-row CSV rejection, retained edits across pages/rejected upload, reset after closing, screenshots and dialog/footers within viewport.
Local observed parser ~7 ms; full XLSX import/lookup/preview ~376–398 ms; 5,000-row draft PostgreSQL WASM ~408 ms, approval ~122 ms. These are synthetic local measurements, not production throughput guarantees. No standalone lint command is configured; diff whitespace and UI/type/build checks apply.

Follow-up validation: retail vs wholesale/VAT policy separation, missing prices and absent retail policy, UI amount 1,000 × 12,345 = 12,345,000, provenance note, retained edits through pagination; all 16 targeted tests pass. Worker library URL now uses new URL so deploy stamping attaches a content version; stamp suite 9/9 passes (fixes initial PR #652 shard-3 failure).
