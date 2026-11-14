<?php
/**
 * Plugin Name: Lock checkout lite
 * Description: Do not load the password strength library (zxcvbn) on the checkout page. Cart page is handled by woo-cart-optimize.php.
 */
if (!defined('ABSPATH')) { exit; }

$lnl_checkout_lite = function () {
    if (is_admin() || !function_exists('is_checkout') || !is_checkout()) { return; }
    if (function_exists('is_order_received_page') && is_order_received_page()) { return; }
    foreach (array('wc-password-strength-meter', 'password-strength-meter', 'zxcvbn-async') as $handle) {
        wp_dequeue_script($handle);
    }
};
add_action('wp_enqueue_scripts', $lnl_checkout_lite, 100);
add_action('wp_print_scripts', $lnl_checkout_lite, 1);
add_action('wp_print_footer_scripts', $lnl_checkout_lite, 1);
