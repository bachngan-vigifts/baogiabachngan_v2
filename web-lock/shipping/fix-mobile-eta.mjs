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



 const probe=createHash('sha256').update(token+':lnl-shipping-v1').digest('hex');
 const previous=await api('get_file_content',{dir,file:pluginName,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});
 const expected=readFileSync('web-lock/shipping/mobile-eta-baseline.php','utf8').replace('__LNL_SHIPPING_PROBE__',probe);
 if(previous.content!==expected)throw Error('unexpected_existing_version; stopped before write');
 const code=readFileSync('web-lock/shipping/lnl-shipping-information.php','utf8').replace('__LNL_SHIPPING_PROBE__',probe);
 rollback=()=>upload(dir,pluginName,previous.content);
 stage='install';await upload(dir,pluginName,code);activated=true;
 const checked=await api('get_file_content',{dir,file:pluginName,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(checked.content!==code)throw Error('readback');
 browser=await chromium.launch();
 for(const width of [390,430,1360]){
 const ctx=await browser.newContext({viewport:{width,height:932}}),page=await ctx.newPage();
 await page.goto('https://locknlockonline.com/?eta_mobile_test='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
 const id=await page.locator('.ajax_add_to_cart[data-product_id]').first().getAttribute('data-product_id');
 const added=await ctx.request.post('https://locknlockonline.com/?wc-ajax=add_to_cart',{form:{product_id:id,quantity:'1'}});if((await added.json()).error)throw Error('guest cart');
 await page.goto('https://locknlockonline.com/thanh-toan/?eta_mobile_test='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('#lnl-shipping-eta').waitFor({state:'attached'});
 await page.locator('#billing_address_1').fill('');
 let responseData;
 page.on('response',async r=>{if(r.url().includes('/lnl-shipping/v1/eta')&&r.ok()){try{responseData=await r.json();}catch{}}});
 async function select(id,value){
 await page.waitForFunction(({id,value})=>Array.from(document.getElementById(id)?.options||[]).some(o=>o.value===value),{id,value});
 await page.evaluate(({id,value})=>jQuery('#'+id).val(value).trigger('change'),{id,value});
 }
 await select('billing_ghn_province_id','220');await select('billing_ghn_district_id','1572');await select('billing_ghn_ward_code','550111');
 await page.waitForFunction(()=>!document.getElementById('lnl-shipping-eta').hidden&&document.querySelector('.lnl-eta-result')?.textContent.includes('Dự kiến:'),{},{timeout:45000});
 let result=await page.locator('.lnl-eta-result').innerText();
 if(!responseData||!result.includes(responseData.to))throw Error('ETA not matched to endpoint response');
 console.log('MOBILE_SELECT2_ETA_WITHOUT_STREET_OK width='+width+' result='+result);
 await page.evaluate(()=>jQuery('#billing_ghn_ward_code').val('').trigger('change'));
 await page.waitForFunction(()=>document.getElementById('lnl-shipping-eta').hidden);
 await select('billing_ghn_ward_code','550111');
 await page.waitForFunction(()=>!document.getElementById('lnl-shipping-eta').hidden&&document.querySelector('.lnl-eta-result').textContent.includes('Dự kiến:'));
 console.log('CLEAR_RESELECT_ETA_OK width='+width);
 responseData=null;
 await select('billing_ghn_province_id','201');await select('billing_ghn_district_id','1489');
 const changedResponse=page.waitForResponse(r=>{if(!r.url().includes('/lnl-shipping/v1/eta')||!r.ok())return false;try{const b=r.request().postDataJSON();return Number(b.district)===1489&&b.ward==='1A0218';}catch{return false;}},{timeout:45000});
 await select('billing_ghn_ward_code','1A0218');
 const expectedRoute=await (await changedResponse).json();
 await page.waitForFunction(data=>{const text=document.querySelector('.lnl-eta-result')?.textContent;return text===(data.from===data.to?'Dự kiến: '+data.to:'Dự kiến: '+data.from+' – '+data.to);},expectedRoute,{timeout:15000});
 responseData=expectedRoute;
 await page.waitForFunction(()=>!document.getElementById('lnl-shipping-eta').hidden&&document.querySelector('.lnl-eta-result').textContent.includes('Dự kiến:'),{},{timeout:45000});
 result=await page.locator('.lnl-eta-result').innerText();
 if(!responseData||!result.includes(responseData.to))throw Error('Changed destination ETA stale');
 console.log('DESTINATION_ETA_MATCH_OK width='+width+' result='+result);
 await page.locator('#lnl-shipping-eta').scrollIntoViewIfNeeded();
 const fits=await page.locator('#lnl-shipping-eta').evaluate(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1;});if(!fits)throw Error('ETA panel overflow');
 await page.screenshot({path:'lock-mobile-eta-'+width+'.png'});
 await page.locator('#ship-to-different-address-checkbox').check();
 await select('shipping_ghn_province_id','220');await select('shipping_ghn_district_id','1572');await select('shipping_ghn_ward_code','550111');
 await page.waitForFunction(()=>document.querySelector('.woocommerce-shipping-fields__field-wrapper #lnl-shipping-eta')&&!document.getElementById('lnl-shipping-eta').hidden&&document.querySelector('.lnl-eta-result').textContent.includes('Dự kiến:'));
 console.log('SEPARATE_ADDRESS_ETA_OK width='+width);
 await ctx.close();
 }
 console.log('LOCK_MOBILE_ETA_DEPLOY_OK');
}catch(error){
 console.log('FAILED_STAGE='+stage+' ERROR='+String(error.message).slice(0,800));
 if(activated&&rollback){await rollback();console.log('LOCK_ETA_PREVIOUS_RESTORED');}
 process.exitCode=1;
}finally{if(browser)await browser.close();}
