<?php
/**
 * Plugin Name: Lock UI align
 * Description: CSS only. Product cards: equal height, buy button pinned to the bottom so buttons line up. Desktop product page: the chat launcher sits beside the contact bar so it no longer covers the buy buttons. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin()) { return; }
    if (defined('LNL_UI_ALIGN_OFF') && LNL_UI_ALIGN_OFF) { return; }
    echo '<style id="lnl-ui-align">' . lnl_ui_align_css() . '</style>';
}, 100);

function lnl_ui_align_css() {
    $css = <<<'CSS'
.col.product-small > .col-inner { height: 100%; display: flex; flex-direction: column; }
.col.product-small > .col-inner > .product-small.box { flex: 1 1 auto; display: flex; flex-direction: column; }
.product-small.box > .box-text { flex: 1 1 auto; height: auto !important; display: flex !important; flex-direction: column !important; flex-wrap: nowrap !important; }
.product-small.box > .box-text > .price-wrapper { height: auto !important; }
.product-small.box > .box-text > .add-to-cart-button { margin-top: auto !important; padding-top: 10px; }
.flickity-slider > .col.product-small { height: 100%; }
@media (min-width: 850px) {
  body.single-product #claw-ai-launcher { top: auto !important; bottom: 2px !important; right: 180px !important; }
}
CSS;
    return $css;
}
