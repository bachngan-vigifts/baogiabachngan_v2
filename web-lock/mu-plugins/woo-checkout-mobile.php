<?php
/**
 * Plugin Name: Lock checkout mobile
 * Description: CSS only. Simplified, easier-to-read checkout on phones (<= 600px). Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin() || !function_exists('is_checkout') || !is_checkout()) { return; }
    if (function_exists('is_order_received_page') && is_order_received_page()) { return; }
    if (defined('LNL_CHECKOUT_MOBILE_OFF') && LNL_CHECKOUT_MOBILE_OFF) { return; }
    echo '<style id="lnl-checkout-mobile">' . lnl_checkout_mobile_css() . '</style>';
}, 99);

function lnl_checkout_mobile_css() {
    $css = <<<'CSS'
@media (max-width: 600px) {
  body.page-template-page-checkout { background: #f5f5f7; }
  body.page-template-page-checkout .checkout-page-title,
  body.page-template-page-checkout nav.checkout-breadcrumbs { display: none; }

  body.page-template-page-checkout form.checkout { padding-bottom: 8px; }
  body.page-template-page-checkout form.checkout .col { padding-bottom: 0; }

  /* Block cards */
  body.page-template-page-checkout .woocommerce-billing-fields,
  body.page-template-page-checkout .woocommerce-additional-fields,
  body.page-template-page-checkout .woocommerce-shipping-fields,
  body.page-template-page-checkout #order_review {
    background: #fff; border-radius: 12px; padding: 14px 14px 6px; margin-bottom: 12px;
  }
  body.page-template-page-checkout .woocommerce-billing-fields > h3,
  body.page-template-page-checkout #order_review_heading {
    font-size: 17px; font-weight: 700; text-transform: none; letter-spacing: 0; margin: 0 0 10px; padding: 0; border: 0;
  }

  /* Order summary: remove the heavy blue frame */
  body.page-template-page-checkout .is-sticky-column__inner,
  body.page-template-page-checkout .col-inner.has-border {
    border: 0 !important; box-shadow: none !important; background: transparent !important; padding: 0 !important;
  }
  body.page-template-page-checkout .large-5.col { padding-top: 0; }

  /* Fields */
  body.page-template-page-checkout .form-row { margin-bottom: 10px; padding-bottom: 0; }
  body.page-template-page-checkout .form-row label { font-size: 13px; font-weight: 600; margin-bottom: 4px; color: #333; }
  body.page-template-page-checkout input.input-text,
  body.page-template-page-checkout select,
  body.page-template-page-checkout .select2-container .select2-selection {
    height: 48px; font-size: 16px; border-radius: 8px; box-shadow: none; margin: 0;
  }
  body.page-template-page-checkout .woocommerce-additional-fields textarea { min-height: 72px; font-size: 16px; border-radius: 8px; }

  /* Remove the theme's inner card so we do not double the padding */
  body.page-template-page-checkout .large-7.col > .col-inner,
  body.page-template-page-checkout #customer_details .col-inner { padding: 0 !important; border: 0 !important; box-shadow: none !important; background: transparent !important; }
  body.page-template-page-checkout .large-7.col { padding: 0 0 0; }
  body.page-template-page-checkout .woocommerce-billing-fields::before,
  body.page-template-page-checkout .woocommerce-billing-fields > h3::before { display: none; }
  body.page-template-page-checkout input.input-text::placeholder { font-size: 14px; }

  /* Checkbox rows: aligned, big tap target */
  body.page-template-page-checkout .form-row.woocommerce-form__label-for-checkbox,
  body.page-template-page-checkout .woocommerce-form__label-for-checkbox,
  body.page-template-page-checkout #ship-to-different-address label,
  body.page-template-page-checkout .woocommerce-form-login-toggle label { display: flex; align-items: flex-start; gap: 10px; margin: 0; padding: 6px 0; font-size: 14px; font-weight: 500; }
  body.page-template-page-checkout .woocommerce-form__label-for-checkbox input,
  body.page-template-page-checkout #ship-to-different-address input { margin: 2px 0 0; flex: 0 0 20px; }
  body.page-template-page-checkout #ship-to-different-address { padding: 0; margin: 0; }
  body.page-template-page-checkout .woocommerce-account-fields .form-row,
  body.page-template-page-checkout .create-account { margin-left: 0 !important; padding-left: 0 !important; }
  body.page-template-page-checkout .woocommerce-account-fields input[type=checkbox] { position: static; margin-left: 0; }
  body.page-template-page-checkout .form-row.woocommerce-form__label-for-checkbox,
  body.page-template-page-checkout #ship-to-different-address { margin: 4px 0; }
  body.page-template-page-checkout input[type=checkbox] { width: 20px; height: 20px; }

  /* Payment cards */
  body.page-template-page-checkout #payment { background: transparent; padding: 0; }
  body.page-template-page-checkout ul.wc_payment_methods { margin: 0 0 10px; padding: 0; border: 0; }
  body.page-template-page-checkout li.wc_payment_method {
    list-style: none; margin: 0 0 8px; padding: 12px; border: 1.5px solid #e1e1e6; border-radius: 10px; background: #fff;
  }
  body.page-template-page-checkout li.wc_payment_method label { font-size: 15px; font-weight: 600; margin: 0; }
  body.page-template-page-checkout li.wc_payment_method input:checked + label { color: #c8102e; }
  body.page-template-page-checkout li.wc_payment_method:has(input:checked) { border-color: #c8102e; background: #fff6f7; }

  /* Place order: sticky bar at the bottom of the screen */
  body.page-template-page-checkout #payment .form-row.place-order {
    position: sticky; bottom: 0; z-index: 50; background: #fff; margin: 0 -14px; padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
    box-shadow: 0 -2px 10px rgba(0,0,0,.08);
  }
  body.page-template-page-checkout #place_order {
    width: 100%; height: 52px; font-size: 17px; font-weight: 700; border-radius: 10px; background: #c8102e; margin: 0;
  }
  body.page-template-page-checkout .woocommerce-privacy-policy-text { font-size: 12px; color: #777; }
}
CSS;
    return $css;
}
