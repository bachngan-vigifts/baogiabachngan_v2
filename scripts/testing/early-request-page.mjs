/** Local real router/PGlite. No production records, mail, Sapo or inventory receipts. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {eq} from 'drizzle-orm';
import {products} from '../../src/modules/catalog/schema.ts';
import {incomingShipments,incomingShipmentLines} from '../../src/modules/suppliers/schema.ts';
import {purchaseEarlyRequests,purchaseEarlyRequestLines,purchaseEarlyRequestAllocations} from '../../src/modules/suppliers/early-request-schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const headers=[],lines=[],allocations=[];for(let i=0;i<22;i++){const id='browser-'+String(i).padStart(3,'0');headers.push({id,clientKey:id,payloadHash:'fixture',createdBy:'mgr',createdAt:'2026-10-26T00:00:00Z',pickupDate:'2026-10-26',status:i===0?'draft':'submitted'});lines.push({id:id+'-line',requestId:id,lineNo:1,sku:'031106000',name:'Ly kiểm thử',unit:'Cái',quantity:1});allocations.push({id:id+'-a',requestLineId:id+'-line',purchaseLineId:'line-a1',supplierId:'a',quantity:1,status:'pending'});}
await f.db.insert(purchaseEarlyRequests).values(headers);await f.db.insert(purchaseEarlyRequestLines).values(lines);await f.db.insert(purchaseEarlyRequestAllocations).values(allocations);
const users={};for(const role of ['mgr','emp'])users[role]=(await f.call('/me',f.cookies[role])).data.user;
let failReads=0;const writes=[];
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),path=u.pathname;
 if(path.startsWith('/api/staff/')){let body;const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length)body=JSON.parse(Buffer.concat(chunks).toString());
 if(req.method==='GET'&&path==='/api/staff/purchase-early-requests'&&failReads>0){failReads--;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Mất kết nối giả lập'}));return;}
 if(req.method!=='GET')writes.push({path,body});const bearer=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(path.slice('/api/staff'.length)+u.search,bearer?'__Host-bn-session='+bearer:'',req.method,body);
 res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html');res.end(data);
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const screenshotDir=process.env.EARLY_SCREENSHOT_DIR||'/workspace/scratch/early-request-page';await mkdir(screenshotDir,{recursive:true});
async function clickAction(page,name){const scope=name==='Làm mới'?page.locator('#view-early-requests'):page,b=scope.getByRole('button',{name,exact:true,includeHidden:true});await b.waitFor({state:'attached'});await page.waitForTimeout(100);if(!await b.isVisible())await b.evaluate(n=>n.closest('[popover]')?.showPopover());await b.click();}
try{for(const width of [390,1280]){
 const context=await browser.newContext({viewport:{width,height:844},acceptDownloads:true});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{if(!localStorage.getItem('bn-v2-session')){localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));}},{token:f.cookies.mgr.split('=')[1],user:users.mgr});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/early-requests');await page.waitForFunction(()=>document.querySelectorAll('.early-page-card').length===20);
 assert.equal(await page.locator('.nav-group-toggle[aria-expanded=false]').count(),await page.locator('.nav-group-toggle').count(),'all sidebar groups start collapsed');
 if(width>850){const buy=page.getByRole('button',{name:'Mua hàng',exact:true});assert.equal(await page.locator('.sidebar a[data-nav=early-requests]').isVisible(),false);await buy.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.sidebar a[data-nav=early-requests]').isVisible(),true);await page.keyboard.press('Space');assert.equal(await buy.getAttribute('aria-expanded'),'false');await buy.click();await page.locator('.sidebar a[data-nav=early-requests]').click();}
 else{await page.waitForFunction(()=>document.querySelector('.crm-mobile-nav a[data-mobile-nav="early-requests"]'));assert.ok(await page.locator('.crm-mobile-nav a').count()>5,'collapsed sidebar must not remove footer pages');assert.ok(await page.locator('#view-early-requests .crm-home-link').isVisible());}
 await page.getByRole('button',{name:'Trang tiếp ›',exact:true}).click();await page.waitForFunction(expected=>document.querySelectorAll('.early-page-card').length===expected,width===390?2:3);
 const filters=page.locator('.early-page-filters');if(!await filters.getAttribute('open'))await filters.locator('summary').click();
 // Different draft on each viewport; first run submits browser-000 and second uses a newly created draft.
 let requestId='browser-000';if(width===1280){const made=await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:'desktop-draft-key',pickupDate:'2026-10-26',lines:[{sku:'031106000',quantity:1}]});assert.equal(made.status,201);requestId=made.data.id;}
 await page.getByRole('searchbox',{name:'Tìm phiếu lấy hàng trước'}).fill(requestId);await page.waitForFunction(()=>document.querySelectorAll('.early-page-card').length===1);
 await page.locator('.early-page-card-head a').click();await page.getByRole('button',{name:'Sửa phiếu nháp',exact:true}).click();const edit=page.locator('dialog.early-request-dialog[open]');await edit.getByRole('spinbutton').fill('2');await clickAction(page,'Lưu nháp');
 await page.waitForFunction(()=>!document.querySelector('dialog[open] button[title="Lưu nháp trước khi gửi"]'));
 const send=edit.getByRole('button',{name:'Gửi NCC',exact:true});await send.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('dialog[open] button')].some(b=>b.textContent==='Gửi NCC'&&!b.disabled));await send.click();await edit.waitFor({state:'hidden'});
 await clickAction(page,'Manager xác nhận thay NCC');const confirm=page.locator('dialog.early-request-dialog[open]');await confirm.getByRole('button',{name:'Xác nhận 1 phiếu',exact:true}).click();await confirm.waitFor({state:'hidden'});
 const receive=page.locator('.early-page-detail a').filter({hasText:'Nhận hàng ·'}).first();await receive.waitFor({state:'attached'});assert.ok((await receive.getAttribute('href')).includes('earlyRequestId='+encodeURIComponent(requestId)));
 assert.equal(await page.locator('.early-page-detail .early-request-card').count(),1,'saving/submitting/confirming remains scoped to the selected request');
 await page.screenshot({path:screenshotDir+'/detail-'+width+'.png'});await page.locator('.early-page-back').click();await page.waitForFunction(()=>document.querySelectorAll('.early-page-card').length===1);assert.equal(await page.getByRole('searchbox').inputValue(),requestId);
 const before=writes.length,download=page.waitForEvent('download');await clickAction(page,'Tải file mẫu');assert.equal((await download).suggestedFilename(),'mau-xin-hang-truoc.xlsx');assert.equal(writes.length,before);
 await clickAction(page,'Xin hàng bằng file');await page.locator('.early-file-dialog').waitFor();await page.locator('.early-file-dialog').getByRole('button',{name:'Đóng',exact:true}).click();assert.equal(writes.length,before,'opening import never saves automatically');
 failReads=3;await clickAction(page,'Làm mới');await page.locator('#view-early-requests > .error').waitFor({state:'visible'});failReads=0;await clickAction(page,'Làm mới');await page.waitForFunction(()=>document.querySelector('#view-early-requests > .error').hidden);assert.equal(await page.getByRole('searchbox').inputValue(),requestId);
 await page.screenshot({path:screenshotDir+'/list-'+width+'.png'});assert.deepEqual(errors,[]);
 // Two SKUs on the same supplier reference form one slip; identical reference at another supplier stays separate.
 const groupedId='grouped-'+width,fullName='Bộ trà 0.7 L Jasmine Trắng Ngà - L1';
 await f.db.insert(products).values({sku:'031106000',name:fullName,updatedAt:new Date().toISOString()}).onConflictDoNothing();
 for(const id of ['a1','a2','b1'])await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'000123'}).where(eq(incomingShipments.id,id));
 await f.db.insert(incomingShipmentLines).values({id:'grouped-purchase-line',shipmentId:'a1',lineNo:2+width,sku:'01654020803',name:'Ấm đủ tên',unit:'Cái',quantity:10}).onConflictDoNothing();
 await f.db.insert(purchaseEarlyRequests).values({id:groupedId,clientKey:groupedId,payloadHash:'fixture',createdBy:'mgr',createdAt:new Date().toISOString(),status:'submitted',pickupDate:'2026-10-26'});
 await f.db.insert(purchaseEarlyRequestLines).values([{id:groupedId+'-l1',requestId:groupedId,lineNo:1,sku:'031106000',name:'Tên ngắn',unit:'Cái',quantity:3},{id:groupedId+'-l2',requestId:groupedId,lineNo:2,sku:'01654020803',name:'Ấm đủ tên',unit:'Cái',quantity:1}]);
 await f.db.insert(purchaseEarlyRequestAllocations).values([
  {id:groupedId+'-a1',requestLineId:groupedId+'-l1',purchaseLineId:'line-a1',supplierId:'a',quantity:1,status:'pending'},
  {id:groupedId+'-a2',requestLineId:groupedId+'-l1',purchaseLineId:'line-a2',supplierId:'a',quantity:1,status:'pending'},
  {id:groupedId+'-b1',requestLineId:groupedId+'-l1',purchaseLineId:'line-b1',supplierId:'b',quantity:1,status:'pending'},
  {id:groupedId+'-a3',requestLineId:groupedId+'-l2',purchaseLineId:'grouped-purchase-line',supplierId:'a',quantity:1,status:'pending'}]);
 await page.goto(origin+'/#/early-requests/'+groupedId);await page.waitForFunction(()=>document.querySelectorAll('.early-request-card').length===2);
 assert.equal(await page.locator('.early-request-card').first().locator('.early-request-line').count(),2);
 const product=page.locator('.early-product-link').filter({hasText:fullName}).first();await product.click();
 await page.locator('dialog.product-card[open]').waitFor();await page.locator('dialog.product-card[open] .modal-foot button[data-x]').click();
 await page.getByRole('checkbox',{name:'Chọn tất cả phiếu chờ xác nhận',exact:true}).check();
 await clickAction(page,'Xác nhận đã chọn (2)');const batchDialog=page.locator('dialog.early-request-dialog[open]');
 await batchDialog.getByRole('button',{name:'Xác nhận 2 phiếu',exact:true}).click();await batchDialog.waitFor({state:'hidden'});
 await page.waitForFunction(()=>!document.querySelector('.early-request-card input[type=checkbox]'));
 const actors=await f.client.query('select responded_by,status from purchase_early_request_allocations where id like $1',[groupedId+'-%']);assert.equal(actors.rows.length,4);assert.ok(actors.rows.every(r=>r.responded_by==='mgr'&&r.status==='accepted'));
 await page.screenshot({path:screenshotDir+'/grouped-'+width+'.png'});assert.deepEqual(errors,[]);
 await page.evaluate(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies.emp.split('=')[1],user:users.emp});await page.goto(origin+'/#/early-requests');await page.reload();await page.locator('.early-page-card').first().waitFor();assert.equal(await page.getByRole('button',{name:'Xin hàng bằng file',exact:true}).isVisible(),false);
 console.log(JSON.stringify({width,pagination:true,sidebarKeyboard:true,footerPreserved:true,draftSubmitConfirm:true,template:true,roleGuard:true,errors}));await context.close();
 }
 const stock=await f.client.query('select count(*)::int as n from stock_moves');assert.equal(stock.rows[0].n,0,'request workflows do not receive/issue stock');
}finally{await browser.close();server.close();await f.client.close();}
