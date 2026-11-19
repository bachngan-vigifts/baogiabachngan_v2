import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {chromium} from '/tmp/ai-seo/node_modules/playwright/index.mjs';
const folder='web-shared/ai-seo/',name='bn-organization-identity.php';
const code=readFileSync(folder+name,'utf8'),hosts=['minhlongonline.com'];
await mkdir('seo-identity-evidence',{recursive:true});
async function verify(host,preview){
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/*',route=>['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
  for(const path of ['/','/gioi-thieu-bach-ngan-gom-su-minh-long/']){
   const r=await page.goto('https://'+host+path,{waitUntil:'domcontentloaded',timeout:60000});
   assert.equal(r.status(),200);
   const data=await page.evaluate(()=>({text:document.body.innerText,nodes:Array.from(document.querySelectorAll('script[type="application/ld+json"]')).flatMap(n=>{const j=JSON.parse(n.textContent);return j['@graph']||[j]})}));
   assert(data.text.includes('1801686576')&&data.text.includes('CÔNG TY TNHH SX TM BÁCH NGÂN')&&data.text.includes('102B'),'visible identity unchanged');
   const orgs=data.nodes.filter(n=>n['@id']==='https://minhlongonline.com/#organization');
   assert.equal(orgs.length,1,'exactly one organization');
   if(!preview){
    assert.equal(orgs[0].legalName,'CÔNG TY TNHH SX TM BÁCH NGÂN');
    assert.equal(orgs[0].taxID,'1801686576');
    assert.equal(orgs[0].address?.streetAddress,'102B đường 3/2, Phường Tân An');
   }
   console.log('SEO_IDENTITY_CHECK',JSON.stringify({host,path,preview,organizationCount:orgs.length,organization:orgs[0]}));
  }
 }finally{await browser.close();}
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

const disabled="<?php\ndefined('ABSPATH') || exit;\n// SEO identity helper disabled.\n";
const helper='bn-seo-identity-cache.php',key=randomBytes(32).toString('hex');
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
await writeFile('seo-identity-evidence/rollback.json',JSON.stringify(previous,null,2));
async function refresh(h){
 for(let n=0;n<4;n++){
  const r=await fetch('https://'+h+'/wp-json/bn-seo-identity/v1/refresh',{method:'POST',headers:{'X-BN-SEO':key},signal:AbortSignal.timeout(60000)});
  if(r.status===404){await new Promise(resolve=>setTimeout(resolve,3000));continue;}
  const j=await r.json();console.log('CACHE_REFRESH',h,r.status,JSON.stringify(j));if(!r.ok)throw Error('Cache refresh failed');return;
 }throw Error('Cache helper not loaded');
}
try{
 for(const h of hosts){helpers.push(h);await put(h,helper,helperCode);written.push(h);await put(h,name,code);await refresh(h);}
 for(const h of hosts)await verify(h,false);
 await writeFile('seo-identity-evidence/result.json',JSON.stringify({hosts,pages:['/','/gioi-thieu-bach-ngan-gom-su-minh-long/'],sha256:createHash('sha256').update(code).digest('hex'),verified:true,ordersCreated:0,cartWrites:0},null,2));
 console.log('MINHLONG_ORGANIZATION_IDENTITY_VERIFIED');
}catch(e){
 for(const h of written.reverse()){
  try{if(await read(h,name)!==code)throw Error('Concurrent change; manual rollback required');await put(h,name,previous[h]??disabled);await refresh(h);console.log('ROLLED_BACK',h);}
  catch{console.log('ROLLBACK_UNCONFIRMED',h);}
 }
 throw e;
}finally{
 for(const h of helpers)try{if(await read(h,helper)===helperCode)await put(h,helper,disabled);else throw Error('Concurrent helper change');}catch{console.log('HELPER_CLEANUP_UNCONFIRMED',h);process.exitCode=1;}
}
