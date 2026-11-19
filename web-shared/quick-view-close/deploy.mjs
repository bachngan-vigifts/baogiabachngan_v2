import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {chromium} from '/tmp/bn-qv-close/node_modules/playwright/index.mjs';
const folder='web-shared/quick-view-close/',name='bn-quick-view-close.php';
const code=readFileSync(folder+name,'utf8');
const css=code.match(/<<<'BN_QV_CSS'\n([\s\S]*?)\nBN_QV_CSS;/)[1];
const js=code.match(/<<<'BN_QV_JS'\n([\s\S]*?)\nBN_QV_JS;/)[1];
const hosts=['locknlockonline.com','minhlongonline.com'];
await mkdir('qv-close-evidence',{recursive:true});
async function verify(host,preview){
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [1360,390]){
   const context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});
   const page=await context.newPage();page.setDefaultTimeout(30000);
   await page.route('**/*',async route=>{
    const r=route.request(),u=new URL(r.url());
    // No cart, order, payment or messaging writes during UI verification.
    if(u.searchParams.has('add-to-cart')||u.searchParams.has('lnl_buy')||u.searchParams.get('wc-ajax')==='checkout')return route.abort();
    if(!['GET','HEAD'].includes(r.method()) && !((r.postData()||'').includes('flatsome_quickview')))return route.abort();
    return route.continue();
   });
   await page.addLocatorHandler(page.locator('#mltv-popup.mltv-popup--show'),async()=>{
    await page.locator('#mltv-popup .mltv-popup__close').click();
   });
   await page.goto('https://'+host+'/',{waitUntil:'domcontentloaded',timeout:90000});
   await page.waitForFunction(()=>window.jQuery&&window.Flatsome,null,{timeout:45000});
   if(preview){await page.addStyleTag({content:css});await page.addScriptTag({content:js});}
   else await page.locator('#bn-qv-close-style').waitFor({state:'attached',timeout:45000});
   const trigger=page.locator('.product-small .quick-view').first();
   async function openQuickView(){
    // Open through the native handler to isolate close-control tests from
    // theme hover visibility and unrelated delayed marketing overlays.
    await trigger.evaluate(el=>window.jQuery(el).trigger('click'));
   }
   await openQuickView();
   const panel=page.locator('.mfp-wrap .product-lightbox');
   await panel.waitFor({state:'visible',timeout:45000});
   const close=panel.locator('.bn-qv-close');
   await close.waitFor({state:'visible'});
   assert.equal(await close.count(),1);
   assert.equal(await close.getAttribute('aria-label'),'Đóng xem nhanh sản phẩm');
   const geometry=await close.evaluate(b=>{
    const r=b.getBoundingClientRect(),p=b.closest('.product-lightbox').getBoundingClientRect();
    const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {right:p.right-r.right,top:r.top-p.top,w:r.width,h:r.height,inViewport:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:top===b||b.contains(top)};
   });
   assert(geometry.right>=0&&geometry.right<=12&&geometry.top>=0&&geometry.top<=12,JSON.stringify(geometry));
   assert(geometry.w>=43.99&&geometry.h>=43.99&&geometry.inViewport&&geometry.hit,'close button reachable '+JSON.stringify(geometry));
   const visibleCloses=await page.locator('.mfp-wrap .mfp-close').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').length);
   assert.equal(visibleCloses,1,'one visible close control');
   await close.focus();
   await page.screenshot({path:'qv-close-evidence/'+host+'-'+(preview?'preview':'live')+'-'+width+'.png'});
   await close.click();await panel.waitFor({state:'hidden'});
   await openQuickView();
   await panel.waitFor({state:'visible'});assert.equal(await panel.locator('.bn-qv-close').count(),1);
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
   console.log('QV_CLOSE_VERIFIED',JSON.stringify({host,width,preview,geometry,clickCloses:true,escapeCloses:true,duplicateButtons:0}));
   await context.close();
  }
 }finally{await browser.close();}
}
// Prove behavior against both live DOMs before any hosting write.
for(const host of hosts)await verify(host,true);
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
if(!user||!token||!raw)throw Error('Missing hosting credentials');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(module,fn,params={}){
 const form=params instanceof FormData,u=new URL('/execute/'+module+'/'+fn,base);
 if(!form)for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));
 const r=await fetch(u,{method:form?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:form?params:undefined,signal:AbortSignal.timeout(45000)});
 const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed: '+module+'/'+fn);return j.data;
}
const domains=await api('DomainInfo','domains_data',{format:'hash'}),roots={};
function visit(x){if(!x||typeof x!=='object')return;if(hosts.includes(x.domain)&&x.documentroot)roots[x.domain]=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}
visit(domains);
for(const h of hosts)if(!roots[h]||!roots[h].startsWith('/home/'+user+'/')||roots[h].includes('..'))throw Error('Unverified docroot '+h);
assert.notEqual(roots[hosts[0]],roots[hosts[1]]);
const disabled="<?php\ndefined('ABSPATH') || exit;\n// Quick-view close helper disabled.\n";
const helper='bn-qv-close-cache.php',key=randomBytes(32).toString('hex');
const helperCode=readFileSync(folder+'cache.php','utf8').replace('__TOKEN__',key).replace('__EXPIRES__',String(Math.floor(Date.now()/1000)+1800));
const previous={},written=[],helpers=[];
const dir=h=>roots[h]+'/wp-content/mu-plugins';
async function read(h,n){return (await api('Fileman','get_file_content',{dir:dir(h),file:n,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0})).content;}
async function put(h,n,s){const f=new FormData();f.set('dir',dir(h));f.set('overwrite','1');f.set('file-1',new Blob([s]),n);await api('Fileman','upload_files',f);assert.equal(await read(h,n),s,'exact readback '+h);}
for(const h of hosts){
 const files=await api('Fileman','list_files',{dir:dir(h)});
 previous[h]=files.some(f=>f.file===name)?await read(h,name):null;
 if(previous[h]!==null&&previous[h]!==code&&previous[h]!==disabled)throw Error('Existing custom change: '+h);
 if(files.some(f=>f.file===helper)&&(await read(h,helper))!==disabled)throw Error('Cache helper occupied: '+h);
}
await writeFile('qv-close-evidence/rollback.json',JSON.stringify(previous,null,2));
async function refresh(h){
 for(let n=0;n<4;n++){
  const r=await fetch('https://'+h+'/wp-json/bn-qv-close/v1/refresh',{method:'POST',headers:{'X-BN-QV':key},signal:AbortSignal.timeout(60000)});
  if(r.status===404){await new Promise(resolve=>setTimeout(resolve,3000));continue;}
  const j=await r.json();console.log('CACHE_REFRESH',h,r.status,JSON.stringify(j));if(!r.ok)throw Error('Cache refresh failed');return;
 }throw Error('Cache helper not loaded');
}
try{
 for(const h of hosts){helpers.push(h);await put(h,helper,helperCode);written.push(h);await put(h,name,code);await refresh(h);}
 for(const h of hosts)await verify(h,false);
 await writeFile('qv-close-evidence/result.json',JSON.stringify({hosts,widths:[1360,390],sha256:createHash('sha256').update(code).digest('hex'),verified:true,ordersCreated:0,cartWrites:0},null,2));
 console.log('BOTH_SITES_QUICK_VIEW_CLOSE_DEPLOY_VERIFIED');
}catch(e){
 for(const h of written.reverse()){
  try{if(await read(h,name)!==code)throw Error('Concurrent change; manual rollback required');await put(h,name,previous[h]??disabled);await refresh(h);console.log('ROLLED_BACK',h);}
  catch{console.log('ROLLBACK_UNCONFIRMED',h);}
 }
 throw e;
}finally{
 for(const h of helpers)try{if(await read(h,helper)===helperCode)await put(h,helper,disabled);else throw Error('Concurrent helper change');}catch{console.log('HELPER_CLEANUP_UNCONFIRMED',h);process.exitCode=1;}
}
