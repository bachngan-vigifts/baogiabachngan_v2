<?php
/**
 * Plugin Name: Lock defer order emails
 * Description: Send WooCommerce order emails (to the shop and to the customer) in the background right after the order is saved, instead of making the customer wait for the mail server while the "Place order" button spins. Uses WooCommerce's own background emailer. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_DEFER_EMAILS_OFF') && LNL_DEFER_EMAILS_OFF) { return; }
add_filter('woocommerce_defer_transactional_emails', '__return_true', 99);
