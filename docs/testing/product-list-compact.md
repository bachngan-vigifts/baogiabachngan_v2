# Product list: compact layout 2

At widths up to 850 px, each product uses three rows: selection/image/name/SKU;
price and Tồn/Giữ/Về; then the existing quote/update/delete actions. Desktop keeps
the complete table. Brand, unit and supplier stock remain available in the product
detail page. Permissions and confirmation handlers are unchanged.

Run the actual app with an isolated PGlite fixture and Chromium:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROMIUM_PATH=/usr/bin/chromium \
SCREENSHOT_DIR=/tmp/product-list-compact \
node --import tsx scripts/testing/product-list-compact.mjs
```

The script checks Manager and employee at 320, 390, 430, 768 and 1440 px,
including long names, missing prices, selection, update dialog, delete confirmation
and quote navigation. It blocks external requests and does not confirm product
changes. Screenshots and measurements are written to `SCREENSHOT_DIR`.

Validated with the same fixture: at 390 px a regular product decreased from
372 px to 133 px tall, with three grid rows. All ten viewport/role combinations
passed. Typecheck, UI build, and the existing mobile operations, mobile density,
mobile action policy, product archive and catalog snapshot regression files passed.

No database migration or API change is required.
