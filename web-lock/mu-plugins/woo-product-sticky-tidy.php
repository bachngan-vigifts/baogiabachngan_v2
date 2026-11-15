<?php
/**
 * Plugin Name: Lock product sticky bar tidy
 * Description: CSS only. On phones, the sticky buy bar on product pages becomes one clean row (thumbnail + two buttons), and the floating chat/contact buttons move up so they no longer cover it. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin() || !function_exists('is_product') || !is_product()) { return; }
    if (defined('LNL_STICKY_TIDY_OFF') && LNL_STICKY_TIDY_OFF) { return; }
    echo '<style id="lnl-sticky-tidy">' . lnl_sticky_tidy_css() . '</style>';
}, 100);

function lnl_sticky_tidy_css() {
    $css = <<<'CSS'
@media (max-width: 600px) {
  .sticky-add-to-cart--active {
    background: #fff; padding: 8px 10px calc(8px + env(safe-area-inset-bottom)) !important;
    box-shadow: 0 -2px 10px rgba(0,0,0,.1);
  }
  .sticky-add-to-cart--active .sticky-add-to-cart__product {
    display: flex !important; align-items: center; flex-wrap: nowrap; gap: 8px; margin: 0; padding: 0;
  }
  .sticky-add-to-cart--active .sticky-add-to-cart-img {
    width: 40px !important; height: 40px !important; flex: 0 0 40px; margin: 0 !important; border-radius: 6px;
  }
  .sticky-add-to-cart--active p.stock,
  .sticky-add-to-cart--active .awdr-bulk-customizable-table,
  .sticky-add-to-cart--active .claw-lnl-logo-calc,
  .sticky-add-to-cart--active .ux-quantity { display: none !important; }

  .sticky-add-to-cart--active form.cart {
    display: flex !important; flex: 1 1 auto; align-items: center; gap: 8px; margin: 0 !important; padding: 0;
  }
  .sticky-add-to-cart--active form.cart .button,
  .sticky-add-to-cart--active .sticky-add-to-cart-select-options-button {
    height: 44px; min-height: 0; line-height: 1.15; font-size: 13px; padding: 0 8px; margin: 0 !important;
    border-radius: 8px; white-space: nowrap;
  }
  .sticky-add-to-cart--active form.cart .button { flex: 1 1 0; width: auto; }
  .sticky-add-to-cart--active .sticky-add-to-cart-select-options-button { margin-left: auto !important; flex: 0 0 auto; padding: 0 14px; }
  .sticky-add-to-cart--active .woocommerce-Price-amount { font-size: 14px; font-weight: 700; white-space: nowrap; }

  /* Floating buttons move above the bar while it is showing */
  body:has(.sticky-add-to-cart--active) .fixed-contact { bottom: calc(64px + env(safe-area-inset-bottom)) !important; top: auto !important; }
  body:has(.sticky-add-to-cart--active) #claw-ai-launcher { bottom: calc(112px + env(safe-area-inset-bottom)) !important; top: auto !important; }
  body:has(.sticky-add-to-cart--active) #top-link { bottom: calc(70px + env(safe-area-inset-bottom)) !important; }
}
CSS;
    return $css;
}
