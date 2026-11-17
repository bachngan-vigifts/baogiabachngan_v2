
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const origin='https://minhlongonline.com',host='minhlongonline.com';
const user=process.env.CPANEL_USERNAME.trim(),token=process.env.CPANEL_API_TOKEN.trim();
const gh=process.env.GHN_ML_API_TOKEN,shop=process.env.GHN_ML_SHOP_ID;
if(!gh||!/^\d+$/.test(shop||''))throw Error('Missing verified Minh Long GHN secrets');
const raw=process.env.CPANEL_BASE_URL.trim(),base=new URL(raw.includes('://')?raw:'https://'+raw);
if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const form=p instanceof FormData,u=new URL('/execute/'+mod+'/'+fn,base);if(!form)for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{method:form?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:form?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error(mod+'/'+fn+' failed');return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});let root;
function visit(x){if(!x||typeof x!=='object')return;if(x.domain===host&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);
if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Domain root not verified');
const dir=root+'/wp-content/mu-plugins',files=await api('Fileman','list_files',{dir});
const names=['ml-home-category-icons.php','ml-shipping-information.php'];
if(names.some(n=>files.some(f=>f.file===n)))throw Error('Existing deployment requires explicit version comparison');
const esc=s=>s.replaceAll('\\','\\\\').replaceAll("'","\\'");
const sources=Object.fromEntries(names.map(n=>[n,readFileSync('web-minhlong/shipping/'+n,'utf8').replace('__ML_GHN_TOKEN__',esc(gh)).replace('__ML_GHN_SHOP_ID__',shop)]));
async function put(name,code){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([code]),name);await api('Fileman','upload_files',f);}
let installed=[],browser,stage='install';
try{
 for(const n of names){installed.push(n);await put(n,sources[n]);const r=await api('Fileman','get_file_content',{dir,file:n,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(r.content!==sources[n])throw Error('Readback mismatch');}
 console.log('INSTALL_READBACK_OK');
 browser=await chromium.launch();const ctx=await browser.newContext({viewport:{width:1360,height:1004}}),page=await ctx.newPage();
 await page.addLocatorHandler(page.locator('#mltv-popup.mltv-popup--show'),async()=>{await page.locator('#mltv-popup .mltv-popup__close').evaluate(b=>b.click());});
 stage='homepage';
 await page.goto(origin+'/?ml_shipping_verify='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForFunction(()=>document.querySelectorAll('nav.qvg-ux-menu .ml-has-product-icon').length===11,{},{timeout:30000});
 console.log('CATEGORY_ICONS_OK=11');
 await page.screenshot({path:'ml-home-desktop.png'});
 const hit=page.locator('.ml-ship-hit').first();await hit.scrollIntoViewIfNeeded();await hit.hover();await page.locator('#ml-ship-tip:visible').waitFor();
 if(!(await page.locator('#ml-ship-tip').innerText()).includes('1.000.000'))throw Error('Tooltip threshold');
 await page.screenshot({path:'ml-shipping-tooltip-desktop.png'});await page.keyboard.press('Escape');
 if(await page.locator('#ml-ship-tip').isVisible())throw Error('Escape did not close tooltip');
 console.log('DESKTOP_TOOLTIP_OK');
 stage='policy';const pol=await ctx.request.get(origin+'/chinh-sach-van-chuyen-giao-nhan-kiem-hang/?ml_shipping_verify='+process.env.GITHUB_RUN_ID);const html=await pol.text();
 if(html.includes('200.000đ')||!html.includes('1.000.000đ trở lên'))throw Error('Policy content mismatch');
 console.log('POLICY_THRESHOLD_OK');
 stage='checkout';const id=await page.locator('.ajax_add_to_cart[data-product_id]').first().getAttribute('data-product_id');if(!id)throw Error('No simple product');
 const added=await ctx.request.post(origin+'/?wc-ajax=add_to_cart',{form:{product_id:id,quantity:'1'}});if((await added.json()).error)throw Error('Test cart failed');
 await page.goto(origin+'/thanh-toan/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('#ml-shipping-eta').waitFor({state:'attached'});
 await page.locator('#billing_ghn_province_id').selectOption('220');
 await page.waitForFunction(()=>Array.from(document.querySelector('#billing_ghn_district_id').options).some(o=>o.value==='1572'));
 await page.locator('#billing_ghn_district_id').selectOption('1572');
 await page.waitForFunction(()=>Array.from(document.querySelector('#billing_ghn_ward_code').options).some(o=>o.value==='550110'));
 await page.locator('#billing_ghn_ward_code').selectOption('550110');
 if(await page.locator('#ml-shipping-eta').isVisible())throw Error('ETA before full address');
 await page.locator('#billing_address_1').fill('1 Đường kiểm tra');
 await page.waitForFunction(()=>document.querySelector('.ml-eta-result')?.textContent.includes('Dự kiến:'),{},{timeout:40000});
 await page.locator('#ml-shipping-eta').scrollIntoViewIfNeeded();
 if(await page.locator('#ml-shipping-eta a').getAttribute('href')!=='tel:0939961966')throw Error('Contact mismatch');
 await page.screenshot({path:'ml-checkout-desktop.png'});console.log('DESKTOP_ETA_AND_EXPRESS_OK');
 await page.setViewportSize({width:390,height:844});await page.locator('#ml-shipping-eta').scrollIntoViewIfNeeded();
 const fits=await page.locator('#ml-shipping-eta').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth});
 if(!fits)throw Error('Mobile ETA overflow');
 await page.screenshot({path:'ml-checkout-mobile.png'});console.log('MOBILE_ETA_OK');
 await page.goto(origin+'/?ml_mobile_verify='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
 const mobileHit=page.locator('.ml-ship-hit').first();await mobileHit.scrollIntoViewIfNeeded();await mobileHit.click();await page.locator('#ml-ship-tip:visible').waitFor();
 await page.screenshot({path:'ml-tooltip-mobile.png'});console.log('MOBILE_TOOLTIP_OK');
 await ctx.close();
 stage='regional_seed';
 await fetch(origin+'/wp-cron.php?doing_wp_cron',{signal:AbortSignal.timeout(60000)});
 const regions=await fetch(origin+'/wp-json/ml-shipping/v1/regions',{signal:AbortSignal.timeout(30000)});const rows=await regions.json();if(!Array.isArray(rows)||rows.length!==3)throw Error('Regional cache not seeded');
 console.log('REGION_CACHE_OK=3');

 stage='schedule';
 const cronApi=async(fn,params={})=>{const u=new URL('/json-api/cpanel',base);for(const[k,v]of Object.entries({cpanel_jsonapi_user:user,cpanel_jsonapi_apiversion:'2',cpanel_jsonapi_module:'Cron',cpanel_jsonapi_func:fn,...params}))u.searchParams.set(k,String(v));const r=await fetch(u,{headers:{Authorization:'cpanel '+user+':'+token},signal:AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok||j.cpanelresult?.error||j.cpanelresult?.event?.result===0)throw Error('Cron API');return j.cpanelresult?.data;};
 let jobs=await cronApi('listcron');if(!Array.isArray(jobs))throw Error('Cron response');
 const covers=jobs.some(j=>/wp-cron|wp cron event run/.test(j.command||'')&&((j.command||'').includes(host)||(j.command||'').includes(root))&&['*','*/1','*/2','*/3','*/4','*/5'].includes(j.minute)&&j.hour==='*');
 if(!covers){const command="/usr/bin/curl --fail --silent --show-error --max-time 45 'https://minhlongonline.com/wp-cron.php?doing_wp_cron' >/dev/null 2>&1";await cronApi('add_line',{command,minute:'*/3',hour:'*',day:'*',month:'*',weekday:'*'});jobs=await cronApi('listcron');if(!jobs.some(j=>j.command===command))throw Error('Cron verification');}
 console.log('SYSTEM_CRON_VERIFIED');

 console.log('MINHLONG_APPROVED_DEPLOY_OK');
}catch(e){console.log('FAILED_STAGE='+stage+' ERROR='+String(e.message).slice(0,200));for(const n of installed)try{await put(n,"<?php defined('ABSPATH')||exit; // Disabled after verification failure.\n");}catch{console.log('ROLLBACK_FAILED');}process.exitCode=1;}
finally{if(browser)await browser.close();}
