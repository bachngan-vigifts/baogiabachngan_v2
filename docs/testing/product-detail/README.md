# Product detail page

Synthetic local fixtures only. No live CRM, Sapo, GHN or production data was read or changed to produce this evidence.

Previously, clicking a catalog product opened a stock modal whose movement cache retained only 20 transactions. It did not provide quote/order/contract/purchase histories or a complete source-based product summary.

The new full page `#/products/<encoded SKU>` uses the same header, KPI/profile and tab pattern as customer details. The old `#/products?sku=...` URL redirects to it. Catalog clicks open the page; quote/POS quick-stock dialogs remain available, with an explicit link to full details.

## Contents and sources

- Profile: image (HTTPS or legacy raster data URL), SKU, name, brand/pattern, unit, barcodes, Sapo ID, active/approval status, creator/approver and dates, VAT and carton dimensions/weight. Current policies include missing-price entries as unknown.
- Stock: the existing authoritative catalog/ledger overlay, update time and hidden-warehouse rules. Unknown stock is not displayed as zero.
- Sales: distinct confirmed source orders including POS and contracts. An order with a contract counts once. Draft/cancelled orders are excluded. Quantity/revenue is for the exact SKU, before VAT; effective return credits of included orders reduce quantity/revenue. Credited quantities also cover pre-fulfillment returns; physical receipts/restock remain separately visible in return history.
- Receipts: active CRM supplier receipts, good/damaged quantities separately. Cancelled receipts remain in history but are excluded from these KPIs. These counters do not claim completeness for external Sapo documents that have never been stored in CRM.
- Histories: quotes, plain orders, contracts, purchases, receipts, customer returns, early requests and the existing stock ledger. Each source document groups only this SKU's lines; links retain the existing source IDs/routes. Draft/cancelled documents remain available for reference.
- Every history has server pagination and a full count. No source history is truncated to the 20-entry product-movement cache. Large tables scroll inside their own frame on mobile.

## Profit meaning

Manager only: **estimated average profit per unit from currently approved quotes**, quantity weighted. Uses the existing `quote-math.profit` engine for post-discount revenue, known product cost, commission and known line printing cost. It is before shipping and shared overhead and is explicitly not finalized realized profit. Rows without a known `costPrice` or with printing that has no allocated line cost are excluded and their quantities displayed. Explicit zero cost is distinct from unknown cost. There is no invented actual COGS or matching of current purchase prices to old sales.

## Permissions and implementation

Two new read-only endpoints live in `src/modules/product-hub`, parallel to `customer-hub`:

- `GET /products/:sku/overview` — metadata, visible stock/prices, full scoped counts/statistics and Manager-only profit estimate.
- `GET /products/:sku/documents?kind=...&offset=...` — 25 source documents per page.

The server reuses quotation ownership/sharing/department predicates, sales order/store scope, purchase scope and purchase-price checks. Counts and KPIs obey the same scopes as their histories. Users without a section's existing page right receive 403 for that document kind. Warehouse users receive no sales prices or quote costs/profit. Private warehouse stock remains hidden. No new permissions, schema/migrations, dependencies, inventory postings or integration behavior.

Product editing on desktop reuses the current editor/API; direct page entry supplies its complete price-policy metadata. Mobile remains read/lookup as before. Re-rendering replaces one root; async responses are sequence-guarded and cached overview data is scoped to the signed-in user. The existing data-refresh path refreshes the product detail when it is active.

## Verification

- Typecheck, UI build and five existing trial-UI checks.
- Three new API integration tests: full scoped counters/returns, >25 quotes pagination, source links, price/stock privacy, role/page permissions, invalid paging, missing products and no inventory writes.
- Two profit tests: weighted totals using the shared engine, unknown versus zero cost, printing coverage, exclusions and negative margins.
- Existing product-update (2), catalog (12) and staff-privacy (5) tests pass.
- Local Chromium + real router/PGlite at 360/390/430/768/1280px: full page, internal-table scrolling/no page overflow, 28 quotes across two pages, browser Back/Forward, canonical contract links, old deep links, catalog navigation, five refreshes with one root/panel, employee scope, no warehouse prices and no business writes. Additional cases cover the desktop edit form's policies, encoded SKU, inline raster image, empty product and history error/retry.
- Full repository suite is running separately; its final state is recorded in the PR. No assertion that CI is green before it finishes.

Screenshots: [mobile overview](overview-390.png), [desktop overview](overview-1280.png), [mobile contracts](contracts-390.png). Browser results: [results.json](results.json).
