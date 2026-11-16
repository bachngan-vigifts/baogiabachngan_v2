<?php
/**
 * Plugin Name: Lock cart fragments guest skip 2
 * Description: WooCommerce "cart fragments" asks the server for the mini cart on the first page view of every new visitor, even when the cart is empty (each call boots WordPress, 2-4 s under load, and the browser gives up after 5 s while the server keeps working). When the visitor has no cart cookie, seed the browser's session storage with the empty mini cart already in the page, so WooCommerce uses it instead of calling the server. Visitors with a cart, and the checkout page, keep the normal behaviour. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_FRAG_SKIP2_OFF') && LNL_FRAG_SKIP2_OFF) { return; }

// cart-fragments is printed as a dependency of theme scripts (not in the queue itself), so attach to the registered script; it only prints if the script prints.
add_action('wp_enqueue_scripts', function () {
    if (is_admin() || !wp_script_is('wc-cart-fragments', 'registered')) { return; }
    if (function_exists('is_checkout') && (is_checkout() || is_cart())) { return; }
    wp_add_inline_script('wc-cart-fragments', lnl_frag_skip2_js(), 'before');
}, 999);

function lnl_frag_skip2_js() {
    $js = <<<'JS'
(function () {
  try {
    var c = document.cookie || '';
    if (c.indexOf('woocommerce_items_in_cart=') !== -1 || c.indexOf('woocommerce_cart_hash=') !== -1) { return; }
    var P = window.wc_cart_fragments_params;
    if (!P || !P.fragment_name || !window.sessionStorage) { return; }
    if (sessionStorage.getItem(P.fragment_name)) { return; }
    var el = document.querySelector('div.widget_shopping_cart_content');
    if (!el) { return; }
    var f = {};
    f['div.widget_shopping_cart_content'] = el.outerHTML;
    sessionStorage.setItem(P.fragment_name, JSON.stringify(f));
    sessionStorage.setItem(P.cart_hash_key, '');
    window.__lnlFragSkip = 1;
  } catch (e) {}
})();
JS;
    return $js;
}
