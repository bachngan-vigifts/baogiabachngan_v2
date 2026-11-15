<?php
/**
 * Plugin Name: Lock UI align 2
 * Description: CSS only. Product cards: an empty colour-swatch holder no longer adds a few pixels, so buy buttons line up exactly. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin()) { return; }
    if (defined('LNL_UI_ALIGN_OFF') && LNL_UI_ALIGN_OFF) { return; }
    echo '<style id="lnl-ui-align-2">' . lnl_ui_align2_css() . '</style>';
}, 100);

function lnl_ui_align2_css() {
    $css = <<<'CSS'
.product-small.box > .box-text > .ux-swatches { margin: 0 !important; padding: 0 !important; min-height: 0 !important; height: 0 !important; overflow: hidden; }
CSS;
    return $css;
}
