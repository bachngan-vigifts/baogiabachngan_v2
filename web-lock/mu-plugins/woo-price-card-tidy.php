<?php
/**
 * Plugin Name: Lock price and product card tidy
 * Description: CSS only. Price ranges read low-to-high (the theme reverses the order for sale prices; ranges were reversed too). Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    if (is_admin()) { return; }
    if (defined('LNL_PRICE_TIDY_OFF') && LNL_PRICE_TIDY_OFF) { return; }
    echo '<style id="lnl-price-tidy">' . lnl_price_tidy_css() . '</style>';
}, 100);

function lnl_price_tidy_css() {
    $css = <<<'CSS'
.price.product-page-price:not(:has(del)) { flex-direction: row !important; justify-content: flex-start !important; flex-wrap: wrap; column-gap: 6px; }
CSS;
    return $css;
}
