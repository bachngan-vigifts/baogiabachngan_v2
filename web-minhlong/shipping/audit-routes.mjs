import {chromium} from 'playwright';
const token=process.env.GHN_ML_API_TOKEN,shop=process.env.GHN_ML_SHOP_ID;
if(!token||!shop)throw Error('Missing GHN config');
async function api(path,payload){const r=await fetch('https://online-gateway.ghn.vn/shiip/public-api'+path,{method:payload?'POST':'GET',headers:{Token:token,ShopId:shop,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});const j=await r.json();if(!r.ok||j.code!==200)throw Error('GHN request failed');return j.data;}
const districts=await api('/master-data/district');
const specs=[['Can Tho',1572,'550110'],['HCM',1442,'20110'],['Da Nang',1526,'40113'],['Ha Noi',1489,'1A0218']];
const browser=await chromium.launch();
try{
const ctx=await browser.newContext(),page=await ctx.newPage();
await page.goto('https://minhlongonline.com/?eta_audit='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
const id=await page.locator('.ajax_add_to_cart[data-product_id]').first().getAttribute('data-product_id');
const added=await ctx.request.post('https://minhlongonline.com/?wc-ajax=add_to_cart',{form:{product_id:id,quantity:'1'}});if((await added.json()).error)throw Error('Cart failed');
await page.goto('https://minhlongonline.com/thanh-toan/',{waitUntil:'domcontentloaded',timeout:90000});
await page.locator('#ml-shipping-eta').waitFor({state:'attached'});
page.on('response',async r=>{if(r.url().includes('/ml-shipping/v1/eta')){try{const b=await r.json();console.log('WEB_ETA_RESPONSE',JSON.stringify({status:r.status(),from:b.from,to:b.to}));}catch{}}});
async function select(id,value){value=String(value);await page.waitForFunction(({id,value})=>Array.from(document.getElementById(id)?.options||[]).some(o=>o.value===value),{id,value});await page.evaluate(({id,value})=>jQuery(document.getElementById(id)).val(value).trigger('change'),{id,value});}
for(const [region,district,ward]of specs){
const province=districts.find(d=>d.DistrictID===district)?.ProvinceID;if(!province)throw Error('Province not found');
const direct=await api('/v2/shipping-order/leadtime',{to_district_id:district,to_ward_code:ward,service_type_id:2});
await select('billing_ghn_province_id',province);
await page.waitForTimeout(1000);
console.log('AFTER_PROVINCE',JSON.stringify({region,...await page.evaluate(()=>({district:document.querySelector('#billing_ghn_district_id').value,ward:document.querySelector('#billing_ghn_ward_code').value,hidden:document.querySelector('#ml-shipping-eta').hidden,text:document.querySelector('.ml-eta-result').textContent}))}));
await select('billing_ghn_district_id',district);await select('billing_ghn_ward_code',ward);
await page.waitForFunction(()=>!document.querySelector('#ml-shipping-eta').hidden&&document.querySelector('.ml-eta-result').textContent.includes('Dự kiến:'),{},{timeout:45000});await page.waitForTimeout(1500);
console.log('COMPARISON',JSON.stringify({region,province,district,ward,ghn:direct.leadtime_order,web:await page.locator('.ml-eta-result').textContent()}));
}
await ctx.close();
}finally{await browser.close();}
