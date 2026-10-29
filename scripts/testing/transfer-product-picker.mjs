/** Offline UI smoke test. All API calls are mocked; no CRM data is written. */
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const shots=process.env.PICKER_SCREENSHOT_DIR||'/workspace/scratch/transfer-product-picker';await mkdir(shots,{recursive:true});
try {for(const width of [390,1280]) {
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/suppliers.css"><main id="root"></main><script type="module">
   import {initTransfers} from '/stock-ops.js';window.posts=[];
   const ui=initTransfers({root:document.querySelector('#root'),toast:console.log,go:()=>{},api:async(path,method,body)=>{
    if(method){posts.push({path,body});return {id:'new',transferNo:'PCK-NEW'};}
    if(path.startsWith('/inventory/lookup'))return {products:[{sku:'LHC3249BEG',name:'Bình giữ nhiệt LocknLock Energetic Tumbler 550ml – Màu beige',unit:'cái',stock:[{warehouse:'KHO VIGIFTS',qty:12}]}]};
    return {transfers:[],warehouses:[{id:'a',name:'KHO VIGIFTS'},{id:'b',name:'MINH LONG - LOCKNLOCK CẦN THƠ'}]};}});await ui.load();
   </script>`});
  if(/\.(js|css)$/.test(path)){try{return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':'text/css',body:await readFile(new URL('../../trial-ui'+path,import.meta.url),'utf8')});}catch{}}
  return route.abort();
 });
 await page.goto('https://crm.test/');await page.getByRole('button',{name:'＋ Xin điều chuyển',exact:true}).click();
 await page.locator('.sup-drawer select').nth(0).selectOption('a');await page.locator('.sup-drawer select').nth(1).selectOption('b');
 const search=page.locator('input[type=search]');await search.fill('Bình');await page.getByRole('button',{name:'Tìm',exact:true}).click();
 await page.locator('.transfer-search-result').click();assert.equal(await search.inputValue(),'');
 assert.match(await page.getByRole('textbox',{name:'Tên sản phẩm',exact:true}).inputValue(),/Bình giữ nhiệt/);
 await search.fill('LHC3249BEG');await search.press('Enter');await page.locator('.transfer-search-result').click();
 assert.equal(await page.getByRole('spinbutton',{name:'Số lượng chuyển',exact:true}).count(),1);
 await page.getByRole('spinbutton',{name:'Số lượng chuyển',exact:true}).fill('3');
 await page.screenshot({path:`${shots}/${width}.png`,fullPage:true});
 assert.equal(await page.locator('.sup-drawer').evaluate(n=>n.scrollWidth>n.clientWidth),false,'drawer does not overflow');
 await page.getByRole('button',{name:'Gửi duyệt',exact:true}).click();
 const posts=await page.evaluate(()=>window.posts);assert.equal(posts.length,1);assert.deepEqual(posts[0].body.lines,[{sku:'LHC3249BEG',qty:3}]);assert.deepEqual(errors,[]);
 await page.close();console.log(`PASS transfer picker ${width}px: search, Enter, add/name, duplicate, quantity, SKU payload, layout`);
}}finally{await browser.close();}
