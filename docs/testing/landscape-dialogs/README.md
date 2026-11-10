# Landscape CRM form dialogs

Desktop (>=900px): 16:9, at most 1280px wide, bounded by both viewport dimensions. Header/actions stay outside the scrolling content. Long standard form grids use three columns; product packaging/prices use four. Mobile retains a vertical form.

The controller observes native `open` and drawer `hidden` transitions. Each open popup gets a local observer for forms loaded asynchronously; closing disconnects it. Existing form nodes, names and handlers are retained. No API, schema, permission or Storage changes.

## Source sweep

`source-inventory.json` records all 64 top-level CRM modules creating native dialogs. Static dialogs in `index.html` were checked separately. The shared head/body/foot layout covers long forms in products, customers, care, personnel/payroll, store/weekly reports, feedback, inventory, purchasing, delivery and finance. Custom shells are supported for POS forms/returns/flows, cash and accounting; supplier/purchase editor drawers also get a centered frame. Product editor, customer-care form, stocktake, team payroll sources, purchase Excel and diagnostics were given explicit sections where needed.

Purpose-built full-page order/contract/verification editors, print/image/document previews, cameras, the quick-task sheet and short confirmations keep their own layouts. Task details use their existing desktop side panel. This is a source sweep plus representative runtime coverage, not a claim that every possible popup/data/permission combination was opened.

## Screenshot and geometry checks

64 popup/viewport cases across the static/product/customer/supplier/POS/team-source audit (42), payroll (12), cash (8), and warehouse settings (2). Desktop probes assert title/close-button separation, 16:9, viewport bounds, header/content/footer separation, nonoverlapping footer buttons, button hit targets after scrolling, and hiding after close. Mobile probes check width/overflow; screenshots were inspected visually. Screenshots are synthetic/local data; external browser requests were blocked.

Representative images: [product desktop](product-desktop.png), [product mobile](product-mobile.png), [payroll](payroll-desktop.png). Full screenshots/geometry JSON are generated under `/tmp/crm-dialog-layouts`, `/tmp/crm-payroll-dialogs`, `/tmp/crm-cash-dialogs` and the configured warehouse output directory.

```sh
node scripts/testing/dialog-layouts.mjs
node --import tsx scripts/testing/payroll-dialog-layouts.mjs
node --import tsx scripts/testing/cash-dialog-layouts.mjs
DIALOG_SCREENSHOT_DIR=/tmp/warehouse-dialogs node --import tsx scripts/testing/warehouse-workspace.mjs
```

Set `PLAYWRIGHT_MODULE` if Playwright is supplied by the runner; Chromium defaults to `/usr/bin/chromium`.

Actual fixture/API flows also checked: product creation/update/error/reopen; customer contacts/create/edit/concurrent conflict; warranty/sample create/partial returns/completion; POS customer creation/payment resume; stocktake draft/cancel/resume/navigation/send/approval; warehouse lifecycle/settings/demo/filtering. These checks never touched production business data.

Typecheck, `ui:build`, syntax checks for changed browser modules and focused unit/UI suites were run. The project has no lint script.

## Existing script limitations

The older `payroll-guide.mjs` has a hard-coded `d.used === 0.915` API expectation; `cash-entry-presets.mjs` expects an immediate -1000 change in company net profit. Their assertions also fail against the unmodified base UI. They are not treated as successful regression runs; dedicated popup audits above isolate layout checks. The older `payroll-settings.mjs` additionally waits for a guide heading absent from its current fixture view. No financial/KPI logic was changed to make those scripts pass. On mobile, the payroll layout audit opens hidden toolbar actions programmatically; it does not assert that the existing mobile toolbar exposes every setting.
