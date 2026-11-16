import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const names=['CPANEL_BASE_URL','CPANEL_USERNAME','CPANEL_API_TOKEN','LOCKNLOCK_DOCROOT','GEMINI_API_KEY'];
let stage='secrets', api, upload, cleanup, rollback, changed=false;

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
   const j=await r.json();if(!r.ok||!j.status){console.log(JSON.stringify({cpanel_function:fn,http:r.status,status:j.status}));throw Error('cpanel');}
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
 const expected=readFileSync('web-lock/chatbot/baseline-ui.php','utf8').replace('__LNL_PRIVATE_CONFIG__',privateDir+'/'+configName);
 if(current.content!==expected) throw Error('baseline_changed');
 console.log('BASELINE_MATCH');
 stage='backup';
 await upload(privateDir,'.lnl-ai-before-ui-'+process.env.GITHUB_RUN_ID+'.php',current.content);
 rollback=()=>upload(dir,pluginName,current.content);
 let code=readFileSync('web-lock/chatbot/lnl-store-ai-bridge.php','utf8')
  .replace('__LNL_PRIVATE_CONFIG__',privateDir+'/'+configName)
  .replace('require $lnl_settings_file','require_once $lnl_settings_file')
  .replaceAll('lnl_gm_', 'lnl_gm_candidate_')
  .replaceAll("'wp_footer'", "'lnl_unused_footer'")
  .replace("'/probe'", "'/probe-candidate'")
  .replace("if ( defined( 'LNL_GEMINI_ACTIVE' ) && LNL_GEMINI_ACTIVE ) {","if ( false ) {")
  .replace("if ( ! defined( 'LNL_GEMINI_ACTIVE' ) || ! LNL_GEMINI_ACTIVE ) { return; }","if ( true ) { return; }");
 const candidate='zz-lnl-chat-candidate.php';
 cleanup=()=>upload(dir,candidate,"<?php\ndefined('ABSPATH') || exit;\n// Candidate test completed.\n");
 stage='stage_candidate';
 await upload(dir,candidate,code);
 const check=await api('get_file_content',{dir,file:candidate,from_charset:'utf-8',to_charset:'utf-8'});
 if(check.content!==code){
  let i=0;while(i<code.length&&code[i]===check.content[i])i++;
  console.log(JSON.stringify({candidate_difference_at:i,expected_codes:Array.from(code.slice(i,i+60)).map(x=>x.codePointAt(0)),actual_codes:Array.from(check.content.slice(i,i+60)).map(x=>x.codePointAt(0))}));
  throw Error('candidate_readback');
 }
 const history=[];
 for(const message of ['Tôi cần bình giữ nhiệt dưới 500.000đ, gợi ý 2 sản phẩm và giá hiện tại.','Trong hai mẫu đó, mẫu nào dung tích 500ml?']){
  stage='probe';
  const t=Date.now();
  const r=await fetch('https://locknlockonline.com/wp-json/lnl-gemini/v1/probe-candidate',{method:'POST',headers:{'Content-Type':'application/json','X-LNL-Probe':probe},body:JSON.stringify({message,history}),signal:AbortSignal.timeout(55000)});
  const j=await r.json();
  console.log(JSON.stringify({http:r.status,ms:Date.now()-t,provider:j.provider,diagnostics:j.diagnostics,productCount:j.products?.length}));
  if(!r.ok||j.provider!=='gemini'||!j.products?.length) throw Error('candidate_failed');
  if(message.includes('500ml')&&!j.reply.includes('500')) throw Error('followup_failed');
  history.push({role:'user',content:message},{role:'assistant',content:j.reply||''});
 }
 stage='activate';
 const latest=await api('get_file_content',{dir,file:pluginName,from_charset:'utf-8',to_charset:'utf-8'});
 if(latest.content!==current.content) throw Error('concurrent_change');
 const finalCode=readFileSync('web-lock/chatbot/lnl-store-ai-bridge.php','utf8').replace('__LNL_PRIVATE_CONFIG__',privateDir+'/'+configName);
 stage='activate_upload';
 changed=true;
 await upload(dir,pluginName,finalCode);
 stage='activate_readback';
 const verified=await api('get_file_content',{dir,file:pluginName,from_charset:'utf-8',to_charset:'utf-8'});
 if(verified.content!==finalCode){console.log(JSON.stringify({expected_bytes:finalCode.length,actual_bytes:verified.content?.length,expected_hash:createHash('sha256').update(finalCode).digest('hex'),actual_hash:typeof verified.content==='string'?createHash('sha256').update(verified.content).digest('hex'):null}));throw Error('readback');}
 await cleanup(); cleanup=null;
 await new Promise(resolve=>setTimeout(resolve,3000));
 stage='verify_live';
 const live=await fetch('https://locknlockonline.com/wp-json/lnl-gemini/v1/probe',{method:'POST',headers:{'Content-Type':'application/json','X-LNL-Probe':probe},body:JSON.stringify({message:'Tôi cần bình giữ nhiệt dưới 500.000đ, gợi ý 2 mẫu.'}),signal:AbortSignal.timeout(30000)});
 const body=await live.json();
 console.log(JSON.stringify({live_status:live.status,provider:body.provider,diagnostics:body.diagnostics,products:body.products?.length}));
 if(!live.ok||body.provider!=='gemini'||!body.products?.length)throw Error('live_failed');
 const publicResult=await fetch('https://locknlockonline.com/wp-json/claw-ai/v1/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Bình giữ nhiệt dưới 10.000đ có mẫu nào?' }),signal:AbortSignal.timeout(30000)});
 const publicBody=await publicResult.json();
 console.log(JSON.stringify({public_status:publicResult.status,provider:publicBody.provider,products:publicBody.products?.length}));
 if(!publicResult.ok||publicBody.provider!=='gemini'||publicBody.products?.length!==0)throw Error('public_failed');
 stage='verify_conversation';
 const advice=await fetch('https://locknlockonline.com/wp-json/claw-ai/v1/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Mình mang cà phê nóng đi làm mỗi ngày. Nên chọn dung tích và kiểu nắp thế nào? Chưa cần giới thiệu mẫu cụ thể.'}),signal:AbortSignal.timeout(30000)});
 const adviceBody=await advice.json();
 console.log(JSON.stringify({advice_status:advice.status,provider:adviceBody.provider,reply:adviceBody.reply}));
 if(!advice.ok||adviceBody.provider!=='gemini'||!adviceBody.reply?.trim())throw Error('advice_failed');
 console.log('CHAT_UI_DEPLOY_OK');
} catch {
 console.log('FAILED_STAGE='+stage);
 if(changed&&rollback)try{await rollback();console.log('RESTORED_PREVIOUS_BRIDGE');}catch{console.log('ROLLBACK_FAILED');}
 process.exitCode=1;
}
finally {if(cleanup)try{await cleanup();console.log('CANDIDATE_DISABLED');}catch{console.log('CANDIDATE_CLEANUP_FAILED');process.exitCode=1;}}
