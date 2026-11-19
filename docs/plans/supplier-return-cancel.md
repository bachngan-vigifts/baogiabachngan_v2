# Supplier returns and cancellation: investigation and required decisions

Status: design pending settlement decision. The new return feature is NOT implemented or deployed.

## Verified behavior

- Purchase cancellation currently rejects orders with receipts or recorded payments (`domain/purchasing.ts`).
- Receipt cancellation reverses CRM ledger movements in one transaction, retains cancelled receipt history, and removes the corresponding product-history movements. Ledger writes reject negative balances.
- Existing Sapo receipt links block receipt cancellation. Returning real goods is distinct from undoing an erroneous receipt.
- Dispatch failures (including HTTP 530) do not establish whether the external write took place. Before this patch, a failed job with cleared lease/dispatch tokens could escape the cancellation guard. The patch preserves the existing operator review, lease-expiry and unchanged-snapshot requirements after any dispatch attempt.
- Production read-only inspection of the selected purchase on 19 November 2026 found an active receipt with `sapo_status=failed`, job `failed`, attempts=1, no active tokens, and no verification. No production records were modified.
- Supplier payments are positive recorded payments or voided records. Voiding a payment is not receipt of money refunded by the supplier.
- Current receipt outbox creates/reconciles purchase receipts; this investigation has not established a working external write contract for supplier returns.

## Required settlement decision

Support both explicitly selected modes, or restrict to one:

1. Return for credit/refund: reduce the payable based on the original confirmed line pricing, CK, fees and VAT. Preserve actual payments. Excess paid becomes money owed by the supplier; record a refund only when accounting confirms actual receipt.
2. Return for replacement: reduce usable stock once; reopen the supplier's delivery obligation. Do not reduce the original payable merely because goods are awaiting replacement.

A cancellation must also explicitly distinguish cancelling an erroneous receipt from closing the purchase order and cancelling the undelivered remainder. Never delete the original documents or silently void actual money transfers.

## Intended implementation after the decision

- Place “Trả hàng / Huỷ phiếu” in the purchase drawer's “Thao tác khác” menu.
- Separate persistent return header/lines from original receipts, with line-level receipt attribution, reason, warehouse, date, settlement mode, immutable pricing snapshots, actor and idempotency key/hash.
- Authorize staff to prepare and Manager to approve/post. Only permitted accounting users can record actual refunds. Enforce permissions at API level as well as UI.
- Preview stock delta, received/remaining quantities, payable credit, paid amount and refundable credit before posting.
- Use a durable outbox for external Sapo writes only after verifying the actual return contract. Unknown outcomes stay in reconciliation; do not issue another external return on timeout.
- Lock in a consistent order: source budgets, purchase, receipt, outbox, inventory balances. Check revision, returnable quantities, active reservations, consumed stock, duplicate external references, and confirmed prices under the locks.
- Post stock, return state, credit and audit history atomically. Preserve incoming-stock counts, receipt progress, source allocations, list badges, supplier payables and supplier-portal isolation. Do not modify tax formulas or fiscal invoices implicitly.
- Replay with the same key and identical payload returns the existing result; a changed payload or cross-document key must conflict.

## Validation required for the full feature

Unreceived/partial/full receipt; partial/full return; multiple SKUs/warehouses/receipt batches; missing price versus legitimate zero; CK/fee/VAT; unpaid/partial/full payments; partial/full refund; replacement and later receipt; return exceeding remaining quantity; insufficient or reserved stock; stale revision; duplicate clicks/lost response; concurrent return/receive/pay/cancel; queued/running/failed/unknown Sapo operations; late callbacks; transaction rollback; unauthorized employees, supplier isolation and sensitive price redaction.

Use a multi-connection PostgreSQL test for race behavior; PGlite alone serializes transactions and cannot prove concurrency safety. Validate the UI and deployment separately before describing the new feature as ready.

## Work completed in this branch

- Tightened the existing receipt-cancellation guard after any attempted dispatch.
- Added an HTTP 530 regression test: cancellation returns 409 without changing receipt, stock, purchase or cancellation audit; a late worker result still reconciles successfully without double-posting stock.
- Four existing test files passed before the patch; the modified outbox test file passed after the patch; TypeScript typecheck passed. These checks do NOT validate a full supplier-return feature, which remains pending.
