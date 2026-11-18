import {readFileSync} from 'node:fs';
const code=readFileSync('web-minhlong/sepay/ml-sepay-qr.php','utf8');
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
const webhookKey=process.env.ML_SEPAY_WEBHOOK_KEY?.trim();
if(!user||!token||!raw||!webhookKey)throw Error('Missing deployment configuration');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const f=p instanceof FormData,u=new URL('/execute/'+mod+'/'+fn,base);if(!f)for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{method:f?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:f?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed: '+mod+'/'+fn);return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});let root;function visit(x){if(!x||typeof x!=='object')return;if(x.domain==='minhlongonline.com'&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);
if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Minh Long document root not verified');root=root.replace(/\/+$/,'');
const dir=root+'/wp-content/mu-plugins',name='ml-sepay-qr.php',home=root.split('/').slice(0,3).join('/'),cfgDir=home,cfgName='.ml-sepay-config.php';
async function read(dir,file){try{return (await api('Fileman','get_file_content',{dir,file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0})).content}catch{return null}}
async function put(dir,name,text){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([text]),name);await api('Fileman','upload_files',f);}
const previous=await read(dir,name),previousCfg=await read(cfgDir,cfgName);
if(previous&&!previous.includes('Plugin Name: Minh Long SePay QR Gate'))throw Error('Unexpected existing file; no write');
const enabled=process.env.ML_SEPAY_ENABLE==='true';
const cfg=`<?php\nif (!defined('ABSPATH')) exit;\nreturn array(\n 'enabled'=>${enabled?'true':'false'},\n 'bank'=>'ACB',\n 'account'=>'579268',\n 'account_name'=>'CONG TY TNHH SAN XUAT THUONG MAI BACH NGAN',\n 'webhook_key'=>${JSON.stringify(webhookKey)}\n);\n`;
try{await put(dir,name,code);await put(cfgDir,cfgName,cfg);if(await read(dir,name)!==code||await read(cfgDir,cfgName)!==cfg)throw Error('Exact readback mismatch');console.log('ML_SEPAY_EXACT_READBACK_OK');console.log(enabled?'ML_SEPAY_LIVE_ENABLED':'ML_SEPAY_INSTALLED_DISABLED_PENDING_WEBHOOK');}
catch(e){if(previous!==null)await put(dir,name,previous);if(previousCfg!==null)await put(cfgDir,cfgName,previousCfg);console.log('ML_SEPAY_ROLLED_BACK');throw e;}
