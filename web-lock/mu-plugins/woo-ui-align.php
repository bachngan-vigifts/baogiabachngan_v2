<?php
/**
 * Plugin Name: Lock UI align
 * Description: CSS only. Product cards: the sale badge sits on the image corner instead of pushing the text down, so buy buttons line up. Desktop product page: the chat launcher sits beside the contact bar so it no longer covers the buy buttons. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin()) { return; }
    if (defined('LNL_UI_ALIGN_OFF') && LNL_UI_ALIGN_OFF) { return; }
    echo '<style id="lnl-ui-align">' . lnl_ui_align_css() . '</style>';
}, 100);

function lnl_ui_align_css() {
    $css = <<<'CSS'
.product-small.box > .box-text { position: static !important; }
.product-small.box > .box-text > .claw-lnl-wdr-sale-badge { position: absolute; top: 8px; left: 8px; margin: 0 !important; z-index: 3; }
@media (min-width: 850px) {
  body.single-product #claw-ai-launcher { top: auto !important; bottom: 2px !important; right: 180px !important; }
}
CSS;
    return $css;
}
