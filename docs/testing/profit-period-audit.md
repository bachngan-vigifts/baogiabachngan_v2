# Profit page audit — 14 November 2026

The reported issue was confirmed by comparing the cached report with independent, read-only source aggregates: the monthly preset requested daily table buckets. A second confirmed issue silently truncated product groups at 300. Production financial figures are kept in the private workspace audit artifact, not committed to the repository.

## Fixes

- UI sends the selected table grain separately from chart grain. Month table shows month totals; the chart may still show days. Exact period net revenue is visible above the tabs.
- API supplies separate chart series, and the order list includes `coveredRevenue`, preventing partially covered orders from incorrectly displaying all costs as unknown.
- Order detail preserves the confidence filter. Pending estimated cost is labelled unconfirmed and remains available for explicit Manager review. Unknown totals remain blank/dash in UI and order CSV; CSV respects the active missing-cost filter.
- Products and customers paginate at 300 groups. Full aggregation stays in the private report cache; paging reuses that calculation and does not issue a new set of source queries. Page totals never replace period totals. The UI states that Excel exports the currently shown group page.
- Employee/customer-filtered branch views use only the selected orders; unallocated whole-branch overhead is not substituted into their net.
- Product table uses line margin and explains which order-level costs are not allocated. Multiple lines of the same SKU in one order count as one order for product statistics.
- Invalid calendar dates and invalid pagination/chart parameters are rejected. Cache format version prevents reuse of the older truncated/coverage-free payload. TTL remains 30 minutes.

No schema migration, RLS change, index, pool, compute or production data repair is required.

## Verification

```sh
npm run typecheck
npm run ui:build
node --import tsx --test --test-concurrency=2 tests/app/profit*.test.ts tests/app/legacy-profit-recovery.test.ts tests/app/product-profit.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/profit-period-audit.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/profit-date-filter.mjs
```

New API audit covers:

- Monthly table vs daily chart; revenue/cost/gross reconciliation across dimensions and order drilldown.
- Partial/all/missing confirmed cost, unchanged revenue across confidence modes.
- Draft, signed, completed and cancelled contracts; draft eligibility and single counting.
- Manager-only report, overview, detail, review and mutation routes: six employee positions, supplier, unauthenticated access, warm shared cache and live Manager role downgrade.
- Pending/rejected/effective partial/full returns, quantity and COGS reversal, original order-date attribution.
- More than 300 product/customer groups; stable totals across pages, cache hit across page offsets, invalid offsets.

Existing tests cover snapshot/fallback costs, printing/commission/shipping, POS/GHN/refunded fees, branch cash classification, salaries/bonuses and full-month allocation, reconciliation, date boundaries and stale-response suppression. Browser checks use the real CRM/router with local PGlite fixtures at 1280, 430 and 390 pixels: all tabs, month total, daily chart, confidence filters, partial coverage, CSV blanks, detail and source-order link, employee denial, product pagination/filter reset, no page overflow and no JavaScript errors. Date-filter browser regression also verifies out-of-order replies and recovery after invalid date ranges. Screenshots: `/workspace/artifacts/profit-period-audit/`.

## Interpretation limits retained

- This is a pre-VAT management report by original order date, not a tax invoice ledger or cash-receipt report. Effective returns adjust that original order period, even if returned later.
- Only complete payroll months in the selected range contribute salaries/bonuses; a month-to-date report does not yet subtract that month's payroll. Estimated/missing COGS stays identified rather than assumed zero.
- Product line profit excludes order shipping, POS/GHN fees and payroll until a separate allocation rule is approved; its margin is labelled accordingly.
- The order list still displays the latest 500 eligible orders with an explicit notice; narrower staff/branch/date filters are needed beyond that. Product/customer exports are per visible page and explicitly labelled. This audit does not claim to validate every historic source document or tax valuation.
