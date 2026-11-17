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
async function read(dir,file){
const {content:s}=await api('Fileman','get_file_content',{dir,file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});
const lines=(s||'').split('\n'),keep=new Set();
lines.forEach((line,i)=>{if(/woocommerce.*(order|email|payment)|on-hold|webhook|processing|sepay|crm|wp_remote_post|defer_transactional/i.test(line))for(let n=Math.max(0,i-5);n<Math.min(lines.length,i+18);n++)keep.add(n);});
console.log('SOURCE '+file+'\n'+[...keep].sort((a,b)=>a-b).map(i=>(i+1)+': '+(/secret|password|token|api.?key|authorization|https:\/\/.*(workers.dev|supabase)/i.test(lines[i])?'[sensitive line omitted]':lines[i])).join('\n').slice(0,40000));
}
const dir=root+'/wp-content/mu-plugins';
for(const f of await api('Fileman','list_files',{dir}))if(f.file.endsWith('.php'))await read(dir,f.file);
await read(root+'/wp-content/themes/flatsome-child','functions.php');
await read(root+'/wp-content/plugins/woocommerce/includes/emails','class-wc-email-new-order.php');
console.log('NOTIFICATIONS_READ_ONLY_COMPLETE');
