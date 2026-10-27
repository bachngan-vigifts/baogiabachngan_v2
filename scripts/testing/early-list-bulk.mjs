/** Real local CRM API, PGlite and browser. Fixtures only; no production or external Sapo requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {products,warehouses} from '../../src/modules/catalog/schema.ts';
import {incomingShipments,incomingShipmentLines} from '../../src/modules/suppliers/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),ok=(r,s=200)=>{assert.equal(r.status,s,JSON.stringify(r.data));return r.data;};
await f.db.insert(products).values([{sku:'031106000',name:'Bộ trà Jasmine Trắng Ngà (031106000)',unit:'Cái',updatedAt:new Date().toISOString()},{sku:'01654020803',name:'Hàng của phiếu NCC khác',unit:'Cái',updatedAt:new Date().toISOString()}]);
await f.db.insert(warehouses).values({id:'receive',name:'KHO NHẬN',kind:'stock'});await postMoves(f.db,'mgr',[{sku:'031106000',warehouseId:'receive',qty:1,kind:'opening',refType:'opening',refId:'opening'}]);
for(const id of ['a1','a2'])await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'NCC-A'}).where(eq(incomingShipments.id,id));
await f.db.insert(incomingShipmentLines).values({id:'outside-request',shipmentId:'a1',lineNo:99,sku:'OUTSIDE',name:'Mã ngoài phiếu xin',unit:'Cái',quantity:999});
async function make(lines,scope={},accept=false){const r=ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-10-27',scope,lines}),201);const s=ok(await f.call('/purchase-early-requests/'+r.id+'/submit',f.cookies.mgr,'POST',{revision:r.request.revision}));if(accept)for(const l of s.request.lines)for(const supplierId of new Set(l.allocations.map(a=>a.supplierId)))ok(await f.call('/purchase-early-request-lines/'+l.id+'/manager-confirm',f.cookies.mgr,'POST',{supplierId}));return r.id;}
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),writes=[],reads=[];let failCommitted=false,commitCount=0;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
 const path=u.pathname.slice('/api/staff'.length)+u.search,chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
 if(req.method==='GET')reads.push(path);else writes.push({path,body});const token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,body);
 if(failCommitted&&path.endsWith('/receipts')&&req.method==='POST'&&r.status<300&&++commitCount===2){failCommitted=false;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Mô phỏng mất phản hồi sau khi máy chủ đã lưu'}));return;}
 res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript;charset=utf-8':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/early-list-bulk';await mkdir(out,{recursive:true});const results=[];
async function session(role,width){const context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=ok(await f.call('/me',f.cookies[role])).user;await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies[role].split('=')[1],user});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};}
const rawStock=async()=>(await f.client.query("select coalesce(sum(qty),0)::float8 n from stock_moves where sku='031106000' and warehouse_id='receive'")).rows[0].n;
try{
 for(const width of [360,390,430,768,1280]){
  const ids=[await make([{sku:'031106000',quantity:4}],{supplierId:'a'}),await make([{sku:'031106000',quantity:6}],{supplierId:'a'})];
  const {context,page,errors}=await session('mgr',width);await page.goto(origin+'/#/early-requests?status=pending');
  for(const id of ids)await page.getByRole('checkbox',{name:'Chọn phiếu '+id.slice(0,8).toUpperCase(),exact:true}).check();
  const bulk=page.locator('.early-list-bulk');await bulk.getByRole('button',{name:'Xác nhận thay NCC',exact:true}).click();
  const review=page.locator('.early-bulk-confirm[open]');await review.waitFor();for(const id of ids)assert.ok((await review.innerText()).includes(id.slice(0,8).toUpperCase()));
  const before=writes.length;await review.getByRole('button',{name:'Đóng',exact:true}).click();assert.equal(writes.length,before);
  await bulk.getByRole('button',{name:'Xác nhận thay NCC',exact:true}).click();await review.getByRole('button',{name:'Xác nhận 2 phiếu',exact:true}).click();await review.waitFor({state:'detached'});await page.waitForFunction(()=>document.querySelector('.early-list-bulk')?.textContent.includes('Đã chọn 0 phiếu'));
  assert.equal(writes.length,before+1);assert.equal(writes.at(-1).path,'/purchase-early-requests/manager-confirm-batch');assert.equal(writes.at(-1).body.allocationIds.length,2);
  for(const id of ids)assert.equal(ok(await f.call('/purchase-early-requests?id='+id,f.cookies.mgr)).requests[0].status,'accepted');
  await page.goto(origin+'/#/early-requests?status=accepted');for(const id of ids)await page.getByRole('checkbox',{name:'Chọn phiếu '+id.slice(0,8).toUpperCase(),exact:true}).check();
  assert.equal(await bulk.getByRole('button',{name:'Xác nhận thay NCC',exact:true}).isDisabled(),true);await page.screenshot({path:out+'/list-'+width+'.png'});
  await bulk.getByRole('button',{name:'Nhận hàng nhanh',exact:true}).click();const modal=page.locator('.early-quick-receipt[open]');await modal.locator('[data-early-quick-quantity]').last().waitFor();assert.equal(await modal.locator('[data-early-quick-quantity]').count(),2);
  await modal.getByLabel('Kho nhận',{exact:true}).selectOption('KHO NHẬN');await modal.getByLabel('Có tạo đơn nhập Sapo không?',{exact:true}).selectOption('false');for(const q of await modal.locator('[data-early-quick-quantity]').all())await q.fill('1');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:out+'/receive-'+width+'.png'});
  const beforeStock=await rawStock(),start=writes.length;await modal.locator('form').evaluate(n=>{n.requestSubmit();n.requestSubmit();});await modal.waitFor({state:'detached'});assert.equal(await rawStock(),beforeStock+2);assert.equal(writes.length,start+2);assert.deepEqual(new Set(writes.slice(start).map(w=>w.body.earlyRequestId)),new Set(ids));
  for(const id of ids)assert.equal(ok(await f.call('/purchase-early-requests?id='+id,f.cookies.mgr)).requests[0].lines[0].allocations[0].receivedQty,1);
  // Selection must not survive filter changes or browser Back/Forward.
  await page.getByRole('checkbox',{name:'Chọn phiếu '+ids[0].slice(0,8).toUpperCase(),exact:true}).check();await page.getByRole('searchbox',{name:'Tìm phiếu lấy hàng trước'}).fill('nothing-fixture');await page.waitForFunction(()=>document.querySelector('.early-list-bulk')?.textContent.includes('Đã chọn 0 phiếu'));assert.equal(await bulk.getByRole('button',{name:'Nhận hàng nhanh',exact:true}).isDisabled(),true);
  assert.deepEqual(errors,[]);results.push({width,twoRequestsConfirmed:true,twoScopedReceipts:true,selectionCleared:true,noOverflow:true,errors});await context.close();
 }
 // Two requests share one source line: joint default and validation cap the PO balance.
 const used=Number((await f.client.query("select coalesce(sum(good_qty),0) n from supplier_receipt_lines where line_id='line-a1'")).rows[0].n);
 await f.db.update(incomingShipmentLines).set({quantity:used+100}).where(eq(incomingShipmentLines.id,'line-a1'));
 const ids=[await make([{sku:'031106000',quantity:80}],{supplierId:'a'},true),await make([{sku:'031106000',quantity:70}],{supplierId:'a'},true)],s=await session('mgr',390),{page}=s;
 await page.goto(origin+'/#/early-requests?status=accepted');for(const id of ids)await page.getByRole('checkbox',{name:'Chọn phiếu '+id.slice(0,8).toUpperCase(),exact:true}).check();await page.locator('.early-list-bulk').getByRole('button',{name:'Nhận hàng nhanh',exact:true}).click();
 const modal=page.locator('.early-quick-receipt[open]'),quantities=modal.locator('[data-early-quick-quantity]');await quantities.nth(1).waitFor();assert.equal((await quantities.evaluateAll(nodes=>nodes.map(n=>n.value))).reduce((n,v)=>n+Number(v),0),100);
 await modal.getByLabel('Kho nhận',{exact:true}).selectOption('KHO NHẬN');await modal.getByLabel('Có tạo đơn nhập Sapo không?',{exact:true}).selectOption('false');for(const q of await quantities.all())await q.fill(await q.getAttribute('max'));
 const before=writes.length;await modal.getByRole('button',{name:'Xác nhận nhận hàng',exact:true}).click();await modal.getByRole('alert').filter({hasText:'Tổng nhận các phiếu'}).waitFor();assert.equal(writes.length,before);
 await quantities.nth(0).fill('10');await quantities.nth(1).fill('20');const beforeStock=await rawStock();failCommitted=true;commitCount=0;
 await modal.getByRole('button',{name:'Xác nhận nhận hàng',exact:true}).click();await modal.getByRole('alert').filter({hasText:'Mô phỏng mất phản hồi'}).waitFor();assert.equal(await rawStock(),beforeStock+30);
 await modal.getByRole('button',{name:'Thử lại lượt nhận',exact:true}).click();await modal.waitFor({state:'detached'});assert.equal(await rawStock(),beforeStock+30);const attempts=writes.slice(before);assert.equal(attempts.length,3);assert.deepEqual(attempts[1],attempts[2]);assert.equal(attempts[0].body.earlyRequestId===attempts[1].body.earlyRequestId,false);assert.deepEqual(s.errors,[]);await s.context.close();results.push({sharedSourceCapped:true,overReceiveBlocked:true,committedTimeoutRetrySafe:true});
 // Fractional shared balances keep valid 0.001-step input defaults.
 const received=Number((await f.client.query("select coalesce(sum(good_qty),0) n from supplier_receipt_lines where line_id='line-a1'")).rows[0].n);
 const fractional=[await make([{sku:'031106000',quantity:1}],{supplierId:'a'},true),await make([{sku:'031106000',quantity:1}],{supplierId:'a'},true)],mixedPending=await make([{sku:'031106000',quantity:1}],{supplierId:'a'}),fraction=await session('mgr',390);
 await f.db.update(incomingShipmentLines).set({quantity:received+0.3}).where(eq(incomingShipmentLines.id,'line-a1'));
 await fraction.page.goto(origin+'/#/early-requests');for(const id of [...fractional,mixedPending])await fraction.page.getByRole('checkbox',{name:'Chọn phiếu '+id.slice(0,8).toUpperCase(),exact:true}).check();
 await fraction.page.locator('.early-list-bulk').getByRole('button',{name:'Nhận hàng nhanh',exact:true}).click();const fracModal=fraction.page.locator('.early-quick-receipt[open]'),fracQty=fracModal.locator('[data-early-quick-quantity]');await fracQty.nth(1).waitFor();assert.equal(await fracQty.count(),2,'pending selected request excluded from receipt');
 const values=await fracQty.evaluateAll(ns=>ns.map(n=>Number(n.value)));assert.ok(Math.abs(values.reduce((a,b)=>a+b,0)-0.3)<0.0000001);assert.ok(await fracQty.evaluateAll(ns=>ns.every(n=>n.validity.valid)));const beforeClose=writes.length;await fracModal.getByRole('button',{name:'Đóng',exact:true}).click();assert.equal(writes.length,beforeClose);await fraction.context.close();results.push({fractionalSharedDefaultsValid:true,pendingRequestExcluded:true,closeWithoutWriting:true});
 const denied=await session('emp',390);await denied.page.goto(origin+'/#/early-requests');await denied.page.locator('.early-page-card').first().waitFor();assert.equal(await denied.page.locator('.early-list-check').count(),0);assert.equal(await denied.page.locator('.early-list-bulk').isVisible(),false);await denied.context.close();results.push({unauthorizedSelectionHidden:true});
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
