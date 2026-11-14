# Quote picker details and explicit design images

Based on main `3d18892c62b5ba91a8a78378e6f011cbd7d3aeec`.

- One toolbar button expands/collapses every loaded product. Filtering, stock refresh and load-more inherit that state; reopening the dialog resets it.
- The toggle updates existing panels without replacing quantity inputs or requesting more products. The existing 20-row loading remains; detail markup is only built on first expansion (or rendering while expanded). No per-product API calls are introduced by expanding.
- The design image remains empty until explicitly selected. The image dialog offers the current SKU's catalogue image, an HTTPS link, and a local file. Choosing a candidate only changes the pending preview; "Dùng hình này" applies it to the same row object. Cancel/close discards pending work; stale async completions are ignored. Catalogue images are read, never written.

## Local validation

Passed: typecheck, UI build, syntax/diff checks; focused stock-column, paste, Sale template/private image, customer-memory and new picker-controls tests. New tests exercise cached/API loading, filtering including zero results, shared expansion, quantity preservation, add action, close/reset, explicit image choice, cancel/reopen, custom link/upload, stale responses, row movement, quote persistence and unchanged catalogue images.

Browser script: `scripts/testing/mobile-product-picker.mjs` covers 320/390/430/1440px, load-more/filtering, image selection/cancel/upload/save/reload and layout assertions. **Not successfully run in this environment**: Chromium exits before opening a page with `socket() failed: Operation not permitted`. No desktop/mobile screenshots or browser timing measurements were produced. Run this script on a host that permits Chromium before marking the draft ready.

```sh
npm run typecheck
npm run ui:build
node --import tsx --test tests/app/quote-picker-controls.test.ts tests/app/picker-stock-columns.test.ts tests/app/quote-paste.test.ts tests/app/sale-quote-template.test.ts tests/app/quote-customer-memory.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/mobile-product-picker.mjs
```

No production data writes, migrations, merge, deployment or manually triggered/rerun Actions.
