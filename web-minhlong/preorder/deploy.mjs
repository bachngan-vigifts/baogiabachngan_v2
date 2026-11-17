import {randomBytes} from 'node:crypto';import {readFileSync} from 'node:fs';import {chromium} from 'playwright';
const origin='https://minhlongonline.com',host='minhlongonline.com';
const user=process.env.CPANEL_USERNAME.trim(),token=process.env.CPANEL_API_TOKEN.trim();
const raw=process.env.CPANEL_BASE_URL.trim(),base=new URL(raw.includes('://')?raw:'https://'+raw);
if(base.protocol!=='https:')throw Error('HTTPS required');if(!base.port)base.port='2083';
async function api(mod,fn,p={}){const form=p instanceof FormData,u=new URL('/execute/'+mod+'/'+fn,base);if(!form)for(const[k,v]of Object.entries(p))u.searchParams.set(k,String(v));const r=await fetch(u,{method:form?'POST':'GET',headers:{Authorization:'cpanel '+user+':'+token},body:form?p:undefined,signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok||!j.status)throw Error(mod+'/'+fn+' failed');return j.data;}
const domains=await api('DomainInfo','domains_data',{format:'hash'});let root;
function visit(x){if(!x||typeof x!=='object')return;if(x.domain===host&&x.documentroot)root=x.documentroot;for(const v of Object.values(x))if(typeof v==='object')visit(v);}visit(domains);
if(!root||!root.startsWith('/home/'+user+'/')||root.includes('..'))throw Error('Domain root not verified');
const dir=root+'/wp-content/mu-plugins',files=await api('Fileman','list_files',{dir});




const name='ml-preorder-purchase.php';
if(files.some(f=>(f.file||f.name)===name))throw Error('Preorder file already exists; review before replacing');
const nonce=randomBytes(24).toString('hex');
const code=readFileSync('web-minhlong/preorder/ml-preorder-purchase.php','utf8');
const probe="<?php if(empty($_COOKIE['mlpo_probe'])||!hash_equals('"+nonce+"',(string)$_COOKIE['mlpo_probe']))return;if(!defined('DONOTCACHEPAGE'))define('DONOTCACHEPAGE',true); ?>"+code.replace("get_option('mlpo_cache_version')==='1'","get_option('mlpo_cache_version')==='probe'").replace("'mlpo_cache_version','1'","'mlpo_cache_version','probe'");
async function put(content){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),name);await api('Fileman','upload_files',f);}
let changed=false,browser;
try{
browser=await chromium.launch();
const publicContext=await browser.newContext();
const before=await (await publicContext.request.get(origin+'/wp-json/wc/store/v1/products/33570?preorder_baseline='+process.env.GITHUB_RUN_ID)).json();
if(before.is_in_stock||Number(before.prices.price)!==988200)throw Error('Unexpected public product baseline');
await put(probe);changed=true;
const readback=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(readback.content!==probe)throw Error('Probe readback mismatch');
const ctx=await browser.newContext({viewport:{width:1484,height:1004}});await ctx.addCookies([{name:'mlpo_probe',value:nonce,domain:host,path:'/',secure:true,httpOnly:true}]);
const page=await ctx.newPage();
async function add(context,id,quantity=1){const r=await context.request.post(origin+'/?wc-ajax=add_to_cart',{form:{product_id:String(id),quantity:String(quantity)}});const j=await r.json();if(j.error)throw Error('Cart add failed for test product '+id);}
async function select(id,value){
 await page.waitForFunction(({id,value})=>Array.from(document.getElementById(id)?.options||[]).some(o=>o.value===value),{id,value});
 await page.evaluate(({id,value})=>jQuery('#'+id).val(value).trigger('change'),{id,value});
}
async function checkout(){
 await page.goto(origin+'/thanh-toan/?preorder_test='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
 await select('billing_ghn_province_id','220');await select('billing_ghn_district_id','1572');await select('billing_ghn_ward_code','550110');
 await page.locator('#billing_address_1').fill('1 Đường kiểm tra');
 await page.evaluate(()=>jQuery(document.body).trigger('update_checkout'));
 await page.waitForFunction(()=>!document.querySelector('form.checkout .blockUI'),{},{timeout:60000});
 await page.waitForTimeout(1500);
}
async function rows(){return page.locator('#order_review tr.shipping').evaluateAll(es=>es.map(e=>({text:e.textContent.trim(),method:e.querySelector('input.shipping_method')?.value||'',amount:Array.from(e.querySelectorAll('.amount')).map(a=>a.textContent.trim())})));}
async function cart(context){return (await context.request.get(origin+'/wp-json/wc/store/v1/cart')).json();}
await add(ctx,21035);await checkout();const baseline=await rows();
if(!baseline.length)throw Error('Shipping baseline missing');
console.log('READY_SHIPPING_BASELINE '+JSON.stringify(baseline));
await add(ctx,33570);await checkout();const mixed=await rows();
const readyRows=mixed.filter(r=>r.method!=='ml_preorder_free'),preRows=mixed.filter(r=>r.method==='ml_preorder_free');
if(preRows.length!==1||readyRows.length!==1)throw Error('Mixed shipping packages missing '+JSON.stringify(mixed));
if(JSON.stringify(readyRows[0].amount)!==JSON.stringify(baseline[0].amount))throw Error('Preorder changed ready shipping fee '+JSON.stringify({baseline,mixed}));
let mixedCart=await cart(ctx);const preLine=mixedCart.items.find(i=>i.id===33570);
if(!preLine||Number(preLine.totals.line_subtotal)!==889380||Number(preLine.totals.line_total)!==889380)throw Error('Unexpected preorder mixed-cart price');
console.log('MIXED_PREORDER_PRICE_AND_SEPARATE_SHIPPING_OK');
await page.screenshot({path:'ml-preorder-mixed-checkout.png'});
const only=await browser.newContext({viewport:{width:390,height:844}});await only.addCookies([{name:'mlpo_probe',value:nonce,domain:host,path:'/',secure:true,httpOnly:true}]);
await add(only,33570,2);const onlyCart=await cart(only);
if(Number(onlyCart.items.find(i=>i.id===33570)?.totals.line_total)!==1778760)throw Error('Preorder quantity two price');
const mobile=await only.newPage();await mobile.goto(origin+new URL(before.permalink).pathname+'?preorder_test='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
await mobile.locator('.mlpo-notice').first().waitFor({state:'visible'});
if(!await mobile.locator('.single_add_to_cart_button').first().isEnabled())throw Error('Preorder mobile purchase disabled');
await mobile.locator('.mlpo-notice').first().scrollIntoViewIfNeeded();await mobile.screenshot({path:'ml-preorder-mobile.png'});
await mobile.goto(origin+'/thanh-toan/?preorder_test='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
await mobile.locator('[data-mlpo-only="1"]').waitFor({state:'visible'});
const security=await mobile.evaluate(()=>window.wc_checkout_params?.apply_coupon_nonce);
if(!security)throw Error('Coupon nonce not available');
await only.request.post(origin+'/?wc-ajax=apply_coupon',{form:{security,coupon_code:'ml10k'}});
const noVoucher=await cart(only);if(noVoucher.coupons?.some(c=>c.code==='ml10k')||Number(noVoucher.items.find(i=>i.id===33570)?.totals.line_total)!==1778760)throw Error('Preorder voucher stacking');
console.log('PREORDER_ONLY_QUANTITY_AND_NO_VOUCHER_OK');
await page.goto(origin+'/?preorder_test='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
const quick=page.locator('a.quick-view[data-prod="33570"]').first();await quick.locator('xpath=ancestor::div[contains(@class,"box-image")]').hover();await quick.click();
await page.locator('.mfp-content .mlpo-notice').waitFor({state:'visible'});
await page.locator('.mfp-content .single_add_to_cart_button').waitFor({state:'visible'});
console.log('PREORDER_QUICK_VIEW_PURCHASE_OK');
await page.screenshot({path:'ml-preorder-quickview.png'});
await put(code);
const final=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(final.content!==code)throw Error('Final file readback mismatch');
await publicContext.request.get(origin+'/?preorder_activate='+process.env.GITHUB_RUN_ID);
const after=await (await publicContext.request.get(origin+'/wp-json/wc/store/v1/products/33570?preorder_verify='+process.env.GITHUB_RUN_ID)).json();
if(!after.is_in_stock||Number(after.prices.price)!==889380)throw Error('Public preorder activation mismatch');
console.log('MINHLONG_PREORDER_DEPLOY_OK; no production order created');
}catch(e){
console.log('PREORDER_FAILED '+String(e.message).slice(0,1000));
if(changed){await put("<?php defined('ABSPATH')||exit; add_action('init',function(){if(get_option('mlpo_cache_version')!=='disabled'){do_action('litespeed_purge_all');update_option('mlpo_cache_version','disabled',false);}});");
console.log('PREORDER_DISABLED; existing plugin files unchanged');}
process.exitCode=1;
}finally{if(browser)await browser.close();}
