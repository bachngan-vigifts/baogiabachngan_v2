import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verify} from './verify.mjs';
const host='minhlongonline.com',origin='https://'+host;
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
if(!user||!token||!raw)throw Error('Missing hosting configuration');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const form=p instanceof FormData,u=new URL('/execute/'+mod+'/'+fn,base);if(!form)for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{method:form?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:form?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed '+mod+'/'+fn);return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});let root;
function visit(x){if(!x||typeof x!=='object')return;if(x.domain===host&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);
if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Minh Long root not verified');
const dir=root+'/wp-content/mu-plugins',name='ml-variation-buttons.php',helper='ml-choices-cache.php';
const code=readFileSync('web-minhlong/variations/'+name,'utf8');
const disabled="<?php\ndefined('ABSPATH') || exit;\n// Disabled after variation verification failure.\n";
const helperDisabled="<?php\ndefined('ABSPATH') || exit;\n// Temporary cache helper disabled.\n";
const files=await api('Fileman','list_files',{dir});
async function read(file){return(await api('Fileman','get_file_content',{dir,file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0})).content;}
async function put(file,content){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),file);await api('Fileman','upload_files',f);if(await read(file)!==content)throw Error('Readback mismatch '+file);}
const previous=files.some(f=>f.file===name)?await read(name):null;
const expectedPrevious="<?php\n/**\n * Plugin Name: Minh Long variation choice buttons\n * Description: Accessible size and color buttons backed by WooCommerce variation selects.\n * Version: 1.0.0\n */\ndefined('ABSPATH') || exit;\nfunction ml_choices_store() {\n    return in_array(strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST)), array('minhlongonline.com', 'www.minhlongonline.com'), true);\n}\nadd_action('wp_enqueue_scripts', function () {\n    if (!ml_choices_store() || !class_exists('WooCommerce')) return;\n    // Also loaded on listing pages: Flatsome quick view inserts forms after page load.\n    wp_enqueue_script('wc-add-to-cart-variation');\n    wp_add_inline_script('wc-add-to-cart-variation', <<<'ML_CHOICES_JS'\n(function($){\n'use strict';\nif(window.mlVariationButtonsLoaded)return;\nwindow.mlVariationButtonsLoaded=true;\nconst records=new WeakMap();\nconst selector='form.variations_form .variations select';\nfunction sync(select){\n const state=records.get(select);if(!state)return;\n const options=new Map(Array.from(select.options).filter(o=>o.value).map(o=>[o.value,o]));\n options.forEach((option,value)=>{\n  if(state.buttons.has(value))return;\n  const button=document.createElement('button');\n  button.type='button';button.className='ml-variation-choice';button.textContent=option.textContent.trim();\n  button.addEventListener('click',function(){\n   const current=Array.from(select.options).find(o=>o.value===value);\n   if(select.disabled||!current||current.disabled||select.value===value)return;\n   select.value=value;\n   $(select).trigger('change');\n   syncForm(select.closest('form.variations_form'));\n  });\n  state.buttons.set(value,button);state.group.append(button);\n });\n state.buttons.forEach((button,value)=>{\n  const option=options.get(value),disabled=select.disabled||!option||option.disabled;\n  button.disabled=disabled;\n  const pressed=select.value===value?'true':'false';\n  if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);\n  if(option&&button.textContent!==option.textContent.trim())button.textContent=option.textContent.trim();\n });\n}\nfunction enhance(select){\n if(records.has(select)){sync(select);return;}\n if(select.multiple||!select.name.startsWith('attribute_'))return;\n const cell=select.closest('td.value')||select.parentElement;\n if(cell.querySelector('.ux-swatches,.variable-items-wrapper'))return;\n if(!Array.from(select.options).some(o=>o.value))return;\n const group=document.createElement('div');\n group.className='ml-variation-choices';group.setAttribute('role','group');\n const row=select.closest('tr'),label=row&&row.querySelector('label');\n group.setAttribute('aria-label',label?label.textContent.trim():'Chọn tùy chọn sản phẩm');\n records.set(select,{group,buttons:new Map()});\n select.after(group);sync(select);\n select.classList.add('ml-variation-native');\n select.setAttribute('tabindex','-1');select.setAttribute('aria-hidden','true');\n select.addEventListener('focus',function(){\n  const state=records.get(select);\n  const target=Array.from(state.buttons.values()).find(b=>!b.disabled&&b.getAttribute('aria-pressed')==='true')||\n   Array.from(state.buttons.values()).find(b=>!b.disabled);\n  if(target)target.focus();\n });\n}\nfunction scan(root){\n if(root.nodeType!==1&&root.nodeType!==9)return;\n if(root.matches&&root.matches(selector))enhance(root);\n root.querySelectorAll(selector).forEach(enhance);\n}\nfunction syncForm(form){if(form)form.querySelectorAll('.variations select').forEach(enhance);}\n$(document).on('wc_variation_form.mlChoices woocommerce_update_variation_values.mlChoices reset_data.mlChoices found_variation.mlChoices','form.variations_form',function(){syncForm(this);});\n$(document).on('change.mlChoices',selector,function(){syncForm(this.closest('form.variations_form'));});\n$(function(){\n scan(document);\n new MutationObserver(function(mutations){\n  const roots=new Set(),selects=new Set();\n  mutations.forEach(m=>{\n   const target=m.target.nodeType===1?m.target:m.target.parentElement;\n   const select=target&&(target.matches(selector)?target:target.closest(selector));\n   if(select)selects.add(select);\n   m.addedNodes.forEach(n=>{if(n.nodeType===1&&!n.closest('.ml-variation-choices'))roots.add(n);});\n  });\n  roots.forEach(scan);selects.forEach(enhance);\n }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});\n});\n})(jQuery);\nML_CHOICES_JS\n    , 'after');\n}, 30);\nadd_action('wp_head', function () {\n    if (!ml_choices_store() || !class_exists('WooCommerce')) return;\n    ?>\n<style id=\"ml-variation-choices-style\">\nform.variations_form .variations select.ml-variation-native{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important}\nform.variations_form .ml-variation-choices{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px;max-width:100%}\nform.variations_form .ml-variation-choices .ml-variation-choice{display:inline-flex;align-items:center;justify-content:center;min-width:60px;min-height:42px;height:auto;margin:0;padding:8px 13px;border:1px solid #cbd7e4;border-radius:7px;background:#fff;color:#173e66;font-family:inherit;font-size:14px;font-weight:600;line-height:1.3;letter-spacing:0;text-transform:none;box-shadow:none;white-space:normal;overflow-wrap:anywhere;max-width:100%;cursor:pointer}\nform.variations_form .ml-variation-choice[aria-pressed=\"true\"]{background:#173e66;color:#fff;border-color:#173e66}\nform.variations_form .ml-variation-choice:focus-visible{outline:2px solid #b78024;outline-offset:3px}\nform.variations_form .ml-variation-choice:disabled{opacity:.45;cursor:not-allowed;text-decoration:line-through}\n@media(max-width:549px){form.variations_form .ml-variation-choices .ml-variation-choice{min-height:44px}}\n</style>\n<?php\n});\n";
if(previous&&previous!==code&&previous!==disabled&&previous!==expectedPrevious)throw Error('Unrecognized existing plugin; no overwrite');
const oldHelper=files.some(f=>f.file===helper)?await read(helper):helperDisabled;
if(oldHelper!==helperDisabled)throw Error('Cache helper already in use');
const probe=createHash('sha256').update(token+':ml-choices-v1').digest('hex');
async function purge(){
 try{
  await put(helper,readFileSync('web-minhlong/variations/cache.php','utf8').replace('__PROBE__',probe));
  for(let attempt=0;attempt<4;attempt++){
   await new Promise(r=>setTimeout(r,2500));
   const r=await fetch(origin+'/wp-json/ml-choices-cache/v1/refresh?verify='+Date.now(),{method:'POST',headers:{'X-LNL-Shipping':probe},signal:AbortSignal.timeout(60000)}),j=await r.json();
   console.log('CACHE',JSON.stringify({status:r.status,found:j.found,purged:j.purged}));
   if(r.ok&&j.found&&j.purged)return;
   if(r.status!==404)throw Error('Minh Long cache refresh failed');
  }
  throw Error('Cache helper not ready');
 }finally{await put(helper,oldHelper);}
}
await mkdir('ml-choices-evidence',{recursive:true});
await writeFile('ml-choices-evidence/rollback.json',JSON.stringify({name,previous}));
let installed=false;
try{
 installed=true;await put(name,code);console.log('MINHLONG_EXACT_READBACK_OK');
 await purge();
 const r=await fetch(origin+'/',{signal:AbortSignal.timeout(60000)}),html=await r.text();
 if(!r.ok||!html.includes('ml-variation-choices-style')||!html.includes('mlVariationButtonsLoaded'))throw Error('Normal homepage cache still missing deployment');
 await verify(false);
 console.log('MINHLONG_VARIATIONS_DEPLOYED');
}catch(e){
 console.log('DEPLOY_FAILED',e.message);
 if(installed){await put(name,previous||disabled);console.log('PLUGIN_ROLLED_BACK');try{await purge();}catch{console.log('ROLLBACK_CACHE_UNCONFIRMED');}}
 throw e;
}
