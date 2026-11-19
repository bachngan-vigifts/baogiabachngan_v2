<?php
/**
 * Plugin Name: Minh Long variation choice buttons
 * Description: Accessible size and color buttons backed by WooCommerce variation selects.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
function ml_choices_store() {
    return in_array(strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST)), array('minhlongonline.com', 'www.minhlongonline.com'), true);
}
add_action('wp_enqueue_scripts', function () {
    if (!ml_choices_store() || !class_exists('WooCommerce')) return;
    // Also loaded on listing pages: Flatsome quick view inserts forms after page load.
    wp_enqueue_script('wc-add-to-cart-variation');
    wp_add_inline_script('wc-add-to-cart-variation', <<<'ML_CHOICES_JS'
(function($){
'use strict';
if(window.mlVariationButtonsLoaded)return;
window.mlVariationButtonsLoaded=true;
const records=new WeakMap();
const selector='form.variations_form .variations select';
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
function syncForm(form){if(form)form.querySelectorAll('.variations select').forEach(enhance);}
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
ML_CHOICES_JS
    , 'after');
}, 30);
add_action('wp_head', function () {
    if (!ml_choices_store() || !class_exists('WooCommerce')) return;
    ?>
<style id="ml-variation-choices-style">
form.variations_form .variations select.ml-variation-native{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important}
form.variations_form .ml-variation-choices{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px;max-width:100%}
form.variations_form .ml-variation-choices .ml-variation-choice{display:inline-flex;align-items:center;justify-content:center;min-width:60px;min-height:42px;height:auto;margin:0;padding:8px 13px;border:1px solid #cbd7e4;border-radius:7px;background:#fff;color:#173e66;font-family:inherit;font-size:14px;font-weight:600;line-height:1.3;letter-spacing:0;text-transform:none;box-shadow:none;white-space:normal;overflow-wrap:anywhere;max-width:100%;cursor:pointer}
form.variations_form .ml-variation-choice[aria-pressed="true"]{background:#173e66;color:#fff;border-color:#173e66}
form.variations_form .ml-variation-choice:focus-visible{outline:2px solid #b78024;outline-offset:3px}
form.variations_form .ml-variation-choice:disabled{opacity:.45;cursor:not-allowed;text-decoration:line-through}
@media(max-width:549px){form.variations_form .ml-variation-choices .ml-variation-choice{min-height:44px}}
</style>
<?php
});
