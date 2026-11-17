import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import {createHash} from 'node:crypto';
const names=['CPANEL_BASE_URL','CPANEL_USERNAME','CPANEL_API_TOKEN','LOCKNLOCK_DOCROOT'];
let stage='secrets', api, upload, rollback, browser, activated=false;
try {
 for(const name of names) if(!process.env[name]?.trim()) throw Error('missing');
 const user=process.env.CPANEL_USERNAME.trim(), token=process.env.CPANEL_API_TOKEN.trim();
 const raw=process.env.CPANEL_BASE_URL.trim(), base=new URL(raw.includes('://')?raw:'https://'+raw);
 if(base.protocol!=='https:'||!/^[a-zA-Z0-9_]+$/.test(user)) throw Error('invalid');
 if(!base.port) base.port='2083';
 const root=process.env.LOCKNLOCK_DOCROOT.trim().replace(/\/+$/,'');
 if(!root.startsWith('/home/'+user+'/')||root.includes('..')) throw Error('root');
 const dir=root+'/wp-content/mu-plugins', privateDir='/home/'+user;
 const pluginName='lnl-shipping-information.php';
 api=async(fn,params)=>{
   const url=new URL('/execute/Fileman/'+fn,base);
   const isForm=params instanceof FormData;
   if(!isForm) for(const [k,v] of Object.entries(params)) url.searchParams.set(k,String(v));
   const r=await fetch(url,{method:isForm?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:isForm?params:undefined,signal:AbortSignal.timeout(40000)});
   const j=await r.json();if(!r.ok||!j.status) throw Error('cpanel');
   return j.data;
 };
 upload=async(dest,name,content)=>{
   const form=new FormData();form.set('dir',dest);form.set('overwrite','1');
   form.set('file-1',new Blob([content],{type:'application/octet-stream'}),name);
   await api('upload_files',form);
 };


 const files=await api('list_files',{dir});
 if(files.some(f=>f.file===pluginName))throw Error('already_exists');
 const probe=createHash('sha256').update(token+':lnl-shipping-v1').digest('hex');
 const code=readFileSync('web-lock/shipping/lnl-shipping-information.php','utf8').replace('__LNL_SHIPPING_PROBE__',probe);
 rollback=()=>upload(dir,pluginName,"<?php\ndefined('ABSPATH') || exit;\n// Disabled after verification failure.\n");
 stage='install';activated=true;await upload(dir,pluginName,code);
 const verified=await api('get_file_content',{dir,file:pluginName,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});
 if(verified.content!==code)throw Error('readback');
 stage='ghn_readonly_probe';
 const res=await fetch('https://locknlockonline.com/wp-json/lnl-shipping/v1/inspect',{headers:{'X-LNL-Shipping':probe},signal:AbortSignal.timeout(60000)});
 const data=await res.json();console.log(JSON.stringify(data));
 if(!res.ok||!data.configured||!data.estimate_ok||data.policy!=='updated')throw Error('ghn_probe');
 stage='verify_browser';
 browser=await chromium.launch();
 const context=await browser.newContext({viewport:{width:1360,height:1004}});
 const page=await context.newPage();
 await page.goto('https://locknlockonline.com/?lnl_shipping_check='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:60000});
 const hit=page.locator('.lnl-ship-hit').first();await hit.waitFor();await hit.scrollIntoViewIfNeeded();await hit.hover();
 await page.locator('#lnl-ship-tip:visible').waitFor();
 if(!(await page.locator('#lnl-ship-tip').innerText()).includes('1.000.000'))throw Error('threshold');
 await page.screenshot({path:'shipping-tooltip-desktop.png'});
 await page.keyboard.press('Escape');
 if(await page.locator('#lnl-ship-tip').isVisible())throw Error('escape');
 const product=page.locator('.ajax_add_to_cart[data-product_id]').first();const id=await product.getAttribute('data-product_id');
 if(!id)throw Error('test_product');
 const cart=await context.request.post('https://locknlockonline.com/?wc-ajax=add_to_cart',{form:{product_id:id,quantity:'1'}});
 const cartData=await cart.json();if(cartData.error)throw Error('test_cart');
 await page.goto('https://locknlockonline.com/thanh-toan/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('#lnl-shipping-eta').waitFor({state:'attached'});
 console.log('CHECKOUT_FIELDS='+JSON.stringify(await page.locator('[id*="ghn"]').evaluateAll(es=>es.map(e=>e.id).filter(Boolean))));
 await page.locator('#billing_ghn_province_id').selectOption(String(data.origin.province));
 await page.waitForFunction(v=>Array.from(document.querySelector('#billing_ghn_district_id').options).some(o=>o.value===v),String(data.origin.district));
 await page.locator('#billing_ghn_district_id').selectOption(String(data.origin.district));
 await page.waitForFunction(v=>Array.from(document.querySelector('#billing_ghn_ward_code').options).some(o=>o.value===v),String(data.origin.ward));
 await page.locator('#billing_ghn_ward_code').selectOption(String(data.origin.ward));
 await page.locator('#billing_address_1').fill('1 Đường kiểm tra');
 await page.waitForFunction(()=>document.querySelector('.lnl-eta-result')?.textContent.includes('Dự kiến:') ,{}, {timeout:30000});
 await page.locator('#lnl-shipping-eta').scrollIntoViewIfNeeded();
 console.log('CHECKOUT_ETA_OK');
 await page.screenshot({path:'shipping-checkout-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await page.locator('#lnl-shipping-eta').scrollIntoViewIfNeeded();
 await page.screenshot({path:'shipping-checkout-mobile.png'});
 await context.close();
 console.log('SHIPPING_DEPLOY_OK');
}catch{
 console.log('FAILED_STAGE='+stage);
 if(activated&&rollback)try{await rollback();console.log('SHIPPING_PLUGIN_DISABLED');}catch{console.log('ROLLBACK_FAILED');}
 process.exitCode=1;
}finally{if(browser)await browser.close();}
