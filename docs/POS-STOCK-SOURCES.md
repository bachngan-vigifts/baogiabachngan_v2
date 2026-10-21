# POS: stock sources and requests

Depends on warehouse sales / transfers in PR #217 (c1fbafa288755d5a61bbd415195aa37d0c3d5db0). Merge that PR first. This change adds no migrations and does not alter checkout stock rules, Sapo sync, opening balances or approval permissions.

- Clicking a product selects it. A selected product explicitly says `Bỏ chọn`; clicking it removes that SKU from the basket. Barcode scanning still increments quantity.
- Four separate stock buttons: current store available stock; VIGIFTS; supplier stock; incoming approved purchase lines. The buttons are siblings of the product button, so stock can be inspected even when the item is out of stock or no shift is open. Tooltips and the click dialog explain the quantities, including incoming order number, supplier and expected date.
- The current store quantity keeps the existing POS on-hand minus reserved calculation. Other real warehouses reuse readCatalogStock (ledger after opening, otherwise synced source); their labels explain that reservations are not deducted. Supplier stock is synced source stock. Incoming quantities reuse incomingLookup/outstandingLines from Tra tồn and are never added to on-hand stock.
- One batch read per catalog page, not one request per product. Active warehouses only. Hidden/private warehouses are removed before serialization, including request options; a hidden register warehouse returns 403.
- `Xin hàng` opens a warehouse selector, quantity and reason. An internal source uses the existing POST /stock-transfers and creates a pending request. It does not approve or move inventory. Existing server guards prevent private-warehouse access. The submit button blocks duplicate clicks while a request is in flight.
- Selecting NCC uses the existing supplier directory and POST /purchase-orders to create a draft, with supplier, integer quantity, delivery address and desired date. It opens the draft for review; it does not send email, approve, receive or pay. Existing incoming orders are linked for review to avoid buying the same stock again. Early pickup retains the existing Manager/Sale Admin permissions.
- UI uses DOM nodes/textContent, no server data interpolation into innerHTML.

Validation: typecheck and UI build; 19 POS UI tests including product toggle, stock click without basket changes, warehouse selection, duplicate submit prevention and NCC draft validation; one integration scenario checks all four source totals, approved vs cancelled/draft incoming orders, private warehouses, pending transfer without stock movement, and new NCC draft excluded from incoming. Five regression files cover existing POS, store scope, warehouse sales/transfers, architecture and generated bundle. Chromium visual verification could not run in the current sandbox (browser launch denied). No live orders/transfers/purchases were created for testing.

## Live migrations already applied on 2026-10-21

Authorized separately by the user; exact source SQL from commit c1fbafa288755d5a61bbd415195aa37d0c3d5db0:

| Repository migration | Supabase history version |
| --- | --- |
| 20261021120000_warehouse_sales.sql | 20261021120140 (warehouse_sales) |
| 20261021120001_supabase_access_warehouse_sales.sql | 20261021120143 (supabase_access_warehouse_sales) |

Project: taceqfnsorewelsbdckg. Verified three new tables with RLS and no PUBLIC/anon/authenticated table privileges; two columns and three expanded check constraints; stock.transfer for warehouse and sale-admin; four seller mappings (Minh Long: sales-ml/sales-lock; VIGIFTS: sale/sale-admin). No warehouse name matches Hoá đơn yet, so there is no accounting mapping. No transfer/transfer-line rows were created. Security advisor reports only the existing server-only RLS/no-policy INFO class, not an open access finding.

Before using warehouse sales, merge PR #217 after its CI passes, then Manager should review seller permissions and use Sổ kho → Chốt tồn đầu kỳ. Opening balances were not posted by this migration execution.
