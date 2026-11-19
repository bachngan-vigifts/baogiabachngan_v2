import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '/tmp/ml-choices/node_modules/playwright/index.mjs';
const php=readFileSync('web-minhlong/variations/ml-variation-buttons.php','utf8');
const js=php.match(/<<<'ML_CHOICES_JS'\n([\s\S]*?)\nML_CHOICES_JS/)[1];
const css=php.match(/<style id="ml-variation-choices-style">([\s\S]*?)<\/style>/)[1];
export async function verify(preview){
 await mkdir('ml-choices-evidence',{recursive:true});
 const browser=await chromium.launch();const results=[];
 try{
 for(const width of [1360,390]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'}),page=await context.newPage();
  page.setDefaultTimeout(30000);
  // Read-only validation: prohibit cart writes and order submission.
  await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.searchParams.has('add-to-cart')||u.searchParams.get('lnl_buy')==='1'||u.searchParams.has('wc-ajax')&&/add_to_cart|checkout/.test(u.searchParams.get('wc-ajax')))return r.abort();return r.continue();});
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
   }else{
    await page.goto(href,{waitUntil:'commit',timeout:60000});
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
   results.push({width,kind,variationId:id,groups:await groups.count(),cartWrites:false});
   if(kind==='popup'){await page.keyboard.press('Escape');await scope.waitFor({state:'hidden'});}
  }
  await context.close();
 }
 console.log('ML_VARIATIONS_VERIFIED '+JSON.stringify({preview,results}));
 await writeFile('ml-choices-evidence/'+(preview?'preview':'live')+'.json',JSON.stringify(results));
 }finally{await browser.close();}
}
if(process.argv[1]?.endsWith('/verify.mjs'))await verify(process.argv.includes('--preview'));
