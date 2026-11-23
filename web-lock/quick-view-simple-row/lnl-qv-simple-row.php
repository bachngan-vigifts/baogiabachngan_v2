<?php
/**
 * Plugin Name: Lock quick-view simple product action row
 * Description: Keep the cart icon and a 20 percent narrower buy button on one row.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
add_action('wp_head', function () {
 if (is_admin() || strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST)) !== 'locknlockonline.com') return;
 echo '<style id="lnl-qv-simple-row">';
 echo <<<'LNL_SIMPLE_CSS'
body .product-lightbox form.cart:not(.variations_form):has(>.lnl-qv-buy){
display:grid!important;grid-template-columns:46px minmax(0,1fr)!important;gap:10px 8px!important;align-items:center!important;width:100%!important}
body .product-lightbox form.cart:not(.variations_form):has(>.lnl-qv-buy)>*:not(button):not(input[type=hidden]){grid-column:1/-1!important}
body .product-lightbox form.cart:not(.variations_form)>.single_add_to_cart_button{
grid-column:1!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:46px!important;min-width:46px!important;height:44px!important;margin:0!important;float:none!important;box-sizing:border-box!important}
body .product-lightbox form.cart:not(.variations_form)>.lnl-qv-buy{
grid-column:2!important;justify-self:start!important;display:flex!important;align-items:center!important;justify-content:center!important;width:calc(80% + 43.2px)!important;max-width:100%!important;min-width:0!important;height:44px!important;min-height:44px!important;margin:0!important;padding:0 12px!important;float:none!important;box-sizing:border-box!important;white-space:nowrap!important}
LNL_SIMPLE_CSS;
 echo '</style>';
}, 250);
