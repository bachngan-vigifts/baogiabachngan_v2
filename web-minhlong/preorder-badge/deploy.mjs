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
if(old.content!==readFileSync('web-minhlong/preorder-badge/baseline.php','utf8'))throw Error('Preorder version changed; stopped before write');
async function put(content){const f=new FormData();f.set('dir',dir);f.set('overwrite','1');f.set('file-1',new Blob([content]),name);await api('Fileman','upload_files',f);}
let changed=false,browser;
try{
const code=readFileSync('web-minhlong/preorder/ml-preorder-purchase.php','utf8');await put(code);changed=true;
const check=await api('Fileman','get_file_content',{dir,file:name,from_charset:'utf-8',to_charset:'utf-8',update_html_document_encoding:0});if(check.content!==code)throw Error('Readback mismatch');

browser=await chromium.launch();const ctx=await browser.newContext(),page=await ctx.newPage();
async function checkBadge(locator){
await locator.waitFor({state:'visible'});
const result=await locator.evaluate(e=>{const b=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return {label:e.textContent,count:e.parentElement.querySelectorAll(':scope > .mlpo-preorder-badge').length,inside:b.left>=p.left&&b.top>=p.top&&b.right<=p.right&&b.bottom<=p.bottom,pointer:getComputedStyle(e).pointerEvents};});
if(result.label!=='ĐẶT TRƯỚC'||result.count!==1||!result.inside||result.pointer!=='none')throw Error('Badge layout '+JSON.stringify(result));
}
for(const width of [1484,390]){
await page.setViewportSize({width,height:1004});
await page.goto(origin+'/san-pham/tuong-thinh-vu-lan-minh-long-12cm-trang-441299tbv/?preorder_badge='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
const badge=page.locator('.product-main .mlpo-preorder-badge').first();await checkBadge(badge);await badge.scrollIntoViewIfNeeded();
await page.screenshot({path:'ml-preorder-badge-product-'+width+'.png'});
console.log('PRODUCT_PREORDER_BADGE_OK width='+width);
await page.goto(origin+'/?preorder_badge='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
await page.waitForTimeout(5000);
for(let i=0;i<3&&await page.locator('.mfp-close:visible').count();i++){await page.locator('.mfp-close:visible').last().click();await page.waitForTimeout(300);}
const card=page.locator('.product-small').filter({has:page.locator('[data-mlpo-product="33570"]')}).first();
await card.scrollIntoViewIfNeeded();await checkBadge(card.locator('.mlpo-preorder-badge'));
await page.screenshot({path:'ml-preorder-badge-list-'+width+'.png'});
console.log('LOOP_PREORDER_BADGE_OK width='+width);
if(width===1484){
await card.locator('.box-image').hover();await card.locator('a.quick-view').click();
await checkBadge(page.locator('.mfp-content .mlpo-preorder-badge').first());
await page.screenshot({path:'ml-preorder-badge-quickview.png'});
console.log('QUICKVIEW_PREORDER_BADGE_OK');
await page.keyboard.press('Escape');
}
}
await page.goto(origin+'/san-pham/bo-do-an-9-san-pham-jasmine-trang/?preorder_badge='+process.env.GITHUB_RUN_ID,{waitUntil:'domcontentloaded',timeout:90000});
if(await page.locator('.product-main .product-gallery .mlpo-preorder-badge').count())throw Error('Badge on ordinary in-stock product');
console.log('NORMAL_PRODUCT_NO_PREORDER_BADGE_OK');
console.log('PREORDER_BADGE_DEPLOY_OK');

}catch(e){console.log('PREORDER_UI_FAILED '+String(e.message).slice(0,800));if(changed){await put(old.content);console.log('PREORDER_PREVIOUS_RESTORED');}process.exitCode=1;}finally{if(browser)await browser.close();}
