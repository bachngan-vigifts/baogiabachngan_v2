import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {verify} from './verify.mjs';
const folder='web-minhlong/mobile-checkout/',cssName='ml-mobile-quick-view.php',checkoutName='store-mobile-checkout.php',helperName='ml-mobile-fix-cache.php';
const css=readFileSync(folder+cssName,'utf8'),style=css.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
await mkdir('ml-mobile-evidence',{recursive:true});
await verify({previewCss:style});
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
if(!user||!token||!raw)throw Error('Missing hosting credentials');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(module,fn,params={}){
 const form=params instanceof FormData,u=new URL('/execute/'+module+'/'+fn,base);if(!form)for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));
 const r=await fetch(u,{method:form?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:form?params:undefined,signal:AbortSignal.timeout(45000)});
 const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed '+module+'/'+fn);return j.data;
}
const domains=await api('DomainInfo','domains_data',{format:'hash'});let root;
function visit(x){if(!x||typeof x!=='object')return;if(x.domain==='minhlongonline.com'&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);
if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Unverified root');
const dir=root+'/wp-content/mu-plugins';
async function read(file){return (await api('Fileman','get_file_content',{dir,file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0})).content;}
async function put(file,content){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),file);await api('Fileman','upload_files',f);assert.equal(await read(file),content,'exact readback '+file);}
const files=await api('Fileman','list_files',{dir}),has=n=>files.some(f=>f.file===n);
const disabled="<?php\ndefined('ABSPATH') || exit;\n// Minh Long mobile helper disabled.\n";
const original=await read(checkoutName),oldCss=has(cssName)?await read(cssName):null;
if(oldCss!==null&&oldCss!==css&&oldCss!==disabled)throw Error('Existing mobile quick-view changes; no write');
if(has(helperName)&&(await read(helperName))!==disabled)throw Error('Cache helper occupied');
const edits=[
 ["array('sepay', 'bacs')","array('ml_sepay_qr', 'sepay', 'bacs')"],
 ["const bank=available.find(e=>e.value==='sepay')||available.find(e=>e.value==='bacs');","const bank=available.find(e=>e.value==='ml_sepay_qr')||available.find(e=>e.value==='sepay')||available.find(e=>e.value==='bacs');"]
];
let patched=original;
for(const[from,to]of edits){if(patched.includes(to))continue;assert.equal(patched.split(from).length-1,1,'exact existing payment selector');patched=patched.replace(from,to);}
assert(patched.includes(edits[0][1])&&patched.includes(edits[1][1]));
await writeFile('ml-mobile-evidence/checkout-before.php',original);await writeFile('ml-mobile-evidence/checkout-after.php',patched);
execFileSync('php',['-l','ml-mobile-evidence/checkout-after.php'],{stdio:'inherit'});
console.log('REVIEWED_PATCH',JSON.stringify({host:'minhlongonline.com',checkoutEdits:edits,existingExplicitChoice:patched.includes('customerPaymentChoice'),gatewayProcessingChanged:false}));
const key=randomBytes(32).toString('hex');
const helper=readFileSync(folder+'cache.php','utf8').replace('__TOKEN__',key).replace('__EXPIRES__',String(Math.floor(Date.now()/1000)+1500));
async function refresh(){for(let i=0;i<5;i++){const r=await fetch('https://minhlongonline.com/wp-json/ml-mobile-fix/v1/refresh',{method:'POST',headers:{'X-ML-Mobile':key},signal:AbortSignal.timeout(60000)});if(r.status===404){await new Promise(r=>setTimeout(r,3000));continue;}if(!r.ok)throw Error('Cache refresh HTTP '+r.status);console.log('PAGE_CACHE_REFRESH_OK');return;}throw Error('Cache helper not loaded');}
const written=[];let helperWritten=false;
try{
 await put(helperName,helper);helperWritten=true;
 assert.equal(await read(checkoutName),original,'checkout unchanged since inspection');
 written.push([checkoutName,original,patched]);await put(checkoutName,patched);
 written.push([cssName,oldCss??disabled,css]);await put(cssName,css);
 await refresh();
 const html=await (await fetch('https://minhlongonline.com/',{signal:AbortSignal.timeout(60000)})).text();
 assert(html.includes('id="ml-mobile-quick-view"'),'public homepage serves new CSS');
 await verify({after:true});
 console.log('MINHLONG_MOBILE_FIX_LIVE',JSON.stringify({host:'minhlongonline.com',quickView:true,defaultGateway:'ml_sepay_qr',checkoutSha256:createHash('sha256').update(patched).digest('hex'),ordersCreated:0}));
}catch(e){
 for(const[name,before,after]of written.reverse()){
  try{assert.equal(await read(name),after,'no concurrent change before rollback');await put(name,before);console.log('ROLLED_BACK',name);}catch{console.log('ROLLBACK_UNCONFIRMED',name);}
 }
 if(helperWritten)try{await refresh();}catch{console.log('ROLLBACK_CACHE_UNCONFIRMED');}
 throw e;
}finally{
 if(helperWritten)try{assert.equal(await read(helperName),helper);await put(helperName,disabled);}catch{console.log('HELPER_CLEANUP_UNCONFIRMED');process.exitCode=1;}
}
