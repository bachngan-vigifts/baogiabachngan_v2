<?php
/**
 * Plugin Name: Minh Long Centered Product Quick View
 * Version: 1.0.0
 */
defined('ABSPATH')||exit;
add_action('wp_head',function(){
 if(!is_front_page() && !(function_exists('is_shop') && (is_shop()||is_product_taxonomy())))return;
?>
<style id="ml-centered-quick-view">
@media(min-width:850px){
body .product-small .box-image > .image-tools.grid-tools:has(>a.quick-view){
top:50%!important;bottom:auto!important;left:0!important;right:0!important;
transform:translateY(-50%)!important;z-index:12!important;text-align:center!important;
}
body .product-small .box-image .image-tools.grid-tools > a.quick-view{
display:inline-flex!important;align-items:center;justify-content:center;
width:auto!important;min-height:36px;padding:8px 18px!important;margin:0!important;
background:#123b6e!important;color:#fff!important;border:1px solid #fff!important;border-radius:20px!important;
font-size:13px!important;font-weight:700!important;line-height:1.2!important;
box-shadow:0 3px 12px #123b6e40!important;
}
}
</style>
<?php
},99);
add_action('init',function(){
 if(get_option('ml_quick_view_position_version')==='1')return;
 do_action('litespeed_purge_url',home_url('/'));
 do_action('litespeed_purge_url',home_url('/danh-muc/minh-long/bo-do-an-minh-long/'));
 update_option('ml_quick_view_position_version','1',false);
});
