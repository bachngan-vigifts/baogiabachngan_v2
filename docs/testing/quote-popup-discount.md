# Quote popup reset and bulk discounts

The product picker reused its query/filter/result state across opens. Paste
already cleared its textarea on open, but an in-flight request could still match
the reopened dialog's quote context. The generic busy-button layer also retained
`data-busy` for that old read and intercepted the next click after reopening.

Both dialogs now reset transient state on close/open and invalidate prior request
generations. Old responses and finalizers cannot modify the new session. Picker
timers, results, counters, scroll, filters and loading flags reset; the user's
shared pricing policy and existing quote rows remain. These self-managed dialogs
and their launchers opt out of generic busy-button tracking. Paste continues to
prevent duplicate submits within the same open session.

The new bulk-discount button applies a validated 0–100% to product rows with SKUs,
either all or only those at zero discount. Manual/fee rows are excluded. The
operation preserves quantity, unit price, VAT, images and print fees, recalculates
through existing quote math, marks the editor dirty and uses the normal Save
Quote action. It does not change defaults for subsequently added products. Locked
quotes and changed editor contexts cannot apply the operation. Button availability
refreshes after the saved quote finishes loading.

## Verification

- Quote tests, typecheck, UI build and whitespace check passed.
- New unit coverage includes 20 rows at 0 → 20%, only-zero scope, unchanged manual
  fees, exact resulting totals, invalid input, locked/changed quote guards, and a
  close/reopen race where the old paste finalizer cannot enable a new submit.
- `scripts/testing/quote-popup-discount.mjs` uses the real UI/API with isolated
  PGlite fixture data, not production. Chromium 1440×950 and 390×950 verified
  20 changed discounts persisted after Save/reload, manual fees unchanged, picker
  query/filter reset and delayed-search rejection. Desktop also verified the
  delayed paste close/reopen race and an empty textarea on the next opening.
- Mobile retains its existing desktop-only Excel button policy; bulk discounts
  and the picker were tested through the mobile UI. No horizontal overflow or
  inaccessible modal footer was found. Screenshots were visually inspected; no
  browser JS errors occurred. Evidence: `/tmp/quote-popup-discount/results.json`.

No schema, API, RLS, index or production-data changes. This is a frontend release.
