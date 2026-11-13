# Accounting SKU/quantity file import

Open Accounting → select legal entity and book → View report → Documents → Nhập file SKU / SL.
The document dialog also offers a two-column XLSX template (`SKU`, `SL`). Keep SKU cells as Text.
Only the first worksheet is read. Supports XLSX/XLS/UTF-8 CSV, maximum 5,000 nonempty data rows and 5 MB. Worksheets whose used range extends beyond 5,001 rows (including header) are rejected conservatively, including formatting-only trailing rows: clear unused rows/export a fresh sheet. No silent truncation, automatic posting or production migration.

A dedicated worker parses files with a 15-second timeout. A single authorized API lookup resolves names/units for known SKUs, without reading prices, tax defaults, stock or supplier details. Unknown SKUs require explicit name/unit. Quantities must be positive (up to 3 decimal places); comma-formatted text, formulas, duplicate SKUs and extra columns are rejected. Numeric Excel quantities use the raw number, preserving thousands-format display compatibility. SKU codes already damaged by Excel cannot be reconstructed.

Import appends to the current form atomically. Paging shows 25 editable rows; document review shows 50 rows. Closing/reopening clears the unsaved form. Imported rows have no assumed monetary valuation or tax. Before saving, provide each line's total before VAT from reconciled evidence; quantity alone does not establish accounting value. A 5,000-row request is saved in 200-row inserts inside one transaction. A failure rolls back all inserts and the header. Existing Manager-only approval, identity guards and duplicate opening/reference controls remain.

Existing reporting safety limits remain 2,000 headers/10,000 total lines per legal entity. New document writes are rejected before exceeding the line limit so an import cannot leave the book inaccessible to the current report. This is not a six-file workaround for a 30,000-row opening: one book can only have one approved opening. Larger opening balances require a separate staged import/reporting design.

Validation (isolated synthetic data, not production):

- `npm run typecheck`, `npm run ui:build`
- `node --import tsx --test tests/accounting-file-import.test.ts tests/accounting-domain.test.ts tests/accounting-workspace.test.ts tests/architecture.test.ts`
- `node --import tsx --test tests/app/trial-ui.test.ts`
- `PLAYWRIGHT_MODULE=... node --import tsx scripts/testing/accounting-workspace.mjs`

Chromium covers Manager/Accounting and denied roles, widths 320/390/430/1440, template download, Excel worker import of 5,000 rows (including text leading-zero SKU and numeric thousands format), 30,000-row CSV rejection, retained edits across pages/rejected upload, reset after closing, screenshots and dialog/footers within viewport.
Local observed parser ~7 ms; full XLSX import/lookup/preview ~376–398 ms; 5,000-row draft PostgreSQL WASM ~408 ms, approval ~122 ms. These are synthetic local measurements, not production throughput guarantees. No standalone lint command is configured; diff whitespace and UI/type/build checks apply.
