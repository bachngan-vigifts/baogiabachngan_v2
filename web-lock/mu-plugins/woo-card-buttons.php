<?php
/**
 * Plugin Name: Lock card buttons
 * Description: CSS only. Product cards: the buy button moves up to the sale-badge line (right side). "Chon" stays as a small text button; "Them vao gio hang" becomes a cart icon. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin()) { return; }
    if (defined('LNL_CARD_BUTTONS_OFF') && LNL_CARD_BUTTONS_OFF) { return; }
    echo '<style id="lnl-card-buttons">' . lnl_card_buttons_css() . '</style>';
}, 103);

function lnl_card_buttons_css() {
    $css = <<<'CSS'
.product-small.box > .box-text > .claw-lnl-wdr-sale-badge { order: -2 !important; flex: 0 1 auto !important; min-width: 0; white-space: nowrap; }
.product-small.box > .box-text { column-gap: 4px !important; }
.product-small.box > .box-text:not(:has(.claw-lnl-wdr-sale-badge))::before { order: -2 !important; flex: 1 1 auto !important; width: auto !important; }
.product-small.box > .box-text > .add-to-cart-button:has(> a.product_type_simple, > a.product_type_variable) { order: -1 !important; flex: 0 0 auto !important; width: auto !important; height: 30px !important; margin: 0 0 0 auto !important; padding: 0 !important; line-height: 1; }
.product-small.box > .box-text > .add-to-cart-button:has(> a.product_type_simple, > a.product_type_variable) > a.button { display: inline-block; box-sizing: border-box; height: 30px; min-height: 0; line-height: 30px !important; padding: 0 9px !important; margin: 0 !important; font-size: 11px; letter-spacing: 0; border-radius: 6px; white-space: nowrap; vertical-align: top; }
.product-small.box > .box-text > .add-to-cart-button > a.product_type_simple.add_to_cart_button[href*="add-to-cart"] { width: 36px; padding: 0 !important; font-size: 0 !important; color: transparent !important; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='9' cy='20' r='1.6'/%3E%3Ccircle cx='18' cy='20' r='1.6'/%3E%3Cpath d='M2 3h3l2.7 12.2a1.5 1.5 0 0 0 1.5 1.2h8.9a1.5 1.5 0 0 0 1.5-1.2L21 7H6'/%3E%3Cpath d='M12.5 9.5v4M10.5 11.5h4'/%3E%3C/svg%3E") !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 19px 19px !important; }
.product-small.box > .box-text > .add-to-cart-button > a.product_type_simple.added { background-color: #1b8a3a !important; }
.product-small.box > .box-text > .add-to-cart-button:has(> a.product_type_simple, > a.product_type_variable) > a.added_to_cart { display: none !important; }
CSS;
    return $css;
}
