import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const code=readFileSync('web-lock/payment-gate/lock-sepay-paid-notifications.php','utf8');
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
if(!user||!token||!raw)throw Error('Missing deployment configuration');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const f=p instanceof FormData,u=new URL('/execute/'+mod+'/'+fn,base);if(!f)for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{method:f?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:f?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed: '+mod+'/'+fn);return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});
function rootFor(host){let root;function visit(x){if(!x||typeof x!=='object')return;if(x.domain===host&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);if(host==='locknlockonline.com'&&!root)root=process.env.LOCKNLOCK_DOCROOT?.trim();if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Domain root not verified '+host);return root.replace(/\/+$/,'');}

const dir=rootFor('locknlockonline.com')+'/wp-content/mu-plugins',name='lock-sepay-paid-notifications.php';
const files=await api('Fileman','list_files',{dir});
let previous=null;
if(files.some(f=>f.file===name)){
 previous=(await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0})).content;
 if(previous!==code)throw Error('Unexpected existing payment gate; no write');
}
async function put(text){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([text]),name);await api('Fileman','upload_files',f);}
try{
 await put(code);
 const back=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});
 if(back.content!==code)throw Error('Readback mismatch');
 console.log('LOCK_PAYMENT_GATE_EXACT_READBACK_OK');
 console.log('MINHLONG_NOT_MODIFIED; NO_EXISTING_ORDERS_CHANGED; NO_EMAILS_SENT_BY_DEPLOY');
}catch(e){
 await put(previous||"<?php // Payment notification gate disabled after failed readback.\n");
 console.log('PAYMENT_GATE_ROLLED_BACK');throw e;
}
