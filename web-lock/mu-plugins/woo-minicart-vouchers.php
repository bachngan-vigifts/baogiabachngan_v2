<?php
/**
 * Plugin Name: Lock mini cart voucher tiers
 * Description: Shows the Voucher Shop tiers (discount + minimum order, and how much more to add) under the buttons of the mini cart. Reads the existing WooCommerce coupons; does not apply or change any coupon. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_MINICART_VOUCHERS_OFF') && LNL_MINICART_VOUCHERS_OFF) { return; }

add_action('woocommerce_widget_shopping_cart_after_buttons', function () {
    if (!function_exists('WC') || !WC()->cart || WC()->cart->is_empty()) { return; }
    $codes = apply_filters('lnl_minicart_voucher_codes', array('lnl10k', 'lnl25k', 'lnl75k', 'lnl150k'));
    $subtotal = (float) WC()->cart->get_displayed_subtotal();
    $rows = '';
    foreach ($codes as $code) {
        if (!wc_get_coupon_id_by_code($code)) { continue; }
        $c = new WC_Coupon($code);
        $exp = $c->get_date_expires();
        if ($exp && $exp->getTimestamp() < time()) { continue; }
        $amount = (float) $c->get_amount();
        if ($amount <= 0) { continue; }
        $min = (float) $c->get_minimum_amount();
        $title = "Gi\u{1ea3}m " . ($c->get_discount_type() === 'percent' ? wc_format_decimal($amount) . '%' : wp_strip_all_tags(wc_price($amount)));
        $cond = $min > 0 ? "\u{110}\u{1a1}n t\u{1eeb} " . wp_strip_all_tags(wc_price($min)) : "M\u{1ecd}i \u{111}\u{1a1}n h\u{e0}ng";
        $ok = $subtotal >= $min;
        $state = $ok ? "\u{2713} \u{110}\u{1ee7} \u{111}i\u{1ec1}u ki\u{1ec7}n" : "Mua th\u{ea}m " . wp_strip_all_tags(wc_price($min - $subtotal));
        $rows .= '<div class="lnl-mv-row' . ($ok ? ' is-ok' : '') . '"><strong>' . esc_html($title) . '</strong><span>' . esc_html($cond) . '</span><em>' . esc_html($state) . '</em></div>';
    }
    if ($rows === '') { return; }
    echo '<div class="lnl-mv"><div class="lnl-mv-head">Voucher Shop</div>' . $rows . '<div class="lnl-mv-note">' . esc_html("Ch\u{1ecd}n m\u{e3} \u{1edf} trang Gi\u{1ecf} h\u{e0}ng ho\u{1eb7}c Thanh to\u{e1}n.") . '</div></div>';
}, 20);

add_action('wp_head', function () {
    if (is_admin()) { return; }
    echo '<style id="lnl-mv-css">' . lnl_minicart_vouchers_css() . '</style>';
}, 100);

function lnl_minicart_vouchers_css() {
    $css = <<<'CSS'
.lnl-mv { margin: 14px 0 0; padding: 12px; border: 1px dashed #f0b9a8; border-radius: 10px; background: #fff8f5; text-align: left; }
.lnl-mv-head { font-size: 14px; font-weight: 700; color: #d93a1e; margin: 0 0 8px; }
.lnl-mv-row { display: grid; grid-template-columns: 1fr auto; column-gap: 8px; align-items: center; padding: 7px 0; border-top: 1px solid #f6e3dc; font-size: 13px; line-height: 1.3; color: #888; }
.lnl-mv-row strong { color: #555; font-weight: 700; }
.lnl-mv-row span { grid-column: 1; font-size: 12px; }
.lnl-mv-row em { grid-column: 2; grid-row: 1 / span 2; font-style: normal; font-size: 12px; text-align: right; white-space: nowrap; }
.lnl-mv-row.is-ok strong { color: #d93a1e; }
.lnl-mv-row.is-ok em { color: #1b8a3a; font-weight: 700; }
.lnl-mv-note { font-size: 12px; color: #777; margin: 8px 0 0; }
CSS;
    return $css;
}
