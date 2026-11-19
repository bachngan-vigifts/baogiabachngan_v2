import {writeFileSync,mkdirSync} from 'node:fs';
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
if(!user||!token||!raw)throw Error('Missing hosting credentials');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(module,fn,params={}){const u=new URL('/execute/'+module+'/'+fn,base);for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));const r=await fetch(u,{headers:{Authorization:'cpanel '+user+':'+token},signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error('Read failed '+module+'/'+fn);return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});let root;
function visit(x){if(!x||typeof x!=='object')return;if(x.domain==='minhlongonline.com'&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);
if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Unverified root');
mkdirSync('ml-mobile-evidence',{recursive:true});
for(const name of ['store-mobile-checkout.php','ml-product-quick-view-position.php']){
 const code=(await api('Fileman','get_file_content',{dir:root+'/wp-content/mu-plugins',file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0})).content;
 writeFileSync('ml-mobile-evidence/'+name,code);
 const lines=code.split('\n');const selected=new Set();for(let i=0;i<lines.length;i++)if(/payment_method|chosen_payment|default_gateway|cod|quick-view|hover:none|hover: none|max-width|hide-for-small/.test(lines[i]))for(let j=Math.max(0,i-2);j<=Math.min(lines.length-1,i+3);j++)selected.add(j);
 console.log('SOURCE',name,[...selected].sort((a,b)=>a-b).map(i=>(i+1)+': '+lines[i]).join('\n'));
}
