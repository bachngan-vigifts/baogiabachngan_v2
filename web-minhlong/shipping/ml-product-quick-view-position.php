<?php
/**
 * Plugin Name: Minh Long Centered Product Quick View
 * Version: 1.2.0
 */
defined('ABSPATH')||exit;
add_action('wp_head',function(){

?>
<style id="ml-centered-quick-view">
@media(min-width:850px){
body .product-small .box-image > .image-tools.grid-tools:has(>a.quick-view){
top:50%!important;bottom:auto!important;left:0!important;right:0!important;
transform:translateY(-50%)!important;z-index:12!important;text-align:center!important;display:flex!important;align-items:center!important;justify-content:center!important;width:100%!important;
}
body .product-small .box-image .image-tools.grid-tools > a.quick-view{
display:inline-flex!important;align-items:center;justify-content:center;
width:auto!important;min-height:36px;padding:8px 18px!important;margin:0!important;
background:#123b6e!important;color:#fff!important;border:1px solid #fff!important;border-radius:20px!important;
font-size:13px!important;font-weight:700!important;line-height:1.2!important;
box-shadow:0 3px 12px #123b6e40!important;
}
}

.single-product .product-main .ml-review-wishlist-row{display:flex!important;align-items:center!important;gap:8px!important;width:100%;margin:10px 0}
.single-product .product-main .ml-review-wishlist-row .woocommerce-product-rating{margin:0!important;min-width:0;flex:1 1 auto;gap:4px!important}
.single-product .product-main .ml-review-wishlist-row .woocommerce-product-rating::after{font-size:12px!important}
.single-product .product-main .ml-review-wishlist-row>button.woosw-btn{position:static!important;transform:none!important;display:inline-flex!important;align-items:center;justify-content:center;gap:5px!important;flex:0 0 auto!important;width:auto!important;min-width:0!important;height:30px!important;min-height:30px!important;margin:0!important;padding:4px 6px!important;border:0!important;border-radius:6px!important;box-shadow:none!important;background:transparent!important;color:#163f68!important;font-size:12px!important;font-weight:600!important;line-height:1.2!important;text-transform:none!important;white-space:nowrap!important}
.ml-review-wishlist-row .woosw-btn-icon{font-size:15px!important}
.mfp-content .product form.cart:not(.variations_form),.mfp-content .product .woocommerce-variation-add-to-cart{display:flex!important;flex-wrap:wrap;align-items:center;gap:10px}
.mfp-content .product form.cart .single_add_to_cart_button.ml-popup-cart-icon{display:inline-flex!important;align-items:center;justify-content:center;width:46px!important;min-width:46px!important;max-width:46px!important;min-height:44px!important;padding:10px!important;margin:0!important;font-size:0!important}
.ml-popup-cart-icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8}
.mfp-content .product form.cart .ml-popup-buy-now{flex:1 1 120px;width:auto!important;min-width:120px;min-height:44px;margin:0!important;padding:10px 16px!important;white-space:nowrap;background:#163f68;color:#fff;border-radius:5px;font-size:14px;line-height:1.2}
.ml-popup-validation{flex-basis:100%;margin:0;color:#b3261e;font-size:13px}
.woosw-popup .woosw-popup-content{width:760px!important;max-width:calc(100vw - 24px)!important;box-sizing:border-box}
.woosw-popup .woosw-items .woosw-item .woosw-item-inner{display:grid!important;grid-template-columns:18px 76px minmax(0,1fr) 160px;gap:12px;align-items:center}
.woosw-popup .woosw-items .woosw-item .woosw-item-inner>div{width:auto!important;min-width:0!important;margin:0!important}
.woosw-popup .woosw-item--image img{width:76px!important;max-width:100%;height:76px!important;object-fit:contain}
.woosw-popup .woosw-item--info{font-size:14px;line-height:1.45}
.woosw-popup .woosw-item--name{white-space:normal;overflow-wrap:anywhere}
.woosw-popup .woosw-item--atc,.woosw-popup .woosw-item--atc p{display:flex!important;align-items:center!important;justify-content:flex-end;gap:8px;flex-wrap:nowrap!important;margin:0!important;padding:0!important}
.woosw-popup .woosw-item--atc .button{display:inline-flex!important;align-items:center;justify-content:center;flex:0 0 auto;width:auto!important;min-width:40px;min-height:40px;height:auto!important;margin:0!important;padding:8px 12px!important;white-space:nowrap!important;word-break:normal!important;line-height:1.2!important}
@media(max-width:600px){
.woosw-popup .woosw-items .woosw-item .woosw-item-inner{grid-template-columns:18px 62px minmax(0,1fr);gap:10px}
.woosw-popup .woosw-item--atc{grid-column:2/-1;justify-content:flex-start!important}
.woosw-popup .woosw-item--image img{width:62px!important;height:62px!important}
.woosw-popup .woosw-popup-content-bot{display:flex!important;flex-wrap:wrap;gap:12px;font-size:12px}
}
.single-product .product-main .ml-sku-category-row{display:flex!important;align-items:center;gap:10px;flex-wrap:nowrap!important;width:100%;min-width:0;border-bottom:1px solid #edf0f4;padding:7px 0}
.single-product .product-main .product_meta .ml-sku-category-row>span{display:inline-block!important;width:auto!important;flex:0 0 auto!important;white-space:nowrap!important;padding:0!important;margin:0!important;border:0!important;font-size:inherit!important;line-height:1.3!important}
.single-product .product-main .product_meta .ml-sku-category-row a{font-size:inherit!important;white-space:nowrap!important}
.woosw-popup .woosw-item--atc,.woosw-popup .woosw-item--atc p,.woosw-popup .woosw-item--atc>div{display:flex!important;flex-direction:row!important;align-items:center!important;gap:8px!important;flex-wrap:nowrap!important}
.woosw-popup .woosw-item--atc .button{border-radius:6px!important}
</style>
<?php
},99);
add_action('init',function(){
 if(get_option('ml_quick_view_position_version')==='3')return;
 do_action('litespeed_purge_all');
 do_action('litespeed_purge_url',home_url('/danh-muc/minh-long/bo-do-an-minh-long/'));
 update_option('ml_quick_view_position_version','3',false);
});

add_filter('woocommerce_add_to_cart_redirect',function($url){
 if(isset($_POST['ml_popup_buy_now']) && '1'===sanitize_text_field(wp_unslash($_POST['ml_popup_buy_now'])))return wc_get_checkout_url();
 return $url;
},99);
add_action('wp_footer',function(){
 if(!function_exists('wc_get_checkout_url'))return;
?>
<script id="ml-product-popup-polish">
(function(){
'use strict';
const checkout=<?php echo wp_json_encode(wc_get_checkout_url()); ?>;
function enhance(){
document.querySelectorAll('.single-product .product-main .product-info.summary').forEach(function(summary){
const meta=summary.querySelector('.product_meta'),sku=meta?.querySelector('.sku_wrapper'),category=Array.from(meta?.querySelectorAll('.posted_in')||[]).find(e=>e.querySelector('a[href*="/danh-muc/"]'));
if(sku&&category){
let line=meta.querySelector('.ml-sku-category-row');
if(!line){line=document.createElement('div');line.className='ml-sku-category-row';sku.before(line);line.append(sku,category);
const fit=()=>{let size=13;line.style.fontSize=size+'px';while(line.scrollWidth>line.clientWidth+1&&size>6){size-=.25;line.style.fontSize=size+'px';}};
new ResizeObserver(fit).observe(line);fit();
}
}
const button=summary.querySelector('button.woosw-btn');if(!button)return;
let row=summary.querySelector('.ml-review-wishlist-row');
if(!row){row=document.createElement('div');row.className='ml-review-wishlist-row';const rating=summary.querySelector('.woocommerce-product-rating');if(rating){rating.before(row);row.append(rating);}else{const title=summary.querySelector('.product-title');if(title)title.after(row);else summary.prepend(row);}}
if(button.parentElement!==row)row.append(button);
const text=button.querySelector('.woosw-btn-text');if(text&&text.textContent!=='Yêu thích')text.textContent='Yêu thích';
button.title=button.classList.contains('woosw-added')?'Mở danh sách yêu thích':'Thêm vào yêu thích';
});
document.querySelectorAll('.mfp-content .product form.cart').forEach(function(form){
const add=form.querySelector('.single_add_to_cart_button');if(!add||form.querySelector('.ml-popup-buy-now'))return;
add.classList.add('ml-popup-cart-icon');add.setAttribute('aria-label','Thêm vào giỏ hàng');add.title='Thêm vào giỏ hàng';
add.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 3h3l3 13h11l3-10H6M9 21h.01M18 21h.01" stroke-linecap="round" stroke-linejoin="round"/></svg>';
form.querySelectorAll('#buy_now_button,.ux-buy-now-button').forEach(e=>e.remove());
const buy=document.createElement('button');buy.type='button';buy.className='button ml-popup-buy-now';buy.textContent='MUA NGAY';add.after(buy);
buy.addEventListener('click',function(){
const variation=form.querySelector('[name="variation_id"]');
if((variation&&!Number(variation.value))||add.disabled||add.classList.contains('disabled')){
let msg=form.querySelector('.ml-popup-validation');if(!msg){msg=document.createElement('p');msg.className='ml-popup-validation';msg.setAttribute('role','alert');buy.after(msg);}msg.textContent='Vui lòng chọn đầy đủ tùy chọn sản phẩm trước khi mua.';return;
}
if(!form.reportValidity())return;
const id=form.querySelector('[name="add-to-cart"]')?.value||add.value||form.querySelector('[name="product_id"]')?.value;
if(!/^\d+$/.test(id||''))return;
function hidden(name,value){let e=form.querySelector('input[name="'+name+'"]');if(!e){e=document.createElement('input');e.type='hidden';e.name=name;form.append(e);}e.value=value;}
hidden('add-to-cart',id);hidden('ml_popup_buy_now','1');
form.method='post';form.action=checkout;buy.disabled=true;buy.textContent='ĐANG CHUYỂN…';HTMLFormElement.prototype.submit.call(form);
});
});
}
let pending=false;function schedule(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;enhance();});}
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});schedule();
})();
</script>
<?php
},100);
