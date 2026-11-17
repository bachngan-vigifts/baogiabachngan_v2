import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
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
 const pluginName='lnl-home-category-icons.php';
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


 stage='read_shipping_code';
 const files=await api('list_files',{dir});
 console.log('MU_FILES='+JSON.stringify(files.map(f=>f.file).filter(f=>/ghn|shipping|checkout|catalog/i.test(f))));
 for(const f of files.filter(f=>/ghn|shipping|checkout|catalog/i.test(f.file)&&f.file.endsWith('.php'))){
 const data=await api('get_file_content',{dir,file:f.file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});
 const s=data.content||'';
 console.log(JSON.stringify({file:f.file,functions:[...s.matchAll(/function\s+([a-zA-Z0-9_]+)\s*\(/g)].map(m=>m[1]),fields:[...new Set(s.match(/(?:billing|shipping)_[a-z_]*(?:ward|district|province)[a-z_]*/g)||[])],options:[...s.matchAll(/get_option\(\s*['"]([^'"]+)['"]/g)].map(m=>m[1]),constants:[...s.matchAll(/defined\(\s*['"]([^'"]+)['"]/g)].map(m=>m[1])}));
 }
 console.log('SHIPPING_READ_ONLY_OK');
}catch{console.log('FAILED_STAGE='+stage);process.exitCode=1;}
