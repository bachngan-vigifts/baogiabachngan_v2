# Early-request receipt quality controls

The quick receipt previously exposed only good quantity and hard-coded damagedQty=0. Its header was outside the form: the desktop landscape controller sized the form to the whole dialog and clipped its footer below the visible area.

The header, scrolling body and footer now share one form. Each scoped source line exposes good quantity, damaged/returned quantity and a line note. Entering damaged quantity reduces the default good quantity if necessary. Good + damaged is validated against both the accepted request cap and shared purchase-line budget, with 0.001 precision.

The **Từ chối nhận** action, approved by the user, records the selected quantities as damaged/returned with zero good quantity and createSapo=false. It requires a reason, 1–3 photos and explicit confirmation. It uses the existing purchase receipt endpoint and does not cancel the supplier request/order, add inventory or reduce the supplier's good-goods obligation. It is a button rather than the form's default submit target so Enter cannot implicitly reject a delivery.

Photos are compressed client-side to JPEG (up to 450,000 data-URL characters each) and sent through the existing private warehouse-photo path, never a new Storage or database path. Upload preparation blocks submission. Missing evidence, invalid quantities and missing rejection reasons stop before API writes. Frozen request snapshots, stable client keys and per-source completion tracking preserve retry behavior; rejection retries display the zero-good quantities actually sent.

Validation:

- `node --import tsx --test tests/app/early-request-receiving.test.ts tests/app/early-receipt-form-ui.test.ts tests/app/early-list-bulk-ui.test.ts tests/app/early-request-manager-ui.test.ts`: 20 tests passed, no skips. New API regression verifies evidence requirement, 7 good + 3 damaged adds only 7, damage/refusal stays due, zero-good refusal adds no stock/outbox and replay is safe.
- `npm run typecheck`, `npm run ui:build`: passed.
- `scripts/testing/early-quick-receive.mjs`: real UI/router/PGlite with an in-memory file store; covers 360/390/430/768/1280px, request/source bounds, explicit CRM/Sapo choice, partial receipts, mixed quality, all-refused delivery, evidence, footer visibility, lost committed response retry, multi-order provenance and receiving-role visibility. Screenshots reviewed at `/workspace/scratch/early-quick-receive/quality-1366.png` and `reject-390.png`.
- `scripts/testing/early-list-bulk.mjs`: bulk/shared-budget and fractional quantity regression.

No production writes, migration, schema, RLS or backend changes. Physical return shipment/transport is not created by recording a refused receipt.
