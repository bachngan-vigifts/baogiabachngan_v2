<?php
/**
 * Plugin Name: Minh Long Homepage Category Product Icons
 * Description: Small product thumbnails for the desktop hero category menu.
 * Version: 1.1.0
 */
defined( 'ABSPATH' ) || exit;
add_action('init',function(){
 if(get_option('ml_hero_size_version')==='2')return;
 do_action('litespeed_purge_url',home_url('/'));
 update_option('ml_hero_size_version','2',false);
});
add_action( 'wp_footer', function () {
    if ( ! is_front_page() || ! function_exists( 'wc_get_products' ) ) { return; }
    $slugs = array( 'tuong-linh-vat-minh-long', 'bo-tra-ca-phe-minh-long', 'bo-do-an-minh-long', 'ca-su', 'ly-su-duong-sinh-minh-long', 'binh-hoa-minh-long', 'to-dia-trai-cay-minh-long', 'chen-minh-long', 'to-tho-khay-minh-long', 'lys', 'healthycook' );
    $map = get_transient( 'ml_hero_product_icons_v1' );
    if ( false === $map ) {
        $map = array();
        foreach ( $slugs as $slug ) {
            $products = wc_get_products( array( 'status' => 'publish', 'visibility' => 'visible', 'category' => array( $slug ), 'limit' => 3, 'orderby' => 'date', 'order' => 'DESC' ) );
            foreach ( $products as $product ) {
                $src = wp_get_attachment_image_url( $product->get_image_id(), 'thumbnail' );
                if ( $src ) { $map[ $slug ] = esc_url_raw( $src ); break; }
            }
        }
        set_transient( 'ml_hero_product_icons_v1', $map, DAY_IN_SECONDS );
        do_action( 'litespeed_purge_url', home_url( '/' ) );
    }
    ?>
<style id="ml-hero-product-icons">
@media(min-width:850px){
.home .ml-hero-menu-column{flex:0 0 290px!important;max-width:290px!important}
.home .ml-hero-banner-column{flex:1 1 0!important;max-width:calc(100% - 290px)!important;min-width:0}
.home nav.qvg-ux-menu .qvg-ux-menu-title{font-size:14px!important;min-height:40px!important}
.home nav.qvg-ux-menu p a.ml-has-product-icon{position:relative;padding:3px 8px 3px 50px!important;min-height:44px!important;font-size:14px!important;font-weight:600!important;line-height:1.2!important;white-space:nowrap!important;overflow:hidden;text-overflow:ellipsis}
@media(min-width:1200px){.home .ml-hero-menu-column{flex-basis:310px!important;max-width:310px!important}.home .ml-hero-banner-column{max-width:calc(100% - 310px)!important}.home nav.qvg-ux-menu p a.ml-has-product-icon{font-size:15px!important}}
.home nav.qvg-ux-menu p a.ml-has-product-icon::before,
.home nav.qvg-ux-menu p a.ml-has-product-icon::after{display:none!important}
.home nav.qvg-ux-menu .ml-category-product-icon{position:absolute;left:5px;top:50%;transform:translateY(-50%);width:38px;height:38px;max-width:38px;object-fit:contain;border-radius:6px;background:#fff;margin:0}
}
@media(max-width:849px){.ml-category-product-icon{display:none!important}}
</style>
<script id="ml-hero-product-icons-js">
(function(){
'use strict';
const images = <?php echo wp_json_encode( $map, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ); ?>;
function init(){
if(!window.matchMedia('(min-width:850px)').matches)return;
document.querySelectorAll('.home nav.qvg-ux-menu').forEach(function(menu){
const col=menu.closest('.col');
if(col&&col.nextElementSibling?.classList.contains('col')){col.classList.add('ml-hero-menu-column');col.nextElementSibling.classList.add('ml-hero-banner-column');}
});
document.querySelectorAll('.home nav.qvg-ux-menu p a').forEach(function(link){
if(link.querySelector('.ml-category-product-icon'))return;
const path=new URL(link.href,location.href).pathname.split('/').filter(Boolean);
const src=images[path[path.length-1]];
if(!src)return;
const img=new Image(38,38);
img.className='ml-category-product-icon';img.alt='';img.setAttribute('aria-hidden','true');img.decoding='async';
img.onload=function(){link.classList.add('ml-has-product-icon');};
img.onerror=function(){link.classList.remove('ml-has-product-icon');img.remove();};
link.prepend(img);img.src=src;
});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.matchMedia('(min-width:850px)').addEventListener('change',init);
})();
</script>
<?php
}, 95 );
