import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const code=readFileSync('web-shared/checkout-step3/store-mobile-checkout.php','utf8');
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
if(!user||!token||!raw)throw Error('Missing deployment configuration');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const f=p instanceof FormData,u=new URL('/execute/'+mod+'/'+fn,base);if(!f)for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{method:f?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:f?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed: '+mod+'/'+fn);return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});
function rootFor(host){let root;function visit(x){if(!x||typeof x!=='object')return;if(x.domain===host&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);if(host==='locknlockonline.com'&&!root)root=process.env.LOCKNLOCK_DOCROOT?.trim();if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Domain root not verified '+host);return root.replace(/\/+$/,'');}

for(const host of ['locknlockonline.com','minhlongonline.com']){
 const dir=rootFor(host)+'/wp-content/mu-plugins',files=await api('Fileman','list_files',{dir});
 console.log('SHIPPING_FILES '+host+' '+JSON.stringify(files.map(f=>f.file).filter(f=>/ghn|shipping|checkout|freeship/i.test(f))));
 for(const f of files.filter(f=>/ghn|shipping|freeship/i.test(f.file)&&f.file.endsWith('.php'))){
 const {content:s}=await api('Fileman','get_file_content',{dir,file:f.file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});
 const lines=(s||'').split('\n'),indices=new Set();
 lines.forEach((line,i)=>{if(/package_rates|shipping-order\/fee|flat_rate|calculate_shipping|set_cost|shipping_total/i.test(line))for(let n=Math.max(0,i-6);n<Math.min(lines.length,i+12);n++)indices.add(n);});
 const excerpt=[...indices].sort((a,b)=>a-b).map(i=>{const line=lines[i];return (i+1)+': '+(/token|secret|password|api.?key|authorization|shop.?id.*[=]|config\(/i.test(line)?'[credential-related line omitted]':line.replace(/(['"])[A-Za-z0-9_\-]{30,}\1/g,'"[long identifier omitted]"'));}).join('\n');
 if(excerpt)console.log('FEE_SOURCE '+host+' '+f.file+'\n'+excerpt.slice(0,14000));
 }
}
console.log('SHIPPING_FEE_READ_ONLY_COMPLETE');
