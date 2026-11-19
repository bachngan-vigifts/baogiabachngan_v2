# Minh Long variation buttons

Candidate MU plugin: `ml-variation-buttons.php`. Minh Long host only. No production deployment has been performed.

## Behavior
- Enhances WooCommerce variation selects into text buttons for size, color and other attributes.
- Original selects remain in the form; a user choice emits one jQuery change event. WooCommerce owns price, image, variation ID, stock and add-to-cart validation.
- Selected state and disabled/missing options follow WooCommerce's select options.
- AJAX-loaded quick view forms are detected. Existing Flatsome / variation swatches are skipped to avoid duplicate controls.
- Without JavaScript, original selects remain visible. Keyboard focus after WooCommerce reset is redirected to a choice button.
- No stock, price, preorder, payment or cart logic changes.
- AJAX-resolved variation availability remains determined by WooCommerce after selection; do not claim every unavailable combination can be predicted in advance.

## Validation status
JavaScript parsed successfully using new Function on the exact embedded source.
PHP lint and browser/integration checks NOT run: execution environment failed to start.
Do not mark deployment ready based on syntax alone.

## Required checks before deployment
1. PHP lint.
2. Product with 1.0 L / 2.0 L / 3.0 L; compare every choice's price/image/variation ID with native select behavior.
3. Size + color with unavailable combinations, defaults, reset, keyboard Enter/Space, disabled options.
4. AJAX variation lookup and preorder/backorder variants remain governed by existing rules.
5. Open/close quick view repeatedly; no duplicate button groups or change events.
6. Check desktop and 390px mobile, long labels, product page and home quick view.
7. Add chosen variant to a test cart; verify correct ID, price and quantity without placing an order.
8. Existing swatches and non-Minh Long hosts unchanged.

## Deployment
Confirm the live Minh Long document root using existing hosting tooling; back up any existing file with the same name. Install only this file at `wp-content/mu-plugins/ml-variation-buttons.php`. Verify readback and rendered behavior after cache refresh. This branch intentionally does not deploy automatically. Roll back by removing only this new MU plugin, or restoring its prior version if one existed.
