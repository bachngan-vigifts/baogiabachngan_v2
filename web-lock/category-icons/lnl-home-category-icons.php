<?php
/**
 * Plugin Name: LNL Homepage Category Product Icons
 * Description: Small product thumbnails for the desktop hero category menu.
 * Version: 1.0.0
 */
defined( 'ABSPATH' ) || exit;
add_action( 'wp_footer', function () {
    if ( ! is_front_page() || ! function_exists( 'wc_get_products' ) ) { return; }
    $slugs = array( 'binh-giu-nhiet', 'hop-com-giu-nhiet', 'hop-thuy-tinh', 'thiet-bi-gia-dung', 'thiet-bi-nha-bep', 'lam-dep-suc-khoe', 'do-dung-sinh-hoat', 'noi-chao', 'bep-dien-tu-bep-hong-ngoai' );
    $map = get_transient( 'lnl_hero_product_icons_v1' );
    if ( false === $map ) {
        $map = array();
        foreach ( $slugs as $slug ) {
            $products = wc_get_products( array( 'status' => 'publish', 'visibility' => 'visible', 'category' => array( $slug ), 'limit' => 3, 'orderby' => 'date', 'order' => 'DESC' ) );
            foreach ( $products as $product ) {
                $src = wp_get_attachment_image_url( $product->get_image_id(), 'thumbnail' );
                if ( $src ) { $map[ $slug ] = esc_url_raw( $src ); break; }
            }
        }
        set_transient( 'lnl_hero_product_icons_v1', $map, DAY_IN_SECONDS );
        do_action( 'litespeed_purge_url', home_url( '/' ) );
    }
    ?>
<style id="lnl-hero-product-icons">
@media(min-width:850px){
.home .MenuInBanner .ux-menu-link__link.lnl-has-product-icon{position:relative;padding-left:35px!important;min-height:30px}
.home .MenuInBanner .ux-menu-link__link.lnl-has-product-icon::before,
.home .MenuInBanner .ux-menu-link__link.lnl-has-product-icon::after{display:none!important}
.home .MenuInBanner .lnl-category-product-icon{position:absolute;left:5px;top:50%;transform:translateY(-50%);width:25px;height:25px;max-width:25px;object-fit:contain;border-radius:6px;background:#fff;margin:0}
}
@media(max-width:849px){.lnl-category-product-icon{display:none!important}}
</style>
<script id="lnl-hero-product-icons-js">
(function(){
'use strict';
const images = <?php echo wp_json_encode( $map, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ); ?>;
function init(){
if(!window.matchMedia('(min-width:850px)').matches)return;
document.querySelectorAll('.home .MenuInBanner .ux-menu-link__link').forEach(function(link){
if(link.querySelector('.lnl-category-product-icon'))return;
const path=new URL(link.href,location.href).pathname.split('/').filter(Boolean);
const src=images[path[path.length-1]];
if(!src)return;
const img=new Image(25,25);
img.className='lnl-category-product-icon';img.alt='';img.setAttribute('aria-hidden','true');img.decoding='async';
img.onload=function(){link.classList.add('lnl-has-product-icon');};
img.onerror=function(){link.classList.remove('lnl-has-product-icon');img.remove();};
link.prepend(img);img.src=src;
});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.matchMedia('(min-width:850px)').addEventListener('change',init);
})();
</script>
<?php
}, 95 );
