# SePay: company separation and outgoing privacy

Two company tabs use exact bank-account mapping from confirmed company accounts and trusted POS-register holder configuration. Transaction content never determines the company. Unmapped/conflicting accounts are available under “Tài khoản chưa phân loại”; they are not silently assigned to a company. Inactive register configuration remains usable for historical classification, without making the account eligible to post receipts.

The existing page.sepay grant remains necessary. Outgoing visibility additionally requires Manager or an employee whose current positionId is exactly accounting. Sale Admin/custom positions do not acquire outgoing access through page.sepay or unrelated permissions. Every request reuses server authentication. The list, count/summary, search/account/amount filters and detail endpoints filter before projection; unauthorized detail IDs return the same404 as nonexistent IDs. Explicit outgoing/all-direction queries return403. Staff pull responses omit outgoing counts and report incoming read counts only. A failed/revoked list request clears prior detail and outgoing cards.

Incoming receipts/matching retain the incoming-only parser. Outgoing rows have positive magnitudes plus transfer_type=out, original bank proof, no order/payment link and a read-only UI. All manual preview/confirm/reconcile receipt paths reject them. Incoming retry workers exclude outgoing rows. Pull deduplication shares existing provider-ID locks and compares direction as well as amount/account/content/time; conflicting batches roll back together. No balances, payments or invoices are created by outgoing imports.

No migration is needed: sepay_transactions already has transfer_type, unique provider IDs and private RLS/access controls. No extra browser grants, policies, index or scheduler is introduced. The existing bounded today-only API pull imports outgoing evidence when enabled. Previous-day history is not automatically backfilled; a separate reviewed import would be required.

## Rollout and rollback

1. Leave SEPAY_DEBIT_IMPORT_ENABLED unset/false. New outgoing storage is disabled by default, because older API versions did not filter those rows for delegated page viewers.
2. Deploy the guarded API, then UI through the normal workflow. Verify CI, function version and access behavior, and let outstanding requests from the previous API finish before enabling imports.
3. Set Edge secret SEPAY_DEBIT_IMPORT_ENABLED=true only after that verification. Run the existing today pull; check Manager/Accounting visibility and delegated incoming-only views. Do not create/edit real bank or payment records as a smoke test.
4. Disable that flag to stop new outgoing imports while retaining guarded reads and existing evidence. After outgoing rows exist, never roll back the API to a version that ignores transfer_type/access restrictions. Ship a compatible fix; UI-only rollback can retain the guarded API. Do not delete financial evidence to make an older version appear to work.

Local evidence: tests/app/sepay-debit-access.test.ts plus existing read/page/permission/payment/web/proximity suites. Real PostgreSQL runs verify concurrent duplicate pulls. Browser scenarios are scripts/testing/sepay-entities.mjs and the updated scripts/testing/sepay-page.mjs, using isolated synthetic data with external requests blocked.
