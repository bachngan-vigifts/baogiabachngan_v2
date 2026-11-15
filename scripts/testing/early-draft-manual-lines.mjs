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
await f.db.insert(incomingShipmentLines).values({id:'unrequested',shipmentId:'a1',lineNo:99,sku:'OUTSIDE',name:'Không xin hàng',unit:'Cái',quantity:20});
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
 // Different draft on each viewport; first run submits browser-000 and second uses a newly created draft.
 let requestId='browser-000';if(width===1280){const made=await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:'desktop-draft-key',pickupDate:'2026-10-26',lines:[{sku:'031106000',quantity:1}]});assert.equal(made.status,201);requestId=made.data.id;}
 await page.goto(origin+'/#/early-requests/'+requestId);await page.locator('.early-request-card').waitFor();
 await page.getByRole('button',{name:'Sửa phiếu nháp',exact:true}).click();const edit=page.locator('dialog.early-request-dialog[open]');
 const manual=edit.getByRole('textbox',{name:'Mã hàng thêm thủ công'}),add=edit.getByRole('button',{name:'Thêm mã',exact:true});
 await manual.fill('DOES-NOT-EXIST');await add.click();await edit.getByRole('alert').filter({hasText:'Không tìm thấy mã'}).waitFor();assert.equal(await edit.locator('tbody tr').count(),1);
 await manual.fill('031106000');await add.click();await edit.getByRole('alert').filter({hasText:'đã có trên phiếu'}).waitFor();
 await manual.fill('OUTSIDE');await manual.press('Enter');await edit.locator('tbody tr').filter({hasText:'Không xin hàng'}).waitFor();
 // Closing without saving must discard the added row.
 await edit.locator('.modal-foot').getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('button',{name:'Sửa phiếu nháp',exact:true}).click();assert.equal(await edit.locator('tbody tr').count(),1);
 await edit.getByRole('button',{name:'Bỏ mã 031106000',exact:true}).click();await clickAction(page,'Lưu nháp');await edit.getByRole('alert').filter({hasText:'Chọn ít nhất một mã'}).waitFor();
 await manual.fill('OUTSIDE');await add.click();await edit.locator('tbody tr').filter({hasText:'Không xin hàng'}).waitFor();await edit.getByRole('spinbutton').fill('2');
 await page.screenshot({path:screenshotDir+'/draft-manual-'+width+'.png'});
 const bounds=await edit.evaluate(n=>{const f=n.querySelector('.modal-foot'),a=n.querySelector('.early-draft-add');return{dialog:n.getBoundingClientRect().toJSON(),footer:f.getBoundingClientRect().toJSON(),add:a.getBoundingClientRect().toJSON()};});assert.ok(bounds.dialog.x>=0&&bounds.dialog.right<=width);assert.ok(bounds.footer.bottom<=844);assert.ok(bounds.add.bottom<=bounds.footer.top);
 const removeFits=await edit.locator('tbody button').evaluateAll(nodes=>nodes.every(n=>{const r=n.getBoundingClientRect(),w=n.closest('.table-wrap').getBoundingClientRect();return !r.width||(r.left>=w.left&&r.right<=w.right);}));assert.ok(removeFits,'row action buttons fit inside the table');
 await clickAction(page,'Lưu nháp');
 await page.waitForFunction(()=>[...document.querySelectorAll('dialog[open] .modal-foot span')].some(n=>n.textContent.includes('phiên bản 2')));
 const edited=(await f.call('/purchase-early-requests?id='+requestId,f.cookies.mgr)).data.requests[0];assert.deepEqual(edited.lines.map(l=>[l.sku,l.quantity]),[['OUTSIDE',2]]);
 await edit.locator('.modal-foot').getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('button',{name:'Sửa phiếu nháp',exact:true}).click();assert.equal(await edit.locator('tbody tr').count(),1);assert.equal(await edit.getByRole('spinbutton').inputValue(),'2');
 await page.waitForFunction(()=>!document.querySelector('dialog[open] button[title="Lưu nháp trước khi gửi"]'));
 const send=edit.getByRole('button',{name:'Gửi NCC',exact:true});await send.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('dialog[open] button')].some(b=>b.textContent==='Gửi NCC'&&!b.disabled));await send.click();await edit.waitFor({state:'hidden'});
 await page.locator('.early-page-detail').getByRole('button',{name:'Xác nhận thay NCC',exact:true}).first().click();const confirm=page.locator('dialog.early-request-dialog[open]');await confirm.getByRole('button',{name:'Xác nhận 1 phiếu',exact:true}).click();await confirm.waitFor({state:'hidden'});
 const receive=page.locator('.early-page-detail').getByRole('button',{name:'Nhận hàng',exact:true}).first();await receive.waitFor();const beforeReceive=page.url();await receive.click();await page.locator('.early-quick-receipt [data-early-quick-quantity]').first().waitFor();assert.equal(page.url(),beforeReceive);await page.locator('.early-quick-receipt').getByRole('button',{name:'Đóng',exact:true}).click();
 assert.equal(await page.locator('.early-page-detail .early-request-card').count(),1,'saving/submitting/confirming remains scoped to the selected request');
 const saved=(await f.call('/purchase-early-requests?id='+requestId,f.cookies.mgr)).data.requests[0],orderId=saved.lines[0].allocations[0].orderId;
 await f.db.update(incomingShipments).set({supplierStatus:'confirmed',supplierConfirmedAt:'2026-10-26T00:00:00Z',confirmedOnBehalf:true}).where(eq(incomingShipments.id,orderId));
 await page.goto(origin+'/#/purchases/'+orderId+'?receive=1&earlyRequestId='+requestId);
 const choice=page.locator('dialog.receipt-sapo-choice[open]');await choice.waitFor();await choice.getByRole('button',{name:'Đóng',exact:true}).click();const confirmed=page.getByRole('button',{name:'NCC đã xác nhận',exact:true,includeHidden:true});assert.ok((await confirmed.getAttribute('class')).includes('status-confirmed'));if(!await confirmed.isVisible())await confirmed.evaluate(n=>n.closest('[popover]')?.showPopover());const colors=await confirmed.evaluate(n=>{const probe=document.createElement('span');probe.style.color='var(--blue)';document.body.append(probe);const result={text:getComputedStyle(n).color,expected:getComputedStyle(probe).color,bg:getComputedStyle(n).backgroundColor};probe.remove();return result;});assert.equal(colors.text,colors.expected);assert.notEqual(colors.text,colors.bg);await page.screenshot({path:screenshotDir+'/confirmed-'+width+'.png'});
 const receiveAction=page.locator('.sup-drawer').getByRole('button',{name:'Nhận hàng',exact:true,includeHidden:true});await receiveAction.waitFor({state:'attached'});if(!await receiveAction.isVisible())await receiveAction.evaluate(n=>n.closest('[popover]')?.showPopover());await receiveAction.click();
 await choice.waitFor();await choice.getByRole('button',{name:'Không — chỉ nhập CRM',exact:true}).click();
 await page.locator('.recv-card').waitFor();assert.equal(await page.locator('.recv-card').count(),1);assert.equal(await page.locator('.recv-card input[type=number]').first().getAttribute('max'),'2');await page.locator('.recv-card').getByRole('button',{name:'Đủ 2',exact:true}).click();assert.equal(await page.locator('.recv-card input[type=number]').first().inputValue(),'2');assert.equal(await page.locator('.recv-card').filter({hasText:'OUTSIDE'}).count(),1);assert.equal(await page.locator('.recv-card').filter({hasText:'031106000'}).count(),0);
 await page.goto(origin+'/#/early-requests/'+requestId);await page.locator('.early-request-card').waitFor();

 console.log(JSON.stringify({width,manualAddRemove:true,cancelDiscards:true,saveReopen:true,confirmBlue:true,errors}));assert.deepEqual(errors,[]);await context.close();
 }
 const stock=await f.client.query('select count(*)::int as n from stock_moves');assert.equal(stock.rows[0].n,0,'request workflows do not receive/issue stock');
}finally{await browser.close();server.close();await f.client.close();}
