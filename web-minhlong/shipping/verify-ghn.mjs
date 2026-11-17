import { chromium } from 'playwright';
const token=process.env.GHN_ML_API_TOKEN,shop=process.env.GHN_ML_SHOP_ID;
if(!token||!shop)throw Error('Missing Minh Long GHN secrets');
async function api(path,body){const r=await fetch('https://online-gateway.ghn.vn/shiip/public-api'+path,{method:body?'POST':'GET',headers:{Token:token,ShopId:shop,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||j.code!==200)throw Error('GHN HTTP '+r.status+' code '+j.code);return j.data;}
const shops=await api('/v2/shop/all?offset=0&limit=100');const own=shops.shops.find(s=>String(s._id)===shop);if(!own)throw Error('Shop not found');
console.log('GHN_SHOP_VERIFIED',JSON.stringify({district:own.district_id,ward:own.ward_code}));
for(const [region,district,ward]of [['south',1442,'20110'],['central',1526,'40113'],['north',1489,'1A0218']]){const e=await api('/v2/shipping-order/leadtime',{to_district_id:district,to_ward_code:ward,service_type_id:2});console.log('LEADTIME',JSON.stringify({region,valid:Number(e.leadtime)>Date.now()/1000,estimate:e.leadtime_order}));}
const browser=await chromium.launch();
try{
const context=await browser.newContext({viewport:{width:1360,height:1004}}),page=await context.newPage();
await page.goto('https://minhlongonline.com/?ml_preflight='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
console.log('PRODUCT_IMAGES',JSON.stringify(await page.locator('.product-small .box-image img').evaluateAll(es=>es.slice(0,5).map(e=>({src:e.currentSrc||e.src,alt:e.alt})))));
const product=page.locator('.ajax_add_to_cart[data-product_id]').first();const id=await product.getAttribute('data-product_id');if(!id)throw Error('No simple test product');
const r=await context.request.post('https://minhlongonline.com/?wc-ajax=add_to_cart',{form:{product_id:id,quantity:'1'}});if((await r.json()).error)throw Error('Isolated cart rejected');
await page.goto('https://minhlongonline.com/thanh-toan/',{waitUntil:'domcontentloaded',timeout:90000});
console.log('CHECKOUT_FIELD_IDS',JSON.stringify(await page.locator('form.checkout input,form.checkout select').evaluateAll(es=>es.map(e=>e.id).filter(Boolean))));
await context.close();
}finally{await browser.close();}
