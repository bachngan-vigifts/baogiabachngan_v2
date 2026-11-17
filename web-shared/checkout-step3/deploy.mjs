import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const code=readFileSync('web-shared/checkout-step3/store-mobile-checkout.php','utf8');
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
if(!user||!token||!raw)throw Error('Missing deployment configuration');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const f=p instanceof FormData,u=new URL('/execute/'+mod+'/'+fn,base);if(!f)for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{method:f?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:f?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed: '+mod+'/'+fn);return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});
function rootFor(host){let root;function visit(x){if(!x||typeof x!=='object')return;if(x.domain===host&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);if(host==='locknlockonline.com'&&!root)root=process.env.LOCKNLOCK_DOCROOT?.trim();if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Domain root not verified '+host);return root.replace(/\/+$/,'');}
const sites=[{host:'minhlongonline.com',pid:'21035',coupon:'ml10k'},{host:'locknlockonline.com',coupon:'lnl10k'}];
const name='store-mobile-checkout.php',disabled="<?php // Mobile checkout presentation disabled after failed verification.\n";
async function putOnce(site,content){const f=new FormData();f.set('dir',site.dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),name);await api('Fileman','upload_files',f);}

async function put(site,content){let last;for(let n=0;n<3;n++){try{await putOnce(site,content);return;}catch(e){last=e;await new Promise(r=>setTimeout(r,700*(n+1)));}}throw last;}
const changed=[];
try{
 for(const site of sites){site.dir=rootFor(site.host)+'/wp-content/mu-plugins';const listing=await api('Fileman','list_files',{dir:site.dir});if(JSON.stringify(listing).includes(name)){const old=await api('Fileman','get_file_content',{dir:site.dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(old.content!==code&&old.content!==disabled)throw Error('Unexpected existing checkout file; stopped before writes');site.previous=old.content;console.log('CHECKOUT_STARTING_STATE '+site.host+' '+(old.content===code?'candidate':'disabled'));}}
 for(const site of sites){changed.push(site);await put(site,code);const readback=await api('Fileman','get_file_content',{dir:site.dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(readback.content!==code)throw Error('Readback mismatch');console.log('CHECKOUT_FILE_VERIFIED '+site.host);}
 const run=spawnSync(process.execPath,['web-shared/checkout-step3/verify.mjs'],{stdio:'inherit',env:{...process.env,LIVE:'1'},timeout:780000});
 if(run.status!==0)throw Error('Live checkout verification failed');
 console.log('BOTH_STORES_CHECKOUT_OPTION3_DEPLOYED_AND_VERIFIED');
}catch(e){console.log('CHECKOUT_DEPLOY_FAILED '+String(e.message).slice(0,350));for(const site of changed){try{await put(site,site.previous||disabled);const back=await api('Fileman','get_file_content',{dir:site.dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(back.content!==(site.previous||disabled))throw Error('Rollback readback mismatch');console.log('CHECKOUT_PRESENTATION_ROLLED_BACK '+site.host);}catch{console.log('CHECKOUT_ROLLBACK_NEEDS_ATTENTION '+site.host);}}process.exitCode=1;}
