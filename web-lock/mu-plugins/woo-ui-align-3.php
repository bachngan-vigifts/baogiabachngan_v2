<?php
/**
 * Plugin Name: Lock UI align 3
 * Description: CSS only. Desktop product cards: cards without visible colour swatches reserve the swatch line, so titles and buy buttons line up with cards that show swatches. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin()) { return; }
    if (defined('LNL_UI_ALIGN_OFF') && LNL_UI_ALIGN_OFF) { return; }
    echo '<style id="lnl-ui-align-3">' . lnl_ui_align3_css() . '</style>';
}, 102);

function lnl_ui_align3_css() {
    $css = <<<'CSS'
@media (min-width: 850px) {
  .product-small.box > .box-text > .ux-swatches-in-loop,
  .product-small.box > .box-text > .title-wrapper,
  .product-small.box > .box-text > .price-wrapper,
  .product-small.box > .box-text > .add-to-cart-button { order: 2; }
  .product-small.box > .box-text:not(:has(> .ux-swatches-in-loop:not([style*="visibility: hidden"])))::after { content: ""; display: block; order: 1; flex: 0 0 100%; width: 100%; height: 20px; }
}
CSS;
    return $css;
}
