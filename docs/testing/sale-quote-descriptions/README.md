# Sale product specifications and order/contract confirmation

The Sale editor previously rendered only the product name and hid the description toggle. Its dedicated PDF/Excel exporter also selected only the name. The general quotation JSON already supported printing/packaging notes; the reference image additionally requires material, brand and volume.

Sale now exposes these six lines below the product name:

1. Chất liệu — `materialDescription`, entered explicitly; no inferred material.
2. Thương hiệu — `brandDescription`, defaulting to the selected product's brand. This display override does not alter the catalogue brand used for pricing/costing.
3. Mã sản phẩm — the existing SKU, read-only so a descriptive edit cannot change inventory identity.
4. Thể tích — `volumeDescription`, a free-text value such as `255ml`; not inferred from a set's name.
5. Chế tác — existing `printDescription`, retaining the printing workflow.
6. Đóng gói — existing `packagingDescription`, retaining the standard default unless explicitly changed/cleared.

Older nonempty `bundleContents` are retained and remain editable; they are not silently discarded. Missing facts are left blank. Both PC and mobile support the description toggle; long printing/packaging text uses multiline controls.

The new text fields are validated at 2,000 characters and stored in existing quotation JSON. **No database migration is required.** Existing approval, private design-image requirements and product image isolation remain in force.

PDF and XLSX place the public specifications on separate lines in the existing product-name column, keeping all eight columns. The PDF wraps/paginates multiline descriptions; spreadsheet rows wrap the text. Private costs, internal identifiers and signed image URLs are not added to the export. Existing non-Sale exports and monetary formulas are unchanged.

## Confirmation findings

The review compared **B2B, Vigifts and Sale**, for both generated orders and contracts:

- All can be generated as drafts after quote approval; the detailed operational Confirm is required when the employee submits the draft for approval, rather than preventing creation of a draft.
- Submission requires product, delivery and payment confirmation. Delivery date/address, receiver/phone, shipping payer and payment method must be valid.
- Logo work, including free printing expressed in the description, additionally requires sample/bulk choice and printing confirmation. Bulk production requires explicit customer authorization; sample mode requires a valid sample approval date.
- Manager approval requires `verified=true`; employees cannot approve through the API.
- The create-order UI has a shared “Xác nhận sinh đơn hàng” popup and cancellation sends no create request. Contract creation uses the common “Lập HĐKT” form submission and has no separate extra confirmation popup specific to Vigifts or Sale. No new pre-creation gate was imposed.

New Sale specification fields are bound into the existing submission fingerprint when present: changing material, display brand, volume or packaging requires a fresh review. Legacy records without the new fields keep their existing fingerprint; edits only to internal costs do not invalidate confirmation.

## Verification

Executed locally with synthetic data, Node 22.22, PGlite and Chromium:

- Browser flow at widths **390, 768, 1280 and 1920**: enter the specifications, toggle visibility, save/reopen, attach a private design, approve, download PDF/XLSX, verify all six labels and preserved values. No JavaScript page errors or whole-page horizontal overflow; eight columns and amounts retained.
- Actual PDF decoded using PDF.js and actual XLSX reloaded using ExcelJS: six separate specification lines, numeric amounts, images, existing totals and private-field exclusion.
- API create/read/update: new specifications persist; empty fields stay empty, overly long values are rejected, display-brand editing does not change the original brand or SKU.
- Template matrix: **three quote templates × two document kinds** requires matching submission confirmations. Missing bulk permission is rejected, missing Manager verification is rejected and employee approval is forbidden.
- Submission fingerprint: specifications change it; cost-only edits do not; legacy/non-Sale fingerprints remain stable.
- Relevant regression files: `sale-quote-template`, `sale-quote-export`, `order-submission-review`, `order-create-ui`, `quote-math.legacy-diff`, `trial-ui`, `architecture`; TypeScript and UI build.

Reproduce browser verification using the existing script `scripts/testing/sale-quote-layout.mjs`. Set `PLAYWRIGHT_MODULE` to an installed Playwright module and `BROWSER_EVIDENCE_DIR` to an output directory; the script serves the real UI against a local synthetic router/database and uses `/usr/bin/chromium`. It does not log in to or modify production CRM.

Deploy the reviewed API and UI through the existing workflows so the API accepts the new JSON fields before the UI starts sending them. No production data change, merge or deploy was performed during this implementation. Full repository CI is a separate PR gate.
