import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '/tmp/ml-sort/node_modules/playwright/index.mjs';
export const path='/danh-muc/minh-long/tuong-linh-vat-minh-long/';
const origin='https://minhlongonline.com';
const php=readFileSync('web-minhlong/category-browsing/ml-category-browsing.php','utf8');
const css=php.match(/<style id="mlcb-sidebar-css">([\s\S]*?)<\/style>/)[1];
const js=php.match(/<script id="mlcb-sidebar-js"[^>]*>([\s\S]*?)<\/script>/)[1];
async function open(page,url){
 const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});assert.equal(r.status(),200);
 await page.locator('.category-page-row .products .product').first().waitFor();
}
async function ids(page){return page.locator('.category-page-row .products .product').evaluateAll(es=>es.map(e=>Number(e.className.match(/(?:^| )post-(\d+)(?: |$)/)?.[1])).filter(Boolean));}
async function makePage(browser,width=1440){
 const page=await browser.newPage({viewport:{width,height:1100},isMobile:width===390,hasTouch:width===390});
 await page.addLocatorHandler(page.locator('#mltv-popup.mltv-popup--show'),async d=>{await d.locator('button[aria-label="Đóng popup"]').click();});
 page.on('pageerror',error=>console.log('PAGE_ERROR',error.message));
 return page;
}
export async function snapshot(){
 const browser=await chromium.launch({channel:'chrome'});
 try{
 const page=await makePage(browser);const result={ids:[],other:[]};
 await open(page,origin+path);
 result.otherUrl=await page.locator('.header-vertical-menu__fly-out a[href]').evaluateAll(as=>as.find(a=>a.textContent.trim()==='Bình hoa')?.href);
 assert(result.otherUrl&&new URL(result.otherUrl).origin===origin,'resolved control category');
 result.pages=await page.locator('a[href]').evaluateAll(as=>Math.max(1,...as.map(a=>Number(a.href.match(/tuong-linh-vat-minh-long\/page\/(\d+)/)?.[1]||0))));
 assert(result.pages<=30&&result.pages>=1);
 for(let n=1;n<=result.pages;n++){
  if(n>1)await open(page,origin+path+'page/'+n+'/');
  result.ids.push(...await ids(page));
 }
 assert.equal(new Set(result.ids).size,result.ids.length,'unique products across pages');
 await open(page,result.otherUrl);result.other=await ids(page);
 await writeFile('category-evidence/baseline.json',JSON.stringify(result,null,2));
 console.log('CATEGORY_BASELINE',JSON.stringify({pages:result.pages,total:result.ids.length,first:result.ids.slice(0,4)}));
 return result;
 }finally{await browser.close();}
}
export async function menu(preview){
 await mkdir('category-evidence',{recursive:true});
 const browser=await chromium.launch({channel:'chrome'});
 try{
 for(const width of [1440,390]){
 const page=await makePage(browser,width);await open(page,origin+path);
 if(preview){await page.addStyleTag({content:css});await page.addScriptTag({content:js});}
 const root=page.locator('.mlcb-sidebar').first();await root.waitFor({state:'attached'});
 if(width===390){
  const trigger=page.locator('a[href="#shop-sidebar"],.filter-button').filter({visible:true}).first();
  await trigger.click();
 }
 await root.waitFor({state:'visible',timeout:10000});
 const grouped=await root.locator('.mlcb-need').evaluateAll(es=>es.map(e=>({title:e.querySelector('strong').textContent,links:[...e.querySelectorAll('a')].map(a=>({text:a.textContent,href:a.href}))})));
 const header=await page.locator('.header-vertical-menu__fly-out .lnl-need').evaluateAll(es=>es.map(e=>({title:e.querySelector('strong').textContent,links:[...e.querySelectorAll('a')].map(a=>({text:a.textContent,href:a.href}))})));
 assert.equal(grouped.length,6);assert.deepEqual(grouped,header);
 assert(await root.locator('a[aria-current="page"]').count()>0);
 await root.locator('input[type=search]').fill('tuong');
 assert.equal(await root.locator('.mlcb-need:not([hidden])').count(),1);
 assert.match(await root.locator('.mlcb-need:not([hidden])').innerText(),/Tượng Linh Vật/);
 await root.locator('.mlcb-needs-reset').click();assert.equal(await root.locator('.mlcb-need:not([hidden])').count(),6);
 const shot=await root.screenshot({path:'category-evidence/'+(preview?'preview':'live')+'-menu-'+width+'.jpg',type:'jpeg',quality:70});
 console.log('MENU_IMAGE_'+width+' '+shot.toString('base64'));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'no horizontal overflow');
 console.log('MENU_OK',JSON.stringify({preview,width,groups:grouped.map(g=>g.title)}));
 await page.close();
 }
 }finally{await browser.close();}
}
export async function live(baseline,products){
 const browser=await chromium.launch({channel:'chrome'});
 try{
 const page=await makePage(browser);const actual=[];
 for(let n=1;n<=baseline.pages;n++){
  await open(page,origin+path+(n===1?'':'page/'+n+'/'));
  assert.equal(await page.locator('#mlcb-figurine-order').count(),1,'new category markup');
  actual.push(...await ids(page));
  if(n===1){
   assert(await page.locator('.quick-sort-block input[data-orderby="date"]').isChecked());
   await page.screenshot({path:'category-evidence/live-category-desktop.jpg',fullPage:false});
  }
 }
 assert.deepEqual([...actual].sort((a,b)=>a-b),[...baseline.ids].sort((a,b)=>a-b),'same products, no loss or duplicates');
 const map=new Map(products.map(p=>[p.id,p]));
 const expected=[...actual].sort((a,b)=>{
  const x=map.get(a),y=map.get(b);assert(x&&y,'known products');
  return Number(x.stock==='outofstock')-Number(y.stock==='outofstock')||y.date.localeCompare(x.date)||b-a;
 });
 assert.deepEqual(actual,expected,'global stock-first newest-first order');
 for(const order of ['price','price-desc']){
  await open(page,origin+path+'?orderby='+order);
  const ordered=(await ids(page)).map(id=>map.get(id));
  for(let i=1;i<ordered.length;i++){
   const a=ordered[i-1],b=ordered[i];
   assert(Number(a.stock==='outofstock')<=Number(b.stock==='outofstock'));
   if(a.stock===b.stock)assert(order==='price'?a.price<=b.price:a.price>=b.price,'explicit price order');
  }
  assert(await page.locator('.quick-sort-block input[data-orderby="'+order+'"]').isChecked());
 }
 await open(page,baseline.otherUrl);assert.deepEqual(await ids(page),baseline.other,'other category order unchanged');
 console.log('CATEGORY_SORT_LIVE_OK',JSON.stringify({pages:baseline.pages,total:actual.length,outOfStock:actual.filter(id=>map.get(id).stock==='outofstock').length,preorder:actual.filter(id=>map.get(id).preorder).length,first:actual.slice(0,5).map(id=>map.get(id)),last:actual.slice(-3).map(id=>map.get(id))}));
 }finally{await browser.close();}
 await menu(false);
}
if(process.argv.includes('--preview'))await menu(true);
