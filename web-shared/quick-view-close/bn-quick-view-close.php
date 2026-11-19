<?php
/**
 * Plugin Name: Bach Ngan quick-view close button
 * Description: Keep the product quick-view close control inside the product panel.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
function bn_qv_close_allowed() {
 return in_array(strtolower((string)wp_parse_url(home_url('/'), PHP_URL_HOST)), array('locknlockonline.com','www.locknlockonline.com','minhlongonline.com','www.minhlongonline.com'), true);
}
add_action('wp_head', function() {
 if (is_admin() || !bn_qv_close_allowed()) return;
 echo '<style id="bn-qv-close-style">';
 echo <<<'BN_QV_CSS'
body .mfp-wrap .product-lightbox{position:relative!important}
body .mfp-wrap:has(.product-lightbox) .mfp-close:not(.bn-qv-close){display:none!important}
body .mfp-wrap .product-lightbox .bn-qv-close{
 position:absolute!important;top:8px!important;right:8px!important;bottom:auto!important;left:auto!important;
 display:flex!important;align-items:center!important;justify-content:center!important;
 width:44px!important;min-width:44px!important;height:44px!important;min-height:44px!important;
 padding:0!important;margin:0!important;transform:none!important;opacity:1!important;
 border:1px solid #d7dce2!important;border-radius:50%!important;background:#fff!important;color:#263446!important;
 font:normal 32px/1 Arial,sans-serif!important;text-indent:0!important;box-shadow:0 2px 8px #0002;
 cursor:pointer!important;z-index:30!important;touch-action:manipulation;
}
body .mfp-wrap .product-lightbox .bn-qv-close:before,
body .mfp-wrap .product-lightbox .bn-qv-close:after{display:none!important}
body .mfp-wrap .product-lightbox .bn-qv-close:hover{background:#f1f5f9!important}
body .mfp-wrap .product-lightbox .bn-qv-close:focus-visible{outline:3px solid #1460bc!important;outline-offset:2px}
body .mfp-wrap .product-lightbox .product-info .product-lightbox-inner{padding-top:60px!important}
BN_QV_CSS;
 echo '</style>';
}, 200);
add_action('wp_footer', function() {
 if (is_admin() || !bn_qv_close_allowed()) return;
 echo '<script id="bn-qv-close-script">';
 echo <<<'BN_QV_JS'
(function($){
 'use strict';
 if(!$||window.bnQvCloseReady)return;
 window.bnQvCloseReady=true;
 function prepare(){
  document.querySelectorAll('.mfp-wrap .product-lightbox').forEach(function(panel){
   if(panel.querySelector('.bn-qv-close'))return;
   var button=document.createElement('button');
   button.type='button';button.className='mfp-close bn-qv-close';button.textContent='×';
   button.setAttribute('aria-label','Đóng xem nhanh sản phẩm');button.title='Đóng';
   button.addEventListener('click',function(event){
    event.preventDefault();event.stopPropagation();
    if($.magnificPopup && $.magnificPopup.instance && $.magnificPopup.instance.isOpen)$.magnificPopup.close();
   });
   panel.appendChild(button);
  });
 }
 $(document).on('mfpOpen.bnQvClose mfpAjaxContentAdded.bnQvClose mfpChange.bnQvClose',prepare);
 new MutationObserver(function(records){
  if(records.some(function(r){return Array.from(r.addedNodes).some(function(n){
   return n.nodeType===1 && (n.matches('.product-lightbox,.mfp-wrap')||n.querySelector('.product-lightbox'));
  });}))prepare();
 }).observe(document.body,{childList:true,subtree:true});
 prepare();
})(window.jQuery);
BN_QV_JS;
 echo '</script>';
}, 200);
