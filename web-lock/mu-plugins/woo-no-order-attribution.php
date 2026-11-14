<?php
/**
 * Plugin Name: Lock no order attribution
 * Description: Turn off the WooCommerce Order Attribution feature (16 hidden checkout fields and its tracking script). Remove this file to turn it back on.
 */
if (!defined('ABSPATH')) { exit; }

add_filter('pre_option_woocommerce_feature_order_attribution_enabled', function () {
    return 'no';
});
