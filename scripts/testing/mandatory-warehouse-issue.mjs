/** Real Chromium DOM/mobile regression using the actual packing renderer and handlers; all APIs mocked. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const source=await readFile(new URL('../../trial-ui/app.js',import.meta.url),'utf8');
const renderer=source.slice(source.indexOf('const slipPhotos = []'),source.indexOf('/** Kho dự kiến xuất của đơn CRM'));
assert.ok(renderer.includes('async function openPacking'));
const html=`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<div id="packing-title"></div><div id="breadcrumb"></div><div id="packing-status"></div><a id="packing-back"></a><div id="packing-actions"></div><main id="packing-body"></main>
<script>
const $=s=>document.querySelector(s),$$=(s,root=document)=>[...root.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PACK_STATUS={},pill=()=>'',kg=String,fmtNum=String,fmtDate=String,duePill=String;
const orderReference=o=>({label:'Đơn',number:o.orderNo}),docHref=()=>'',isWarehouse=()=>true,KHO_HOME='#/packing';
const toast=()=>{},tasksView=()=>({badge(){}});
window.posts=[];let done=false;
const api=async(path,method,body)=>{
 if(path==='/stock-warehouses')return {warehouses:[{id:'vig',name:'KHO VIGIFTS'},{id:'other',name:'Kho khác'}]};
 if(method==='POST'){posts.push({path,body:structuredClone(body)});done=true;return {ok:true};}
 if(path==='/packing/mock')return {slip:{id:'mock',slipNo:'DG_TEST',source:new URLSearchParams(location.search).get('source'),sourceLabel:'Nguồn bổ sung',status:done?'packed':'sent',totalQty:29},
  order:{id:'order',orderNo:'DH_TEST',customerName:'Khách thử'},lines:[{name:'Bộ trà',sku:'00123',qty:29,unit:'Bộ'}],photos:[],canConfirm:!done};
 throw Error('Unexpected mock API: '+path);
};
${renderer}
window.addTestPhoto=()=>{slipPhotos.push('data:image/jpeg;base64,'+'A'.repeat(200));drawSlipPhotos();};
location.hash='#/packing/mock';openPacking('mock').then(()=>window.ready=true);
</script>`;
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 for(const width of [390,1280])for(const source of ['warehouse','supplier','agent','store','other']){
  const context=await browser.newContext({viewport:{width,height:844}});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?source='+source);await page.waitForFunction(()=>window.ready);
  await page.locator('.pick-tick').check();await page.evaluate(()=>window.addTestPhoto());
  assert.equal(await page.locator('#slip-confirm-wh').count(),1,source);
  assert.equal(await page.locator('#slip-confirm').isDisabled(),true,'photo/ticks alone cannot bypass warehouse');
  await page.locator('#slip-confirm-wh').selectOption('vig');
  assert.equal(await page.locator('#slip-confirm').isEnabled(),true);assert.match(await page.locator('#slip-confirm').textContent(),/Đã xuất kho/);
  await page.locator('#slip-confirm').click();await page.waitForFunction(()=>window.posts.length===1);
  const [post]=await page.evaluate(()=>window.posts);assert.equal(post.path,'/packing/mock/confirm');assert.equal(post.body.warehouseId,'vig');assert.equal(post.body.photos.length,1);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,source,warehouseRequired:true,confirmWarehouse:post.body.warehouseId}));
  await context.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
