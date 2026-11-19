import assert from 'node:assert/strict';
import {chromium} from '/tmp/ml-choices/node_modules/playwright/index.mjs';
export async function verify(){
 const browser=await chromium.launch();
 try{
 const context=await browser.newContext({viewport:{width:1360,height:1000}}),page=await context.newPage();
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.searchParams.get('wc-ajax')==='checkout'||/order-pay|order-received/.test(u.pathname))return r.abort();return r.continue();});
 await page.goto('https://minhlongonline.com/',{waitUntil:'domcontentloaded',timeout:60000});
 const item=page.locator('a.product_type_simple[data-product_id]').first();await item.waitFor({state:'attached'});
 const id=await item.getAttribute('data-product_id');assert(/^\d+$/.test(id),'simple product ID');
 await page.goto('https://minhlongonline.com/?add-to-cart='+id,{waitUntil:'domcontentloaded',timeout:60000});
 await page.goto('https://minhlongonline.com/thanh-toan/',{waitUntil:'domcontentloaded',timeout:60000});
 const gateway=page.locator('li.payment_method_ml_sepay_qr');await gateway.waitFor({state:'visible',timeout:45000});
 const label=gateway.locator('label');assert.equal((await label.innerText()).trim(),'Chuyển khoản trước vào tài khoản công ty');
 assert.equal(await page.locator('li.payment_method_bacs').count(),0);
 assert(await page.locator('li.payment_method_cod').isVisible());
 await gateway.locator('input').check();await page.waitForTimeout(1500);
 assert.equal((await label.innerText()).trim(),'Chuyển khoản trước vào tài khoản công ty');
 assert.equal((await gateway.locator('.payment_box').allTextContents()).join('').trim(),'');
 await gateway.scrollIntoViewIfNeeded();await page.screenshot({path:'payment-label-evidence/desktop.png',timeout:15000});
 await page.setViewportSize({width:390,height:844});await gateway.scrollIntoViewIfNeeded();
 assert.equal((await label.innerText()).trim(),'Chuyển khoản trước vào tài khoản công ty');
 await page.screenshot({path:'payment-label-evidence/mobile.png',timeout:15000});
 console.log('CHECKOUT_LABEL_VERIFIED',JSON.stringify({desktop:true,mobile:true,sepay:true,cod:true,bacs:false,descriptionEmpty:true,orderSubmitted:false}));
 await context.close();
 }finally{await browser.close();}
}
