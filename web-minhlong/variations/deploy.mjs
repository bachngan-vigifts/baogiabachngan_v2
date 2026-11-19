import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verify} from './verify.mjs';
const host='minhlongonline.com',origin='https://'+host;
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
if(!user||!token||!raw)throw Error('Missing hosting configuration');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const form=p instanceof FormData,u=new URL('/execute/'+mod+'/'+fn,base);if(!form)for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{method:form?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:form?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed '+mod+'/'+fn);return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});let root;
function visit(x){if(!x||typeof x!=='object')return;if(x.domain===host&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);
if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Minh Long root not verified');
const dir=root+'/wp-content/mu-plugins',name='ml-variation-buttons.php',helper='ml-choices-cache.php';
const code=readFileSync('web-minhlong/variations/'+name,'utf8');
const disabled="<?php\ndefined('ABSPATH') || exit;\n// Disabled after variation verification failure.\n";
const helperDisabled="<?php\ndefined('ABSPATH') || exit;\n// Temporary cache helper disabled.\n";
const files=await api('Fileman','list_files',{dir});
async function read(file){return(await api('Fileman','get_file_content',{dir,file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0})).content;}
async function put(file,content){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),file);await api('Fileman','upload_files',f);if(await read(file)!==content)throw Error('Readback mismatch '+file);}
const previous=files.some(f=>f.file===name)?await read(name):null;
if(previous&&previous!==code&&previous!==disabled)throw Error('Unrecognized existing plugin; no overwrite');
const oldHelper=files.some(f=>f.file===helper)?await read(helper):helperDisabled;
if(oldHelper!==helperDisabled)throw Error('Cache helper already in use');
const probe=createHash('sha256').update(token+':ml-choices-v1').digest('hex');
async function purge(){
 try{
  await put(helper,readFileSync('web-minhlong/variations/cache.php','utf8').replace('__PROBE__',probe));
  for(let attempt=0;attempt<4;attempt++){
   await new Promise(r=>setTimeout(r,2500));
   const r=await fetch(origin+'/wp-json/ml-choices-cache/v1/refresh?verify='+Date.now(),{method:'POST',headers:{'X-LNL-Shipping':probe},signal:AbortSignal.timeout(60000)}),j=await r.json();
   console.log('CACHE',JSON.stringify({status:r.status,found:j.found,purged:j.purged}));
   if(r.ok&&j.found&&j.purged)return;
   if(r.status!==404)throw Error('Minh Long cache refresh failed');
  }
  throw Error('Cache helper not ready');
 }finally{await put(helper,oldHelper);}
}
await mkdir('ml-choices-evidence',{recursive:true});
await writeFile('ml-choices-evidence/rollback.json',JSON.stringify({name,previous}));
let installed=false;
try{
 installed=true;await put(name,code);console.log('MINHLONG_EXACT_READBACK_OK');
 await purge();
 const r=await fetch(origin+'/',{signal:AbortSignal.timeout(60000)}),html=await r.text();
 if(!r.ok||!html.includes('ml-variation-choices-style')||!html.includes('mlVariationButtonsLoaded'))throw Error('Normal homepage cache still missing deployment');
 await verify(false);
 console.log('MINHLONG_VARIATIONS_DEPLOYED');
}catch(e){
 console.log('DEPLOY_FAILED',e.message);
 if(installed){await put(name,previous||disabled);console.log('PLUGIN_ROLLED_BACK');try{await purge();}catch{console.log('ROLLBACK_CACHE_UNCONFIRMED');}}
 throw e;
}
