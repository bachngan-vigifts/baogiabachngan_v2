<?php
/**
 * Plugin Name: Lock discount bulk table off
 * Description: Woo Discount Rules reloads its "bulk discount table" by AJAX on every variable product view (3 identical calls on load) and on every variation change. The shop has no bulk rules, so the answer is always an empty table. Use the plugin's own filter to stop loading it dynamically. Prices, cart and checkout discounts are not affected. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_WDR_BULK_OFF_OFF') && LNL_WDR_BULK_OFF_OFF) { return; }
add_filter('advanced_woo_discount_rules_disable_load_dynamic_bulk_table', function () { return 'off'; }, 99);
