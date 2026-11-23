import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {chromium} from '/tmp/qv-info/node_modules/playwright/index.mjs';
const folder='web-lock/quick-view-info/',name='store-qv-info.php';
const code=readFileSync(folder+name,'utf8'),hosts=['locknlockonline.com','minhlongonline.com'];
const css=code.match(/<<<'BN_INFO_CSS'\n([\s\S]*?)BN_INFO_CSS;/)[1];
const js=code.match(/<<<'BN_INFO_JS'\n([\s\S]*?)BN_INFO_JS;/)[1];
await mkdir('qv-info-evidence',{recursive:true});
async function verify(host,preview){
 const browser=await chromium.launch({headless:true});
 try{for(const width of [1214,390]){
 const page=await browser.newPage({viewport:{width,height:1003}});
 await page.route('**/*',route=>{
 const r=route.request(),u=new URL(r.url());
 if(u.searchParams.has('add-to-cart')||u.searchParams.has('lnl_buy'))return route.abort();
 if(!['GET','HEAD'].includes(r.method())&&!(r.postData()||'').includes('flatsome_quickview'))return route.abort();
 return route.continue();
 });
 await page.goto('https://'+host+'/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForFunction(()=>window.jQuery&&document.querySelector('a.quick-view'),null,{timeout:45000});
 if(preview){await page.addStyleTag({content:css});await page.addScriptTag({content:js});}
 else await page.locator('#bn-qv-info-script').waitFor({state:'attached'});
 const triggers=page.locator('a.quick-view');assert(await triggers.count()>1);
 for(const index of [0,1,0]){
 await triggers.nth(index).evaluate(el=>window.jQuery(el).trigger('click'));
 const popup=page.locator('.product-lightbox');await popup.waitFor({state:'visible',timeout:45000});
 await popup.locator('.bn-qv-info').waitFor();
 assert.equal(await popup.locator('.bn-qv-invoice').count(),1);
 assert.equal(await popup.locator('.bn-qv-info').count(),1);
 const result=await popup.evaluate(p=>{
 const invoice=p.querySelector('.bn-qv-invoice'),info=p.querySelector('.bn-qv-info');
 const codes=Array.from(info.querySelectorAll('code'),n=>n.textContent);
 const expected=Array.from(document.getElementById('lnl-image-vouchers-template').content.querySelectorAll('code'),n=>n.textContent);
 return {invoiceAfterPrice:invoice.previousElementSibling.classList.contains('price-wrapper'),infoAfterMeta:info.previousElementSibling.classList.contains('product_meta'),codes,expected,text:invoice.textContent};
 });
 assert(result.invoiceAfterPrice&&result.infoAfterMeta);assert.deepEqual(result.codes,result.expected);assert(result.codes.length>0);
 assert(result.codes.every(c=>c.startsWith(host.startsWith('lock')?'LNL':'ML')));
 assert(result.text.includes('Có hỗ trợ xuất hóa đơn công ty')&&result.text.includes('Tôi muốn xuất hóa đơn Công ty'));
 await popup.locator('.bn-qv-info details').evaluateAll(ds=>ds.forEach(d=>d.open=true));
 await popup.locator('.bn-qv-info').scrollIntoViewIfNeeded();
 const bounds=await popup.locator('.bn-qv-info').evaluate(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,scroll:e.scrollWidth,width:e.clientWidth}));
 assert(bounds.left>=-1&&bounds.right<=width+1&&bounds.scroll<=bounds.width+1,JSON.stringify(bounds));
 await page.screenshot({path:'qv-info-evidence/'+(preview?'preview':'live')+'-'+host+'-'+width+'-'+index+'.png'});
 console.log('INFO_CHECK',JSON.stringify({host,preview,width,index,...result}));
 await page.keyboard.press('Escape');await popup.waitFor({state:'hidden'});
 }
 await page.close();
 }}finally{await browser.close();}
}
for(const host of hosts)await verify(host,true);
