import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {chromium} from '/tmp/ml-hero/node_modules/playwright/index.mjs';
const php=readFileSync('web-minhlong/hero-links/ml-hero-product-links.php','utf8');
const css=php.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1],js=php.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const paths=['/bo-suu-tap-noi-su-duong-sinh-ceres-kim-sa/','/san-pham/binh-hoa-ma-dao-thanh-cong-minh-long-27cm-k26/'];
export async function verify(preview){
 await mkdir('hero-evidence',{recursive:true});
 const browser=await chromium.launch({channel:'chrome'});
 try{
 for(const width of [390,1440,1812]){
  const page=await browser.newPage({viewport:{width,height:1000},isMobile:width===390,hasTouch:width===390});
  await page.addLocatorHandler(page.locator('#mltv-popup.mltv-popup--show'),async overlay=>{
   const close=overlay.locator('[aria-label*="Đóng"],[aria-label*="đóng"],[aria-label*="Close"],[class*="close"]').first();
   if(await close.isVisible())await close.click();else await overlay.locator('.mltv-popup__backdrop').click({position:{x:5,y:5}});
  });
  for(let i=0;i<paths.length;i++){
   const response=await page.goto('https://minhlongonline.com/',{waitUntil:'domcontentloaded',timeout:60000});
   assert.equal(response.status(),200);
   if(preview){await page.addStyleTag({content:css});await page.addScriptTag({content:js});}
   else assert.equal(await page.locator('#ml-hero-product-links-js').count(),1,'live homepage marker');
   const a=page.locator('a.ml-hero-product-link:visible').nth(i);
   await a.waitFor({state:'visible',timeout:15000});
   const href=await a.getAttribute('href');assert.equal(href,paths[i]);
   const box=await a.boundingBox();assert(box.width>30&&box.height>=30);
   if(i===0){
    await page.addStyleTag({content:'a.ml-hero-product-link{outline:2px solid #ff4020!important}'});
    await page.screenshot({path:'hero-evidence/'+(preview?'preview':'live')+'-'+width+'.jpg',type:'jpeg',quality:70});
    if(preview)console.log('PREVIEW_IMAGE_'+width+' '+(await page.screenshot({type:'jpeg',quality:50})).toString('base64'));
   }
   await a.click({timeout:15000});
   await page.waitForURL('https://minhlongonline.com'+paths[i],{timeout:60000,waitUntil:'domcontentloaded'});
   const heading=(await page.locator('h1').allTextContents()).join(' ');
   assert(i===0?/Kim Sa/i.test(heading):/Mã Đáo Thành Công/i.test(heading),'destination heading '+heading);
   console.log('HERO_LINK_OK',JSON.stringify({preview,width,link:i,href,box,heading}));
  }
  await page.close();
 }
 }finally{await browser.close();}
}
if(process.argv.includes('--preview'))await verify(true);
