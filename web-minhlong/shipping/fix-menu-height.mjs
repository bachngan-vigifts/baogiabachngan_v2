import {readFileSync} from 'node:fs';import {chromium} from 'playwright';
const origin='https://minhlongonline.com',host='minhlongonline.com';
const user=process.env.CPANEL_USERNAME.trim(),token=process.env.CPANEL_API_TOKEN.trim();
const raw=process.env.CPANEL_BASE_URL.trim(),base=new URL(raw.includes('://')?raw:'https://'+raw);
if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const form=p instanceof FormData,u=new URL('/execute/'+mod+'/'+fn,base);if(!form)for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{method:form?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:form?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error(mod+'/'+fn+' failed');return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});let root;
function visit(x){if(!x||typeof x!=='object')return;if(x.domain===host&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);
if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Domain root not verified');
const dir=root+'/wp-content/mu-plugins',files=await api('Fileman','list_files',{dir});


const name='ml-home-category-icons.php';
const old=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});
if(old.content!==readFileSync('web-minhlong/shipping/height-baseline.php','utf8'))throw Error('Unexpected icon version');
async function put(content){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),name);await api('Fileman','upload_files',f);}
let changed=false,browser;
try{
const code=readFileSync('web-minhlong/shipping/ml-home-category-icons.php','utf8');await put(code);changed=true;
const check=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(check.content!==code)throw Error('Readback mismatch');
browser=await chromium.launch();const page=await browser.newPage();
for(const width of [1484,1360,1024,850]){
await page.setViewportSize({width,height:1004});
await page.goto(origin+'/?icons_size='+process.env.GITHUB_RUN_ID+'-'+width,{waitUntil:'domcontentloaded',timeout:90000});
await page.waitForFunction(()=>document.querySelectorAll('.qvg-ux-menu .ml-has-product-icon').length===11,{},{timeout:30000});
const rows=await page.locator('.qvg-ux-menu a.ml-has-product-icon').evaluateAll(es=>es.map(e=>({text:e.textContent.trim(),font:parseFloat(getComputedStyle(e).fontSize),icon:e.querySelector('img').getBoundingClientRect().width,overflow:e.scrollWidth>e.clientWidth+1})));
if(rows.some(r=>r.overflow||r.font<14||r.icon<30))throw Error('Menu layout check failed '+JSON.stringify(rows.filter(r=>r.overflow)));
const geometry=await page.evaluate(()=>{const m=document.querySelector('.qvg-ux-menu'),b=document.querySelector('.ml-hero-banner-column .col-inner');return {menu:m.getBoundingClientRect().bottom,banner:b.getBoundingClientRect().bottom};});
if(Math.abs(geometry.menu-geometry.banner)>3)throw Error('Menu/banner bottom mismatch '+JSON.stringify(geometry));
console.log('MENU_BOTTOM_MATCH_OK width='+width+' '+JSON.stringify(geometry));
console.log('MENU_SINGLE_LINE_OK width='+width+' rows='+rows.length);
await page.screenshot({path:'ml-menu-'+width+'.png'});
}
await page.setViewportSize({width:390,height:844});
const visible=await page.locator('.ml-category-product-icon').evaluateAll(es=>es.some(e=>e.getBoundingClientRect().width>0));if(visible)throw Error('Desktop icons visible on mobile');
console.log('MOBILE_UNCHANGED_OK');console.log('MENU_SIZE_DEPLOY_OK');
}catch(e){console.log('MENU_SIZE_FAILED '+String(e.message).slice(0,500));if(changed){await put(old.content);console.log('MENU_PREVIOUS_RESTORED');}process.exitCode=1;}finally{if(browser)await browser.close();}
