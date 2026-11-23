import {readFileSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {chromium} from '/tmp/ml-choices/node_modules/playwright/index.mjs';
const code=readFileSync('web-lock/invoice-guidance/store-company-invoice-guidance.php','utf8');
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
if(!user||!token||!raw)throw Error('Missing hosting configuration');
const base=new URL(raw.includes('://')?raw:'https://'+raw);
if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const form=p instanceof FormData,u=new URL('/execute/'+mod+'/'+fn,base);if(!form)for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{method:form?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:form?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed '+mod+'/'+fn);return j.data;}
async function put(dir,name,text){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([text]),name);await api('Fileman','upload_files',f);}
async function read(dir,file){return (await api('Fileman','get_file_content',{dir,file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0})).content;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});
function findRoot(host){let root;function visit(x){if(!x||typeof x!=='object')return;if(x.domain===host&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);if(!root&&host==='locknlockonline.com')root=process.env.LOCKNLOCK_DOCROOT?.trim();if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Unverified root '+host);return root.replace(/\/+$/,'');}
mkdirSync('invoice-evidence',{recursive:true});
const browser=await chromium.launch();
const disabled="<?php defined('ABSPATH') || exit; // Invoice guidance disabled.\n";
const name='store-company-invoice-guidance.php',helper='store-invoice-cache-refresh.php';
const targets=[
{host:'minhlongonline.com',path:'/san-pham/bo-tra-035l-misc-assortment-sen-vang/'},
{host:'locknlockonline.com',path:'/san-pham/eni222wht-banlahoinuoccamtaylocknlock/'}
];
try{
for(const target of targets){
 const {host,path}=target,origin='https://'+host,dir=findRoot(host)+'/wp-content/mu-plugins';
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await ctx.newPage();page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('.product-main .product-info.summary .price-wrapper').waitFor();
 const beforePrice=await page.locator('.product-main .product-info.summary .price-wrapper .amount').allTextContents();
 await page.locator('.product-main .product-info.summary .price-wrapper').scrollIntoViewIfNeeded();
 await page.screenshot({path:'invoice-evidence/'+host+'-before-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('.product-main .product-info.summary .price-wrapper').scrollIntoViewIfNeeded();
 await page.screenshot({path:'invoice-evidence/'+host+'-before-mobile.png'});
 const files=await api('Fileman','list_files',{dir});
 const previous=files.some(f=>f.file===name)?await read(dir,name):disabled;
 if(previous!==code&&previous!==disabled)throw Error('Unexpected existing invoice plugin '+host);
 if(files.some(f=>f.file===helper)){const old=await read(dir,helper);if(old!==disabled)throw Error('Active existing cache helper '+host);}
 const auth=randomBytes(32).toString('hex');
 const cacheCode=readFileSync('web-lock/invoice-guidance/cache.php','utf8').replaceAll('__TOKEN__',auth).replaceAll('__HOST__',host);
 async function purge(){
   await put(dir,helper,cacheCode);
   try{
    const r=await fetch(origin+'/wp-json/store-invoice-cache/v1/refresh',{method:'POST',headers:{'X-Invoice-Token':auth},signal:AbortSignal.timeout(90000)});
    const j=await r.json();if(!r.ok||!j.local)throw Error('Cache refresh failed');
    console.log(host,'CACHE_REFRESH',JSON.stringify(j));
   }finally{await put(dir,helper,disabled);}
 }
 try{
   await put(dir,name,code);if(await read(dir,name)!==code)throw Error('Readback mismatch');
   await purge();
   await new Promise(r=>setTimeout(r,5000));
   for(const width of [1440,390]){
     await page.setViewportSize({width,height:width===390?844:1000});
     await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:90000});
     const notice=page.locator('.product-main .product-info.summary .price-wrapper .store-invoice-guidance');
     await notice.waitFor({state:'visible',timeout:45000});await notice.scrollIntoViewIfNeeded();
     if(await notice.count()!==1)throw Error('Duplicate guidance');
     const fits=await notice.evaluate(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.left>=p.left-1&&r.right<=p.right+1&&e.scrollWidth<=e.clientWidth+1;});
     if(!fits)throw Error('Guidance overflow '+width);
     const text=await notice.innerText();if(!text.includes('Tôi muốn xuất hóa đơn Công ty'))throw Error('Copy mismatch');
     const prices=await page.locator('.product-main .product-info.summary .price-wrapper .amount').allTextContents();
     if(JSON.stringify(prices)!==JSON.stringify(beforePrice))throw Error('Price text changed');
     await page.screenshot({path:'invoice-evidence/'+host+'-after-'+width+'.png'});
     console.log(host,'INVOICE_VERIFIED',JSON.stringify({width,oneNotice:true,withinPriceCard:true,priceUnchanged:true}));
   }
   console.log(host,'PAGEERRORS',JSON.stringify([...new Set(errors)].map(x=>x.slice(0,180))));
   console.log(host,'INVOICE_DEPLOYED');
 }catch(e){await put(dir,name,previous);await purge();console.log(host,'ROLLED_BACK');throw e;}
 finally{await ctx.close();}
}
}finally{await browser.close();}
