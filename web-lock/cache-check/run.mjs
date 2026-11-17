import { readFileSync } from 'node:fs';
import {createHash} from 'node:crypto';
const names=['CPANEL_BASE_URL','CPANEL_USERNAME','CPANEL_API_TOKEN','LOCKNLOCK_DOCROOT'];
let stage='secrets', api, upload, rollback, browser, activated=false;
try {
 for(const name of names) if(!process.env[name]?.trim()) throw Error('missing');
 const user=process.env.CPANEL_USERNAME.trim(), token=process.env.CPANEL_API_TOKEN.trim();
 const raw=process.env.CPANEL_BASE_URL.trim(), base=new URL(raw.includes('://')?raw:'https://'+raw);
 if(base.protocol!=='https:'||!/^[a-zA-Z0-9_]+$/.test(user)) throw Error('invalid');
 if(!base.port) base.port='2083';
 const root=process.env.LOCKNLOCK_DOCROOT.trim().replace(/\/+$/,'');
 if(!root.startsWith('/home/'+user+'/')||root.includes('..')) throw Error('root');
 const dir=root+'/wp-content/mu-plugins', privateDir='/home/'+user;
 const pluginName='lnl-cache-target-check.php';
 api=async(fn,params)=>{
   const url=new URL('/execute/Fileman/'+fn,base);
   const isForm=params instanceof FormData;
   if(!isForm) for(const [k,v] of Object.entries(params)) url.searchParams.set(k,String(v));
   const r=await fetch(url,{method:isForm?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:isForm?params:undefined,signal:AbortSignal.timeout(40000)});
   const j=await r.json();if(!r.ok||!j.status) throw Error('cpanel');
   return j.data;
 };
 upload=async(dest,name,content)=>{
   const form=new FormData();form.set('dir',dest);form.set('overwrite','1');
   form.set('file-1',new Blob([content],{type:'application/octet-stream'}),name);
   await api('upload_files',form);
 };


 stage='install_scoped_cache_helper';
 const files=await api('list_files',{dir});
 if(files.some(f=>f.file===pluginName))throw Error('existing_helper');
 const probe=createHash('sha256').update(token+':lnl-shipping-v1').digest('hex');
 const code=readFileSync('web-lock/cache-check/target.php','utf8').replace('__PROBE__',probe);
 rollback=()=>upload(dir,pluginName,"<?php\ndefined('ABSPATH') || exit;\n// Cache verification completed.\n");
 activated=true;await upload(dir,pluginName,code);
 stage='verify_target_zone';
 const r=await fetch('https://locknlockonline.com/wp-json/lnl-cache-check/v1/refresh',{method:'POST',headers:{'X-LNL-Shipping':probe},signal:AbortSignal.timeout(60000)});
 const j=await r.json();console.log('TARGET_ZONE_CHECK='+JSON.stringify(j));
 await rollback();activated=false;
 const home=await fetch('https://locknlockonline.com/',{signal:AbortSignal.timeout(45000)});const html=await home.text();
 console.log(JSON.stringify({status:home.status,cache:home.headers.get('cf-cache-status'),age:home.headers.get('age'),icons:html.includes('lnl-hero-product-icons-js'),shipping:html.includes('lnl-shipping-information-js')}));
 if(!html.includes('lnl-hero-product-icons-js')||!html.includes('lnl-shipping-information-js'))throw Error('public_cache_stale');
 console.log('PUBLIC_HOMEPAGE_VERIFIED');
}catch{console.log('FAILED_STAGE='+stage);process.exitCode=1;}
finally{if(activated&&rollback)await rollback();}
