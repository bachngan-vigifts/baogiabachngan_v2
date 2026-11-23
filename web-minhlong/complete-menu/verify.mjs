import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {chromium} from '/tmp/ml-complete/node_modules/playwright/index.mjs';
const folder='web-minhlong/complete-menu/';
const fixture=JSON.parse(readFileSync(folder+'categories.fixture.json','utf8'));
const source=readFileSync(folder+'ml-complete-category-menu.php','utf8');
const js=source.match(/<script id="mlcm-complete-menu"[^>]*>([\s\S]*?)<\/script>/)[1];
export async function verify(preview){
 await mkdir('complete-menu-evidence',{recursive:true});
 const browser=await chromium.launch({channel:'chrome'});
 try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1100},isMobile:width===390,hasTouch:width===390});
  await page.addLocatorHandler(page.locator('#mltv-popup.mltv-popup--show'),async d=>d.locator('button[aria-label="Đóng popup"]').click());
  const r=await page.goto('https://minhlongonline.com/danh-muc/minh-long/tuong-linh-vat-minh-long/',{waitUntil:'domcontentloaded',timeout:60000});assert.equal(r.status(),200);
  if(preview){
   await page.evaluate(data=>{const el=document.createElement('script');el.id='mlcm-category-data';el.type='application/json';el.textContent=JSON.stringify(data);document.body.append(el);},fixture);
   await page.addScriptTag({content:js});
  }
  const data=await page.locator('#mlcm-category-data').evaluate(e=>JSON.parse(e.textContent));
  assert(data.length>=55);
  const expected=data.map(t=>Number(t.id)).sort((a,b)=>a-b);
  assert(expected.includes(400)&&expected.includes(440),'fruit bowls and LYS bowls in taxonomy');
  for(const surface of ['sidebar','header']){
   let menu;
   if(surface==='sidebar'){
    if(width===390)await page.locator('a[href="#shop-sidebar"],.filter-button').filter({visible:true}).first().click();
    menu=page.locator('.mlcb-menu:visible').first();
   }else if(width===1440){
    await page.locator('.header-vertical-menu__opener').hover();
    menu=page.locator('.header-vertical-menu__fly-out .lnl-needs-menu:visible').first();
   }else{
    await page.keyboard.press('Escape');
    const close=page.locator('.mfp-close:visible').first();if(await close.count())await close.click();
    await page.locator('a[href="#main-menu"]:visible,[data-open="#main-menu"]:visible').first().click();
    menu=page.locator('.mfp-content .lnl-needs-menu:visible').first();
   }
   await menu.waitFor({state:'visible',timeout:15000});
   await menu.locator('[data-mlcm-term="400"]').first().waitFor({state:'attached'});
   const p=surface==='sidebar'?'mlcb-':'lnl-';
   const actual=await menu.locator('.'+p+'need [data-mlcm-term]').evaluateAll(as=>as.map(a=>Number(a.dataset.mlcmTerm)).sort((a,b)=>a-b));
   assert.deepEqual(actual,expected,'every taxonomy appears exactly once in grouped menu');
   const all=await menu.locator('.'+p+'needs-all [data-mlcm-term]').evaluateAll(as=>as.map(a=>Number(a.dataset.mlcmTerm)).sort((a,b)=>a-b));
   assert.deepEqual(all,expected,'all-categories list complete');
   await menu.locator('input[type=search]').fill('trai cay');
   const fruit=menu.locator('.'+p+'need [data-mlcm-term="400"]');
   assert(await fruit.isVisible(),'new category searchable');
   assert.match(await fruit.innerText(),/trái cây/i);
   const href=await fruit.getAttribute('href');assert.equal(href,data.find(t=>Number(t.id)===400).url);
   await menu.screenshot({path:'complete-menu-evidence/'+(preview?'preview':'live')+'-'+surface+'-'+width+'.jpg',type:'jpeg',quality:65});
   await menu.locator('.'+p+'needs-reset').click();
   assert.equal(await menu.locator('.'+p+'need:not([hidden])').count(),6);
   console.log('COMPLETE_MENU_OK',JSON.stringify({preview,width,surface,total:actual.length,fruitUrl:href}));
  }
  // Follow a real newly added link from the mobile/header or desktop header.
  const panel=width===390?page.locator('.mfp-content .lnl-needs-menu:visible').first():page.locator('.header-vertical-menu__fly-out .lnl-needs-menu:visible').first();
  await panel.locator('input[type=search]').fill('trai cay');
  await panel.locator('.lnl-need [data-mlcm-term="400"]').click();
  await page.waitForURL(data.find(t=>Number(t.id)===400).url,{waitUntil:'domcontentloaded',timeout:60000});
  assert.match(await page.locator('body').innerText(),/trái cây/i);
  console.log('CATEGORY_NAVIGATION_OK',JSON.stringify({preview,width,url:page.url()}));
  await page.close();
 }
 }finally{await browser.close();}
}
if(process.argv.includes('--preview'))await verify(true);
