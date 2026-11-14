<?php
/**
 * Plugin Name: Lock default QR payment
 * Description: On the checkout page, preselect bank transfer by QR (gateway id sepay) when the customer has not chosen a payment method yet. COD stays available and keeps its place in the list. Remove this file to go back to the old default.
 */
if (!defined('ABSPATH')) { exit; }

add_action('woocommerce_before_checkout_form', function () {
    if (!function_exists('WC') || !WC()->session || !WC()->payment_gateways()) { return; }
    if (WC()->session->get('chosen_payment_method')) { return; }
    $gateways = WC()->payment_gateways()->get_available_payment_gateways();
    if (!isset($gateways['sepay'])) { return; }
    WC()->session->set('chosen_payment_method', 'sepay');
    if (method_exists(WC()->session, 'has_session') && !WC()->session->has_session()) {
        WC()->session->set_customer_session_cookie(true);
    }
}, 5);
