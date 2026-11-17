import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const code=readFileSync('web-shared/checkout-step3/store-mobile-checkout.php','utf8');
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
if(!user||!token||!raw)throw Error('Missing deployment configuration');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const f=p instanceof FormData,u=new URL('/execute/'+mod+'/'+fn,base);if(!f)for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{method:f?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:f?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed: '+mod+'/'+fn);return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});
function rootFor(host){let root;function visit(x){if(!x||typeof x!=='object')return;if(x.domain===host&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);if(host==='locknlockonline.com'&&!root)root=process.env.LOCKNLOCK_DOCROOT?.trim();if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Domain root not verified '+host);return root.replace(/\/+$/,'');}


const root=rootFor('locknlockonline.com');
async function inspect(dir,depth=0){
 const files=await api('Fileman','list_files',{dir});
 console.log('FILES '+dir.replace(root,'LOCK')+' '+JSON.stringify(files.map(f=>({name:f.file,type:f.type}))));
 for(const f of files){
  if(f.file==='.'||f.file==='..')continue;
  if(f.file.endsWith('.php')&&(/sepay|gateway|payment|thank|order/i.test(f.file)||depth>0)){
   const {content:s}=await api('Fileman','get_file_content',{dir,file:f.file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});
   const lines=(s||'').split('\n');
   const keep=new Set();lines.forEach((line,i)=>{if(/process_payment|payment_complete|update_status|thankyou|receipt|webhook|callback|redirect|on-hold|pending|processing|woocommerce_api|check_payment/i.test(line))for(let n=Math.max(0,i-6);n<Math.min(lines.length,i+28);n++)keep.add(n);});
   console.log('SOURCE '+dir.replace(root,'LOCK')+'/'+f.file+'\n'+[...keep].sort((a,b)=>a-b).map(i=>(i+1)+': '+(/secret|password|token|api.?key|authorization/i.test(lines[i])?'[credential-related line omitted]':lines[i].replace(/(['"])[A-Za-z0-9_-]{32,}\1/g,'"[identifier omitted]"'))).join('\n').slice(0,40000));
  } else if(depth<2&&(/sepay|includes|inc|templates/i.test(f.file))&&!f.file.includes('.')){await inspect(dir+'/'+f.file,depth+1);}
 }
}
await inspect(root+'/wp-content/mu-plugins');
await inspect(root+'/wp-content/plugins');
console.log('SEPAY_READ_ONLY_COMPLETE');
