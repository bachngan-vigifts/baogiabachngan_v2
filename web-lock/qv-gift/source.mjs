const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
if(!user||!token||!raw)throw Error('Missing hosting credentials');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(module,fn,params={}){
 const form=params instanceof FormData,u=new URL('/execute/'+module+'/'+fn,base);
 if(!form)for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));
 const r=await fetch(u,{method:form?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:form?params:undefined,signal:AbortSignal.timeout(45000)});
 const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed: '+module+'/'+fn);return j.data;
}
const hosts=['locknlockonline.com'];
const domains=await api('DomainInfo','domains_data',{format:'hash'}),roots={};
function visit(x){if(!x||typeof x!=='object')return;if(hosts.includes(x.domain)&&x.documentroot)roots[x.domain]=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}
visit(domains);
for(const h of hosts)if(!roots[h]||!roots[h].startsWith('/home/'+user+'/')||roots[h].includes('..'))throw Error('Unverified docroot '+h);


const dir=roots['locknlockonline.com']+'/wp-content/mu-plugins';
const files=await api('Fileman','list_files',{dir});
console.log('PROMO_FILES',JSON.stringify(files.map(x=>x.file)));
for(const f of files.filter(x=>/gift|promo|black|friday|bf-|offer/i.test(x.file)&&x.file.endsWith('.php'))){
 const c=(await api('Fileman','get_file_content',{dir,file:f.file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0})).content;
 console.log('PROMO_CODE',f.file,c.split('\n').filter(l=>/function |add_action|add_filter|Gourmet|1000000|2026-11|gift|promo/i.test(l)&&!/secret|token|password|api.key/i.test(l)).join('\n').slice(0,18000));
}