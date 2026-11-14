<?php
/**
 * Plugin Name: Lock checkout mobile - invoice on top
 * Description: CSS only. On phones, show the company-invoice box at the top of the checkout form (highlighted) and tidy the checkbox rows. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin() || !function_exists('is_checkout') || !is_checkout()) { return; }
    if (function_exists('is_order_received_page') && is_order_received_page()) { return; }
    if (defined('LNL_CHECKOUT_MOBILE_OFF') && LNL_CHECKOUT_MOBILE_OFF) { return; }
    echo '<style id="lnl-checkout-mobile-top">' . lnl_checkout_mobile_top_css() . '</style>';
}, 100);

function lnl_checkout_mobile_top_css() {
    $css = <<<'CSS'
@media (max-width: 600px) {
  /* One flex column so the invoice box can jump above the billing card */
  body.page-template-page-checkout #customer_details { display: flex; flex-direction: column; }
  body.page-template-page-checkout #customer_details > div,
  body.page-template-page-checkout #customer_details .woocommerce-additional-fields { display: contents; }

  body.page-template-page-checkout .claw-lnl-invoice-request { order: 0; }
  body.page-template-page-checkout .woocommerce-billing-fields { order: 1; }
  body.page-template-page-checkout .woocommerce-account-fields { order: 2; }
  body.page-template-page-checkout .woocommerce-shipping-fields { order: 3; }
  body.page-template-page-checkout .woocommerce-additional-fields__field-wrapper { order: 4; }

  /* Invoice box: highlighted */
  body.page-template-page-checkout .claw-lnl-invoice-request {
    background: #f0faf3; border: 2px solid #1b8a3a; border-radius: 12px; padding: 12px 14px; margin: 0 0 12px;
  }
  body.page-template-page-checkout .claw-lnl-invoice-request__label {
    display: flex; align-items: center; gap: 10px; margin: 0; font-size: 16px; font-weight: 700; color: #14702e;
  }
  body.page-template-page-checkout .claw-lnl-invoice-request__checkbox { width: 22px; height: 22px; flex: 0 0 22px; margin: 0; }

  /* Account + ship-to-other-address: two tidy rows */
  body.page-template-page-checkout .woocommerce-account-fields,
  body.page-template-page-checkout .woocommerce-shipping-fields {
    background: #fff; border-radius: 12px; padding: 6px 14px; margin: 0 0 8px;
  }
  body.page-template-page-checkout .woocommerce-account-fields .form-row.create-account { margin: 0; padding: 0; }
  body.page-template-page-checkout .woocommerce-account-fields label,
  body.page-template-page-checkout #ship-to-different-address label { min-height: 36px; align-items: center; }
  body.page-template-page-checkout #ship-to-different-address { margin: 0; padding: 0; font-size: 14px; text-transform: none; letter-spacing: 0; }

  /* Order note as its own card */
  body.page-template-page-checkout #order_comments_field { background: #fff; border-radius: 12px; padding: 12px 14px; margin: 0 0 12px; }
  /* Tighten the three checkbox rows */
  body.page-template-page-checkout .woocommerce-billing-fields > label.woocommerce-form__label-for-checkbox { margin: 0 !important; padding: 2px 0 !important; min-height: 0; }
  body.page-template-page-checkout #mailpoet_woocommerce_checkout_optin_present_field { display: none; }
  body.page-template-page-checkout .woocommerce-billing-fields { padding-bottom: 6px; margin-bottom: 4px; }
  body.page-template-page-checkout .woocommerce-account-fields,
  body.page-template-page-checkout .woocommerce-shipping-fields { padding: 0 14px; margin: 0 0 2px; }
  body.page-template-page-checkout .woocommerce-account-fields label,
  body.page-template-page-checkout #ship-to-different-address label { min-height: 30px; padding: 0; margin: 0; }
  body.page-template-page-checkout .woocommerce-account-fields .form-row,
  body.page-template-page-checkout .woocommerce-shipping-fields h3 { margin: 0 !important; padding: 0 !important; }
  body.page-template-page-checkout .woocommerce-shipping-fields .shipping_address,
  body.page-template-page-checkout .woocommerce-account-fields div.create-account { margin: 0; padding: 0; }
}
CSS;
    return $css;
}
