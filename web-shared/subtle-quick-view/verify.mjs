import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {chromium} from '/tmp/subtle-qv/node_modules/playwright/index.mjs';
const css=readFileSync('web-shared/subtle-quick-view/store-subtle-quick-view.php','utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
export async function verify(preview){
 await mkdir('subtle-qv-evidence',{recursive:true});
 const browser=await chromium.launch({channel:'chrome'});
 try{
 for(const host of ['minhlongonline.com','locknlockonline.com']){
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:950},isMobile:width===390,hasTouch:width===390});
  await page.addLocatorHandler(page.locator('#mltv-popup.mltv-popup--show'),async d=>{
   const close=d.locator('[aria-label*="Đóng"],[aria-label*="Close" i],[class*="close" i],[data-close]').first();
   console.log('PROMO_CLOSE',host,await d.evaluate(e=>Array.from(e.querySelectorAll('button,[role="button"]')).map(b=>({tag:b.tagName,class:b.className,label:b.getAttribute('aria-label'),text:b.textContent.slice(0,60)}))));
   await close.click({timeout:5000});
  });
  await page.goto('https://'+host+'/',{waitUntil:'domcontentloaded',timeout:60000});
  if(preview)await page.addStyleTag({content:css});
  else await page.locator('#store-subtle-quick-view').waitFor({state:'attached'});
  const button=page.locator('.product-small .box-image .grid-tools > a.quick-view').first();
  await button.waitFor({state:'attached',timeout:20000});
  await button.scrollIntoViewIfNeeded();
  await page.mouse.move(0,0);
  await page.waitForTimeout(500);
  const opacity=()=>button.evaluate(e=>Number(getComputedStyle(e).opacity));
  if(width===1440){
   assert.equal(await opacity(),0,'hidden before desktop hover');
   await button.locator('xpath=ancestor::div[contains(@class,"box-image")]').hover();
   await page.waitForTimeout(300);
   assert.equal(await opacity(),1,'visible on desktop image hover');
  }else{
   assert((await opacity())>=.35&&(await opacity())<=.5,'subtle mobile button');
   assert.equal(await button.evaluate(e=>getComputedStyle(e).pointerEvents),'auto');
  }
  await page.screenshot({path:'subtle-qv-evidence/'+host+'-'+width+'-'+(preview?'preview':'live')+'.png'});
  await button.click();
  await page.locator('.product-lightbox:visible').waitFor({timeout:30000});
  await page.screenshot({path:'subtle-qv-evidence/'+host+'-'+width+'-'+(preview?'preview':'live')+'-opened.png'});
  console.log('QUICK_VIEW_OK',JSON.stringify({host,width,preview,opens:true}));
  await page.close();
 }
 }
 }finally{await browser.close();}
}
