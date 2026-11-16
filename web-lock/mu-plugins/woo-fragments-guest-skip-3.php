<?php
/**
 * Plugin Name: Lock cart fragments guest skip 3
 * Description: New visitors without a cart made one "refresh mini cart" server request on their first page (about 2 s each, browser gives up after 5 s). Print a tiny script at the end of the page body (runs before the deferred WooCommerce cart-fragments script): when the visitor has no cart cookie, store the empty mini cart already in the page in the browser session storage, so WooCommerce uses it instead of asking the server. Visitors with a cart, cart and checkout pages are unchanged. Delete this file to roll back.
 */
if (!defined('ABSPATH')) { exit; }
if (defined('LNL_FRAG_SKIP3_OFF') && LNL_FRAG_SKIP3_OFF) { return; }
add_action('wp_footer', function () {
    if (is_admin() || !function_exists('WC') || (function_exists('is_checkout') && (is_checkout() || is_cart()))) { return; }
    $id = get_current_blog_id();
    $base = md5($id . '_' . get_site_url($id, '/') . get_template());
    $hash_key = apply_filters('woocommerce_cart_hash_key', 'wc_cart_hash_' . $base);
    $frag_name = apply_filters('woocommerce_cart_fragment_name', 'wc_fragments_' . $base);
    $js = '(function(){try{var c=document.cookie||"";if(c.indexOf("woocommerce_items_in_cart=")!==-1||c.indexOf("woocommerce_cart_hash=")!==-1){return;}'
        . 'var F=' . wp_json_encode($frag_name) . ',K=' . wp_json_encode($hash_key) . ';if(!window.sessionStorage||sessionStorage.getItem(F)){return;}'
        . 'var el=document.querySelector("div.widget_shopping_cart_content");if(!el){return;}'
        . 'var f={};f["div.widget_shopping_cart_content"]=el.outerHTML;sessionStorage.setItem(F,JSON.stringify(f));sessionStorage.setItem(K,"");window.__lnlFragSkip=1;}catch(e){}})();';
    echo '<script id="lnl-frag-skip3" data-no-optimize="1" data-no-defer="1">' . $js . '</script>';
}, 1);
