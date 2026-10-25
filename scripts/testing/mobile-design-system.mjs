/** Real local CRM router + fresh PGlite database; no production requests or carrier actions. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {customers} from '../../src/modules/customers/schema.ts';
import {suppliers,incomingShipments,incomingShipmentLines} from '../../src/modules/suppliers/schema.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const f=await setup(),ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const phase=Number(process.env.MOBILE_DESIGN_PHASE||1);
const customerId='design-customer';
await f.db.insert(customers).values({id:customerId,name:'CÔNG TY PHƯỚC ĐỨC',contact:'Anh Minh',phone:'0903123218',email:'minh@example.invalid',address:'12 Nguyễn Huệ, Cần Thơ',taxCode:'0101234567',customerCode:'BN-CUZN04196',search:'phuoc duc anh minh',sourceVersion:0,syncedAt:''});
async function quote(no){return ok(await f.call('/quotes',f.mgr,'POST',{type:'HRC',quoteNo:no,date:'2026-10-25',customer:'CÔNG TY PHƯỚC ĐỨC',customerId,contact:'Anh Minh',phone:'0903123218',vat:8,rows:[{sku:'00123',name:'Bộ trà Hoàng Cung 0.65L',unit:'Bộ',qty:2,price:185000,taxRate:8},{sku:'LY-X',name:'Khăn lụa Hoàng Cung',unit:'Cái',qty:1,price:85000,taxRate:8}]}),201);}
const q=await quote('HRC_BG_001_25102026');ok(await f.call('/quotes/'+q.id+'/approve',f.mgr,'POST',{revision:1}));
const contract=ok(await f.call('/contracts',f.mgr,'POST',{quoteId:q.id,legalEntity:'BN',depositRate:30}),201);
const oq=await quote('HRC_BG_002_25102026');ok(await f.call('/quotes/'+oq.id+'/approve',f.mgr,'POST',{revision:1}));
const order=ok(await f.call('/orders',f.mgr,'POST',{quoteId:oq.id}),201);
for(const id of [contract.orderId,order.id])ok(await f.call('/orders/'+id+'/status',f.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true}));
ok(await f.call('/tasks',f.mgr,'POST',{title:'Gọi xác nhận đơn cho Anh Minh',assigneeId:'mgr',dueDate:'2026-10-25'}),201);
const cfg=ok(await f.call('/care/config',f.mgr));
ok(await f.call('/care',f.mgr,'POST',{customerId,contactName:'Anh Minh',remindBefore:'1d',type:cfg.types[0].key,content:'Gửi lại báo giá bộ trà, hẹn khách xác nhận',result:cfg.results[0].key,nextAt:new Date(Date.now()+864e5).toISOString().slice(0,10)}),201);
const user=ok(await f.call('/me',f.mgr)).user,token=f.mgr.split('=')[1];
if(phase>=2){
 const now=new Date().toISOString();
 await f.db.insert(suppliers).values({id:'design-supplier',name:'Nhà máy Gốm sứ Hoàng Cung',nameKey:'gom su hoang cung',phone:'0909876543',createdAt:now,createdBy:'mgr',updatedAt:now});
 await f.db.insert(incomingShipments).values({id:'design-po',ticketNumber:'DMH_20261025_001',source:'supplier-order',warehouse:'Kho POS',supplierId:'design-supplier',supplierName:'Nhà máy Gốm sứ Hoàng Cung',approvalStatus:'approved',supplierStatus:'confirmed',arrivalDate:now.slice(0,10),createdAt:now,createdBy:'mgr',updatedAt:now});
 await f.db.insert(incomingShipmentLines).values({id:'design-po-line',shipmentId:'design-po',lineNo:1,sku:'00123',name:'Ly sứ Hoàng Cung',unit:'Cái',quantity:29,price:185000});
 ok(await f.call('/deliveries',f.mgr,'POST',{orderId:order.id,plannedDate:now.slice(0,10)}),201);
 await f.open();
 ok(await f.call('/cash/entries',f.emp,'POST',{key:crypto.randomUUID(),kind:'other_income',amount:1668600,reason:'Thu tiền đơn hàng thử nghiệm'}),201);
}
if(phase>=3){await f.db.insert(warehouses).values({id:'factory-wh',name:'Kho nhà máy',kind:'stock'});ok(await f.call('/stock-transfers',f.mgr,'POST',{fromWarehouseId:'pos-wh',toWarehouseId:'factory-wh',reason:'Phiếu thử giao diện, chưa thực hiện',lines:[{sku:'00123',qty:1}]}),201);}
const writes=[],reads=[];let failOrders=false;
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost'),path=u.pathname;
 if(path.startsWith('/api/staff/')){
  const route=u.pathname.slice('/api/staff'.length)+u.search;reads.push(route);
  if(failOrders&&route.startsWith('/orders?')){failOrders=false;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Kết nối thử nghiệm bị gián đoạn'}));return;}
  let body;const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length)body=JSON.parse(Buffer.concat(chunks).toString());
  if(req.method!=='GET')writes.push({path:route,method:req.method,body});
  const auth=req.headers.authorization?.replace(/^Bearer /,'')||'',r=await f.call(route,auth?'__Host-bn-session='+auth:'',req.method,body);
  const data={...r.data};if(r.cookie)data.sessionToken=r.cookie.split('=')[1];if(route==='/logout')data.sessionToken='';
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(data));return;
 }
 res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');
 let data=await readFile(root+(path==='/'?'index.html':path));
 if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const screenshotDir=process.env.MOBILE_SCREENSHOT_DIR||'/workspace/scratch/crm-mobile-design';await mkdir(screenshotDir,{recursive:true});
async function settle(page){await page.waitForTimeout(180);}
async function shot(page,name,width){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page must not overflow horizontally: '+name);await page.screenshot({path:screenshotDir+'/'+name+'-'+width+'.png',fullPage:false});}
async function goto(page,hash){await page.evaluate(h=>location.hash=h,hash);await settle(page);}
try{for(const width of [390,1280]){
 const context=await browser.newContext({viewport:{width,height:844},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/index.html#/contracts');await page.locator('#contracts-list tr.clickable').first().waitFor();await settle(page);
 assert.equal(await page.locator('#contracts-list .crm-list-card').count(),1);
 if(width===390){
  assert.equal(await page.locator('.crm-mobile-nav a').count(),4);assert.equal(await page.locator('.crm-mobile-nav button').textContent(),'⋯Thêm');
  assert.equal(await page.locator('#contracts-entity').isVisible(),false);await shot(page,'contracts-list',width);
  const before=writes.length;await page.getByRole('button',{name:'Lọc HĐKT',exact:true}).click();await page.locator('#contracts-entity').selectOption('BN');
  await page.waitForFunction(()=>document.querySelector('#contracts-entity').value==='BN');await settle(page);assert.equal(writes.length,before,'filtering never writes business data');
  assert.ok(reads.some(p=>p.startsWith('/contracts?')&&p.includes('entity=BN')));await shot(page,'contracts-filters',width);
  await page.locator('#view-contracts .crm-filter-foot .primary').click();
 }else{assert.equal(await page.locator('#contracts-entity').isVisible(),true);await shot(page,'contracts-list',width);}
 await page.locator('#contracts-list a').first().click();await page.locator('#order-title').filter({hasText:/HĐKT|BN-/}).waitFor();await page.locator('.crm-document-sheet').waitFor({state:'visible'});await settle(page);await shot(page,'contract-detail',width);
 assert.equal(await page.locator('.crm-document-sheet #view-order').count(),1);assert.equal(await page.locator('#view-order').count(),1,'no cloned document IDs');
 await page.getByRole('button',{name:'Đóng chi tiết HĐKT',exact:true}).click();await page.waitForFunction(()=>location.hash==='#/contracts');await page.locator('.crm-document-sheet').waitFor({state:'hidden'});
 await goto(page,'#/quotes');await page.locator('#quote-list tr.clickable').first().waitFor();await shot(page,'quotes-list',width);
 await goto(page,'#/customers/'+customerId);await page.locator('.crm-customer-person strong').waitFor({state:width===390?'visible':'hidden'});await settle(page);await shot(page,'customer-detail',width);
 if(width===390){assert.equal(await page.getByRole('button',{name:'Chăm sóc',exact:true}).first().isVisible(),true);assert.equal(await page.locator('.crm-mobile-nav [aria-current=page]').textContent(),'Khách hàng');}
 await goto(page,'#/tasks');await page.locator('.task-row').first().waitFor();await settle(page);await shot(page,'tasks',width);
 if(width===390){
  await page.evaluate(()=>document.querySelectorAll('.sidebar [data-nav=customers],.bottom-nav [data-nav=customers]').forEach(a=>{a.dataset.testWasHidden=String(a.hidden);a.hidden=true;}));
  await page.waitForFunction(()=>!document.querySelector('.crm-mobile-nav [data-mobile-nav=customers]')&&!document.querySelector('.crm-more-grid [data-mobile-nav=customers]'));
  await page.evaluate(()=>document.querySelectorAll('[data-test-was-hidden]').forEach(a=>{a.hidden=a.dataset.testWasHidden==='true';delete a.dataset.testWasHidden;}));
  await page.waitForFunction(()=>document.querySelector('.crm-mobile-nav [data-mobile-nav=customers]'));
 }
 await goto(page,'#/care');await page.locator('#view-care [data-list] tr').first().waitFor();await settle(page);await shot(page,'care',width);
 // Error/retry preserves list filters and never dispatches a business write.
 failOrders=true;await goto(page,'#/orders');await page.locator('#view-orders .crm-list-retry').waitFor({state:'visible'});const beforeRetry=writes.length;await page.locator('#view-orders .crm-list-retry').click();await page.locator('#orders-list tr.clickable').first().waitFor();assert.equal(writes.length,beforeRetry);
 await shot(page,'orders-list',width);
 if(phase>=2){
  const before=writes.length;
  for(const [hash,selector,name]of [
   ['#/purchases','#view-purchases .crm-list-card','purchases'],
   ['#/suppliers','#view-suppliers .crm-list-card','suppliers'],
   ['#/receiving','#view-receiving .crm-list-card','receiving'],
   ['#/deliveries','#deliveries-list .crm-list-card','deliveries'],
   ['#/receivables','#receivables-list .crm-list-card','receivables'],
   ['#/cashbook','#cashbook-list .crm-list-card','cashbook'],
   ['#/cash','#view-cash .crm-list-card','cash'],
  ]){await goto(page,hash);await page.locator(selector).first().waitFor();await settle(page);await shot(page,name,width);}
  assert.equal(writes.length,before,'opening operations pages never posts stock, payment or shipping actions');
  await goto(page,'#/suppliers');await page.locator('#view-suppliers tr.clickable').first().click();
  const supplierForm=page.locator('#view-suppliers .sup-drawer:not([hidden]) form');await supplierForm.waitFor();
  assert.equal(await supplierForm.getByRole('button',{name:'Lưu thay đổi',exact:true}).isVisible(),true);
  await supplierForm.locator('[name=name]').fill('Tên sửa thử chưa lưu');assert.equal(writes.length,before);
  await page.locator('#view-suppliers .sup-drawer-head button').click();
  await goto(page,'#/purchases?mode=incoming');await page.locator('.incoming-table .crm-list-card').first().waitFor();
  const qty=page.getByLabel('SL cần lấy trước mã 00123',{exact:true});await qty.fill('2');
  assert.equal(await page.getByRole('button',{name:'Lưu và gửi NCC',exact:true}).isEnabled(),true);
  await shot(page,'incoming',width);assert.equal(writes.length,before,'selection stays local until explicit submission');
  if(width===390){await page.getByRole('button',{name:'Lọc hàng đang về',exact:true}).click();await page.getByLabel('Nhà cung cấp',{exact:true}).selectOption('design-supplier');await page.locator('.purchase-incoming .crm-filter-foot .primary').click();await qty.waitFor();assert.equal(await qty.inputValue(),'2','filter preserves selected quantity');}
  await goto(page,'#/stock-lookup?q=00123');await page.locator('.lookup-item').first().waitFor();assert.equal(await page.locator('.lookup-bar button[type=submit]').isVisible(),true);await shot(page,'stock-lookup',width);
 }
 if(phase>=3){
  const before=writes.length;
  for(const [hash,selector,name]of [
   ['#/dashboard','.dash-tile','dashboard'],
   ['#/kho','.kho-list','warehouse-home'],
   ['#/inventory','#view-inventory .crm-list-card','inventory'],
   ['#/stock-moves','#view-stock-moves .crm-list-card','stock-moves'],
   ['#/transfers','#view-transfers .crm-list-card','transfers'],
   ['#/products','#product-list .crm-list-card','products'],
   ['#/staff','#member-list .crm-list-card','staff'],
   ['#/payroll','#payroll-board .stats','payroll'],
   ['#/permissions','.perm-table','permissions'],
   ['#/flow','.flow-node','flow'],
  ]){await goto(page,hash);await page.locator(selector).first().waitFor();await settle(page);await shot(page,name,width);}
  assert.equal(writes.length,before,'admin/warehouse viewing never posts transfers, stock openings, payroll or permissions');
  await goto(page,'#/stock-moves');await page.locator('.crm-card-balance').first().waitFor();
  for(const kind of ['in','out','balance'])assert.equal(await page.locator('.crm-card-'+kind).first().isVisible(),true,'quantity remains available: '+kind);
  await goto(page,'#/dashboard');await page.locator('.dash-tile').first().waitFor();
  if(width===390){assert.equal(await page.locator('.dash-kpis > .dash-tile').count(),4);await page.locator('.crm-kpi-extras summary').click();assert.ok(await page.locator('.crm-kpi-extra-grid .dash-tile:visible').count()>0);}
 }
 if(width===390){
  await page.locator('.view:not([hidden]) h1').first().click();await settle(page);
  await page.locator('.crm-mobile-nav button').click();await page.locator('.crm-more-sheet').waitFor({state:'visible'});assert.equal(await page.locator('.crm-more-sheet a[href="#/contracts"]').count(),1);await page.getByRole('button',{name:'Đóng các trang',exact:true}).click();
  await goto(page,'#/quotes/new');
  const form=page.locator('#quote-form');await form.waitFor({state:'visible'});
  await form.locator('[name=customer]').fill('Bản nháp thiết bị của Anh Thái');await page.waitForTimeout(950);assert.equal(await page.locator('.crm-mobile-nav').isVisible(),false);
  await page.reload();await page.getByRole('button',{name:'Khôi phục nháp',exact:true}).click();assert.equal(await form.locator('[name=customer]').inputValue(),'Bản nháp thiết bị của Anh Thái');
  assert.equal(await form.locator('[data-quote-panel=info]').first().isVisible(),true);assert.equal(await form.locator('[data-quote-panel=products]').first().isVisible(),true);assert.equal(await form.locator('[data-quote-panel=review]').first().isVisible(),true);
  await shot(page,'quote-form',width);
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({width,screenshots:true,realRouter:true,filterQueries:true,documentOwnership:true,localDraft:width===390,errors}));await context.close();
}}finally{await browser.close();server.close();await f.client.close();}
