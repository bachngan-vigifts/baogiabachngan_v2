import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '/tmp/ml-choices/node_modules/playwright/index.mjs';
const php=readFileSync('web-minhlong/variations/ml-variation-buttons.php','utf8');
const js=php.match(/<<<'ML_CHOICES_JS'\n([\s\S]*?)\nML_CHOICES_JS/)[1];
const deployedJs="(function($){\n'use strict';\nif(window.mlVariationButtonsLoaded)return;\nwindow.mlVariationButtonsLoaded=true;\nconst records=new WeakMap();\nconst selector='form.variations_form .variations select';\nfunction sync(select){\n const state=records.get(select);if(!state)return;\n const options=new Map(Array.from(select.options).filter(o=>o.value).map(o=>[o.value,o]));\n options.forEach((option,value)=>{\n  if(state.buttons.has(value))return;\n  const button=document.createElement('button');\n  button.type='button';button.className='ml-variation-choice';button.textContent=option.textContent.trim();\n  button.addEventListener('click',function(){\n   const current=Array.from(select.options).find(o=>o.value===value);\n   if(select.disabled||!current||current.disabled||select.value===value)return;\n   select.value=value;\n   $(select).trigger('change');\n   syncForm(select.closest('form.variations_form'));\n  });\n  state.buttons.set(value,button);state.group.append(button);\n });\n state.buttons.forEach((button,value)=>{\n  const option=options.get(value),disabled=select.disabled||!option||option.disabled;\n  button.disabled=disabled;\n  const pressed=select.value===value?'true':'false';\n  if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);\n  if(option&&button.textContent!==option.textContent.trim())button.textContent=option.textContent.trim();\n });\n}\nfunction enhance(select){\n if(records.has(select)){sync(select);return;}\n if(select.multiple||!select.name.startsWith('attribute_'))return;\n const cell=select.closest('td.value')||select.parentElement;\n if(cell.querySelector('.ux-swatches,.variable-items-wrapper'))return;\n if(!Array.from(select.options).some(o=>o.value))return;\n const group=document.createElement('div');\n group.className='ml-variation-choices';group.setAttribute('role','group');\n const row=select.closest('tr'),label=row&&row.querySelector('label');\n group.setAttribute('aria-label',label?label.textContent.trim():'Chọn tùy chọn sản phẩm');\n records.set(select,{group,buttons:new Map()});\n select.after(group);sync(select);\n select.classList.add('ml-variation-native');\n select.setAttribute('tabindex','-1');select.setAttribute('aria-hidden','true');\n select.addEventListener('focus',function(){\n  const state=records.get(select);\n  const target=Array.from(state.buttons.values()).find(b=>!b.disabled&&b.getAttribute('aria-pressed')==='true')||\n   Array.from(state.buttons.values()).find(b=>!b.disabled);\n  if(target)target.focus();\n });\n}\nfunction scan(root){\n if(root.nodeType!==1&&root.nodeType!==9)return;\n if(root.matches&&root.matches(selector))enhance(root);\n root.querySelectorAll(selector).forEach(enhance);\n}\nfunction syncForm(form){if(form)form.querySelectorAll('.variations select').forEach(enhance);}\n$(document).on('wc_variation_form.mlChoices woocommerce_update_variation_values.mlChoices reset_data.mlChoices found_variation.mlChoices','form.variations_form',function(){syncForm(this);});\n$(document).on('change.mlChoices',selector,function(){syncForm(this.closest('form.variations_form'));});\n$(function(){\n scan(document);\n new MutationObserver(function(mutations){\n  const roots=new Set(),selects=new Set();\n  mutations.forEach(m=>{\n   const target=m.target.nodeType===1?m.target:m.target.parentElement;\n   const select=target&&(target.matches(selector)?target:target.closest(selector));\n   if(select)selects.add(select);\n   m.addedNodes.forEach(n=>{if(n.nodeType===1&&!n.closest('.ml-variation-choices'))roots.add(n);});\n  });\n  roots.forEach(scan);selects.forEach(enhance);\n }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});\n});\n})(jQuery);";
const css=php.match(/<style id="ml-variation-choices-style">([\s\S]*?)<\/style>/)[1];
export async function verify(preview){
 await mkdir('ml-choices-evidence',{recursive:true});
 const browser=await chromium.launch();const results=[];
 try{
 for(const width of [1360,390]){
  const context=await browser.newContext({viewport:{width:1360,height:900},locale:'vi-VN'}),page=await context.newPage();
  page.setDefaultTimeout(30000);
  // Read-only validation: prohibit cart writes and order submission.
  await page.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.searchParams.has('add-to-cart')||u.searchParams.get('lnl_buy')==='1'||u.searchParams.has('wc-ajax')&&/add_to_cart|checkout/.test(u.searchParams.get('wc-ajax')))return r.abort();if(preview&&q.resourceType()==='document'){const response=await r.fetch();let body=await response.text();assert(body.includes(deployedJs),'expected deployed script');body=body.replace(deployedJs,js).replace(/<style id="ml-variation-choices-style">[\s\S]*?<\/style>/,'<style id="ml-variation-choices-style">'+css+'</style>');return r.fulfill({response,body});}return r.continue();});
  await page.goto('https://minhlongonline.com/',{waitUntil:'commit',timeout:60000});
  await page.locator('.product-small.box a.quick-view').first().waitFor({state:'attached'});
  await page.mouse.move(100,100);
  await page.waitForFunction(()=>window.jQuery&&window.Flatsome);
  await page.addLocatorHandler(page.locator('#mltv-popup.mltv-popup--show'),async()=>{await page.locator('#mltv-popup .mltv-popup__close').evaluate(b=>b.click());});
  const card=page.locator('.product-small.box').filter({has:page.locator('a.product_type_variable')}).first();
  const href=await card.locator('.box-text a.woocommerce-LoopProduct-link,.box-image>a').first().getAttribute('href');
  assert(href,'variable product URL');
  for(const kind of ['popup','product']){
   if(kind==='popup'){
    await card.scrollIntoViewIfNeeded();await card.hover();await card.locator('a.quick-view').click();
    await page.locator('.product-lightbox form.variations_form').waitFor({state:'visible'});
    await page.setViewportSize({width,height:900});
   }else{
    await page.goto('https://minhlongonline.com/san-pham/noi-duong-sinh-ceres-kim-sa-thap-healthycook/',{waitUntil:'commit',timeout:60000});
    await page.locator('.product-main form.variations_form').waitFor({state:'visible'});
    await page.waitForFunction(()=>window.jQuery&&typeof jQuery.fn.wc_variation_form==='function');
   }
   const form=page.locator(kind==='popup'?'.product-lightbox form.variations_form':'.product-main form.variations_form').first();
   const scope=page.locator(kind==='popup'?'.product-lightbox':'.product-main');
   if(preview){
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:js});
   }else await page.waitForFunction(()=>window.mlVariationButtonsLoaded===true);
   const groups=form.locator('.ml-variation-choices');await groups.first().waitFor({state:'visible'});
   const selects=form.locator('.variations select');
   const geometry=await form.locator('tr.ml-variation-row').evaluateAll(rows=>rows.map(row=>{
    const label=row.querySelector('label').getBoundingClientRect(),button=row.querySelector('.ml-variation-choice').getBoundingClientRect(),cell=row.querySelector('td.value').getBoundingClientRect(),group=row.querySelector('.ml-variation-choices').getBoundingClientRect();
    return {centerDelta:Math.abs((label.top+label.height/2)-(button.top+button.height/2)),bottomGap:cell.bottom-group.bottom};
   }));
   assert(geometry.length,'enhanced rows');geometry.forEach(g=>{assert(g.centerDelta<=2,'label and first choice vertically aligned '+JSON.stringify(g));assert(g.bottomGap<=16,'no empty reset space '+JSON.stringify(g));});
   console.log('LAYOUT_GEOMETRY',JSON.stringify({width,kind,geometry}));
   assert.equal(await groups.count(),await selects.count(),'one group per attribute');
   await form.evaluate(f=>{window.__changes=0;jQuery(f).on('change.testChoices','.variations select',()=>window.__changes++);});
   for(let i=0;i<await selects.count();i++){
    const cell=selects.nth(i).locator('xpath=ancestor::td[1]');
    await cell.locator('.ml-variation-choice:not(:disabled)').first().click();
   }
   await page.waitForFunction(sel=>Number(document.querySelector(sel+' [name="variation_id"]')?.value)>0,kind==='popup'?'.product-lightbox':'.product-main');
   const id=await form.locator('[name="variation_id"]').inputValue();assert(Number(id)>0);
   assert.equal(await page.evaluate(()=>window.__changes),await selects.count(),'one native change per selection');
   for(let i=0;i<await selects.count();i++){
    const selected=groups.nth(i).locator('[aria-pressed="true"]');assert.equal(await selected.count(),1);
    const text=await selects.nth(i).evaluate(s=>s.options[s.selectedIndex].textContent.trim());assert.equal(await selected.innerText(),text);
   }
   const native=await form.evaluate(f=>{const v=jQuery(f).data('product_variations');return Array.isArray(v)?v.find(x=>String(x.variation_id)===f.querySelector('[name=variation_id]').value):null;});
   if(native){assert(native.is_in_stock&&native.is_purchasable,'selected variation purchasable');console.log('VARIATION_MATCH',JSON.stringify({width,kind,id,price:native.display_price}));}
   assert(await groups.evaluateAll(gs=>gs.every(g=>{const r=g.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;})),'choice groups fit viewport');
   await groups.first().scrollIntoViewIfNeeded();
   await page.screenshot({path:'ml-choices-evidence/'+(preview?'preview':'live')+'-'+kind+'-'+width+'.png',timeout:15000});
   const reset=form.locator('.reset_variations');
   if(await reset.isVisible()){
    await reset.click();
    await page.waitForFunction(sel=>!document.querySelector(sel+' .ml-variation-choice[aria-pressed="true"]'),kind==='popup'?'.product-lightbox':'.product-main');
    const first=groups.first().locator('button:not(:disabled)').first();await first.focus();await page.keyboard.press('Enter');assert(await selects.first().inputValue(),'keyboard selection');
   }
   results.push({width,kind,popupOpenedAtDesktop:kind==='popup',variationId:id,groups:await groups.count(),cartWrites:false});
   if(kind==='popup'){await page.keyboard.press('Escape');await scope.waitFor({state:'hidden'});}
  }
  await context.close();
 }
 console.log('ML_VARIATIONS_VERIFIED '+JSON.stringify({preview,results}));
 await writeFile('ml-choices-evidence/'+(preview?'preview':'live')+'.json',JSON.stringify(results));
 }finally{await browser.close();}
}
if(process.argv[1]?.endsWith('/verify-layout.mjs'))await verify(process.argv.includes('--preview'));
