<?php
/**
 * Plugin Name: Lock hide sold count
 * Description: CSS only. Hides the "Da ban N" (sold count) label. Delete this file to show it again.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin()) { return; }
    if (defined('LNL_HIDE_SOLD_OFF') && LNL_HIDE_SOLD_OFF) { return; }
    echo '<style id="lnl-hide-sold">.lnl-sold-count{display:none!important}</style>';
}, 104);
