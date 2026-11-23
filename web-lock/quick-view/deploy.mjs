import {readFileSync} from 'node:fs';
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verify} from './verify.mjs';
import {checkHomepage} from './readiness.mjs';
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim(),root=process.env.LOCKNLOCK_DOCROOT?.trim().replace(/\/+$/,'');
if(!user||!token||!raw||!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Missing/invalid deployment configuration');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
const dir=root+'/wp-content/mu-plugins',name='lnl-native-quick-view.php',code=readFileSync('web-lock/quick-view/'+name,'utf8');
async function api(fn,p){const form=p instanceof FormData,url=new URL('/execute/Fileman/'+fn,base);if(!form)Object.entries(p).forEach(([k,v])=>url.searchParams.set(k,String(v)));const r=await fetch(url,{method:form?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:form?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed '+fn);return j.data;}
async function read(file){return (await api('get_file_content',{dir,file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0})).content;}
async function put(content,fileName=name){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),fileName);await api('upload_files',f);}
const probe=createHash('sha256').update(token+':lnl-shipping-v1').digest('hex');
async function purge(){
 // Existing scoped helper resolves the real Lock Cloudflare zone rather than trusting a stale zone setting.
 const helper='lnl-cache-target-check.php',disabled="<?php\ndefined('ABSPATH') || exit;\n// Cache verification completed.\n";
 const before=await read(helper);
 if(before!==disabled)throw Error('Cache helper is in use; no overwrite');
 const source=readFileSync('web-lock/cache-check/target.php','utf8').replace('__PROBE__',probe);
 try{
  await put(source,helper);
  if(await read(helper)!==source)throw Error('Cache helper readback mismatch');
  let refreshed=false;
  for(let attempt=0;attempt<4;attempt++){
   await new Promise(r=>setTimeout(r,2500));
   const r=await fetch('https://locknlockonline.com/wp-json/lnl-cache-check/v1/refresh?verify='+Date.now(),{method:'POST',headers:{'X-LNL-Shipping':probe},signal:AbortSignal.timeout(60000)});
   const j=await r.json();
   console.log('LOCK_ZONE_CACHE_REFRESH',JSON.stringify({status:r.status,code:j.code,found:j.found,purged:j.purged,configuredZoneMatches:j.configured_zone_matches}));
   if(r.ok&&j.found&&j.purged){refreshed=true;break;}
   if(r.status!==404)break;
  }
  if(!refreshed)throw Error('Verified Lock zone cache refresh failed');
 }finally{await put(before,helper);if(await read(helper)!==before)throw Error('Cache helper restoration mismatch');}
}

await mkdir('quick-view-evidence',{recursive:true});
const files=await api('list_files',{dir});
for(const dependency of ['woo-buy-now-direct.php','woo-ajax-add-to-cart.php'])if(!files.some(f=>f.file===dependency))throw Error('Missing existing cart dependency');
let previous=null;
if(files.some(f=>f.file===name)){
 previous=await read(name);
 if(previous!==code&&!previous.includes('// Disabled after quick-view verification failure.'))throw Error('Unexpected existing quick-view file; no write');
}
await writeFile('quick-view-evidence/rollback.json',JSON.stringify({file:name,existed:previous!==null,previous}));
let activated=false;
try{
 activated=true;await put(code);if(await read(name)!==code)throw Error('Readback mismatch');
 console.log('QUICK_VIEW_EXACT_READBACK_OK');await purge();
 await checkHomepage();
 await verify(false);
 await writeFile('quick-view-evidence/deployment.json',JSON.stringify({host:'locknlockonline.com',file:name,sha256:createHash('sha256').update(code).digest('hex'),normalHomepage:true,desktopAndMobile:true,cartWritesIntercepted:true,ordersCreated:0}));
 console.log('LOCK_QUICK_VIEW_DEPLOY_VERIFIED');
}catch(e){
 console.log('QUICK_VIEW_FAILURE',e.message);
 if(activated){await put(previous||"<?php\ndefined('ABSPATH') || exit;\n// Disabled after quick-view verification failure.\n");console.log('QUICK_VIEW_ROLLED_BACK');try{await purge();}catch{console.log('ROLLBACK_CACHE_REFRESH_UNCONFIRMED');}}
 throw e;
}
