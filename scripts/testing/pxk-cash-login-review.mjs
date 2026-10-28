/** Real local router/PGlite + browser; no production or external integration calls. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {eq} from 'drizzle-orm';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {suppliers,incomingShipments,incomingShipmentLines} from '../../src/modules/suppliers/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {salesOrders,deliveries} from '../../src/modules/sales/schema.ts';
import {products,productStock} from '../../src/modules/catalog/schema.ts';
import {PASSWORD} from '../../tests/helpers/staff-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setup();await f.open();
const before=process.argv.includes('--before'),stage=before?'before':'after',now=new Date().toISOString();
await f.db.insert(suppliers).values({id:'supplier',name:'NCC kiểm thử',nameKey:'test',createdAt:now,createdBy:'mgr',updatedAt:now});
for(const [i,no] of [[1,'NCC-ONE'],[2,'NCC-TWO']]){
 await f.db.insert(incomingShipments).values({id:'po'+i,ticketNumber:'PO-'+i,source:'supplier-order',warehouse:'Kho',supplierId:'supplier',supplierName:'NCC kiểm thử',supplierInternalOrderNumber:no,approvalStatus:'approved',createdBy:'mgr',createdAt:now,updatedAt:now});
 await f.db.insert(incomingShipmentLines).values({id:'pl'+i,shipmentId:'po'+i,lineNo:1,sku:'00123',name:'Ly thử nghiệm',unit:'cái',quantity:1000});
}
await f.db.insert(salesOrders).values({id:'ghn-review',orderNo:'POS_GHN_REVIEW',quoteType:'HRC',customerName:'Khách GHN kiểm thử',ownerId:'mgr',createdBy:'mgr',orderDate:'2026-10-28',status:'delivering',holdsStock:false,createdAt:now,updatedAt:now});
await f.db.insert(deliveries).values({id:'ghn-delivery',deliveryNo:'GH_REVIEW',orderId:'ghn-review',plannedDate:'2026-10-28',carrier:'GHN',trackingCode:'GHN123456',trackingStatus:'delivering',createdBy:'mgr',createdAt:now,updatedAt:now});
const originalStock=await f.db.select().from(productStock),xctx={};runInNewContext(await readFile('trial-ui/xlsx.full.min.js','utf8'),xctx);const X=xctx.XLSX;
function workbook(){const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet([['Mã hàng','Số lượng xin trước','Số đơn mua CRM (DMH)','Số đơn của NCC','Số PXK'],['00123',3,'PO-1','NCC-ONE','00001'],['00123',4,'PO-2','NCC-TWO','00001'],['00123',5,'PO-1','NCC-ONE','00002']]),'Xin hàng trước');return Buffer.from(X.write(b,{type:'array',bookType:'xlsx'}));}
const uiRoot=process.env.UI_ROOT||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),writes=[];let loseResponse=false;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
 const path=u.pathname.slice('/api/staff'.length)+u.search,chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
 if(req.method!=='GET')writes.push({path,body});const token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,body);
 if(loseResponse&&path==='/purchase-early-requests/file'&&r.status===201){loseResponse=false;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Mất phản hồi thử nghiệm sau lưu'}));return;}
 const data={...r.data};if(r.cookie)data.sessionToken=r.cookie.split('=')[1];res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(data));return;
 }const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(uiRoot+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,out='/workspace/scratch/pxk-cash-login/'+stage;await mkdir(out,{recursive:true});const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];let debugPage;
async function session(width,role='mgr'){
 const context=await browser.newContext({viewport:{width,height:932},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const cookie=role==='mgr'?f.mgr:f.emp,user=(await f.call('/me',cookie)).data.user;
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({user,session:token}));},{user,token:cookie.split('=')[1]});
 const page=await context.newPage(),errors=[];debugPage=page;page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};
}
try{
 for(const width of before?[390,1280]:[360,390,430,768,1280]){
  const {context,page,errors}=await session(width);await page.goto(origin+'/#/early-requests');await page.locator('.early-page-index').waitFor();
  if(!before)assert.equal(await page.locator('#view-early-requests .head-actions').getByRole('button',{name:'Tải file mẫu',exact:true}).count(),0);
  if(!before)assert.deepEqual(await page.locator('.sidebar .nav-group-toggle').evaluateAll(bs=>bs.map(b=>b.getAttribute('aria-expanded'))),['true','true','false','false','false','false','false']);
  await page.screenshot({path:out+'/early-'+width+'.png'});await page.getByRole('button',{name:'Xin hàng bằng file',exact:true}).click();const modal=page.locator('.early-file-dialog[open]');await modal.waitFor();
  await page.screenshot({path:out+'/file-'+width+'.png'});
  if(!before){const download=page.waitForEvent('download');await modal.getByRole('button',{name:/Tải file mẫu/}).click();const d=await download,b=X.read(await readFile(await d.path()),{type:'buffer'});assert.equal(b.Sheets[b.SheetNames[0]].E1.v,'Số PXK');
   await modal.getByLabel('File xin hàng trước').setInputFiles({name:'pxk.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook()});await page.waitForFunction(()=>document.querySelector('.early-file-dialog [role=status]').textContent.includes('2 nhóm PXK'));
   if(width===390)loseResponse=true;
   await modal.getByRole('button',{name:'Lưu phiếu nháp',exact:true}).click();if(width===390)await modal.getByRole('button',{name:'Thử lưu lại',exact:true}).click();
   await modal.getByRole('link',{name:/Mở phiếu/}).first().waitFor();assert.equal(await modal.getByRole('link',{name:/Mở phiếu/}).count(),2);await page.screenshot({path:out+'/file-preview-'+width+'.png'});
  }
  await modal.getByRole('button',{name:'Đóng',exact:true}).click();
  await page.goto(origin+'/#/products/00123');await page.locator('.pd-hero').waitFor();
  if(width>850){
await page.getByRole('button',{name:'Cập nhật sản phẩm',exact:true}).click();const product=page.locator('dialog.modal[open]').filter({has:page.getByRole('heading',{name:'Cập nhật sản phẩm',exact:true})});await product.waitFor();
  if(!before){await product.locator('[name=perCarton]').fill('12');await product.locator('[name=cartonLength]').fill('40.8');await product.locator('[name=cartonWidth]').fill('28.3');await product.locator('[name=cartonHeight]').fill('23.6');await product.locator('[name=cartonWeight]').fill('5.25');}
  if(!before)assert.ok((await product.locator('.modal-foot').boundingBox()).y+(await product.locator('.modal-foot').boundingBox()).height<=932);
  await page.screenshot({path:out+'/product-'+width+'.png'});
  if(!before&&width===1280){await product.getByRole('button',{name:'Lưu cập nhật',exact:true}).click();await product.waitFor({state:'detached'});assert.equal((await f.call('/products/00123',f.mgr)).data.product.cartonWeight,5.25);}else await product.getByRole('button',{name:'Huỷ',exact:true}).click();
  }else await page.screenshot({path:out+'/product-'+width+'.png'});
  await page.goto(origin+'/#/orders');await page.locator('#orders-list tr.clickable').first().waitFor();
  if(!before){assert.equal(await page.getByRole('link',{name:'GHN GHN123456',exact:true}).isVisible(),true);assert.ok((await page.locator('#orders-list').innerText()).includes('Đang giao hàng'));}
  await page.screenshot({path:out+'/orders-'+width+'.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);await context.close();
  const cash=await session(width,'emp');await cash.page.goto(origin+'/#/cash');const expense=cash.page.getByRole('button',{name:'+ Chi tiền',exact:true});await cash.page.locator('#view-cash h1').waitFor();if(!await expense.isVisible())await cash.page.locator('#view-cash > .cash-tools > .mobile-action-trigger').first().click();await expense.click();const cm=cash.page.locator('dialog.cash-dialog[open]');await cm.waitFor();
  if(!before){assert.ok((await cm.locator('datalist option').evaluateAll(os=>os.map(o=>o.value))).includes('Phí GHN'));}
  await cash.page.screenshot({path:out+'/cash-'+width+'.png'});
  if(!before&&width===390){await cm.locator('input[list]').fill('Phí gửi xe mới');await cm.getByLabel('Số tiền (VNĐ)').fill('100');await cm.getByLabel('Nội dung / lý do').fill('Giao hàng kiểm thử');await cm.getByRole('button',{name:'Lưu phiếu',exact:true}).click();await cm.waitFor({state:'detached'});await cash.page.reload();const expense=cash.page.getByRole('button',{name:'+ Chi tiền',exact:true});await cash.page.locator('#view-cash h1').waitFor();if(!await expense.isVisible())await cash.page.locator('#view-cash > .cash-tools > .mobile-action-trigger').first().click();await expense.click();await cash.page.waitForFunction(()=>[...document.querySelectorAll('dialog.cash-dialog[open] datalist option')].some(o=>o.value==='Phí gửi xe mới'));}
  await cash.page.locator('dialog.cash-dialog[open]').getByRole('button',{name:'Huỷ',exact:true}).click();await cash.page.getByRole('button',{name:'+ Thu tiền',exact:true}).click();const incoming=cash.page.locator('dialog.cash-dialog[open]');
  if(!before)assert.ok((await incoming.locator('datalist option').evaluateAll(os=>os.map(o=>o.value))).includes('Nộp quỹ'));
  await incoming.getByRole('button',{name:'Huỷ',exact:true}).click();assert.deepEqual(cash.errors,[]);await cash.context.close();results.push({width,passed:true});
 }
 if(!before){await f.db.update(employees).set({positionId:'sale-admin'}).where(eq(employees.id,'emp'));const context=await browser.newContext();await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const page=await context.newPage();await page.goto(origin+'/#/quotes');await page.locator('#email').fill('emp@x.vn');await page.locator('#password').fill(PASSWORD);await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL('**/#/flow');await context.close();}
 assert.deepEqual(await f.db.select().from(productStock),originalStock);assert.ok(!writes.some(w=>/receipts|\/submit|supplier-portal|ghn|sapo/.test(w.path)));await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}catch(e){if(debugPage&&!debugPage.isClosed()){console.error((await debugPage.locator('body').innerText()).slice(-3500));await debugPage.screenshot({path:out+'/error.png'});}throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.client.close();}
