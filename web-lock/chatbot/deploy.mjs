import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const names=['CPANEL_BASE_URL','CPANEL_USERNAME','CPANEL_API_TOKEN','LOCKNLOCK_DOCROOT','GEMINI_API_KEY'];
let stage='secrets', api, upload, config, activated=false;
try {
 for(const name of names) if(!process.env[name]?.trim()) throw Error('missing');
 const user=process.env.CPANEL_USERNAME.trim(), token=process.env.CPANEL_API_TOKEN.trim(), key=process.env.GEMINI_API_KEY.trim();
 const raw=process.env.CPANEL_BASE_URL.trim(), base=new URL(raw.includes('://')?raw:'https://'+raw);
 if(base.protocol!=='https:'||!/^[a-zA-Z0-9_]+$/.test(user)) throw Error('invalid');
 if(!base.port) base.port='2083';
 const root=process.env.LOCKNLOCK_DOCROOT.trim().replace(/\/+$/,'');
 if(!root.startsWith('/home/'+user+'/')||root.includes('..')) throw Error('root');
 const dir=root+'/wp-content/mu-plugins', privateDir='/home/'+user;
 const configName='.lnl-gemini-private-20261116.php', pluginName='lnl-store-ai-bridge.php';
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
 stage='target';
 const rootFiles=await api('list_files',{dir:root});
 if(!rootFiles.some(f=>f.file==='wp-config.php')) throw Error('wrong_root');
 const files=await api('list_files',{dir});
 if(files.some(f=>f.file===pluginName)) throw Error('existing_bridge_requires_review');
 const privates=await api('list_files',{dir:privateDir});
 if(privates.some(f=>f.file===configName)) throw Error('existing_config_requires_review');
 const probe=randomBytes(32).toString('hex');
 const phpString=s=>"'"+s.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'";
 config=active=>'<?php\ndefined(\'ABSPATH\') || exit;\ndefine(\'LNL_GEMINI_KEY\', '+phpString(key)+');\ndefine(\'LNL_GEMINI_PROBE\', '+phpString(probe)+');\ndefine(\'LNL_GEMINI_ACTIVE\', '+(active?'true':'false')+');\n';
 let code=readFileSync('web-lock/chatbot/lnl-store-ai-bridge.php','utf8').replace('__LNL_PRIVATE_CONFIG__',privateDir+'/'+configName);
 stage='upload_inactive';
 await upload(privateDir,configName,config(false));
 await upload(dir,pluginName,code);
 const baseSite='https://locknlockonline.com';
 async function chat(path,message,headers={}){
   const started=Date.now();
   const r=await fetch(baseSite+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({message}),signal:AbortSignal.timeout(45000)});
   const j=await r.json();
   if(!r.ok||j.provider!=='gemini'||!j.reply) throw Error('chat_check');
   if(JSON.stringify(j).includes(key)||JSON.stringify(j).includes(probe)) throw Error('secret_response');
   return {j,ms:Date.now()-started};
 }
 stage='probe';
 const probeHeaders={'X-LNL-Probe':probe};
 const p=await chat('/wp-json/lnl-gemini/v1/probe','Tôi cần bình giữ nhiệt dưới 500.000đ, gợi ý sản phẩm đang bán.',probeHeaders);
 if(!p.j.products?.length||p.j.products.some(x=>x.price_vnd>500000||!x.url.startsWith(baseSite+'/'))) throw Error('grounding');
 console.log('STAGED_PRODUCT_TEST_OK LATENCY_MS='+p.ms+' PRODUCTS='+p.j.products.length);
 const g=await chat('/wp-json/lnl-gemini/v1/probe','Chào em, em giúp được gì?',probeHeaders);
 console.log('STAGED_GREETING_OK LATENCY_MS='+g.ms);
 const denied=await fetch(baseSite+'/wp-json/lnl-gemini/v1/probe',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"message":"hello"}'});
 if(![401,403].includes(denied.status)) throw Error('probe_auth');
 stage='activate';
 activated=true;
 await upload(privateDir,configName,config(true));
 await new Promise(resolve=>setTimeout(resolve,3000));
 stage='live';
 const live=await chat('/wp-json/claw-ai/v1/chat','Tôi cần bình giữ nhiệt dưới 500.000đ, gợi ý 2 sản phẩm.');
 if(!live.j.products?.length||live.j.products.some(x=>x.price_vnd>500000)) throw Error('live_grounding');
 console.log('LIVE_GEMINI_OK LATENCY_MS='+live.ms+' PRODUCTS='+live.j.products.length);
 console.log('LIVE_REPLY='+live.j.reply);
 console.log('LIVE_PRODUCTS='+JSON.stringify(live.j.products.map(p=>({name:p.name,url:p.url,price_vnd:p.price_vnd}))));
 console.log('DEPLOYMENT_OK');
} catch {
 console.log('DEPLOY_FAILED_STAGE='+stage);
 if(activated && upload && config){
  try{await upload('/home/'+process.env.CPANEL_USERNAME.trim(),'.lnl-gemini-private-20261116.php',config(false));console.log('ROLLED_BACK_TO_ORIGINAL_CHAT');}
  catch{console.log('ROLLBACK_FAILED_MANUAL_CHECK_REQUIRED');}
 }
 process.exitCode=1;
}
