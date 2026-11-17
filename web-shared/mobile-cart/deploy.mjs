import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const code=readFileSync('web-shared/mobile-cart/store-mobile-cart.php','utf8');
const user=process.env.CPANEL_USERNAME?.trim(),token=process.env.CPANEL_API_TOKEN?.trim(),raw=process.env.CPANEL_BASE_URL?.trim();
if(!user||!token||!raw)throw Error('Missing deployment configuration');
const base=new URL(raw.includes('://')?raw:'https://'+raw);if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const f=p instanceof FormData,u=new URL('/execute/'+mod+'/'+fn,base);if(!f)for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{method:f?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:f?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error('Hosting operation failed: '+mod+'/'+fn);return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});
function rootFor(host){let root;function visit(x){if(!x||typeof x!=='object')return;if(x.domain===host&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);if(host==='locknlockonline.com'&&!root)root=process.env.LOCKNLOCK_DOCROOT?.trim();if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Domain root not verified '+host);return root.replace(/\/+$/,'');}
const sites=[{host:'minhlongonline.com',pid:'21035',coupon:'ml10k'},{host:'locknlockonline.com',coupon:'lnl10k'}];
const name='store-mobile-cart.php',disabled="<?php // Mobile cart presentation disabled after failed verification.\n";
async function put(site,content){const f=new FormData();f.set('dir',site.dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),name);await api('Fileman','upload_files',f);}
let browser,changed=[];
try{
 for(const site of sites){site.dir=rootFor(site.host)+'/wp-content/mu-plugins';const listing=await api('Fileman','list_files',{dir:site.dir});if(JSON.stringify(listing).includes(name)){const old=await api('Fileman','get_file_content',{dir:site.dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(old.content!==disabled)throw Error('Unexpected existing version; stopped before write');}}
 browser=await chromium.launch();
 async function checkSite(site,preview){
 const origin='https://'+site.host,ctx=await browser.newContext({viewport:{width:390,height:844}}),page=await ctx.newPage();
 await page.goto(origin+'/?cart_layout_check='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
 if(!site.pid)site.pid=await page.locator('.ajax_add_to_cart[data-product_id]').first().getAttribute('data-product_id');
 const add=await ctx.request.post(origin+'/?wc-ajax=add_to_cart',{form:{product_id:site.pid,quantity:'2'}});if((await add.json()).error)throw Error('Guest cart add failed '+site.host);
 if(site.host==='minhlongonline.com'){const r=await ctx.request.post(origin+'/?wc-ajax=add_to_cart',{form:{product_id:'33570',quantity:'1'}});if((await r.json()).error)throw Error('Preorder add failed');}
 await page.goto(origin+'/gio-hang/',{waitUntil:'domcontentloaded',timeout:90000});
 if(preview){
 const css=code.match(/<style id="bnmc-style">([\s\S]*?)<\/style>/)[1],js=code.match(/<script id="bnmc-script">([\s\S]*?)<\/script>/)[1],bar=code.match(/<div id="bnmc-bar"[\s\S]*?<\/div>\s*<button[\s\S]*?<\/button>\s*<\/div>/)[0];
 await page.addStyleTag({content:css});await page.evaluate(html=>document.body.insertAdjacentHTML('beforeend',html),bar);await page.addScriptTag({content:js});
 }
 await page.locator('#bnmc-bar').waitFor({state:'visible'});
 for(const width of [390,430,320]){
 await page.setViewportSize({width,height:844});await page.waitForTimeout(500);
 const check=await page.evaluate(()=>{
 const bar=document.getElementById('bnmc-bar'),r=bar.getBoundingClientRect(),row=document.querySelector('.cart_item'),rr=row.getBoundingClientRect();
 return {same:document.querySelector('#bnmc-total').textContent===document.querySelector('.cart_totals .order-total .amount').textContent.trim(),bar:r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,card:getComputedStyle(row).display==='grid',fit:rr.left>=0&&rr.right<=innerWidth+1,overflow:document.documentElement.scrollWidth>innerWidth+2};
 });if(!check.same||!check.bar||!check.card||!check.fit||check.overflow)throw Error('Mobile geometry '+site.host+' '+width+' '+JSON.stringify(check));
 if(!preview)await page.screenshot({path:'cart-'+site.host+'-'+width+'.png',fullPage:true});
 console.log((preview?'PREVIEW':'LIVE')+'_MOBILE_LAYOUT_OK '+site.host+' width='+width);
 }
 await page.setViewportSize({width:390,height:844});
 const open=page.locator('.lnl-voucher-shop-wrap.context-cart [data-lnl-voucher-open]').first();await open.click();
 await page.locator('.lnl-voucher-modal[aria-hidden="false"]').waitFor({state:'visible'});
 const panel=page.locator('.lnl-voucher-modal[aria-hidden="false"] .lnl-voucher-modal-panel');
 if(!await panel.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}))throw Error('Voucher sheet overflow');
 if(!preview)await page.screenshot({path:'cart-voucher-'+site.host+'.png'});
 await page.locator('.lnl-voucher-modal[aria-hidden="false"] .lnl-voucher-close').click();
 console.log('VOUCHER_SHEET_OK '+site.host);
 await page.setViewportSize({width:1484,height:1004});
 if(await page.locator('#bnmc-bar').isVisible())throw Error('Mobile bar visible on desktop');
 if(await page.locator('.cart_item').first().evaluate(e=>getComputedStyle(e).display==='grid'))throw Error('Desktop card regression');
 console.log('DESKTOP_UNCHANGED_OK '+site.host);
 if(!preview){
 await page.setViewportSize({width:390,height:844});
 const qty=page.locator('.cart_item').filter({has:page.locator('[data-product_id="'+site.pid+'"]')}).locator('input.qty');
 await qty.fill('3');await qty.dispatchEvent('change');
 await page.waitForTimeout(150);
 const sticky=page.locator('#bnmc-buy');
 if((await sticky.textContent()).includes('Cập nhật'))await sticky.click();
 await page.waitForTimeout(5000);
 await page.waitForFunction(()=>!document.querySelector('.woocommerce-cart-form.processing,.cart_totals.processing,.blockUI'),{},{timeout:45000});
 await page.reload({waitUntil:'domcontentloaded',timeout:90000});
 if(await qty.inputValue()!=='3')throw Error('Quantity not persisted');
 await page.waitForFunction(()=>document.querySelector('#bnmc-total')?.textContent===document.querySelector('.cart_totals .order-total .amount')?.textContent.trim());
 console.log('QUANTITY_PERSISTED_TOTAL_SYNC_OK '+site.host);
 await page.locator('[data-lnl-voucher-open]').first().click();
 const voucher=page.locator('.lnl-voucher-modal[aria-hidden="false"] [data-lnl-voucher-code="'+site.coupon+'"]');
 await voucher.click();
 await page.waitForTimeout(5000);
 await page.reload({waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('.cart_totals .cart-discount').waitFor({state:'visible',timeout:30000});
 await page.waitForFunction(()=>document.querySelector('#bnmc-total')?.textContent===document.querySelector('.cart_totals .order-total .amount')?.textContent.trim());
 console.log('COUPON_SERVER_TOTAL_SYNC_OK '+site.host);
 if(site.host==='minhlongonline.com'){await page.locator('.bnmc-preorder').waitFor();console.log('PREORDER_CART_BADGE_OK');}
 await page.locator('#bnmc-buy').click();
 await page.waitForURL('**/thanh-toan/**',{timeout:60000});
 if(await page.locator('#bnmc-bar').count())throw Error('Cart bar leaked to checkout');
 console.log('CHECKOUT_NAVIGATION_OK_NO_ORDER_SUBMITTED '+site.host);
 }
 await ctx.close();
 }
 for(const site of sites)await checkSite(site,true);
 for(const site of sites){await put(site,code);changed.push(site);const readback=await api('Fileman','get_file_content',{dir:site.dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(readback.content!==code)throw Error('Readback mismatch');}
 for(const site of sites)await checkSite(site,false);
 console.log('BOTH_STORES_MOBILE_CART_OPTION3_DEPLOYED');
}catch(e){console.log('CART_DEPLOY_FAILED '+String(e.message).slice(0,650));for(const site of changed){await put(site,disabled);console.log('CART_PRESENTATION_ROLLED_BACK '+site.host);}process.exitCode=1;}finally{if(browser)await browser.close();}
