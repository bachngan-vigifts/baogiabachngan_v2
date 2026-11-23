import {mkdir,writeFile} from 'node:fs/promises';
const u=process.env.CPANEL_USERNAME?.trim(),t=process.env.CPANEL_API_TOKEN?.trim(),b=process.env.CPANEL_BASE_URL?.trim(),root=process.env.LOCKNLOCK_DOCROOT?.trim().replace(/\/+$/,'');
if(!u||!t||!b||!root||!root.startsWith('/home/'+u+'/')||root.includes('..'))throw Error('Missing or invalid hosting configuration');
const base=new URL(b.includes('://')?b:'https://'+b);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(fn,p){const url=new URL('/execute/Fileman/'+fn,base);Object.entries(p).forEach(([k,v])=>url.searchParams.set(k,String(v)));const r=await fetch(url,{headers:{Authorization:'cpanel '+u+':'+t},signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting read failed '+fn);return j.data;}
async function list(dir){return await api('list_files',{dir});}
async function read(dir,file){return (await api('get_file_content',{dir,file,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0})).content;}
const themes=await list(root+'/wp-content/themes');
console.log('THEMES',JSON.stringify(themes.map(f=>f.file)));
const mus=await list(root+'/wp-content/mu-plugins');
console.log('MU_PLUGIN_NAMES',JSON.stringify(mus.map(f=>f.file)));
const dir=root+'/wp-content/themes/flatsome';
for(const sub of ['inc/woocommerce','inc/woocommerce/structure-wc-global.php','woocommerce/content-product-lightbox.php','assets/js/woocommerce.js']){
 try{if(!sub.endsWith('.php')&&!sub.endsWith('.js')){console.log('THEME_DIRECTORY',sub,JSON.stringify((await list(dir+'/'+sub)).map(f=>f.file)));continue;}
 const p=sub.lastIndexOf('/'),s=await read(dir+'/'+sub.slice(0,p),sub.slice(p+1));if(sub.endsWith('content-product-lightbox.php'))console.log('LIGHTBOX_TEMPLATE',s);
 else console.log('QUICK_VIEW_CODE',sub,s.split('\n').filter(l=>/quick.?view|product.?lightbox|flatsome_quick/i.test(l)).map(l=>l.slice(0,1600)).join('\n'));
 }catch{console.log('NOT_READ',sub);}
}
for(const file of mus.map(f=>f.file).filter(f=>/quick|buy.?now|cart.?single|preorder/i.test(f)&&f.endsWith('.php'))){
 const s=await read(root+'/wp-content/mu-plugins',file);
 console.log('RELATED_PLUGIN',file,s.split('\n').filter(l=>/function |add_action|add_filter|quick|buy.?now|lightbox|submit|add_to_cart_redirect/i.test(l)).map(l=>l.slice(0,900)).join('\n'));
}
await mkdir('quick-view-evidence',{recursive:true});
for(const [name,url]of [['lock','https://locknlockonline.com/'],['minhlong','https://minhlongonline.com/']]){
 const r=await fetch(url,{signal:AbortSignal.timeout(60000)});const s=await r.text();
 await writeFile('quick-view-evidence/'+name+'-public.html',s);
 console.log('PUBLIC',name,r.status,'QUICK_VIEW_MARKERS',s.match(/.{0,180}(?:quick-view|quick_view|quickView|product-lightbox).{0,240}/g)?.slice(0,15));
 console.log('SCRIPTS',name,[...s.matchAll(/<script[^>]+src=["']([^"']+)/g)].map(m=>m[1]).filter(x=>/flatsome|woocommerce|quick|claw/i.test(x)));
}
console.log('READ_ONLY_INSPECTION_COMPLETE');

for(const sub of ['inc/extensions','woocommerce','woocommerce/single-product','inc/woocommerce/structure-wc-product-box.php','inc/woocommerce/class-buy-now.php']){
try {if(!sub.endsWith('.php'))console.log('MORE_DIRECTORY',sub,JSON.stringify((await list(dir+'/'+sub)).map(f=>f.file)));
else {const n=sub.lastIndexOf('/'),s=await read(dir+'/'+sub.slice(0,n),sub.slice(n+1));console.log('THEME_SOURCE',sub,s);}}catch{console.log('NOT_READ',sub);}
}
for(const file of ['woo-buy-now-direct.php','woo-ajax-add-to-cart.php','woo-card-buttons.php']){
 const s=await read(root+'/wp-content/mu-plugins',file);console.log('CART_SOURCE',file,s);
}
const js=await read(dir+'/assets/js','woocommerce.js');
for(const m of js.matchAll(/quick-view|quick_view|product-lightbox/g)){console.log('JS_QUICK_VIEW_CONTEXT',js.slice(Math.max(0,m.index-900),m.index+1800));}

console.log('QV_DIRECTORY',JSON.stringify((await list(dir+'/inc/extensions/flatsome-wc-quick-view')).map(f=>f.file)));
for(const sub of ['inc/extensions/flatsome-wc-quick-view/flatsome-quick-view.php','inc/extensions/flatsome-wc-quick-view/flatsome-wc-quick-view.php','woocommerce/content-single-product-lightbox.php']){
try{const n=sub.lastIndexOf('/');console.log('FINAL_THEME_SOURCE',sub,await read(dir+'/'+sub.slice(0,n),sub.slice(n+1)));}catch{console.log('NOT_READ',sub);}
}

console.log('EXTENSIONS_SOURCE',await read(dir+'/inc/extensions','extensions.php'));
