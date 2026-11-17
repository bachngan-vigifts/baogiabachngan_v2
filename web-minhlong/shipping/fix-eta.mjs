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

const name='ml-shipping-information.php';
const esc=s=>s.replaceAll('\\','\\\\').replaceAll("'","\\'");
const provision=s=>s.replace('__ML_GHN_TOKEN__',esc(gh)).replace('__ML_GHN_SHOP_ID__',shop);
const previous=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});
const expected=provision(readFileSync('web-minhlong/shipping/eta-baseline.php','utf8'));
if(previous.content!==expected)throw Error('Unexpected current version; stop before write');
const code=provision(readFileSync('web-minhlong/shipping/ml-shipping-information.php','utf8'));
async function put(content){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),name);await api('Fileman','upload_files',f);}
let changed=false,browser;
try{
 await put(code);changed=true;
 const verify=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(verify.content!==code)throw Error('Readback mismatch');
 browser=await chromium.launch();
 for(const width of [1360,390]){
 const ctx=await browser.newContext({viewport:{width,height:1004}}),page=await ctx.newPage();
 await page.goto(origin+'/?eta_test='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
 const id=await page.locator('.ajax_add_to_cart[data-product_id]').first().getAttribute('data-product_id');
 const cart=await ctx.request.post(origin+'/?wc-ajax=add_to_cart',{form:{product_id:id,quantity:'1'}});if((await cart.json()).error)throw Error('Isolated cart failed');
 await page.goto(origin+'/thanh-toan/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('#ml-shipping-eta').waitFor({state:'attached'});
 async function select(id,value){
 await page.waitForFunction(({id,value})=>Array.from(document.getElementById(id)?.options||[]).some(o=>o.value===value),{id,value});
 // Same jQuery change path as Select2, deliberately no native dispatch.
 await page.evaluate(({id,value})=>window.jQuery(document.getElementById(id)).val(value).trigger('change'),{id,value});
 }
 await select('billing_ghn_province_id','220');
 await select('billing_ghn_district_id','1572');
 await select('billing_ghn_ward_code','550110');
 await page.waitForFunction(()=>!document.getElementById('ml-shipping-eta').hidden&&document.querySelector('.ml-eta-result').textContent.includes('Dự kiến:'),{},{timeout:45000});
 console.log('ETA_SELECT2_WITHOUT_STREET_OK width='+width);
 await page.evaluate(()=>window.jQuery('#billing_ghn_ward_code').val('').trigger('change'));
 await page.waitForFunction(()=>document.getElementById('ml-shipping-eta').hidden);
 await select('billing_ghn_ward_code','550110');
 await page.waitForFunction(()=>!document.getElementById('ml-shipping-eta').hidden&&document.querySelector('.ml-eta-result').textContent.includes('Dự kiến:'));
 console.log('ETA_CLEAR_RESELECT_OK width='+width);
 await page.locator('#billing_address_1').fill('1 Đường kiểm tra');
 await page.locator('#ml-shipping-eta').scrollIntoViewIfNeeded();
 await page.screenshot({path:'eta-fixed-'+width+'.png'});
 await page.locator('#ship-to-different-address-checkbox').check();
 await select('shipping_ghn_province_id','220');await select('shipping_ghn_district_id','1572');await select('shipping_ghn_ward_code','550110');
 await page.waitForFunction(()=>document.querySelector('.woocommerce-shipping-fields__field-wrapper #ml-shipping-eta')&&!document.getElementById('ml-shipping-eta').hidden);
 console.log('ETA_SEPARATE_SHIPPING_OK width='+width);
 await ctx.close();
 }
 console.log('MINHLONG_ETA_FIX_OK');
}catch(e){console.log('ETA_FIX_FAILED '+String(e.message).slice(0,200));if(changed){await put(previous.content);console.log('PREVIOUS_VERSION_RESTORED');}process.exitCode=1;}
finally{if(browser)await browser.close();}
