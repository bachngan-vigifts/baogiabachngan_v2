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




const name='ml-preorder-purchase.php';
const old=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});
if(old.content!==readFileSync('web-minhlong/preorder-ui/baseline.php','utf8'))throw Error('Preorder version changed; stopped before write');
async function put(content){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),name);await api('Fileman','upload_files',f);}
let changed=false,browser;
try{
const code=readFileSync('web-minhlong/preorder/ml-preorder-purchase.php','utf8');await put(code);changed=true;
const check=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(check.content!==code)throw Error('Readback mismatch');
browser=await chromium.launch();const ctx=await browser.newContext(),page=await ctx.newPage();
async function checkButtons(scope){
await scope.locator('.mlpo-order-button').waitFor({state:'visible'});
const result=await scope.evaluate(e=>({buttons:Array.from(e.querySelectorAll('a,button')).filter(b=>b.getBoundingClientRect().width&&b.getBoundingClientRect().height).map(b=>b.textContent.trim().replace(/\s+/g,' ')),primary:e.querySelector('.single_add_to_cart_button')?.textContent.trim()}));
if(result.primary!=='ĐẶT TRƯỚC'||result.buttons.some(t=>/^(MUA NGAY|ĐẶT TRƯỚC NGAY|YÊU CẦU ĐẶT TRƯỚC)$/i.test(t)))throw Error('Preorder actions incorrect '+JSON.stringify(result));
}
for(const width of [1484,390]){
await page.setViewportSize({width,height:1004});
await page.goto(origin+'/san-pham/tuong-thinh-vu-lan-minh-long-12cm-trang-441299tbv/?preorder_ui='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
await checkButtons(page.locator('.product-main .product-info').first());
await page.locator('.mlpo-order-button').first().scrollIntoViewIfNeeded();await page.screenshot({path:'ml-preorder-one-button-'+width+'.png'});
console.log('PRODUCT_ONE_PREORDER_BUTTON_OK width='+width);
}
await page.setViewportSize({width:1484,height:1004});
await page.goto(origin+'/?preorder_ui='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
await page.waitForTimeout(5000);
for(let i=0;i<3&&await page.locator('.mfp-close:visible').count();i++){await page.locator('.mfp-close:visible').last().click();await page.waitForTimeout(300);}
const card=page.locator('.product-small').filter({has:page.locator('[data-mlpo-product="33570"]')}).first();
const labels=await card.evaluate(e=>Array.from(e.querySelectorAll('a.button,button')).filter(b=>b.getBoundingClientRect().width&&b.getBoundingClientRect().height).map(b=>b.textContent.trim()));
if(labels.filter(t=>t==='ĐẶT TRƯỚC').length!==1||labels.some(t=>/MUA NGAY|ĐẶT TRƯỚC NGAY/.test(t)))throw Error('Loop actions incorrect '+JSON.stringify(labels));
console.log('LOOP_ONE_PREORDER_BUTTON_OK');
const quick=card.locator('a.quick-view');await card.locator('.box-image').hover();await quick.click();
await checkButtons(page.locator('.mfp-content .product-info').first());
await page.locator('.mfp-content .mlpo-order-button').click({trial:true});await page.screenshot({path:'ml-preorder-one-button-popup.png'});
await page.locator('.mfp-content .mlpo-order-button').click();
let added=false;for(let i=0;i<20;i++){const cart=await (await ctx.request.get(origin+'/wp-json/wc/store/v1/cart')).json();if(cart.items?.some(x=>x.id===33570&&Number(x.totals.line_total)===889380)){added=true;break;}await page.waitForTimeout(1000);}
if(!added)throw Error('Preorder button did not add correct item');
console.log('PREORDER_BUTTON_ADDS_TO_CART_OK');
await page.goto(origin+'/san-pham/bo-do-an-9-san-pham-jasmine-trang/?preorder_ui='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
const regularBuy=page.locator('.product-main #buy_now_button,.product-main .ux-buy-now-button').first();await regularBuy.waitFor({state:'visible'});
console.log('IN_STOCK_BUY_NOW_UNCHANGED_OK');
console.log('PREORDER_SINGLE_BUTTON_DEPLOY_OK');
}catch(e){console.log('PREORDER_UI_FAILED '+String(e.message).slice(0,800));if(changed){await put(old.content);console.log('PREORDER_PREVIOUS_RESTORED');}process.exitCode=1;}finally{if(browser)await browser.close();}
