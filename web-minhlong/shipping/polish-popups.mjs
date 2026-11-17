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
const old=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});
if(old.content!==readFileSync('web-minhlong/shipping/popup-baseline.php','utf8'))throw Error('Unexpected popup version');
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
const good=await button.evaluate(e=>{const r=e.getBoundingClientRect(),b=e.closest('.box-image').getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {xError:Math.abs((r.x+r.width/2)-(b.x+b.width/2)),centerError:Math.abs((r.y+r.height/2)-(b.y+b.height/2)),clickable:hit===e||e.contains(hit)};});
if(good.xError>3||good.centerError>3||!good.clickable)throw Error('Quick view not centered/clickable '+JSON.stringify(good));
console.log('QUICK_VIEW_CENTERED_OK width='+width);
await page.screenshot({path:'ml-quickview-'+width+'.png'});
await button.click();await page.locator('.mfp-content .product').first().waitFor({state:'visible',timeout:30000});console.log('QUICK_VIEW_OPENS_OK width='+width);
await page.locator('.mfp-content .ml-popup-buy-now').waitFor();
if(await page.locator('.mfp-content .ml-popup-cart-icon[aria-label="Thêm vào giỏ hàng"]').count()!==1)throw Error('Cart icon missing');
console.log('QUICK_VIEW_ACTIONS_OK width='+width);
const form=page.locator('.mfp-content .product form.cart');
const selects=form.locator('select[name^="attribute_"]');
if(width===1484&&await selects.count()){
const variation=form.locator('[name=variation_id]');
if(!Number(await variation.inputValue())){
await form.locator('.ml-popup-buy-now').click();
await form.locator('.ml-popup-validation').waitFor({state:'visible'});
console.log('QUICK_VIEW_VARIATION_REQUIRED_OK');
}
for(let i=0;i<await selects.count();i++){
const select=selects.nth(i),value=await select.locator('option').evaluateAll(es=>es.find(e=>e.value&&!e.disabled)?.value);
if(value)await select.selectOption(value);
}
await page.waitForFunction(()=>Number(document.querySelector('.mfp-content [name=variation_id]')?.value)>0,{},{timeout:20000});
const chosen=await variation.inputValue();
await form.locator('input[name=quantity]').fill('2');
await Promise.all([page.waitForURL('**/thanh-toan/**',{timeout:60000}),form.locator('.ml-popup-buy-now').click()]);
await page.locator('#order_review').waitFor({state:'visible'});
const checkout=await page.locator('#order_review').innerText();
if(!checkout.trim())throw Error('Empty checkout after Buy Now');
console.log('QUICK_VIEW_BUY_NOW_CHECKOUT_OK variation='+chosen+' quantity=2; no order submitted');
continue;
}
await page.keyboard.press('Escape');
}

for(const width of [1484,390]){
await page.setViewportSize({width,height:1004});
await page.goto(origin+'/san-pham/bo-do-an-9-san-pham-jasmine-trang/?popup_check='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
await page.locator('.ml-review-wishlist-row .woosw-btn').waitFor();
const detail=await page.evaluate(()=>{
const row=document.querySelector('.ml-review-wishlist-row'),a=row.querySelector('.woocommerce-product-rating').getBoundingClientRect(),b=row.querySelector('.woosw-btn').getBoundingClientRect(),meta=document.querySelector('.ml-sku-category-row');
return {sameRow:Math.abs((a.y+a.height/2)-(b.y+b.height/2))<3,right:b.x>=a.right-2,label:row.querySelector('.woosw-btn-text').textContent,meta:!!meta,overflow:meta?meta.scrollWidth>meta.clientWidth+1:true,font:meta?getComputedStyle(meta).fontSize:''};
});
if(!detail.sameRow||!detail.right||detail.label!=='Yêu thích'||!detail.meta||detail.overflow)throw Error('Product detail layout '+JSON.stringify(detail));
console.log('PRODUCT_DETAILS_OK width='+width+' '+JSON.stringify(detail));
await page.screenshot({path:'ml-detail-'+width+'.png'});
const wish=page.locator('.ml-review-wishlist-row .woosw-btn');await wish.click();
await page.locator('.woosw-popup.woosw-show .woosw-item').first().waitFor({timeout:30000});
const layout=await page.locator('.woosw-popup.woosw-show').evaluate(e=>{const c=e.querySelector('.woosw-popup-content');return {overflow:c.scrollWidth>c.clientWidth+1,buttons:Array.from(e.querySelectorAll('.woosw-item--atc .button')).map(b=>({text:b.textContent.trim(),width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,white:getComputedStyle(b).whiteSpace,y:b.getBoundingClientRect().y}))};});
if(layout.overflow||layout.buttons.some(b=>b.white!=='nowrap')||(layout.buttons.length>1&&Math.abs(layout.buttons[0].y-layout.buttons[1].y)>4))throw Error('Wishlist layout '+JSON.stringify(layout));
console.log('WISHLIST_LAYOUT_OK width='+width+' '+JSON.stringify(layout));
await page.screenshot({path:'ml-wishlist-'+width+'.png'});
await page.evaluate(()=>document.querySelector('.woosw-popup.woosw-show .woosw-popup-close')?.click());
}
console.log('QUICK_VIEW_DEPLOY_OK');
}catch(e){console.log('QUICK_VIEW_FAILED '+String(e.message).slice(0,300));if(changed){await put(old.content);console.log('POPUP_PREVIOUS_RESTORED');}process.exitCode=1;}finally{if(browser)await browser.close();}
