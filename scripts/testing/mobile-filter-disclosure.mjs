/** Exercise the real quote toolbar and a SePay allocation form without a production API. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ui=new URL('../../trial-ui/',import.meta.url);
const html=await readFile(new URL('index.html',ui),'utf8');
const quotes=html.split('id="view-quotes" hidden>')[1].split('</section>')[0];
const fixture=`<link rel="stylesheet" href="/mobile-design.css"><main id="workspace">
<section class="view" id="view-quotes">${quotes}</section>
<section class="view"><form class="sa-search"><label>Tìm<input name="q"></label>
<label>Loại đơn<select><option>GHN</option></select></label><button>Tìm chứng từ</button></form></section>
</main><script type="module" src="/mobile-actions-init.js"></script>`;
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname.slice(1);
 if(!path){res.setHeader('content-type','text/html');return res.end(fixture);}
 if(!/^[\w.-]+\.(js|css)$/.test(path))return res.writeHead(404).end();
 try{res.setHeader('content-type',path.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(new URL(path,ui)));}
 catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
try {
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:800}});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const advanced=page.locator('#quote-from'),source=page.locator('.sa-search select');
  const toggle=page.locator('.crm-inline-filter-toggle'),mobile=width<=850;
  if(mobile)await toggle.waitFor();
  for(const field of [advanced,source,page.locator('#type-filter')])assert.equal(await field.isVisible(),!mobile);
  assert(await page.locator('#quote-search').isVisible());
  const search=page.locator('.sa-search input');await search.fill('BG-123');
  if(mobile){
   await toggle.focus();await page.keyboard.press('Enter');assert(await source.isVisible());
   await toggle.click();assert.equal(await source.isVisible(),false);assert.equal(await search.inputValue(),'BG-123');
   await page.locator('.crm-filter-trigger').click();assert(await advanced.isVisible());
   assert(await page.locator('#type-filter').isVisible());
  }
  await page.close();console.log('PASS',width);
 }
}finally{await browser.close();server.close();}
