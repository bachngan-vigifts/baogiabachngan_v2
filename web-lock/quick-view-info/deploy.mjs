import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {chromium} from '/tmp/qv-info/node_modules/playwright/index.mjs';
const folder='web-lock/quick-view-info/',name='store-qv-info.php';
const code=readFileSync(folder+name,'utf8'),hosts=['locknlockonline.com','minhlongonline.com'];
const css=code.match(/<<<'BN_INFO_CSS'\n([\s\S]*?)BN_INFO_CSS;/)[1];
const js=code.match(/<<<'BN_INFO_JS'\n([\s\S]*?)BN_INFO_JS;/)[1];
await mkdir('qv-info-evidence',{recursive:true});
async function verify(host,preview){
 const browser=await chromium.launch({headless:true});
 try{for(const width of [1214,390]){
 const page=await browser.newPage({viewport:{width,height:1003},isMobile:width===390,hasTouch:width===390});
 await page.addLocatorHandler(page.locator('#mltv-popup.mltv-popup--show'),async d=>{await d.locator('[aria-label*="Đóng"],[aria-label*="Close" i],[class*="close" i],[data-close]').first().click({timeout:5000});});
 await page.route('**/*',route=>{
 const r=route.request(),u=new URL(r.url());
 if(u.searchParams.has('add-to-cart')||u.searchParams.has('lnl_buy'))return route.abort();
 if(!['GET','HEAD'].includes(r.method())&&!(r.postData()||'').includes('flatsome_quickview'))return route.abort();
 return route.continue();
 });
 await page.goto('https://'+host+'/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForFunction(()=>window.jQuery&&document.querySelector('a.quick-view'),null,{timeout:45000});
 if(preview){await page.addStyleTag({content:css});await page.addScriptTag({content:js});}
 else await page.locator('#bn-qv-info-script').waitFor({state:'attached'});
 const triggers=page.locator('a.quick-view');assert(await triggers.count()>1);
 for(const index of [0,1,0]){
 const trigger=triggers.nth(index);await trigger.scrollIntoViewIfNeeded();
 if(width>549)await trigger.locator('xpath=ancestor::div[contains(@class,"box-image")]').hover();
 await trigger.dispatchEvent('click');
 const popup=page.locator('.product-lightbox');await popup.waitFor({state:'visible',timeout:45000});
 await popup.locator('.bn-qv-info').waitFor();
 assert.equal(await popup.locator('.bn-qv-invoice').count(),1);
 assert.equal(await popup.locator('.bn-qv-info').count(),1);
 const result=await popup.evaluate(p=>{
 const invoice=p.querySelector('.bn-qv-invoice'),info=p.querySelector('.bn-qv-info');
 const codes=Array.from(info.querySelectorAll('code'),n=>n.textContent);
 const expected=Array.from(document.getElementById('lnl-image-vouchers-template').content.querySelectorAll('code'),n=>n.textContent);
 return {invoiceAfterPrice:invoice.previousElementSibling.classList.contains('price-wrapper'),infoAfterMeta:info.previousElementSibling.classList.contains('product_meta'),codes,expected,text:invoice.textContent};
 });
 assert(result.invoiceAfterPrice&&result.infoAfterMeta);assert.deepEqual(result.codes,result.expected);assert(result.codes.length>0);
 assert(result.codes.every(c=>c.startsWith(host.startsWith('lock')?'LNL':'ML')));
 assert(result.text.includes('Có hỗ trợ xuất hóa đơn công ty')&&result.text.includes('Tôi muốn xuất hóa đơn Công ty'));
 await popup.locator('.bn-qv-info details').evaluateAll(ds=>ds.forEach(d=>d.open=true));
 await popup.locator('.bn-qv-info').scrollIntoViewIfNeeded();
 const bounds=await popup.locator('.bn-qv-info').evaluate(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,scroll:e.scrollWidth,width:e.clientWidth}));
 assert(bounds.left>=-1&&bounds.right<=width+1&&bounds.scroll<=bounds.width+1,JSON.stringify(bounds));
 await page.screenshot({path:'qv-info-evidence/'+(preview?'preview':'live')+'-'+host+'-'+width+'-'+index+'.png'});
 console.log('INFO_CHECK',JSON.stringify({host,preview,width,index,...result}));
 await page.keyboard.press('Escape');await popup.waitFor({state:'hidden'});
 }
 await page.close();
 }}finally{await browser.close();}
}
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

assert.equal(new Set(Object.values(roots)).size,hosts.length,'Distinct site roots required');
const disabled="<?php\ndefined('ABSPATH') || exit;\n// Quick-view simple row helper disabled.\n";
const helper='bn-qv-info-cache.php',key=randomBytes(32).toString('hex');
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
await writeFile('qv-info-evidence/rollback.json',JSON.stringify(previous,null,2));
async function refresh(h){
 for(let n=0;n<4;n++){
  const r=await fetch('https://'+h+'/wp-json/bn-qv-info/v1/refresh',{method:'POST',headers:{'X-BN-INFO':key},signal:AbortSignal.timeout(60000)});
  if(r.status===404){await new Promise(resolve=>setTimeout(resolve,3000));continue;}
  const j=await r.json();console.log('CACHE_REFRESH',h,r.status,JSON.stringify(j));if(!r.ok)throw Error('Cache refresh failed');return;
 }throw Error('Cache helper not loaded');
}
try{
 for(const h of hosts){helpers.push(h);await put(h,helper,helperCode);written.push(h);await put(h,name,code);await refresh(h);}
 for(const h of hosts)await verify(h,false);
 await writeFile('qv-info-evidence/result.json',JSON.stringify({hosts,widths:[1214,390],sha256:createHash('sha256').update(code).digest('hex'),verified:true,ordersCreated:0,cartWrites:0},null,2));
 console.log('BOTH_QV_INFO_VERIFIED');
}catch(e){
 for(const h of written.reverse()){
  try{if(await read(h,name)!==code)throw Error('Concurrent change; manual rollback required');await put(h,name,previous[h]??disabled);await refresh(h);console.log('ROLLED_BACK',h);}
  catch{console.log('ROLLBACK_UNCONFIRMED',h);}
 }
 throw e;
}finally{
 for(const h of helpers)try{if(await read(h,helper)===helperCode)await put(h,helper,disabled);else throw Error('Concurrent helper change');}catch{console.log('HELPER_CLEANUP_UNCONFIRMED',h);process.exitCode=1;}
}
