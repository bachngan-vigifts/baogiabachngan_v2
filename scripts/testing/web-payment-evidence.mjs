/** Local CRM/browser check with synthetic orders only; never calls production or a carrier. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {posRegisters,webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/web-payment-evidence';await mkdir(out,{recursive:true});
await f.db.update(posRegisters).set({name:'Showroom Gốm Sứ Minh Long Cần Thơ'}).where(eq(posRegisters.id,f.registerId));
const synced=await f.call('/integrations/woocommerce/minhlong/order?token=test-ml-token','','POST',{id:990001,number:'990001',status:'processing',total:'100000',currency:'VND',payment_method_title:'Chuyển khoản ngân hàng trực tiếp',date_paid_gmt:'2026-11-18T04:33:54',billing:{first_name:'Khách kiểm thử'},line_items:[{sku:'00123',name:'Hàng thử',quantity:1,total:'100000'}]});assert.equal(synced.status,200);
f.env.ghnMlToken='local-fake-token';f.env.ghnMlShopId='local-fake-shop';let carrierCalls=0;
f.env.ghnFetch=async()=>{carrierCalls++;throw Error('This browser check must not create shipments');};
const [order]=await f.db.select().from(webStoreOrders);
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const auth=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,auth?'__Host-bn-session='+auth:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'}).end(data);}catch{res.writeHead(404).end('Fixture resource unavailable');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
 for(const width of [390,1280]){
  const user=(await f.call('/me',f.mgr)).data.user,token=f.mgr.split('=')[1],context=await browser.newContext({viewport:{width,height:1000}});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#/pos');await page.getByText('Website báo đã thanh toán · Chờ đối soát',{exact:false}).first().waitFor();await page.screenshot({path:out+'/pos-'+width+'.png',fullPage:true});
  await page.goto(origin+'/#/orders/'+encodeURIComponent('web:'+order.id));await page.getByText('Website báo đã thanh toán · Chờ đối soát',{exact:true}).first().waitFor().catch(async e=>{console.log(JSON.stringify({errors,body:(await page.locator('body').innerText()).slice(-5000)}));await page.screenshot({path:out+'/failure.png',fullPage:true});throw e;});await page.screenshot({path:out+'/detail-'+width+'.png',fullPage:true});
  await page.goto(origin+'/#/pos?webOrderId='+encodeURIComponent(order.id));await page.getByText('Chọn địa chỉ & tạo vận đơn GHN',{exact:true}).click();
  const dialog=page.locator('dialog[open]').last();await dialog.getByText('Đã đối chiếu tiền thực nhận và COD trên website/GHN (không ghi nhận phiếu thu)',{exact:true}).waitFor();
  assert.equal(await dialog.locator('input[type=number]').first().inputValue(),'');assert.equal(await dialog.locator('input[type=checkbox]').isChecked(),false);await dialog.screenshot({path:out+'/cod-review-'+width+'.png'});
  assert.equal(carrierCalls,0);assert.deepEqual(errors,[]);results.push({width,label:true,detail:true,codBlank:true,reviewUnchecked:true,carrierCalls,errors});await context.close();
 }
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
console.log(JSON.stringify(results));
