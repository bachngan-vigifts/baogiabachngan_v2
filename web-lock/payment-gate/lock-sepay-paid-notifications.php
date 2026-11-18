<?php
/**
 * Plugin Name: Lock SePay paid-order notification gate
 * Version: 1.0.0
 * Delay new-order email and CRM order delivery until SePay payment is paid.
 */
defined('ABSPATH') || exit;
function lnl_png_store() {
 return in_array(strtolower((string) parse_url(home_url('/'), PHP_URL_HOST)), array('locknlockonline.com', 'www.locknlockonline.com'), true);
}
function lnl_png_order($order) {
 return $order instanceof WC_Order ? $order : (is_numeric($order) ? wc_get_order($order) : false);
}
function lnl_png_target($order) {
 return lnl_png_store() && $order instanceof WC_Order && $order->get_payment_method() === 'sepay';
}
function lnl_png_released($order) {
 return $order->is_paid() || (bool) $order->get_date_paid() || $order->get_meta('_lnl_sepay_released') === 'yes';
}
function lnl_png_email($enabled, $order) {
 $order = lnl_png_order($order);
 return lnl_png_target($order) && !lnl_png_released($order) ? false : $enabled;
}
add_filter('woocommerce_email_enabled_new_order', 'lnl_png_email', 99999, 2);
// Do not send the initial "order received / on hold" message for an unpaid QR session.
add_filter('woocommerce_email_enabled_customer_on_hold_order', function($enabled, $order) {
 $order = lnl_png_order($order);
 return lnl_png_target($order) ? false : $enabled;
}, 99999, 2);
function lnl_png_crm_webhook($webhook) {
 if (!is_object($webhook) || $webhook->get_resource() !== 'order') return false;
 $url = parse_url($webhook->get_delivery_url());
 return ($url['host'] ?? '') === 'taceqfnsorewelsbdckg.supabase.co'
  && ($url['path'] ?? '') === '/functions/v1/baogia-v2-api/api/staff/integrations/woocommerce/lock/order';
}
add_filter('woocommerce_webhook_should_deliver', function($allowed, $webhook, $arg) {
 if (!$allowed || !lnl_png_store() || !lnl_png_crm_webhook($webhook)) return $allowed;
 $order = lnl_png_order($arg);
 return lnl_png_target($order) && !lnl_png_released($order) ? false : $allowed;
}, 99999, 3);
// Preserve later cancellation/refund updates for an order that has already been released.
add_action('woocommerce_order_status_changed', function($id, $from, $to, $order) {
 if (lnl_png_target($order) && $order->is_paid() && $order->get_meta('_lnl_sepay_released') !== 'yes') {
  $order->update_meta_data('_lnl_sepay_released', 'yes');
  $order->save_meta_data();
 }
}, 5, 4);
// WooCommerce's admin new-order email does not listen to on-hold -> paid by default.
// Use its existing send-once protection, configured recipients and deferred notification hooks.
function lnl_png_notify_paid($id, $order = false) {
 $order = lnl_png_order($order ?: $id);
 if (!lnl_png_target($order) || !$order->is_paid() || $order->get_meta('_new_order_email_sent') === 'true') return;
 $emails = WC()->mailer()->get_emails();
 if (isset($emails['WC_Email_New_Order'])) $emails['WC_Email_New_Order']->trigger($id, $order);
}
add_action('woocommerce_order_status_on-hold_to_processing_notification', 'lnl_png_notify_paid', 20, 2);
add_action('woocommerce_order_status_on-hold_to_completed_notification', 'lnl_png_notify_paid', 20, 2);
