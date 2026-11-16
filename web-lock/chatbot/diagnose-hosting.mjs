import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const names=['CPANEL_BASE_URL','CPANEL_USERNAME','CPANEL_API_TOKEN','LOCKNLOCK_DOCROOT','GEMINI_API_KEY'];
let stage='secrets', api, upload, cleanup;

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

 stage='inspect';
 const current=await api('get_file_content',{dir,file:pluginName,from_charset:'utf-8',to_charset:'utf-8'});
 const privateData=await api('get_file_content',{dir:privateDir,file:configName,from_charset:'utf-8',to_charset:'utf-8'});
 if(typeof current.content!=='string'||typeof privateData.content!=='string') throw Error('file_shape');
 const probe=privateData.content.match(/define\(\s*'LNL_GEMINI_PROBE',\s*'([a-f0-9]+)'/)[1];
 const expected=readFileSync('web-lock/chatbot/baseline.php','utf8').replace('__LNL_PRIVATE_CONFIG__',privateDir+'/'+configName);
 if(current.content!==expected) throw Error('baseline_changed');
 console.log('BASELINE_MATCH');
 let code=readFileSync('web-lock/chatbot/candidate.php','utf8')
  .replace('__LNL_PRIVATE_CONFIG__',privateDir+'/'+configName)
  .replace('require $lnl_settings_file','require_once $lnl_settings_file')
  .replaceAll('lnl_gm_', 'lnl_gm_candidate_')
  .replace("'/probe'", "'/probe-candidate'")
  .replace("if ( defined( 'LNL_GEMINI_ACTIVE' ) && LNL_GEMINI_ACTIVE ) {","if ( false ) {");
 const candidate='zz-lnl-chat-candidate.php';
 cleanup=()=>upload(dir,candidate,"<?php\ndefined('ABSPATH') || exit;\n// Candidate test completed.\n");
 stage='stage_candidate';
 await upload(dir,candidate,code);
 const history=[];
 for(const message of ['Tôi cần bình giữ nhiệt dưới 500.000đ, gợi ý 2 sản phẩm và giá hiện tại.','Trong hai mẫu đó, mẫu nào dung tích 500ml?']){
  stage='probe';
  const t=Date.now();
  const r=await fetch('https://locknlockonline.com/wp-json/lnl-gemini/v1/probe-candidate',{method:'POST',headers:{'Content-Type':'application/json','X-LNL-Probe':probe},body:JSON.stringify({message,history}),signal:AbortSignal.timeout(55000)});
  const j=await r.json();
  console.log(JSON.stringify({http:r.status,ms:Date.now()-t,provider:j.provider,diagnostics:j.diagnostics,productCount:j.products?.length}));
  history.push({role:'user',content:message},{role:'assistant',content:j.reply||''});
 }
} catch { console.log('FAILED_STAGE='+stage);process.exitCode=1; }
finally {if(cleanup)try{await cleanup();console.log('CANDIDATE_DISABLED');}catch{console.log('CANDIDATE_CLEANUP_FAILED');process.exitCode=1;}}
