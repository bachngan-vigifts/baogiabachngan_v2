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


const name='ml-product-quick-view-position.php';
if(files.some(f=>f.file===name))throw Error('Existing quick view file requires version review');
async function put(content){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),name);await api('Fileman','upload_files',f);}
let changed=false,browser;
try{
const code=readFileSync('web-minhlong/shipping/'+name,'utf8');await put(code);changed=true;
const check=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(check.content!==code)throw Error('Readback mismatch');
browser=await chromium.launch();const page=await browser.newPage();
for(const width of [1484,1024]){
await page.setViewportSize({width,height:1004});
await page.goto(origin+'/danh-muc/minh-long/bo-do-an-minh-long/?quickview_check='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
const button=page.locator('.product-small .box-image a.quick-view').first();
const box=button.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," box-image ")][1]');
await box.scrollIntoViewIfNeeded();await box.hover();await button.waitFor({state:'visible'});await page.waitForTimeout(500);
const good=await button.evaluate(e=>{const r=e.getBoundingClientRect(),b=e.closest('.box-image').getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {centerError:Math.abs((r.y+r.height/2)-(b.y+b.height/2)),clickable:hit===e||e.contains(hit)};});
if(good.centerError>3||!good.clickable)throw Error('Quick view not centered/clickable '+JSON.stringify(good));
console.log('QUICK_VIEW_CENTERED_OK width='+width);
await page.screenshot({path:'ml-quickview-'+width+'.png'});
await button.click();await page.locator('.mfp-content .product').first().waitFor({state:'visible',timeout:30000});console.log('QUICK_VIEW_OPENS_OK width='+width);
await page.keyboard.press('Escape');
}
console.log('QUICK_VIEW_DEPLOY_OK');
}catch(e){console.log('QUICK_VIEW_FAILED '+String(e.message).slice(0,300));if(changed){await put("<?php defined('ABSPATH')||exit; // Disabled after verification failure.\n");console.log('QUICK_VIEW_DISABLED');}process.exitCode=1;}finally{if(browser)await browser.close();}
