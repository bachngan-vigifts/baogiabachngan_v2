# Company invoice guidance

Approved for both stores on 19 November 2026. Add an invoice notice inside the existing product price card, beneath VAT. Do not modify price, promotions, invoice fields or checkout behavior.

Deploy via the dedicated workflow using existing cPanel secrets. The script verifies the exact plugin upload, refreshes page caches through a temporary authenticated helper, disables the helper, and checks normal public product URLs at 1440px and 390px. Screenshots are saved before and after. Verification failure restores the prior plugin and refreshes caches. To disable manually, remove only wp-content/mu-plugins/store-company-invoice-guidance.php and refresh the product page cache.
