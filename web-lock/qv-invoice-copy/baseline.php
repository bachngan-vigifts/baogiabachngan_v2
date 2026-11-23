<?php
/**
 * Plugin Name: Store Quick View Information
 * Description: Invoice guidance and existing shipping/voucher information in product quick view.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
add_action('wp_footer', function () {
 if (is_admin() || !in_array(strtolower((string)wp_parse_url(home_url('/'), PHP_URL_HOST)), array('locknlockonline.com','minhlongonline.com'), true)) return;
 echo '<style id="bn-qv-info-style">';
 echo <<<'BN_INFO_CSS'
.product-lightbox .bn-qv-invoice{margin:10px 0 16px;padding:10px 12px;background:#f3f8ff;border:1px solid #d9e7f7;border-radius:8px;color:#334155;font-size:13px;line-height:1.5}.product-lightbox .bn-qv-invoice strong{display:block;color:#245b88;font-size:14px;margin-bottom:3px}.product-lightbox .bn-qv-invoice p{margin:0}.product-lightbox .bn-qv-info{margin-top:12px;border:1px solid #dce5ed;border-radius:8px;color:#334155;font-size:13px;line-height:1.5;overflow-wrap:anywhere}.product-lightbox .bn-qv-info details+details{border-top:1px solid #dce5ed}.product-lightbox .bn-qv-info summary{cursor:pointer;padding:11px 12px;font-weight:600;color:#245b88}.product-lightbox .bn-qv-info summary:focus-visible{outline:2px solid #245b88;outline-offset:-3px}.product-lightbox .bn-qv-info .bn-qv-body{padding:0 12px 12px}.product-lightbox .bn-qv-info p{margin:0 0 6px}.product-lightbox .bn-qv-coupon{padding:8px 0;border-bottom:1px dashed #dce5ed}.product-lightbox .bn-qv-coupon strong{color:#b64027}.product-lightbox .bn-qv-coupon code{display:inline-block;margin-left:8px;background:#edf5fb;color:#245b88;padding:2px 6px}.product-lightbox .bn-qv-coupon ul{margin:4px 0 0 16px;font-size:12px}.product-lightbox .bn-qv-info small{display:block;margin-top:8px;line-height:1.5}
BN_INFO_CSS;
 echo '</style><script id="bn-qv-info-script">';
 echo <<<'BN_INFO_JS'
(function(){
if(window.bnQuickViewInfoReady)return;window.bnQuickViewInfoReady=true;
function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;}
function section(root,title){var d=el('details'),s=el('summary','',title),b=el('div','bn-qv-body');d.append(s,b);root.append(d);return b;}
function fill(p){
 var price=p.querySelector('.product-info .price-wrapper'),meta=p.querySelector('.product-info .product_meta');
 if(price&&!p.querySelector('.bn-qv-invoice')){
  var note=el('aside','bn-qv-invoice');note.setAttribute('aria-label','Hướng dẫn xuất hóa đơn công ty');
  note.append(el('strong','','Có hỗ trợ xuất hóa đơn công ty'),el('p','','Chọn Mua ngay hoặc vào Giỏ hàng, rồi chọn “Tôi muốn xuất hóa đơn Công ty” để nhập thông tin.'));
  price.after(note);
 }
 if(!meta||p.querySelector('.bn-qv-info'))return;
 var info=el('section','bn-qv-info');info.setAttribute('aria-label','Vận chuyển và voucher');
 var ship=section(info,'Chính sách vận chuyển'),tip=document.getElementById('lnl-ship-tip'),para=tip&&tip.querySelector('p');
 ship.append(el('p','',para?para.textContent:'Chọn địa chỉ tại Thanh toán để xem phí vận chuyển áp dụng cho đơn hàng.'));
 var link=tip&&tip.querySelector('a[href]');
 if(!link)link=Array.from(document.querySelectorAll('a[href]')).find(function(a){return /chính sách vận chuyển/i.test(a.textContent)&&!a.closest('.product-lightbox');});
 if(link){var u=new URL(link.href,location.href);if(u.origin===location.origin){var a=el('a','','Xem chính sách vận chuyển');a.href=u.href;ship.append(a);}}
 var vouchers=section(info,'Voucher và điều kiện áp dụng'),template=document.getElementById('lnl-image-vouchers-template'),source=template&&template.content;
 var items=source?source.querySelectorAll('.lnl-image-vouchers-item'):[];
 items.forEach(function(item){var row=el('div','bn-qv-coupon'),head=el('div'),title=item.querySelector('strong'),code=item.querySelector('code'),ul=el('ul');
 if(title)head.append(el('strong','',title.textContent));if(code)head.append(el('code','',code.textContent));
 item.querySelectorAll('li').forEach(function(li){ul.append(el('li','',li.textContent));});row.append(head,ul);vouchers.append(row);});
 var foot=source&&source.querySelector('.lnl-image-vouchers-note');
 vouchers.append(el('small','',foot?foot.textContent:'Xem mã ưu đãi và điều kiện áp dụng tại Giỏ hàng hoặc Thanh toán.'));
 meta.after(info);
}
function scan(){document.querySelectorAll('.product-lightbox').forEach(fill);}
function init(){scan();if(window.jQuery)window.jQuery(document).on('mfpOpen.bnQvInfo mfpAjaxContentAdded.bnQvInfo',scan);
 new MutationObserver(function(records){if(records.some(function(r){return Array.from(r.addedNodes).some(function(n){return n.nodeType===1&&(n.matches('.product-lightbox')||n.querySelector('.product-lightbox'));});}))scan();}).observe(document.body,{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
BN_INFO_JS;
 echo '</script>';
}, 999);
