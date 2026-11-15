<?php
/**
 * Plugin Name: Lock UI align 2
 * Description: CSS only. Product cards: an empty colour-swatch holder no longer takes its own (6px) line, and the reserved badge space matches the badge exactly, so titles and buy buttons line up. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin()) { return; }
    if (defined('LNL_UI_ALIGN_OFF') && LNL_UI_ALIGN_OFF) { return; }
    echo '<style id="lnl-ui-align-2">' . lnl_ui_align2_css() . '</style>';
}, 101);

function lnl_ui_align2_css() {
    $css = <<<'CSS'
.product-small.box > .box-text > .ux-swatches:not(.js-ux-swatches):not(:has(.ux-swatch)) { display: none !important; }
.product-small.box > .box-text:not(:has(.claw-lnl-wdr-sale-badge))::before { height: 30px !important; }
CSS;
    return $css;
}
