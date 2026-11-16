# Purchase price suggestions for linked products

The link preview fills catalogue selling prices, not a supplier-confirmed acquisition cost. The approval form reads `/products?skus=…`, selects the browser's `bn-price-policy` (or the first returned policy), converts a VAT-inclusive reference to pre-VAT, and applies the shared brand discount suggestion only to lines without a saved purchase price.

`Healthycook` from a website was not recognized by `defaultCostDiscount`, which only accepted `Healthy Cook`. Even with catalogue prices available, the form skipped both price and discount. The shared server/browser rule now recognizes these aliases with word boundaries, preserving the established 15% rate. No database normalization or price backfill is required. Unknown brands still require manual entry; failed lookups do not become zero purchase prices.

The form's `Giá mua` is a unit reference **before purchase discount and before VAT**. Net unit acquisition cost is `price × (1 − purchaseDiscount/100)`, plus a separately recorded printing fee when applicable. `computeOrderTotals` applies VAT after the discount and printing fee; a supplier-confirmed discount takes precedence when present. These suggestions remain reviewable by the Manager and are distinct from confirmed supplier prices and recorded inventory costs.

The hint now distinguishes a missing product, a missing selected-policy price and a missing discount rule, and explains the price/discount relationship. Saved prices are unchanged. This patch does not change price-policy selection, tax-basis rules, permissions, approval or historical purchase records. Catalogue metadata does not retain the original product link, so the `Healthycook` spelling is evidence of the alias issue, not a reliable filter for every product ever created from a link.

## Verification

On the previous generated module, a synthetic `{brand:'Healthycook',name:'Nồi Ceres'}` returns `null`; on the repaired module it returns `15`. Existing `Healthy Cook` remains `15`.

```sh
npm run ui:build
npm run typecheck
node --import tsx --test tests/app/purchase-price-prefill-ui.test.ts tests/app/purchase-discount-review.test.ts tests/app/purchase-order-number-ui.test.ts tests/app/quote-purchase-cost-ui.test.ts src/modules/quotes/domain/purchase-cost.test.ts src/modules/suppliers/domain/order-totals.test.ts tests/app/quick-create-from-link.test.ts tests/app/trial-ui.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/purchase-price-prefill.mjs
```

The browser script uses the actual local CRM/router with synthetic PGlite records, blocks writes, and captures PC (1280px) and mobile (430px) screenshots. It checks retail 1,000,000 → discount 15%, VAT 8%, visible save controls and absence of browser errors. Unit/UI cases also cover VAT-inclusive and non-taxable references, saved prices, manual nonzero discounts, missing catalogue data/rules and network failure. Production is queried read-only for diagnosis; no production orders are approved or edited.
