# PR #624: CI and quote save-response correction

Confirmed failures from run 42989603698:

- Mobile capture's isolated VM did not provide `saleDesignProblem`/`isSaleEditor`.
- The approved-quote permission VM omitted the design-image route registrar.
- The PDF export test required `pdftotext`, absent on the CI runner.
- The real quote/customer-memory test found an empty response `customerId` after
  a successful customer creation.

While investigating, upstream was rebased and updated to `ac0d4a72`, which fixes
the fixtures, installs `poppler-utils` in CI, and retains the approved-quote guard
before design-key inspection. Those changes were preserved; local work was saved
before following the new source tip. No remote history rewrite is needed.

The remaining save-response bug came from projecting the response before the
transaction. Staff cost filtering and private-image resolution create a detached
view; customer memory then assigns `customerId` inside the transaction, leaving
the earlier view stale. POST and PUT now project the final transaction data again,
reusing only already-resolved design URLs by object key. There is no additional
Storage call after committing and the staff cost filter still applies.

Validation on the updated source:

- 96 tests passed, no skips: quote regressions, Sale template and private-image
  isolation, customer memory, contract permissions, mobile capture, actual XLSX
  round-trip, and Vietnamese PDF generation/text extraction.
- Added combined POST/PUT customer-link + private-design coverage. It verifies
  response/persisted IDs agree, costs remain hidden, signed URLs are not stored,
  and a simulated Storage failure leaves revision/data/customer records unchanged.
- Typecheck and UI build passed. CI YAML parses and installs PDF tooling before
  tests. No tests, approval gates or private-storage checks were disabled.

No schema, RLS, grants, secrets, production data, or deployment changes.
