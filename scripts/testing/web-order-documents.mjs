/** Isolated browser/API checks with fixture orders and mocked GHN. No production requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {posRegisters,webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
import {salesOrders} from '../../src/modules/sales/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/workspace/scratch/web-order-documents',results=[],requests=[];await mkdir(out,{recursive:true});
await f.db.update(posRegisters).set({name:'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
const ml=(await f.call('/pos/registers',f.mgr,'POST',{name:'Showroom Gốm Sứ Minh Long Cần Thơ',warehouseId:'pos-wh',pricePolicyId:'retail-vat',secondPricePolicyId:'retail'})).data.id;assert.ok(ml);
await f.db.insert(salesOrders).values({id:'regular-ui',orderNo:'DH-UI-REGULAR',quoteType:'HRC',customerName:'Khách CRM kiểm tra',ownerId:'mgr',createdBy:'mgr',orderDate:'2026-11-02',createdAt:'2026-11-02T05:00:00Z',updatedAt:'2026-11-02T05:00:00Z',status:'draft',holdsStock:false});
const cases=[];let no=21569;
for(const source of ['lock','minhlong'])for(const width of [1280,390]){
 const number=String(no++),r=await f.call('/integrations/woocommerce/'+source+'/order?token='+(source==='lock'?'test-lock-token':'test-ml-token'),'','POST',{id:Number(number),number,status:'pending',total:'216000',currency:'VND',billing:{first_name:'Khách thử '+source,phone:'0901234567'},line_items:[{sku:'00123',name:'Ly sứ',quantity:2,subtotal:'200000',subtotal_tax:'16000',total:'200000',total_tax:'16000'}],shipping_total:'0',shipping_tax:'0',total_tax:'16000',discount_total:'0',coupon_lines:[],fee_lines:[],shipping_lines:[],date_paid_gmt:null,date_created_gmt:'2026-11-02T05:00:00Z'});assert.equal(r.status,200,JSON.stringify(r.data));
 cases.push({source,width,number,name:'Web_'+number+'_Khách thử '+source});
}
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),path=u.pathname.slice('/api/staff'.length)+u.search;
  requests.push({path:u.pathname,method:req.method});const r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;if(path.includes('..')){res.writeHead(404).end();return;}let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.jpg')?'image/jpeg':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),user=(await f.call('/me',f.mgr)).data.user;
try{
 for(const c of cases){
  const context=await browser.newContext({viewport:{width:c.width,height:1004},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.mgr.split('=')[1]});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto(origin+'/#/orders');await page.getByRole('link',{name:c.name,exact:true}).click();
  const content=page.locator('#web-order-content');await content.getByRole('heading',{name:c.name,exact:true}).first().waitFor();assert.match(await content.innerText(),/Đơn giá trước CK/i);
  await content.getByRole('button',{name:'Sửa sản phẩm / giá',exact:true}).click();
  await content.getByRole('spinbutton',{name:'Số lượng',exact:true}).fill('1');await content.getByRole('textbox',{name:'Lý do sửa',exact:true}).fill('Khách đổi số lượng trước GHN');
  await content.getByRole('checkbox',{name:'Đã kiểm tra giá, CK, VAT, phí và tổng tiền',exact:true}).check();await content.getByRole('checkbox',{name:'Đã đối chiếu thanh toán với khách / chứng từ',exact:true}).check();
  await content.getByRole('button',{name:'Kiểm tra tổng tiền',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.web-edit-total')?.textContent.includes('108.000'));
  await content.getByRole('button',{name:'Lưu bản sửa',exact:true}).click();await content.getByText('Đã chỉnh trên CRM; đơn website gốc được giữ để đối chiếu.',{exact:true}).waitFor();
  assert.match(await content.locator('.web-order-paper').innerText(),/108.000/);assert.equal(await content.locator('.web-order-paper tbody tr').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page-wide horizontal overflow');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:out+'/'+c.source+'-'+c.width+'.png',fullPage:true,style:'#toasts {visibility:hidden}'});
  const webHash=new URL(page.url()).hash;
  await page.evaluate(()=>{window.print=()=>{window.__webPrinted=true;};});await content.getByRole('button',{name:'In / lưu đơn hàng',exact:true}).click();await page.waitForFunction(()=>window.__webPrinted===true);assert.match(await page.locator('#print-sheet').textContent(),new RegExp(c.number));
  await page.evaluate(()=>{dispatchEvent(new Event('afterprint'));location.hash='#/orders/regular-ui';});await page.waitForFunction(()=>document.querySelector('#order-title')?.textContent==='DH-UI-REGULAR'&&document.querySelector('#web-order-content')?.hidden);assert.equal(await page.locator('#web-order-content').isVisible(),false);assert.equal(await page.locator('#order-customer-card').isVisible(),true);
  await page.evaluate(hash=>{location.hash=hash;},webHash);await page.locator('#web-order-content').getByRole('heading',{name:c.name,exact:true}).first().waitFor();assert.equal(await page.locator('#view-order > .editor-head').isVisible(),false);
  assert.deepEqual(errors,[]);results.push({...c,editedTotal:108000,printed:true,regularRestore:true,errors});await context.close();
 }
 assert.equal((await f.db.select().from(salesOrders)).length,1,'only the pre-seeded normal order; no duplicate physical sales orders');assert.equal((await f.db.select().from(webStoreOrders)).length,4);
 assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='/api/staff/orders').length,0);assert.equal(requests.some(r=>r.path.includes('/checkout')||r.path.includes('/payments')),false);
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
