import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
const folder='web-lock/google-extended/',name='lnl-google-extended.php';
const code=readFileSync(folder+name,'utf8'),hosts=['locknlockonline.com'];
await mkdir('ge-evidence',{recursive:true});
function groups(txt){
 const out=[];let agents=[],rules=[],started=false;
 for(const line of txt.split(/\r?\n/)){
  const m=line.split('#')[0].trim().match(/^([^:]+):\s*(.*)$/);if(!m)continue;
  const field=m[1].toLowerCase(),value=m[2].trim();
  if(field==='user-agent'){
   if(started){out.push({agents,rules});agents=[];rules=[];started=false;}
   agents.push(value.toLowerCase());
  }else if(['allow','disallow'].includes(field)&&agents.length){
   rules.push({allow:field==='allow',path:value});started=true;
  }
 }
 if(agents.length)out.push({agents,rules});return out;
}
function allowed(txt,agent,path){
 const gs=groups(txt),specific=gs.filter(g=>g.agents.includes(agent.toLowerCase()));
 const chosen=specific.length?specific:gs.filter(g=>g.agents.includes('*'));
 let best=-1,result=true;
 for(const r of chosen.flatMap(g=>g.rules)){
  if(!r.path)continue;
  const end=r.path.endsWith('$'),raw=end?r.path.slice(0,-1):r.path;
  const pattern=raw.split('*').map(s=>s.replace(/[.+?^$()|[\]\\{}]/g,'\\$&')).join('.*');
  if(!new RegExp('^'+pattern+(end?'$':'')).test(path))continue;
  const length=Buffer.byteLength(raw.replaceAll('*',''));
  if(length>best||(length===best&&r.allow)){best=length;result=r.allow;}
 }
 return result;
}
assert(allowed('User-agent: Google-Extended\nDisallow: /\nUser-agent: Google-Extended\nAllow: /\nDisallow: /cart/','Google-Extended','/san-pham/a/'));
assert(!allowed('User-agent: Google-Extended\nDisallow: /\nUser-agent: Google-Extended\nAllow: /\nDisallow: /cart/','Google-Extended','/cart/'));
assert(!allowed('User-agent: *\nAllow: /\nUser-agent: GPTBot\nDisallow: /','GPTBot','/'));
let before;
async function robots(){
 const r=await fetch('https://locknlockonline.com/robots.txt',{signal:AbortSignal.timeout(45000)});
 assert.equal(r.status,200);const t=await r.text();assert(t.includes('User-agent:')||t.includes('User-Agent:'));return t;
}
async function verify(host,preview){
 const text=await robots();
 if(preview){
  before=text;await writeFile('ge-evidence/robots-before.txt',text);
  assert(!text.includes('# BEGIN LOCK GOOGLE EXTENDED PERMISSION'),'Existing deployment requires separate review');
  console.log('BEFORE_GOOGLE_EXTENDED',allowed(text,'Google-Extended','/'));
  return;
 }
 assert(text.includes('# BEGIN LOCK GOOGLE EXTENDED PERMISSION'),'permission block must be publicly served');
 const without=text.replace(/\n*# BEGIN LOCK GOOGLE EXTENDED PERMISSION[\s\S]*?# END LOCK GOOGLE EXTENDED PERMISSION\s*/,'').trim();
 assert.equal(without,before.trim(),'all existing robots content retained');
 const publicPaths=['/','/san-pham/','/san-pham/binh-giu-nhiet-locknlock-lhc3249/','/gioi-thieu-cua-hang-locknlock-online/','/danh-muc/','/sitemap_index.xml'];
 const privatePaths=['/wp-admin/','/wp-login.php','/wp-json/','/cart/','/checkout/','/my-account/','/gio-hang/','/thanh-toan/','/tai-khoan/','/wishlist/','/?add-to-cart=1','/?wc-ajax=checkout','/?lnl_buy=1','/wp-content/uploads/wc-logs/test.log'];
 for(const path of publicPaths)assert(allowed(text,'Google-Extended',path),'public permission '+path);
 for(const path of privatePaths)assert(!allowed(text,'Google-Extended',path),'private exclusion '+path);
 for(const agent of ['Googlebot','GPTBot','ClaudeBot','OAI-SearchBot','PerplexityBot','*']){
  for(const path of [...publicPaths,...privatePaths])assert.equal(allowed(text,agent,path),allowed(before,agent,path),'unchanged '+agent+' '+path);
 }
 for(const path of ['/','/gioi-thieu-cua-hang-locknlock-online/']){
  const r=await fetch('https://'+host+path,{signal:AbortSignal.timeout(45000)});
  assert.equal(r.status,200);assert((await r.text()).includes('Lock'),'public page readable');
 }
 await writeFile('ge-evidence/robots-after.txt',text);
 console.log('ROBOTS_EFFECTIVE_PERMISSION_OK',JSON.stringify({publicPaths,privatePaths,otherAgentsUnchanged:true}));
}
await verify(hosts[0],true);
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

const disabled="<?php\ndefined('ABSPATH') || exit;\n// Google Extended helper disabled.\n";
const helper='lnl-ge-permission-cache.php',key=randomBytes(32).toString('hex');
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
await writeFile('ge-evidence/rollback.json',JSON.stringify(previous,null,2));
async function refresh(h){
 for(let n=0;n<4;n++){
  const r=await fetch('https://'+h+'/wp-json/lnl-ge-permission/v1/refresh',{method:'POST',headers:{'X-LNL-GE':key},signal:AbortSignal.timeout(60000)});
  if(r.status===404){await new Promise(resolve=>setTimeout(resolve,3000));continue;}
  const j=await r.json();console.log('CACHE_REFRESH',h,r.status,JSON.stringify(j));if(!r.ok)throw Error('Cache refresh failed');return;
 }throw Error('Cache helper not loaded');
}
try{
 for(const h of hosts){helpers.push(h);await put(h,helper,helperCode);written.push(h);await put(h,name,code);await refresh(h);}
 for(const h of hosts)await verify(h,false);
 await writeFile('ge-evidence/result.json',JSON.stringify({hosts,resource:'/robots.txt',sha256:createHash('sha256').update(code).digest('hex'),verified:true,ordersCreated:0,cartWrites:0},null,2));
 console.log('LOCK_GOOGLE_EXTENDED_PERMISSION_VERIFIED');
}catch(e){
 for(const h of written.reverse()){
  try{if(await read(h,name)!==code)throw Error('Concurrent change; manual rollback required');await put(h,name,previous[h]??disabled);await refresh(h);console.log('ROLLED_BACK',h);}
  catch{console.log('ROLLBACK_UNCONFIRMED',h);}
 }
 throw e;
}finally{
 for(const h of helpers)try{if(await read(h,helper)===helperCode)await put(h,helper,disabled);else throw Error('Concurrent helper change');}catch{console.log('HELPER_CLEANUP_UNCONFIRMED',h);process.exitCode=1;}
}
