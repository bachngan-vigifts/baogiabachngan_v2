<?php
/**
 * Plugin Name: Lock native quick view
 * Description: Enable Flatsome quick view with centered buttons and existing Lock cart/checkout handlers.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
function lnl_qv_host() {
 return in_array(strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST)), array('locknlockonline.com','www.locknlockonline.com'), true);
}
add_filter('theme_mod_disable_quick_view', function($value) { return lnl_qv_host() ? false : $value; }, 999);
add_action('wp_head', function() {
 if (!lnl_qv_host() || is_admin()) return;
 echo '<style id="lnl-native-quick-view">';
 echo <<<'LNL_QV_CSS'

.product-small .box-image>.image-tools.grid-tools:has(>a.quick-view){display:block!important;inset:50% 0 auto!important;transform:translateY(-50%)!important;opacity:1!important;visibility:visible!important;pointer-events:none!important;z-index:8!important;text-align:center!important}
.product-small .box-image>.image-tools.grid-tools>a.quick-view{display:inline-flex!important;align-items:center;justify-content:center;position:relative!important;inset:auto!important;transform:none!important;float:none!important;width:auto!important;max-width:90%;margin:0 auto!important;padding:9px 16px!important;min-height:40px;line-height:1.2!important;border-radius:24px;background:#1460bc!important;color:#fff!important;font-size:13px;font-weight:700;pointer-events:auto!important;opacity:0;transition:opacity .15s}
.product-small .box-image:hover>.image-tools.grid-tools>a.quick-view,.product-small .box-image:focus-within>.image-tools.grid-tools>a.quick-view{opacity:1}
@media(hover:none),(max-width:849px){.product-small .box-image>.image-tools.grid-tools>a.quick-view{opacity:1;padding:7px 12px!important;font-size:12px;min-height:36px}}
.product-lightbox{max-width:960px!important;border-radius:14px;overflow:hidden}
.product-lightbox .product-lightbox-inner{padding:24px!important}
.product-lightbox .single_add_to_cart_button{width:46px!important;min-width:46px!important;height:44px!important;padding:0!important;font-size:0!important;border-radius:7px!important;background:#1765c1!important;color:transparent!important;vertical-align:middle}
.product-lightbox .single_add_to_cart_button:after{content:'';display:inline-block;width:22px;height:22px;vertical-align:middle;background:center/contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'%3E%3Cpath d='M2 3h3l3 13h11l3-10H6'/%3E%3Ccircle cx='9' cy='20' r='1'/%3E%3Ccircle cx='18' cy='20' r='1'/%3E%3C/svg%3E")}
.product-lightbox .lnl-qv-buy{min-height:44px;margin-left:8px!important;border-radius:7px!important;background:#1460bc!important;color:#fff!important;font-size:14px;padding:0 24px!important}
.product-lightbox .lnl-qv-buy:disabled{opacity:.45;cursor:not-allowed}
.product-lightbox .lnl-qv-status{flex-basis:100%;margin:10px 0;font-size:13px;color:#147839;line-height:1.5}
.product-lightbox .lnl-qv-error{color:#aa2626}
.product-lightbox .variations select.ml-variation-native{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip-path:inset(50%)!important;padding:0!important;margin:-1px!important;border:0!important}
.product-lightbox .ml-variation-choices{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
.product-lightbox .ml-variation-choice{min-height:42px;margin:0;padding:7px 12px;border:1px solid #cbd7e4;border-radius:7px;background:#fff;color:#174778;font-size:13px;line-height:1.3;text-transform:none;letter-spacing:0;white-space:normal}
.product-lightbox .ml-variation-choice[aria-pressed="true"]{background:#1460bc;color:#fff;border-color:#1460bc}
.product-lightbox .ml-variation-choice:disabled{opacity:.4;text-decoration:line-through}
.product-lightbox button:focus-visible,.quick-view:focus-visible{outline:2px solid #e6a325;outline-offset:3px}
@media(max-width:549px){.product-lightbox .product-lightbox-inner{padding:16px!important}.product-lightbox .product-gallery{max-width:100%}.product-lightbox h1{font-size:19px!important}.product-lightbox .ml-variation-choice{min-height:44px}.product-lightbox .lnl-qv-buy{padding:0 18px!important}}

LNL_QV_CSS;
 echo '</style>';
}, 120);
add_action('wp_footer', function() {
 if (!lnl_qv_host() || is_admin() || !function_exists('wc_get_checkout_url')) return;
 $config=array('add'=>add_query_arg('wc-ajax','lnl_add_to_cart',home_url('/')),'checkout'=>wc_get_checkout_url());
 echo '<script id="lnl-native-quick-view-js">const LNL_QV='.wp_json_encode($config,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).';';
 echo <<<'LNL_QV_JS'
(function($){
'use strict';
if(window.lnlQuickViewReady)return;window.lnlQuickViewReady=true;
const busy=new WeakSet();
function prepare(root){
 root.querySelectorAll('form.cart').forEach(form=>{
  if(form.querySelector('.group_table'))return;
  const add=form.querySelector('.single_add_to_cart_button');
  if(!add)return;
  const id=form.querySelector('[name="product_id"]')?.value||add.value;
  if(!/^\d+$/.test(id||''))return;
  add.setAttribute('aria-label','Thêm vào giỏ hàng');add.setAttribute('title','Thêm vào giỏ hàng');
  let buy=form.querySelector('.lnl-qv-buy');
  if(!buy){buy=document.createElement('button');buy.type='submit';buy.name='lnl_qv_buy';buy.value=id;buy.className='button primary lnl-qv-buy';buy.textContent='Mua ngay';add.after(buy);}
  buy.disabled=add.disabled||add.classList.contains('disabled')||busy.has(form);
 });
}
function message(form,text,error){
 let n=form.querySelector('.lnl-qv-status');
 if(!n){n=document.createElement('p');n.className='lnl-qv-status';n.setAttribute('role','status');n.setAttribute('aria-live','polite');form.append(n);}
 n.textContent=text;n.classList.toggle('lnl-qv-error',!!error);
}
function sync(){document.querySelectorAll('.product-lightbox').forEach(prepare);}
$(document).on('mfpOpen.lnlQv wc_variation_form.lnlQv show_variation.lnlQv hide_variation.lnlQv woocommerce_variation_has_changed.lnlQv',()=>{sync();setTimeout(sync,0);});
new MutationObserver(ms=>{if(ms.some(m=>m.type==='attributes'?m.target.matches('.product-lightbox .single_add_to_cart_button'):Array.from(m.addedNodes).some(n=>n.nodeType===1&&(n.matches('.product-lightbox')||n.querySelector('.product-lightbox')))))sync();}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','class']});
document.addEventListener('submit',async function(e){
 const form=e.target,button=e.submitter;
 if(!form.matches?.('.product-lightbox form.cart')||form.querySelector('.group_table')||!button)return;
 if(!button.matches('.single_add_to_cart_button,.lnl-qv-buy'))return;
 e.preventDefault();e.stopImmediatePropagation();
 if(busy.has(form)||button.disabled||button.classList.contains('disabled'))return;
 const add=form.querySelector('.single_add_to_cart_button');
 const fd=new FormData(form),pid=fd.get('product_id')||add?.value;
 if(!/^\d+$/.test(String(pid||''))){message(form,'Vui lòng mở trang sản phẩm để chọn mua.',true);return;}
 if(form.classList.contains('variations_form')&&!(Number(fd.get('variation_id'))>0)){message(form,'Vui lòng chọn đầy đủ size và màu.',true);return;}
 if(!form.reportValidity())return;
 const data=new URLSearchParams();
 for(const[k,v]of fd){if(typeof v==='string'&&(k==='quantity'||k==='variation_id'||k.startsWith('attribute_')))data.append(k,v);}
 busy.add(form);button.classList.add('loading');
 if(button.matches('.lnl-qv-buy')){
  data.set('add-to-cart',String(pid));data.set('lnl_buy','1');
  const target=new URL(LNL_QV.checkout);data.forEach((v,k)=>target.searchParams.set(k,v));
  window.location.assign(target.href);return;
 }
 data.set('product_id',String(pid));
 // Do not send add-to-cart: the existing AJAX handler is the sole cart writer.
 try{
  const response=await fetch(LNL_QV.add,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:data});
  if(!response.ok)throw Error('http');
  const result=await response.json();
  if(!result.success){message(form,'Chưa thêm được sản phẩm. Vui lòng kiểm tra lựa chọn và giỏ hàng trước khi thử lại.',true);return;}
  $.each(result.fragments||{},(selector,html)=>$(selector).replaceWith(html));
  $(document.body).trigger('added_to_cart',[result.fragments,result.cart_hash,$(add)]);
  message(form,'Đã thêm vào giỏ hàng.',false);
 }catch{message(form,'Chưa xác nhận được kết quả. Vui lòng kiểm tra giỏ hàng trước khi thử lại.',true);}
 finally{busy.delete(form);button.classList.remove('loading');sync();}
},true);
sync();
})(jQuery);
(function($){
'use strict';
if(window.lnlQvChoicesLoaded)return;
window.lnlQvChoicesLoaded=true;
const records=new WeakMap();
const selector='.product-lightbox form.variations_form .variations select';
function sync(select){
 const state=records.get(select);if(!state)return;
 const options=new Map(Array.from(select.options).filter(o=>o.value).map(o=>[o.value,o]));
 options.forEach((option,value)=>{
  if(state.buttons.has(value))return;
  const button=document.createElement('button');
  button.type='button';button.className='ml-variation-choice';button.textContent=option.textContent.trim();
  button.addEventListener('click',function(){
   const current=Array.from(select.options).find(o=>o.value===value);
   if(select.disabled||!current||current.disabled||select.value===value)return;
   select.value=value;
   $(select).trigger('change');
   syncForm(select.closest('form.variations_form'));
  });
  state.buttons.set(value,button);state.group.append(button);
 });
 state.buttons.forEach((button,value)=>{
  const option=options.get(value),disabled=select.disabled||!option||option.disabled;
  button.disabled=disabled;
  const pressed=select.value===value?'true':'false';
  if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);
  if(option&&button.textContent!==option.textContent.trim())button.textContent=option.textContent.trim();
 });
}
function enhance(select){
 if(records.has(select)){sync(select);return;}
 if(select.multiple||!select.name.startsWith('attribute_'))return;
 const cell=select.closest('td.value')||select.parentElement;
 if(cell.querySelector('.ux-swatches,.variable-items-wrapper'))return;
 if(!Array.from(select.options).some(o=>o.value))return;
 const group=document.createElement('div');
 group.className='ml-variation-choices';group.setAttribute('role','group');
 const row=select.closest('tr'),label=row&&row.querySelector('label');
 group.setAttribute('aria-label',label?label.textContent.trim():'Chọn tùy chọn sản phẩm');
 records.set(select,{group,buttons:new Map()});
 select.after(group);sync(select);
 select.classList.add('ml-variation-native');
 select.setAttribute('tabindex','-1');select.setAttribute('aria-hidden','true');
 select.addEventListener('focus',function(){
  const state=records.get(select);
  const target=Array.from(state.buttons.values()).find(b=>!b.disabled&&b.getAttribute('aria-pressed')==='true')||
   Array.from(state.buttons.values()).find(b=>!b.disabled);
  if(target)target.focus();
 });
}
function scan(root){
 if(root.nodeType!==1&&root.nodeType!==9)return;
 if(root.matches&&root.matches(selector))enhance(root);
 root.querySelectorAll(selector).forEach(enhance);
}
function syncForm(form){if(form&&form.closest('.product-lightbox'))form.querySelectorAll('.variations select').forEach(enhance);}
$(document).on('wc_variation_form.mlChoices woocommerce_update_variation_values.mlChoices reset_data.mlChoices found_variation.mlChoices','form.variations_form',function(){syncForm(this);});
$(document).on('change.mlChoices',selector,function(){syncForm(this.closest('form.variations_form'));});
$(function(){
 scan(document);
 new MutationObserver(function(mutations){
  const roots=new Set(),selects=new Set();
  mutations.forEach(m=>{
   const target=m.target.nodeType===1?m.target:m.target.parentElement;
   const select=target&&(target.matches(selector)?target:target.closest(selector));
   if(select)selects.add(select);
   m.addedNodes.forEach(n=>{if(n.nodeType===1&&!n.closest('.ml-variation-choices'))roots.add(n);});
  });
  roots.forEach(scan);selects.forEach(enhance);
 }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
});
})(jQuery);
LNL_QV_JS;
 echo '</script>';
}, 120);
