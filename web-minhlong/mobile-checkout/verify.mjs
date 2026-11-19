import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from '/tmp/ml-mobile/node_modules/playwright/index.mjs';
const site='https://minhlongonline.com';
export async function verify({previewCss=null,after=false}={}){
 await mkdir('ml-mobile-evidence',{recursive:true});
 const browser=await chromium.launch({channel:'chrome'});
 try{
 for(const width of [390,1360]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});
  const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message.slice(0,120)));
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.searchParams.get('wc-ajax')==='checkout'||/order-pay|order-received/.test(u.pathname)||/\/wc\/store\/.*\/checkout/.test(u.pathname))return route.abort();
   if(previewCss&&u.origin===site&&u.pathname==='/'&&req.isNavigationRequest()){const r=await route.fetch();return route.fulfill({response:r,body:(await r.text()).replace('</head>','<style>'+previewCss+'</style></head>')});}
   return route.continue();
  });
  await page.goto(site+'/',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForTimeout(1800);
  const quick=page.locator('.product-small .box-image a.quick-view').first();
  if(width===390||after){
   await quick.scrollIntoViewIfNeeded();
   if(width!==390)await quick.hover();
   await page.waitForTimeout(250);
   const shape=await quick.evaluate(a=>{const r=a.getBoundingClientRect(),b=a.closest('.box-image').getBoundingClientRect(),s=getComputedStyle(a);return {w:r.width,h:r.height,opacity:s.opacity,display:s.display,visibility:s.visibility,dx:Math.abs(r.x+r.width/2-b.x-b.width/2),dy:Math.abs(r.y+r.height/2-b.y-b.height/2)};});
   assert(shape.w>30&&shape.h>=32&&Number(shape.opacity)===1&&shape.visibility==='visible','quick view visible');
   assert(shape.dx<4&&shape.dy<6,'quick view centered');
   await page.screenshot({path:'ml-mobile-evidence/'+(after?'live':'preview')+'-'+width+'-quickview.png'});
   await quick.click();await page.locator('.product-lightbox').waitFor({state:'visible',timeout:45000});
   assert(await page.locator('.product-lightbox').innerText(),'popup content');
   await page.screenshot({path:'ml-mobile-evidence/'+(after?'live':'preview')+'-'+width+'-popup.png'});
   console.log('QUICK_VIEW_OK',JSON.stringify({width,after,shape,popupOpened:true}));
   await page.keyboard.press('Escape');await page.waitForTimeout(300);
  }
  if(after){
   const item=page.locator('a.product_type_simple[data-product_id]').first();const id=await item.getAttribute('data-product_id');assert(/^\d+$/.test(id||''),'simple product');
   const response=await context.request.post(site+'/?wc-ajax=add_to_cart',{form:{product_id:id,quantity:'1'},timeout:60000});const added=await response.json();assert(response.ok()&&!added.error&&added.cart_hash,'guest cart');
   await page.goto(site+'/thanh-toan/',{waitUntil:'domcontentloaded',timeout:60000});
   await page.waitForFunction(()=>document.querySelector('input[name="payment_method"][value="ml_sepay_qr"]')?.checked,{},{timeout:45000});
   await page.waitForTimeout(2000);
   assert(await page.locator('#payment_method_ml_sepay_qr').isChecked(),'initial transfer choice after initialization');
   const label=(await page.locator('label[for="payment_method_ml_sepay_qr"]').textContent()).trim();
   assert.equal(label,'Chuyển khoản trước vào tài khoản công ty');
   if(width===390){
    await page.locator('#billing_first_name').fill('Kiểm tra giao diện');
    await page.locator('#billing_phone').fill('0900000000');
    await page.locator('#billing_address_1').fill('Kiểm tra giao diện - không đặt đơn');
    for(const field of ['billing_ghn_province_id','billing_ghn_district_id','billing_ghn_ward_code']){
     await page.waitForFunction(id=>{const s=document.getElementById(id);return s&&!s.disabled&&Array.from(s.options).some(o=>o.value&&!o.disabled);},field,{timeout:45000});
     const value=await page.locator('#'+field).evaluate(s=>Array.from(s.options).find(o=>o.value&&!o.disabled).value);
     await page.locator('#'+field).selectOption(value);await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1800);await page.locator('#bnco-next').click();
    await page.locator('body.bnco-step2').waitFor({timeout:45000});
   }
   await page.locator('#payment_method_ml_sepay_qr').scrollIntoViewIfNeeded();
   await page.screenshot({path:'ml-mobile-evidence/live-'+width+'-checkout.png'});
   await page.locator('#payment_method_cod').check();
   await page.waitForTimeout(1500);
   const updated=page.waitForResponse(r=>new URL(r.url()).searchParams.get('wc-ajax')==='update_order_review',{timeout:45000});
   await page.evaluate(()=>jQuery(document.body).trigger('update_checkout'));await updated;await page.waitForTimeout(1200);
   assert(await page.locator('#payment_method_cod').isChecked(),'explicit COD choice survives server refresh');
   await page.locator('#payment_method_ml_sepay_qr').check();await page.waitForTimeout(1500);
   assert(await page.locator('#payment_method_ml_sepay_qr').isChecked(),'customer can return to transfer');
   console.log('CHECKOUT_DEFAULT_OK',JSON.stringify({width,label,defaultTransfer:true,codPreservedAfterAjax:true,ordersSubmitted:0,errors}));
  }
  await context.close();
 }
 }finally{await browser.close();}
}
