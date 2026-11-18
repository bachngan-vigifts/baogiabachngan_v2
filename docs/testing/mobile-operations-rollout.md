# Mobile operations and warehouse rollout

PRs #317 and #318 were merged into stacked feature branches after their base
had entered main. Their merge commits and P2/P3 profiles were absent from the
production source. This rollout ports the applicable layout to current main
instead of replaying old coordinator, navigation, filters and table indices.

The old purchase/receiving layout has since been replaced by the buying
workspace. Its native filters, forms and drawers stay in place. Dashboard's
existing four-card/expand behavior, grouped footer, full-page contract view,
stock mutation policy and current product confirmation flow also stay in place.

Operations, supplier, product, employee, transfer and stock list cards match
rendered headers/data-labels. Missing/permission-restricted columns are never
borrowed from another index. Unknown tables and colspan rows remain intact.
The current pending-stock column is distinct from historical balance and branch;
Sapo/ledger/difference and cash in/out remain individually labelled. Original
selection and quantity inputs are retained. Extra columns open with Chi tiết;
this toggle stops row navigation and is hidden on desktop. Opening/filtering or
selecting data never submits a business command. Existing API permissions apply.

Filters use the current deferred-apply coordinator. Cancel restores the values;
resize restores the original DOM positions. Native purchasing and inventory
forms are not moved into generic sheets. Dense payroll/permission tables keep
their own horizontal scroll. No API, migration, salary, tax or stock logic changes.

## Reproduce

```sh
npm run typecheck
npm run ui:build
node --import tsx --test tests/app/mobile-operations-layout.test.ts tests/app/mobile-action-policy.test.ts tests/app/mobile-nav-order.test.ts tests/app/mobile-chrome-fixes-ui.test.ts tests/app/mobile-density-ui.test.ts tests/app/purchase-incoming-ui.test.ts tests/app/cash-ui.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/mobile-operations-rollout.mjs
```

The browser script uses the actual CRM/router and a fresh PGlite database with
synthetic data. All requests outside the local test server are blocked. It
checks 360/390/430/768/1280px layouts, separate stock/cash values, expandable
columns, desktop restoration, deferred/cancelled/applied filters, native buying
pages and original editable incoming quantity. It also asserts no business
writes while viewing/filtering/expanding/selecting. Screenshots/results are
written to `/workspace/artifacts/mobile-rollout`. This is not an iPhone hardware
or production data test.

Validation for the rollout: TypeScript and UI build pass; seven related test files
pass, including five column-mapping regressions. Chromium/router tests cover the
five widths above with no JavaScript errors or unexpected business writes.
