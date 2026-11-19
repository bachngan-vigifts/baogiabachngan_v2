# Lock quick view

Lock-only MU plugin enabling Flatsome's native quick-view extension through its theme filter. Does not modify theme options or parent theme files. Popup enhancements retain native WooCommerce variation validation and existing Lock cart/checkout endpoints.

- Product-image button centered on hover/focus; visible on touch devices.
- Attribute buttons retain the native selects as the variation source of truth.
- Cart icon and buy-now button use selected variation and quantity. No automatic retries after uncertain cart failure.
- No payment, CRM, pricing, or shipping logic changes.

## Deployment

Push-triggered deployment workflow uses existing cPanel GitHub secrets, uploads only lnl-native-quick-view.php, checks exact readback, refreshes existing home-page caches and verifies live desktop/mobile behavior. Failed verification restores the previous file (or a disabled file for initial install).

Run PHP lint and node test.mjs with jsdom/jquery installed under /tmp/lnl-qv. verify.mjs uses Playwright against the public page and intercepts cart writes/buy-now navigation; it never creates orders. Screenshots and results are workflow artifacts.

The predeployment browser preview cannot enable the server-side theme extension: with quick view disabled on the server, its AJAX action returns HTTP 400. Use live verification after the reversible activation; the PHP filter is required for the endpoint and variation script enqueue.
