# Supplier returns, undelivered cancellation and actual refunds

Implementation branch: `feature/supplier-return-void`. No production business records are changed by development/tests.

## User behavior

Manager opens **Thao tác khác → Trả hàng / Huỷ phần chưa nhận** on an approved purchase:

- **Trả giảm công nợ / yêu cầu hoàn tiền**: select the original receipt and good quantities actually returned. Post one outbound movement to that receipt's warehouse (using the original ledger warehouse ID, even after a rename) and credit those quantities. Preserve gross ordered/received quantities and recorded payments.
- **Trả để NCC giao bù**: post the stock return, reopen the supplier's delivery obligation and incoming-stock quantity, and keep the purchase value unchanged. Later receipts satisfy the reopened obligation, including after cancelling an earlier undelivered remainder.
- **Huỷ toàn bộ phần chưa nhận**: credit only the remaining undelivered quantities. No stock movement and no deletion or automatic payment void. Retained goods and financial obligations remain on the original purchase. The ordinary draft/order cancellation action and erroneous-receipt undo remain separate.

The preview shows quantities, original line price/CK/VAT/printing fee, payable before/after, gross payments, actual refunds and the amount the supplier still owes. Manager must type the document number and confirm the agreed settlement before posting. Missing prices/VAT block credits/refunds; legitimate zero prices remain valid.

**Actual refund** is a separate accounting action: a user with both supplier-payment and price access records the amount, actual receipt date, method and mandatory evidence reference. It is limited to the supplier's outstanding credit. Payments are retained. A refunded payment cannot simply be voided away. Duplicate evidence references within the same purchase/method are rejected; reference allocation across different purchases remains possible.

## Sapo boundary — explicit manual reconciliation

This implementation performs **no external Sapo return write**. It does not enable or invent an n8n/OpenClaw return API.

- A receipt explicitly created without Sapo (`createSapo=false`, `not_needed`, no job/link) can be returned directly on CRM.
- A Sapo-linked receipt must already be verified/done with no active job. Manager must inspect the actual Sapo return and enter its positive numeric ID, document code and reconciliation note, then attest the receipt, warehouse and quantities agree. The Sapo return ID may be attached only once. This is labelled **manual reconciliation**, not automatic provider verification.
- Unknown/pending/failed Sapo outcomes block returns. HTTP 530/timeout is not proof that an external write failed. Erroneous-receipt undo now keeps the existing review, expired-lease and unchanged-snapshot safeguards after any attempted dispatch.
- A receipt with posted returns cannot be undone again. Original Sapo receipt links remain intact.

If an external return was completed manually and CRM subsequently refuses a stock/revision check, retain the external reference, review the actual warehouse state and reconcile before retrying the same operation. CRM never compensates by issuing another Sapo write or altering production stock silently.

## Data and concurrency

Migration `20261119020633_supplier_goods_returns.sql` adds private RLS tables `supplier_goods_returns` and `supplier_refunds`, plus zero-default netting counters on original documents. It changes no old balances. No new public policies or client grants are added.

Returns preserve immutable line/settlement snapshots. Credits use the original rounded line value prorated by credited physical quantity; without credits, the original price/CK/fee/VAT formulas and legacy rounding are unchanged. Quantity counters use three decimal places. Higher-precision legacy order quantities require reconciliation before monetary credit. Credits release source allocations from latest `(createdAt,id)` first and show the released sources in the preview. Original allocations remain in history with a cancelled-quantity counter.

Stock, return record, quantity/source counters, incoming stock and audit history commit in one database transaction. Source and stock-hold locks precede purchase → receipt → job → ledger locks. Existing reservations and stock-short checks are reused without an override. Return previews are bound to the actual input/revision, receipt/job state, prices and monetary balance. An intervening payment invalidates the preview.

Identical client-key retries return the posted record; changed payloads or cross-purchase reuse conflict. Refund writes lock the purchase and cap against remaining supplier credit. Payment voids lock the parent first and cannot erase money already refunded.

Requests select at most 200 lines; close-remainder also rejects orders requiring over 200 lines. Previews do not read design-image blobs, payment attachments or outbox payloads. Database counter updates are batched and incoming stock is refreshed only for affected SKUs inside the transaction. Receipt progress uses one aggregation pass.

Internal lists, badge counts, incoming/source budgets, supplier payables/exports and the scoped supplier portal use net quantities/value/refunds. Portal quantity rounding for untouched legacy lines stays unchanged; lines with an explicit return/credit use physical net quantities thereafter. Staff without price access receive redacted return snapshots. The supplier portal exposes only its own order's SKU/quantity, credit and actual refund summaries; no internal source/customer/evidence notes are shared.

The supplier ledger is updated; this feature does not create bank transfers, electronic fiscal invoices, automatic credit notes at Viettel/VNPT, or modify a separate accounting book without its normal approval flow.

## Deploy and rollback

1. Review SQL and preflight table/constraint existence plus production lock/load state. Apply the migration once in a maintenance window with the supplied five-second lock timeout and sixty-second statement timeout. The file is transactional; do not run selected fragments or reapply a completed migration blindly.
2. Run `scripts/sql/assert-supplier-goods-returns.sql` in a read-only transaction. It verifies the private tables, columns, constraints, index validity and ledger return kinds. The API deployment workflow runs this gate before changing Edge secrets/deploying.
3. Deploy API, then UI. Test with approved test documents before processing actual purchases; verify Manager/accounting access and supplier isolation.
4. To stop new return/refund writes, set Edge secret `SUPPLIER_RETURNS_DISABLED=true`. Existing net accounting reads remain active. The actions are hidden and write endpoints return 503. Remove/set false only after resolving the issue.
5. Do **not** roll back to code that ignores return counters after any returns/refunds have posted. Preserve the migration/tables/history and ship a compatible fix. Before any posted records, the prior application can be restored while leaving additive schema in place; no destructive down-migration is required.

See committed API/DB tests and `/workspace/artifacts/supplier-return` for local browser evidence. Test results and deployment state are reported separately; local checks are not production verification.
