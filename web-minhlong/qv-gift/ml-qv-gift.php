<?php
/**
 * Plugin Name: Minh Long Quick View Gift Information
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
add_action('wp_footer',function(){
 if(is_admin() || strtolower((string)wp_parse_url(home_url('/'),PHP_URL_HOST))!=='minhlongonline.com')return;
 ?>
<style id="ml-qv-gift-style">.product-lightbox .bn-qv-info>.ml-qv-gift{padding:12px;margin:0;background:#fff9ed;border-bottom:1px solid #ead7ad;border-radius:8px 8px 0 0;color:#5b461e;font-size:13px;line-height:1.55}.product-lightbox .ml-qv-gift>strong{display:block;color:#985e16;font-size:14px;margin-bottom:5px}.product-lightbox .ml-qv-gift>p{margin:0}.product-lightbox .ml-qv-gift a{display:inline-block;margin-top:5px}</style>
<script id="ml-qv-gift-script" data-no-optimize="1">(function(){
if(window.mlQvGiftReady)return;window.mlQvGiftReady=true;
const requests=new Map();
function source(url){
 if(!requests.has(url))requests.set(url,(async()=>{
 const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('promotion unavailable');
 const doc=new DOMParser().parseFromString(await response.text(),'text/html');
 const summary=doc.querySelector('.product-info.summary');
 if(!summary)return null;
 const label=Array.from(summary.querySelectorAll('span')).find(e=>/BLACK FRIDAY/i.test(e.textContent)&&e.textContent.length<80);
 if(!label)return null;
 const card=label.parentElement.parentElement;
 const text=card.textContent.replace(/\s+/g,' ').trim();
 if(!/Tặng.*Gourmet/i.test(text)||text.length>600)return null;
 const date=text.match(/Đến\s+(\d{2})\/(\d{2})\/(\d{4})/);
 if(date&&Date.now()>Date.parse(date[3]+'-'+date[2]+'-'+date[1]+'T23:59:59+07:00'))return null;
 return text;
 })().catch(()=>{requests.delete(url);return null;}));
 return requests.get(url);
}
function fill(p){
 const info=p.querySelector('.bn-qv-info');if(!info||info.querySelector('.ml-qv-gift'))return;
 const link=p.querySelector('a.plain[href*="/san-pham/"],.product-title a[href],a[href*="/san-pham/"]');
 const id=p.querySelector('[name="product_id"],[name="add-to-cart"]')?.value;
 let href=link?.href;
 if(!href&&id&&/^\d+$/.test(id)){
 const trigger=document.querySelector('a.quick-view[data-prod="'+id+'"]');
 href=trigger?.closest('.product-small')?.querySelector('.name a[href],.box-image a[href*="/san-pham/"]')?.href;
 }
 if(!href)return;
 const url=new URL(href,location.href);if(url.origin!==location.origin)return;
 const gift=document.createElement('aside');gift.className='ml-qv-gift';gift.setAttribute('aria-label','Quà tặng');
 const title=document.createElement('strong');title.textContent='🎁 Quà tặng';
 const body=document.createElement('p');body.textContent='Đang kiểm tra ưu đãi quà tặng…';gift.append(title,body);info.prepend(gift);
 source(url.href).then(text=>{
 if(!gift.isConnected)return;
 if(text){body.textContent=text.replace(/^🎁\s*BLACK FRIDAY\s*/i,'');}
 else{body.textContent='Xem chương trình quà tặng đang áp dụng tại trang sản phẩm.';const a=document.createElement('a');a.href=url.href;a.textContent='Xem chi tiết';gift.append(a);}
 });
}
function scan(){document.querySelectorAll('.product-lightbox').forEach(fill);}
function init(){
 scan();if(window.jQuery)window.jQuery(document).on('mfpOpen.mlQvGift mfpAjaxContentAdded.mlQvGift',scan);
 new MutationObserver(ms=>{if(ms.some(m=>Array.from(m.addedNodes).some(n=>n.nodeType===1&&(n.matches('.product-lightbox,.bn-qv-info')||n.querySelector('.product-lightbox,.bn-qv-info')))))scan();}).observe(document.body,{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();</script>
 <?php
},1005);
