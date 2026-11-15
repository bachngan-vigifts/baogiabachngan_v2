<?php
/**
 * Plugin Name: Lock checkout no account prompts
 * Description: Checkout page: hide the "create account" checkbox and the "already have an account? click to login" notice. Guest checkout stays as is. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_CHECKOUT_NOACCOUNT_OFF') && LNL_CHECKOUT_NOACCOUNT_OFF) { return; }

// Only when guests may check out; otherwise leave WooCommerce untouched.
$lnl_guest_ok = function () {
    return get_option('woocommerce_enable_guest_checkout') === 'yes';
};

add_filter('woocommerce_checkout_registration_enabled', function ($enabled) use ($lnl_guest_ok) {
    return $lnl_guest_ok() ? false : $enabled;
});

add_action('template_redirect', function () use ($lnl_guest_ok) {
    if ($lnl_guest_ok()) {
        remove_action('woocommerce_before_checkout_form', 'woocommerce_checkout_login_form', 10);
    }
});

add_action('wp_head', function () {
    if (is_admin() || !function_exists('is_checkout') || !is_checkout()) { return; }
    if (function_exists('is_order_received_page') && is_order_received_page()) { return; }
    echo '<style id="lnl-checkout-no-account">.woocommerce-form-login-toggle,.woocommerce-account-fields p.create-account{display:none!important}</style>';
}, 100);
