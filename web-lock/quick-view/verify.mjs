import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {chromium} from '/tmp/lnl-qv/node_modules/playwright/index.mjs';
const php=readFileSync('web-lock/quick-view/lnl-native-quick-view.php','utf8');
const script=php.match(/<<<'LNL_QV_JS'\n([\s\S]*?)\nLNL_QV_JS;/)[1],css=php.match(/<<<'LNL_QV_CSS'\n([\s\S]*?)\nLNL_QV_CSS;/)[1];
export async function verify(preview=false){
 await mkdir('quick-view-evidence',{recursive:true});
 const browser=await chromium.launch({headless:true});const results=[];
 try{
 for(const width of [1360,390]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});
  const page=await context.newPage();page.setDefaultTimeout(25000);const writes=[],buys=[],errors=[];page.on('console',m=>{if(m.type()==='error')console.log('BROWSER_ERROR',m.text().slice(0,400));});page.on('response',async r=>{if(r.request().postData()?.includes('flatsome_quickview'))console.log('QV_AJAX',r.status(),(await r.text()).slice(0,200));});
  page.on('pageerror',e=>{if(/lnlQuickView|LNL_QV|lnl-qv/.test(e.message))errors.push(e.message);});
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.searchParams.get('wc-ajax')==='checkout'){return route.abort();}
   if(url.searchParams.get('wc-ajax')==='lnl_add_to_cart'){
    writes.push(req.postData());return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,fragments:{},cart_hash:'isolated-verification'})});
   }
   if(url.searchParams.get('lnl_buy')==='1'){buys.push(Object.fromEntries(url.searchParams));return route.abort();}
   return route.continue();
  });
  await page.goto('https://locknlockonline.com/',{waitUntil:'commit',timeout:60000});
  await page.locator('.product-small.box').first().waitFor({state:'attached',timeout:45000});
  await page.mouse.move(150,150);await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
  await page.waitForFunction(()=>window.jQuery&&window.Flatsome,{timeout:45000});
  await page.evaluate(()=>document.querySelectorAll('#mltv-popup,.mltv-popup-overlay').forEach(n=>n.remove()));
  if(preview){
   await page.addStyleTag({content:css});
   await page.addScriptTag({content:'window.LNL_QV={add:"https://locknlockonline.com/?wc-ajax=lnl_add_to_cart",checkout:"https://locknlockonline.com/thanh-toan/"};\n'+script});
   await page.evaluate(()=>{
    document.querySelectorAll('.product-small.box').forEach(box=>{
     if(box.querySelector('.quick-view'))return;
     const data=box.querySelector('[data-product_id]'),col=box.closest('.product');
     const id=data?.getAttribute('data-product_id')||col?.className.match(/post-(\d+)/)?.[1];
     const image=box.querySelector('.box-image');if(!id||!image)return;
     const wrap=document.createElement('div');wrap.className='image-tools grid-tools';
     const a=document.createElement('a');a.href='#quick-view';a.className='quick-view';a.dataset.prod=id;a.textContent='Xem nhanh';a.setAttribute('role','button');a.setAttribute('aria-haspopup','dialog');a.setAttribute('aria-expanded','false');wrap.append(a);image.append(wrap);
    });
    Flatsome.attach('quick-view',jQuery(document));
   });
  }else{
   await page.locator('#lnl-native-quick-view').waitFor({state:'attached',timeout:45000});
   await page.waitForFunction(()=>window.lnlQuickViewReady,{timeout:45000});
  }
  const card=page.locator('.product-small.box').filter({has:page.locator('a.product_type_variable')}).first();
  const trigger=card.locator('a.quick-view').first();await trigger.scrollIntoViewIfNeeded();await card.locator('.box-image').hover();
  await trigger.waitFor({state:'visible',timeout:30000});
  const center=await trigger.evaluate(a=>{const b=a.getBoundingClientRect(),i=a.closest('.box-image').getBoundingClientRect();return {dx:Math.abs(b.x+b.width/2-i.x-i.width/2),dy:Math.abs(b.y+b.height/2-i.y-i.height/2)};});
  assert(center.dx<3&&center.dy<3,'centered trigger '+JSON.stringify(center));
  console.log('TRIGGER_STATE',await trigger.evaluate(a=>({html:a.outerHTML,classes:a.className,variation:typeof jQuery.fn.wc_variation_form,behaviors:Object.keys(Flatsome)})));await trigger.click();
  const popup=page.locator('.product-lightbox');try{await popup.waitFor({state:'visible',timeout:30000});}catch(e){await page.screenshot({path:'quick-view-evidence/open-failure-'+width+'.png'});console.log('OPEN_FAILURE',await page.evaluate(()=>({popups:document.querySelectorAll('.mfp-wrap').length,body:document.body.className,scripts:[...document.scripts].map(s=>s.src).filter(s=>/flatsome|woocommerce|litespeed/.test(s))})));throw e;}
  await popup.locator('form.variations_form').waitFor({timeout:45000});
  await popup.locator('.lnl-qv-buy').waitFor({timeout:15000});
  const selects=popup.locator('.variations select');assert(await selects.count()>0);
  for(let i=0;i<await selects.count();i++){
   const select=selects.nth(i);const option=await select.evaluate(s=>Array.from(s.options).find(o=>o.value&&!o.disabled)?.value);
   assert(option,'available variation option');
   const cell=select.locator('..');
   const choices=cell.locator('.ml-variation-choice:not(:disabled),.ux-swatch:not(.disabled),.variable-item:not(.disabled)').filter({visible:true});
   if(await choices.count()){await choices.first().click();assert(await select.inputValue(),'visible choice updates native select');}
   else if(await select.isVisible())await select.selectOption(option);
   else {console.log('VARIATION_CELL',await cell.innerHTML());throw Error('No visible variation control');}
  }
  await page.waitForFunction(()=>Number(document.querySelector('.product-lightbox [name="variation_id"]')?.value)>0,{timeout:45000});
  await popup.locator('.lnl-qv-buy').waitFor({state:'visible'});
  assert(await popup.locator('.lnl-qv-buy').isEnabled(),'buy enabled');
  const data=await popup.locator('form.cart').evaluate(f=>({product_id:f.querySelector('[name=product_id]')?.value,variation_id:f.querySelector('[name=variation_id]')?.value}));
  const qty=popup.locator('[name=quantity]').first();await qty.fill('2');
  await popup.locator('.single_add_to_cart_button').click();
  await popup.locator('.lnl-qv-status').filter({hasText:'Đã thêm'}).waitFor();
  assert.equal(writes.length,1,'one cart request');const posted=new URLSearchParams(writes[0]);assert.equal(posted.get('quantity'),'2');assert.equal(posted.get('variation_id'),data.variation_id);assert(!posted.has('add-to-cart'));
  assert(await popup.locator('img').first().evaluate(i=>i.complete&&i.naturalWidth>0),'product image loaded');
  assert(await popup.evaluate(p=>p.getBoundingClientRect().width<=innerWidth+1),'popup fits viewport');
  await page.screenshot({path:'quick-view-evidence/'+(preview?'preview':'live')+'-'+width+'.png',fullPage:false});
  await popup.locator('.lnl-qv-buy').click();
  await page.waitForTimeout(500);assert.equal(buys.length,1,'one buy navigation');assert.equal(buys[0]['add-to-cart'],data.product_id);assert.equal(buys[0].variation_id,data.variation_id);assert.equal(buys[0].quantity,'2');
  assert.equal(errors.length,0,errors.join('\n'));
  results.push({width,center,variant:true,oneCartRequest:true,buyPayload:true,orderSubmitted:false,payment:false,cartWritesIntercepted:true});
  await context.close();
 }
 console.log('QUICK_VIEW_BROWSER_RESULTS '+JSON.stringify({preview,results}));
 }finally{await browser.close();}
}
if(process.argv[1]?.endsWith('/verify.mjs'))await verify(process.argv.includes('--preview'));
