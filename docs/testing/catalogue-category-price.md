# Catalogue category, price bands and quote navigation

Bulk edit now shows common saved category/collection/pattern/color and pricing
values. Mixed selections show their existing values separately and leave the
input blank. Prefilling never checks an apply box: only explicitly selected
fields are sent in the existing revision-checked, replay-safe bulk command.
Attribute inputs also offer suggestions from the currently loaded library.

`priceBand` is optional/null for automatic grouping and otherwise a stable
numeric band ID. Existing IDs 0–4 and contact band 5 retain their meanings;
IDs 6 and 7 add 350–500k and 500–800k splits. Band 5 is selected by contact
pricing rather than manually. Existing automatic thresholds are unchanged.
Explicit bands group pages without modifying the quoted prices or multiplying
them; contact products still belong to the contact group. The field survives
shared product edits, local backups and server-side quote snapshots. It lives
in existing product/quote JSON; no database migration is needed.

Bulk and individual product picks open the quote editor immediately. Picking an
already included product keeps it included. Saved quote snapshots remain separate
from later shared-library edits. Existing singleton-page export rules remain.

## Validation (11 November 2026)

- `npm run typecheck`: passed.
- `npm run ui:build`: passed, no generated changes.
- `node --import tsx --test --test-concurrency=2 tests/app/catalogue.test.ts tests/app/catalogue-*.test.ts`:
  100 tests, 97 passed, 3 existing native-PostgreSQL concurrency tests skipped.
  Run outside the restricted process sandbox because the image-version test
  invokes a child Node process (`spawnSync` otherwise returns EPERM).
- `scripts/testing/catalogue-category-price.mjs`: passed with Chromium at
  1440×950 and 390×950. Uses the real library proxy and API router against an
  isolated PGlite fixture, with no production calls. Verified common/mixed
  prefills, unchecked-field exclusion, bulk persistence across accounts,
  single-product price editing, correct generated band, and automatic quote
  navigation for both individual and bulk picks (including duplicate picks).
  Modal widths were 760/358 px; footers stayed visible, body/footers did not
  overlap, dialogs had no horizontal overflow, and no browser JS errors occurred.
  Screenshots and results are written to `BROWSER_EVIDENCE_DIR` (default
  `/tmp/catalogue-category-price`). Screenshots were visually inspected.
- `git -c core.whitespace=cr-at-eol diff --check`: passed (legacy files use CRLF).

Deploy the API together with the UI so validation accepts the new JSON field.
Production deployment is not part of the local verification above.

## Optional customer and save-time recipient form

Customer details can stay empty during editing and export. Every explicit save
now stages a recipient form: select an approved accessible customer, an existing
accessible customer group (`customer_type`), or explicitly save unassigned.
Cancel/Escape discards staged changes and sends no write. Group lookup errors
stay in the form with a retry button; changing identity blocks confirmation.

The optional `meta.customerGroup` is stored in existing quote JSON and survives
backups, reloads and shared saves. It classifies the quote by group rather than
creating individual links to every member. The API validates groups against
approved customers in the actor's existing scope. Moving/clearing a customer or
group association still validates access to the old association; legacy clients
that omit association fields preserve them. Both customer and group cannot be
selected at once. No schema, RLS or grant change.

Additional local Chromium checks passed at both widths: exactly three quote
writes for group → customer → unassigned; none for cancellation, Escape,
incomplete customer selection, failed group loading, or an identity change.
Group selection persisted across reload and customer/group/empty metadata was
verified against the real local API. Recipient dialog widths were 640/358 px,
with visible footers and no horizontal overflow. Group and unassigned screenshots
were visually inspected; no browser JS errors occurred.
