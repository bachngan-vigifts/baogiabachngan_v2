<?php
/**
 * Plugin Name: Store Company Invoice Guidance
 * Description: Product price card guidance for requesting a company invoice.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
add_action('wp_footer', function () {
    if (!function_exists('is_product') || !is_product()) return;
    $host = wp_parse_url(home_url(), PHP_URL_HOST);
    if (!in_array($host, array('locknlockonline.com', 'www.locknlockonline.com', 'minhlongonline.com', 'www.minhlongonline.com'), true)) return;
    ?>
    <style id="store-invoice-guidance-style">
    .product-info.summary .store-invoice-guidance{display:flex;align-items:flex-start;gap:10px;clear:both;box-sizing:border-box;width:100%;margin:12px 0 0;padding:12px;border:1px solid #d4e4f2;border-radius:9px;background:#eaf3fc;color:#173e65;text-align:left;white-space:normal;line-height:1.55}
    .product-info.summary .store-invoice-guidance svg{flex:0 0 23px;width:23px;height:27px;margin-top:2px;fill:none;stroke:currentColor;stroke-width:1.6}
    .product-info.summary .store-invoice-guidance div{min-width:0;flex:1}
    .product-info.summary .store-invoice-guidance strong{display:block;font-size:14px;font-weight:700;line-height:1.45;margin:0 0 5px;color:#173e65}
    .product-info.summary .store-invoice-guidance p{font-size:13px;font-weight:400;line-height:1.55;margin:0;color:#36536f;overflow-wrap:break-word}
    .product-info.summary .store-invoice-guidance b{font-weight:600}
    @media(max-width:549px){.product-info.summary .store-invoice-guidance{padding:12px;gap:9px}.product-info.summary .store-invoice-guidance p{font-size:13px}}
    </style>
    <script id="store-invoice-guidance-script">
    (function(){
      'use strict';
      var summary=document.querySelector('.product-main .product-info.summary');
      if(!summary)return;
      function place(){
        var card=summary.querySelector('.price-wrapper');
        if(!card||card.querySelector('.store-invoice-guidance'))return;
        var notice=document.createElement('aside');
        notice.className='store-invoice-guidance';
        notice.setAttribute('aria-label','Hướng dẫn xuất hóa đơn công ty');
        notice.innerHTML='<svg viewBox="0 0 24 28" aria-hidden="true"><path d="M5 1h10l6 6v19H3V3a2 2 0 0 1 2-2Z"/><path d="M15 1v7h6M7 13h10M7 18h10M7 23h6"/></svg><div><strong>Có hỗ trợ xuất hóa đơn công ty</strong><p>Chọn <b>Mua ngay</b> hoặc vào <b>Giỏ hàng</b>, rồi chọn “Tôi muốn xuất hóa đơn Công ty” để nhập thông tin.</p></div>';
        card.appendChild(notice);
      }
      place();
      var pending=false;
      new MutationObserver(function(){if(pending)return;pending=true;requestAnimationFrame(function(){pending=false;place();});}).observe(summary,{childList:true,subtree:true});
    })();
    </script>
    <?php
}, 99);
