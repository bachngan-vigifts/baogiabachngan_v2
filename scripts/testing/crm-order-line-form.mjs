/** Real read-only CRM API with synthetic stored POS/CRM/contract prices; no external requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {salesOrders,salesOrderLines,salesContracts,paymentSchedules} from '../../src/modules/sales/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const f=await setup(),phase=process.argv[2]||'after',root=process.env.CRM_FORM_UI_DIR||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/crm-order-line-form-'+phase;
await mkdir(out,{recursive:true});
const now=new Date().toISOString(),writes=[],calls=[];
const rows=[{id:'product',lineNo:1,sku:'00123',name:'Sản phẩm mẫu <img onerror=alert(1)>',unit:'Cái',qty:2,unitPrice:95000,listUnitPrice:100000,discountType:'percent',discountValue:10,discountAmount:20000,taxRate:8,amount:190000},
{id:'fee',lineNo:2,sku:'',name:'Phí đóng gói',unit:'Gói',qty:1,unitPrice:10000,listUnitPrice:10000,discountType:'amount',discountValue:0,discountAmount:0,taxRate:10,amount:10000}];
for(const id of ['crm-form','contract-form','legacy-form','pos-form']) {
 const pos=id==='pos-form';
 const quoteId=pos?null:'quote-'+id;
 if(quoteId)await f.db.insert(quotations).values({id:quoteId,creatorId:'mgr',quoteNo:'BG_'+id,quoteType:'B2B',customer:'KHÁCH HÀNG KIỂM THỬ',approvalStatus:'approved',createdAt:now,updatedAt:now,data:JSON.stringify({type:'B2B',vat:8,rows:[{sku:'00123',name:'Sản phẩm mẫu',unit:'Cái',qty:2,price:100000,discount:10,printFee:5000,taxRate:8},{manualLine:true,name:'Phí đóng gói',unit:'Gói',qty:1,price:10000,taxRate:10}]})});
 const stored=rows.map(l=>({...l,...(pos?{listUnitPrice:l.id==='product'?108000:11000,discountValue:l.id==='product'?5:0,discountAmount:l.id==='product'?10800:0}:{})}));
 await f.db.insert(salesOrders).values({id,quoteId,quoteNo:quoteId?'BG_'+id:'',orderNo:id,quoteType:'B2B',customerId:f.customerId,customerName:'KHÁCH HÀNG KIỂM THỬ',ownerId:'mgr',createdBy:'mgr',channel:pos?'pos':'crm',status:'draft',subtotal:200000,tax:16200,total:216200,orderDate:now.slice(0,10),createdAt:now,updatedAt:now,note:'Giao theo lịch đã hẹn',posSnapshot:pos?JSON.stringify({lines:stored.map(l=>({...l,total:l.amount*(1+l.taxRate/100),tax:l.amount*l.taxRate/100}))}):'{}'});
 await f.db.insert(paymentSchedules).values({id:'balance-'+id,orderId:id,kind:'balance',amount:216200,createdAt:now});
 for(const row of stored) await f.db.insert(salesOrderLines).values({...row,id:id+'-'+row.id,orderId:id,...(id==='legacy-form'?{listUnitPrice:null,discountAmount:0}:{} )});
}
await f.db.insert(salesContracts).values({id:'contract-form-doc',contractNo:'11/10112026/HĐKT/VG-TEST',orderId:'contract-form',legalEntity:'VG',status:'draft',value:216200,createdBy:'mgr',createdAt:now,updatedAt:now});
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')) {
  if(req.method!=='GET'){writes.push(req.url);res.writeHead(405).end();return;}
  const token=req.headers.authorization?.replace(/^Bearer /,''),path=u.pathname.slice('/api/staff'.length)+u.search;
  calls.push(path);const r=await f.call(path,token?'__Host-bn-session='+token:'');
  res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify(r.data));return;
 }
 const p=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+p);
 if(p.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'cache-control':'no-store','content-type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8'}).end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),user=(await f.call('/me',f.mgr)).data.user,runs=[];
async function context(width){const c=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await c.addInitScript(({token,user})=>{if(location.origin==='null')return;localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));window.__perf={lcp:null,cls:0};new PerformanceObserver(l=>window.__perf.lcp=l.getEntries().at(-1).startTime).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__perf.cls+=e.value;}).observe({type:'layout-shift',buffered:true});},{token:f.mgr.split('=')[1],user});return c;}
try{
 for(const width of [1440,390])for(let run=1;run<=3;run++){
  const c=await context(width),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));const cdp=await c.newCDPSession(p);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:1600000,uploadThroughput:750000});
  const start=performance.now(),before=calls.length;await p.goto(origin+'/#/orders/crm-form');await p.locator('#order-lines tr').first().waitFor();const ready=performance.now()-start;await p.waitForTimeout(800);
  const metrics=await p.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0],r=performance.getEntriesByType('resource');return{ttfb:n.responseStart-n.requestStart,load:n.loadEventEnd-n.startTime,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,lcp:window.__perf.lcp,cls:window.__perf.cls,jsRequests:r.filter(x=>new URL(x.name).pathname.endsWith('.js')).length,jsBytes:r.filter(x=>new URL(x.name).pathname.endsWith('.js')).reduce((s,x)=>s+x.encodedBodySize,0)};});
  runs.push({width,run,ready,...metrics,openingApis:calls.length-before});assert.deepEqual(errors,[]);await c.close();
 }
 if(phase!=='before')for(const width of [1440,390])for(const id of ['crm-form','contract-form','legacy-form','pos-form']){
  const c=await context(width),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/#/'+(id==='contract-form'?'contracts/':'orders/')+id);await p.locator('#order-lines tr').first().waitFor();
  assert.equal(await p.locator('#order-lines-head th').count(),8);
  assert.equal(await p.locator('#order-lines tr').count(),2);
  const text=await p.locator('#order-line-details').textContent();assert.ok(text.includes('216.200 đ'),text);
  if(id==='legacy-form'){assert.ok(text.includes('Chưa có đủ dữ liệu'));assert.ok((await p.locator('#order-lines').textContent()).includes('Chưa lưu CK'));}
  else if(id!=='pos-form'){assert.ok((await p.locator('#order-lines').textContent()).includes('100.000 đ'));assert.ok((await p.locator('#order-lines').textContent()).includes('10%'));assert.ok((await p.locator('#order-lines').textContent()).includes('Đã gồm phí in 5.000 đ'));}
  assert.equal(await p.locator('#order-lines img,#order-lines script').count(),0);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  assert.deepEqual(errors,[]);assert.equal(await p.getByText('Kết nối chậm – đã tạm chuyển máy chủ dự phòng, sẽ tự kiểm tra lại kết nối.',{exact:true}).count(),0);await p.locator('#order-lines').scrollIntoViewIfNeeded();await p.screenshot({path:out+'/'+id+'-'+width+'.png'});await c.close();
 }
 const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)],summary=[1440,390].map(width=>{const subset=runs.filter(r=>r.width===width);return{width,...Object.fromEntries(Object.keys(subset[0]).filter(k=>!['width','run'].includes(k)).map(k=>[k,median(subset.map(r=>r[k]))]))};});
 assert.equal(writes.length,0);await writeFile(out+'/results.json',JSON.stringify({phase,conditions:{runsPerViewport:3,latencyMs:40,downloadBps:1600000,source:'real local router + synthetic stored records, not production'},runs,summary},null,2));console.log(JSON.stringify(summary));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
