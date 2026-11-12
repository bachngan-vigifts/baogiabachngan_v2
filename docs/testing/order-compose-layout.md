# Order/contract composition desktop layout

Confirmed cause: both full-page dialogs rendered three direct children (document details, production-file host and sourcing host) in a two-column grid. Auto placement put sourcing into the narrow first column on the next row. At 1366px the sourcing width was only 360px, and allocation selects/actions overflowed while the right side stayed empty. Even an empty production-file host occupied a grid cell.

Fix: wrap document details and production files in one left sidebar, leaving sourcing as the second grid child. Both order and HĐKT now retain a full-width right sourcing column. Add scoped minimum-width/input sizing and allow source action labels to wrap. Keep all form IDs, controllers, allocation calculations, source actions and submissions unchanged. Mobile retains the existing single-column layout and persistent footer.

Validation:

- `node --import tsx --test tests/app/quote-sourcing-ui.test.ts tests/app/order-create-ui.test.ts tests/app/production-files.test.ts`: 30 passed, 0 skipped.
- `npm ci`, `npm run typecheck`, `npm run ui:build`: passed with current lockfile dependencies. The prior shared node_modules lacked the new main dependency pdfjs-dist; a private install resolved that local setup mismatch without changing manifests.
- `PLAYWRIGHT_MODULE=<installed playwright module> node scripts/testing/order-compose-layout.mjs`: 20 cases passed at 390/1024/1366/1440/1920px, order and contract, with and without eligible production files. Uses real dialog HTML and real sourcing/production-file controllers, synthetic read-only API responses. Confirms right-column placement, no horizontal overflow, controls inside product cards, visible persistent footer, and allocations 34 from stock + 48 purchase + 8 pinned incoming = 90. No writes/uploads or browser JS errors.
- Before/after measured at 1366px: sourcing **360 → 934px** in both dialogs, regardless of production-file eligibility. Captured and reviewed screenshots at 390 and 1366px in `/tmp/order-compose-layout-before/` and `/tmp/order-compose-layout-after/`. Optional `before` script mode uses the saved pre-change HTML/CSS in `/tmp/order-compose-before.{html,css}`; default mode tests current files.

No schema, backend, permissions or production-data changes.
