<?php
/**
 * WooCommerce Cart Optimization
 * - Keep the trimmed cart fragments filters (same behaviour as before).
 * - REMOVED: the footer script that forced an extra cart fragments refresh 3 seconds after every page load
 *   (it added one get_refreshed_fragments request of about 2 seconds to every page).
 * - Cart page only: do not load the password strength meter (zxcvbn, about 380 KB), the cart does not need it.
 *   Checkout and account pages are not touched.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Cart fragments cache hint (unchanged).
add_filter('woocommerce_cart_fragments_cache_expiration', function ($expiration) {
    return 30;
});

// Return only the fragments the theme uses (unchanged).
add_filter('woocommerce_add_to_cart_fragments', function ($fragments) {
    $keep = [];
    $keys_to_keep = [
        'div.widget_shopping_cart_content',
        '.cart-item',
        '.header-cart-title',
        '.cart-icon',
    ];

    foreach ($keys_to_keep as $key) {
        if (isset($fragments[$key])) {
            $keep[$key] = $fragments[$key];
        }
    }

    // If none of the known keys exist, keep everything.
    if (empty($keep) && !empty($fragments)) {
        return $fragments;
    }

    return !empty($keep) ? $keep : $fragments;
}, 100);

// Cart page only: drop the password strength meter scripts.
$lnl_drop_pw_meter = function () {
    if (is_admin() || !function_exists('is_cart') || !is_cart() || (function_exists('is_checkout') && is_checkout())) {
        return;
    }
    foreach (['wc-password-strength-meter', 'password-strength-meter', 'zxcvbn-async'] as $handle) {
        wp_dequeue_script($handle);
    }
};
add_action('wp_enqueue_scripts', $lnl_drop_pw_meter, 100);
add_action('wp_print_scripts', $lnl_drop_pw_meter, 1);
add_action('wp_print_footer_scripts', $lnl_drop_pw_meter, 1);
