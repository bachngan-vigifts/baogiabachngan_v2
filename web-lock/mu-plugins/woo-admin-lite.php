<?php
/**
 * Plugin Name: Lock lighter WooCommerce admin
 * Description: Every wp-admin screen loaded the WooCommerce "activity panel" (orders, reviews, low stock, inbox notes, store alerts) and marketing panels: 5-6 REST calls of ~5 s each per page. Turn off only those panels and marketplace suggestions. Analytics reports, orders, products and settings stay as they are. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_ADMIN_LITE_OFF') && LNL_ADMIN_LITE_OFF) { return; }
add_filter('woocommerce_admin_features', function ($features) {
    if (!is_array($features)) { return $features; }
    $off = array('activity-panels', 'remote-inbox-notifications', 'marketing', 'store-alerts', 'shipping-label-banner', 'remote-free-extension', 'wc-pay-promotion');
    return array_values(array_diff($features, $off));
}, 99);
add_filter('woocommerce_allow_marketplace_suggestions', '__return_false', 99);
