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



const name='ml-desktop-category-groups.php';
if(files.some(f=>(f.file||f.name)===name))throw Error('Existing desktop menu requires review');
async function put(content){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),name);await api('Fileman','upload_files',f);}
let changed=false,browser;
try{
const code=readFileSync('web-minhlong/shipping/'+name,'utf8');await put(code);changed=true;
const check=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(check.content!==code)throw Error('Readback mismatch');
browser=await chromium.launch();const page=await browser.newPage();
for(const width of [2214,1484,1024]){
await page.setViewportSize({width,height:1004});
await page.goto(origin+'/?desktop_groups='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
await page.locator('.header-vertical-menu__opener').first().hover();
const menu=page.locator('.ml-desktop-needs .lnl-needs-menu');await menu.waitFor({state:'visible'});
const result=await menu.evaluate(e=>{
const root=e.parentElement,source=Array.from(root.querySelectorAll('.menu-menu-doc-container .menu-item-object-product_cat>a')).map(a=>a.href),all=new Set(Array.from(e.querySelectorAll('.lnl-needs-all a')).map(a=>a.href));
return {groups:e.querySelectorAll('.lnl-need').length,photos:e.querySelectorAll('.lnl-need img').length,missing:source.filter(x=>!all.has(x)),overflow:e.scrollWidth>e.clientWidth+1,oldVisible:root.querySelector('.menu-menu-doc-container').getBoundingClientRect().height>0};
});if(result.groups!==6||result.photos!==6||result.missing.length||result.overflow||result.oldVisible)throw Error('Desktop menu '+JSON.stringify(result));
await menu.locator('input[type=search]').fill('binh hoa');
await page.waitForFunction(()=>Array.from(document.querySelectorAll('.ml-desktop-needs .lnl-need:not([hidden])')).length===1);
await menu.locator('.lnl-needs-reset').click();
if(await menu.locator('.lnl-need:not([hidden])').count()!==6)throw Error('Menu reset failed');
await menu.locator('.lnl-need summary').first().click();
await menu.locator('.lnl-need summary').nth(1).click();
await page.waitForFunction(()=>document.querySelectorAll('.ml-desktop-needs .lnl-need[open]').length===1);
await page.screenshot({path:'ml-desktop-menu-'+width+'.png'});
console.log('DESKTOP_GROUPS_OK width='+width+' '+JSON.stringify(result));
}
await page.setViewportSize({width:390,height:844});
if(await page.locator('.ml-desktop-needs').isVisible())throw Error('Desktop menu visible on mobile');
console.log('MOBILE_MENU_UNCHANGED_OK');
await page.setViewportSize({width:1484,height:1004});
await page.goto(origin+'/san-pham/bo-do-an-9-san-pham-jasmine-trang/',{waitUntil:'domcontentloaded',timeout:90000});
await page.locator('.ml-review-wishlist-row .woosw-btn').waitFor({state:'visible'});
console.log('PUBLIC_PRODUCT_CACHE_UPDATED_OK');
console.log('DESKTOP_MENU_DEPLOY_OK');
}catch(e){console.log('DESKTOP_MENU_FAILED '+String(e.message).slice(0,400));if(changed){await put("<?php defined('ABSPATH')||exit; // Disabled after failed verification.\n");console.log('NEW_DESKTOP_MENU_DISABLED');}process.exitCode=1;}finally{if(browser)await browser.close();}
