<?php
/**
 * Plugin Name: Lock UI align
 * Description: CSS only. Product cards: cards without a sale badge reserve the badge's space, so titles and buy buttons line up with cards that have one. Desktop product page: the chat launcher sits beside the contact bar so it no longer covers the buy buttons. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin()) { return; }
    if (defined('LNL_UI_ALIGN_OFF') && LNL_UI_ALIGN_OFF) { return; }
    echo '<style id="lnl-ui-align">' . lnl_ui_align_css() . '</style>';
}, 100);

function lnl_ui_align_css() {
    $css = <<<'CSS'
.product-small.box > .box-text:not(:has(.claw-lnl-wdr-sale-badge))::before { content: ""; display: block; flex: 0 0 100%; width: 100%; height: 36px; }
@media (min-width: 850px) {
  body.single-product #claw-ai-launcher { top: auto !important; bottom: 2px !important; right: 180px !important; }
}
CSS;
    return $css;
}
