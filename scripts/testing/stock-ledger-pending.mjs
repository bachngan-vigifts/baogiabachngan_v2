/** Local fixture only: pending quantities, export and unavailable-state UI; no production calls. */
import {createServer} from 'node:http';import {readFile,mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const out=process.env.STOCK_PENDING_ARTIFACT_DIR||'/tmp/stock-pending-browser';await mkdir(out,{recursive:true});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript;charset=utf-8':p.endsWith('.css')?'text/css;charset=utf-8':'text/html;charset=utf-8');res.end(p==='/'?'<!doctype html><html lang="vi"><head><meta charset="utf-8"></head><body><main style="padding:16px"></main></body></html>':await readFile(root+p));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1000},timezoneId:'Asia/Ho_Chi_Minh'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 for(const f of ['style.css','typography.css','mobile-design.css'])await page.addStyleTag({url:origin+'/'+f});
 await page.evaluate(async()=>{
  const {initStockMoves}=await import('/stock-ops.js');globalThis.toasts=[];globalThis.failPending=false;
  globalThis.XLSX={utils:{book_new:()=>({}),aoa_to_sheet:rows=>{globalThis.exportRows=rows;return {};},book_append_sheet(){},encode_col:()=> 'U'},writeFile:()=>{globalThis.exportDone=true;}};
  const api=async path=>({warehouses:[{id:'w',name:'KHO MINH HỌA'}],brands:[],page:1,size:20,total:2,totals:{inQty:50,outQty:10},pendingAvailable:!failPending,pendingAsOf:'2026-11-14T05:00:00Z',moves:[0,1].map((n)=>({id:'m'+n,at:'2026-11-01T01:00:00Z',sku:'SP-THU',name:'Sản phẩm minh họa',warehouse:'KHO MINH HỌA',warehouseId:'w',inQty:n?50:0,outQty:n?0:10,balanceAfter:n?50:40,active:true,description:n?'Nhập đầu kỳ':'Đóng gói xuất kho',refNo:'DG-THU',brand:'',unit:'Cái',pendingQty:failPending?null:12,pending:{packed:6,returning:4,held:2,unassignedHeld:3,uncertain:!!n}}))});
  const createPager=()=>({page:1,limit:20,offset:0,reset(){},render(){}});
  globalThis.stockUi=initStockMoves({api,root:document.querySelector('main'),createPager,toast:m=>toasts.push(m)});await stockUi.show('from=2026-10-16&to=2026-11-14');
 });
 await page.locator('.ledger-pending-detail').first().waitFor();assert.equal(await page.getByRole('columnheader',{name:'Hàng đang treo (hiện tại)',includeHidden:true}).count(),1);
 await page.locator('.ledger-pending-detail summary').first().click();assert.match(await page.locator('.ledger-pending-detail').first().innerText(),/Chờ giao: 6/);assert.match(await page.locator('.ledger-pending-detail').first().innerText(),/Hoàn chờ nhận: 4/);assert.match(await page.locator('.ledger-pending-detail').first().innerText(),/Tạm giữ: 2/);assert.match(await page.locator('.ledger-pending-detail').first().innerText(),/Giữ chưa gắn kho: 3/);
 assert.match(await page.locator('.ledger-pending-detail summary').nth(1).innerText(),/12 \+ \?/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('button',{name:/Xuất file/}).click();await page.waitForFunction(()=>exportDone);
 const exported=await page.evaluate(()=>exportRows);assert.equal(exported[0].length,exported[1].length);assert.equal(exported[1][11],12);assert.deepEqual(exported[1].slice(12,16),[6,4,2,3]);assert.equal(exported[2][16],'Có');
 await page.screenshot({path:out+'/ledger-'+width+'.png',fullPage:true});
 await page.evaluate(async()=>{failPending=true;exportDone=false;await stockUi.show('from=2026-10-16&to=2026-11-14');});await page.waitForFunction(()=>document.querySelector('.ledger-pending-stamp').textContent.startsWith('Chưa tải'));
 assert.equal(await page.locator('td.ledger-pending').first().innerText().then(t=>t.trim()),'—');assert.equal(await page.locator('.ledger-balance').first().innerText(),'40');await page.getByRole('button',{name:/Xuất file/}).click();await page.waitForFunction(()=>exportDone);const failed=await page.evaluate(()=>exportRows);assert.deepEqual(failed[1].slice(11,16),[null,null,null,null,null]);assert.equal(failed[1][16],'Chưa tải được');
 assert.deepEqual(errors,[]);console.log('PASS '+width+'px: pending breakdown, unknown marker, unassigned holds, Excel columns, no overflow, failure preserves balances');await page.close();
}}finally{await browser.close();server.close();}
