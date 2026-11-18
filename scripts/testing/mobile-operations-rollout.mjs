/** Real local CRM router + fresh PGlite database; no production requests or carrier actions. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {customers} from '../../src/modules/customers/schema.ts';
import {suppliers,incomingShipments,incomingShipmentLines} from '../../src/modules/suppliers/schema.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const f=await setup(),ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const phase=3;
let packingId='';
const customerId='design-customer';
await f.db.insert(customers).values({id:customerId,name:'CÔNG TY PHƯỚC ĐỨC',contact:'Anh Minh',phone:'0903123218',email:'minh@example.invalid',address:'12 Nguyễn Huệ, Cần Thơ',taxCode:'0101234567',customerCode:'BN-CUZN04196',search:'phuoc duc anh minh',sourceVersion:0,syncedAt:''});
async function quote(no){return ok(await f.call('/quotes',f.mgr,'POST',{type:'HRC',quoteNo:no,date:'2026-10-25',customer:'CÔNG TY PHƯỚC ĐỨC',customerId,contact:'Anh Minh',phone:'0903123218',vat:8,shipping:{payer:'receiver'},rows:[{sku:'00123',name:'Bộ trà Hoàng Cung 0.65L',unit:'Bộ',qty:2,price:185000,costMode:'manual',costPrice:90000,taxRate:8},{sku:'LY-X',name:'Khăn lụa Hoàng Cung',unit:'Cái',qty:1,price:85000,costMode:'manual',costPrice:40000,taxRate:8}]}),201);}
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
await f.db.insert(warehouses).values({id:'factory-wh',name:'Kho nhà máy',kind:'stock'});
ok(await f.call('/stock-transfers',f.mgr,'POST',{fromWarehouseId:'pos-wh',toWarehouseId:'factory-wh',reason:'Fixture chưa chuyển kho',lines:[{sku:'00123',qty:1}]}),201);
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
const screenshotDir=process.env.MOBILE_SCREENSHOT_DIR||'/workspace/artifacts/mobile-rollout';await mkdir(screenshotDir,{recursive:true});
async function settle(page){await page.waitForTimeout(180);}
async function shot(page,name,width){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page must not overflow horizontally: '+name);await page.screenshot({path:screenshotDir+'/'+name+'-'+width+'.png',fullPage:false});}
async function goto(page,hash){await page.evaluate(h=>location.hash=h,hash);await settle(page);}
const results=[];
async function arrive(page,hash,selector){await page.goto(origin+'/index.html'+hash);await page.locator('#workspace').waitFor({state:'visible'});if(selector)await page.locator(selector).first().waitFor();await page.waitForTimeout(350);}
try{for(const width of (process.env.MOBILE_DESIGN_WIDTHS||'360,390,430,768,1280').split(',').map(Number)){
 const context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));localStorage.setItem('inventoryTab','compare');},{token,user});
 const page=await context.newPage(),errors=[];await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const panel=document.createElement('section');panel.className='purchase-incoming';panel.hidden=true;document.body.prepend(panel);}));page.on('pageerror',e=>errors.push(e.message));
 await arrive(page,'#/suppliers','#view-suppliers tr.clickable');
 const before=writes.length;
 for(const [hash,selector,name]of [
  ['#/suppliers','#view-suppliers .crm-list-card','suppliers'],
  ['#/deliveries?view=list','#deliveries-list .crm-list-card','deliveries'],
  ['#/receivables','#receivables-list .crm-list-card','receivables'],
  ['#/cashbook','#cashbook-list .crm-list-card','cashbook'],
  ['#/cash','#view-cash .crm-list-card','cash'],
  ['#/inventory','#view-inventory .crm-list-card','inventory'],
  ['#/stock-moves','#view-stock-moves .crm-list-card','ledger'],
  ['#/transfers','#view-transfers .crm-list-card','transfers'],
  ['#/products','#product-list .crm-list-card','products'],
  ['#/staff','#member-list .crm-list-card','staff'],
 ]){
  console.log('CHECK',width,name);await arrive(page,hash,selector);await shot(page,name,width);
  if(width<=850){
   const row=page.locator(selector).first();
   assert.equal(await row.locator('.crm-card-title').isVisible(),true,name+' title');
   const detail=row.locator('.crm-card-details button');
   if(await detail.count()){
    assert.equal(await row.locator('.crm-card-extra').first().isVisible(),false);
    const hashBefore=await page.evaluate(()=>location.hash);await detail.click();assert.equal(await row.locator('.crm-card-extra').first().isVisible(),true,name+' hidden columns accessible');
    assert.equal(await page.evaluate(()=>location.hash),hashBefore,'details must not open source document');
    await detail.click();
   }
   if(name==='ledger')for(const role of ['in','out','balance','pending','owner'])assert.equal(await row.locator('.crm-card-'+role).isVisible(),true,role);
   if(name==='inventory')for(const role of ['ledger','sapo','difference'])assert.equal(await row.locator('.crm-card-'+role).isVisible(),true,role);
   if(name==='cashbook')for(const role of ['in','out'])assert.equal(await row.locator('.crm-card-'+role).isVisible(),true,role);
  }else{
   const extras=page.locator(selector).first().locator('.crm-card-extra');if(await extras.count())assert.equal(await extras.first().isVisible(),true,name+' desktop columns');
   assert.equal(await page.locator(selector).first().locator('.crm-card-details').isVisible(),false);
  }
 }
 // Keep redesigned purchasing/receiving pages and the editable original incoming controls.
 await arrive(page,'#/purchases','#view-purchases .buy-list');await shot(page,'purchases-native',width);
 await arrive(page,'#/receiving','#view-receiving .buy-page');await shot(page,'receiving-native',width);
 await arrive(page,'#/purchases?mode=incoming','.incoming-table .crm-list-card');
 const qty=page.getByLabel('SL cần lấy trước mã 00123',{exact:true});await qty.fill('2');await qty.blur();await page.waitForTimeout(150);
 assert.equal(await qty.inputValue(),'2');assert.equal(await qty.isVisible(),true);await shot(page,'incoming',width);
 for(const [hash,selector,name]of [['#/permissions','#view-permissions .perm-table','permissions'],['#/payroll','#view-payroll','payroll'],['#/flow','#view-flow .flow-board','flow']]){await arrive(page,hash,selector);await shot(page,name,width);}
 // Filters stay deferred and restore values on Cancel. Native forms are never moved.
 if(width<=850){
  await arrive(page,'#/stock-moves','.ledger-table .crm-list-card');
  const from=page.locator('.ledger-bar input[type=date]').first(),original=await from.inputValue();
  await page.getByRole('button',{name:'Lọc sổ kho',exact:true}).click();const count=reads.filter(r=>r.startsWith('/stock-moves?')).length;
  await from.fill('2026-01-01');await page.waitForTimeout(150);assert.equal(reads.filter(r=>r.startsWith('/stock-moves?')).length,count);
  await page.getByRole('button',{name:'Đóng bộ lọc',exact:true}).click();assert.equal(await from.inputValue(),original);
  await page.getByRole('button',{name:'Lọc sổ kho',exact:true}).click();await from.fill('2026-01-01');await page.locator('#view-stock-moves .crm-filter-foot .primary').click();
  await page.waitForTimeout(350);assert.ok(reads.filter(r=>r.startsWith('/stock-moves?')).length>count);
  await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(250);assert.equal(await from.isVisible(),true);assert.equal(await from.evaluate(n=>n.closest('.crm-filter-fields')===null),true);
  await page.setViewportSize({width,height:900});
 }
 assert.equal(writes.length,before,'opening/filtering/expanding/selecting must not write stock, cash or permissions');
 assert.deepEqual(errors,[]);results.push({width,pages:15,columns:true,deferredFilters:width<=850,editableIncoming:true,noBusinessWrites:true,errors});console.log(JSON.stringify(results.at(-1)));await context.close();
 }}finally{await writeFile(screenshotDir+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
