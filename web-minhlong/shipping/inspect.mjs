
const user=process.env.CPANEL_USERNAME.trim(),token=process.env.CPANEL_API_TOKEN.trim();
const raw=process.env.CPANEL_BASE_URL.trim(),base=new URL(raw.includes('://')?raw:'https://'+raw);
if(base.protocol!=='https:')throw Error('https required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const u=new URL('/execute/'+mod+'/'+fn,base);for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{headers:{Authorization:'cpanel '+user+':'+token},signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error(mod+'/'+fn+' failed');return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});
let found;function visit(x){if(!x||typeof x!=='object')return;if(x.domain==='minhlongonline.com'&&x.documentroot)found=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);
if(!found||!found.startsWith('/home/'+user+'/')||found.includes('..'))throw Error('Minh Long root not verified');
console.log('MINHLONG_ROOT_VERIFIED');
const dir=found+'/wp-content/mu-plugins',files=await api('Fileman','list_files',{dir});
console.log('MU_NAMES',JSON.stringify(files.map(f=>f.file)));
for(const f of files.filter(f=>/\.php$/.test(f.file))){const r=await api('Fileman','get_file_content',{dir,file:f.file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});const s=r.content||'';if(/GHN|ghn/.test(s)){console.log('GHN_REFERENCES',JSON.stringify({file:f.file,constantNames:[...new Set([...s.matchAll(/(?:defined|constant|getenv)\(\s*['"]([^'"]*(?:GHN|ghn)[^'"]*)['"]/g)].map(m=>m[1]))],optionNames:[...new Set([...s.matchAll(/get_option\(\s*['"]([^'"]*(?:ghn|shipping)[^'"]*)['"]/g)].map(m=>m[1]))],fieldIds:[...new Set([...s.matchAll(/(?:billing|shipping)_ghn_[a-z_]+/g)].map(m=>m[0]))]}));}}
