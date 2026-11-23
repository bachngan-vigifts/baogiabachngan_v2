<?php
/**
 * Plugin Name: Store subtle quick view
 * Description: Subtle touch controls and hover-only desktop quick view on Lock and Minh Long.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
add_action('wp_head', function () {
 if (is_admin()) return;
 $host = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
 if (!in_array($host, array('locknlockonline.com','www.locknlockonline.com','minhlongonline.com','www.minhlongonline.com'), true)) return;
 ?>
<style id="store-subtle-quick-view">
html body .product-small .box-image > .image-tools.grid-tools > a.quick-view.quick-view{
 opacity:.42!important;background:rgba(18,59,110,.68)!important;box-shadow:none!important;
 transition:opacity .18s ease,background-color .18s ease!important;
}
html body .product-small .box-image > .image-tools.grid-tools > a.quick-view.quick-view:active,html body .product-small .box-image > .image-tools.grid-tools > a.quick-view.quick-view:focus-visible{opacity:1!important;background:#123b6e!important}
@media(min-width:850px) and (hover:hover) and (pointer:fine){
 html body .product-small .box-image > .image-tools.grid-tools > a.quick-view.quick-view{opacity:0!important;pointer-events:none!important}
 html body .product-small .box-image:hover > .image-tools.grid-tools > a.quick-view.quick-view,
 html body .product-small .box-image:focus-within > .image-tools.grid-tools > a.quick-view.quick-view{
 opacity:1!important;background:#123b6e!important;pointer-events:auto!important
 }
}
@media(prefers-reduced-motion:reduce){html body .product-small .box-image > .image-tools.grid-tools > a.quick-view.quick-view{transition:none!important}}
</style>
 <?php
}, 99999);
