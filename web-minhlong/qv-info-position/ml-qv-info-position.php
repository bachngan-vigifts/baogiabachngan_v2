<?php
/**
 * Plugin Name: Minh Long Quick View Information Position
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
add_action('wp_footer', function () {
 if (is_admin() || strtolower((string)wp_parse_url(home_url('/'), PHP_URL_HOST)) !== 'minhlongonline.com') return;
 echo '<style id="ml-qv-info-position-style">';
 echo <<<'BN_INFO_CSS'
.product-lightbox .product-gallery > .bn-qv-info{margin:16px 16px 20px;text-align:left}
BN_INFO_CSS;
 echo '</style><script id="ml-qv-info-position-script">';
 echo <<<'BN_INFO_JS'
(function(){
 if(window.mlQvInfoPositionReady)return;window.mlQvInfoPositionReady=true;
 function move(){document.querySelectorAll('.product-lightbox').forEach(function(p){
 var info=p.querySelector('.bn-qv-info'),gallery=p.querySelector('.product-gallery');
 if(info&&gallery&&info.parentElement!==gallery)gallery.appendChild(info);
 });}
 function init(){move();if(window.jQuery)window.jQuery(document).on('mfpOpen.mlInfoPosition mfpAjaxContentAdded.mlInfoPosition',move);
 new MutationObserver(function(records){if(records.some(function(r){return Array.from(r.addedNodes).some(function(n){return n.nodeType===1&&(n.matches('.product-lightbox,.bn-qv-info')||n.querySelector('.product-lightbox,.bn-qv-info'));});}))move();}).observe(document.body,{childList:true,subtree:true});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
BN_INFO_JS;
 echo '</script>';
}, 1000);
