<?php
/**
 * Plugin Name: Minh Long mobile quick view
 * Description: Keep the existing Flatsome quick-view control visible and centered on touch layouts.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
function ml_mobile_qv_host() {
 return in_array(strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST)), array('minhlongonline.com','www.minhlongonline.com'), true);
}
add_filter('theme_mod_disable_quick_view', function($disabled) {
 return ml_mobile_qv_host() ? false : $disabled;
}, 1000);
add_action('wp_head', function() {
 if (!ml_mobile_qv_host() || is_admin()) return;
 ?>
<style id="ml-mobile-quick-view">
@media(max-width:849px){
body .product-small .box-image>.image-tools.grid-tools:has(>a.quick-view){display:flex!important;align-items:center!important;justify-content:center!important;position:absolute!important;inset:50% 0 auto!important;transform:translateY(-50%)!important;width:100%!important;opacity:1!important;visibility:visible!important;pointer-events:none!important;z-index:12!important;text-align:center!important}
body .product-small .box-image>.image-tools.grid-tools>a.quick-view{display:inline-flex!important;align-items:center!important;justify-content:center!important;position:relative!important;inset:auto!important;transform:none!important;float:none!important;width:auto!important;max-width:90%!important;margin:0!important;padding:7px 12px!important;min-height:36px!important;line-height:1.2!important;border:1px solid #fff!important;border-radius:24px!important;background:#123b6e!important;color:#fff!important;font-size:12px!important;font-weight:700!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important}
}
</style>
 <?php
}, 10001);
