/** Local CRM component + router permissions; fake order cohorts and delayed reads, no production access. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {filterPosOrderBoard} from '../../src/modules/sales/domain/pos-order-board.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/workspace/scratch/pos-order-filter-feedback',results=[],requests=[];let mode='full';await mkdir(out,{recursive:true});
const made=await f.call('/pos/registers',f.mgr,'POST',{name:'Showroom Minh Long thử',warehouseId:'pos-wh',pricePolicyId:'retail-vat',secondPricePolicyId:'retail'});assert.equal(made.status,200);const ml=made.data.id;
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),path=u.pathname.slice('/api/staff'.length)+u.search,r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,body);
  if(u.pathname.endsWith('/pos/orders')&&r.status===200){
   const registerId=u.searchParams.get('registerId'),family=registerId===ml?'ML':'LOCK',count=mode==='full'?48:200,at=new Date().toISOString().slice(0,10);
   const rows=Array.from({length:count},(_,i)=>({id:family+'-'+i,orderNo:family+'-'+i,customerName:'Khách thử '+i,phone:'',ownerId:'emp',ownerName:'NV thử',sapoOrderCode:null,orderDate:at,createdAt:at,bucket:['pending','packing','waiting_delivery','completed','cancelled'][i%5],orderSource:i%4===0?'web':'pos',source:'crm',external:false,fulfillmentMode:'pickup',paymentStatus:i%5===3?'paid':'debt',total:1000+i,paid:i%5===3?1000+i:0,outstanding:i%5===3?0:1000+i,currency:'VND'}));
   const d=filterPosOrderBoard(rows,u.searchParams),offset=Number(u.searchParams.get('offset')||0);requests.push({mode,family,status:u.searchParams.get('status')});if(mode==='partial'&&u.searchParams.get('status')!=='all')await new Promise(done=>setTimeout(done,2000));
   r.data={...r.data,...d,totalOrders:d.orders.length,orders:d.orders.slice(offset,offset+100),nextOffset:offset+100<d.orders.length?offset+100:null};
  }
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;if(path.includes('..')){res.writeHead(404).end();return;}let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),user=(await f.call('/me',f.mgr)).data.user;
try{
 for(const runMode of ['full','partial'])for(const family of ['LOCK','ML'])for(const width of [1280,390]){
  mode=runMode;const context=await browser.newContext({viewport:{width,height:1004},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.mgr.split('=')[1]});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto(origin+'/#/pos');const board=page.locator('.pos-order-board');await board.locator('.pos-order-row').first().waitFor();if(family==='ML'){await page.getByRole('combobox',{name:'Lọc đơn theo cửa hàng'}).selectOption(ml);await page.waitForFunction(()=>document.querySelector('.pos-order-list')?.textContent.includes('ML-'));}
  await page.waitForFunction(()=>document.querySelector('.pos-order-board')?.getAttribute('aria-busy')==='false');await board.scrollIntoViewIfNeeded();
  const before=requests.length,start=Date.now(),web=board.locator('[data-order-status=web]');await web.click();
  if(mode==='partial'){
   assert.equal(await board.getAttribute('aria-busy'),'true');assert.equal(await web.isDisabled(),true);await board.getByText('Đang lọc: Đơn web…',{exact:true}).waitFor();await board.getByRole('searchbox',{name:'Tìm đơn hàng cửa hàng'}).click();assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Tìm đơn hàng cửa hàng');
   await page.evaluate(()=>{const b=document.querySelector('[data-order-status=web]');b.dispatchEvent(new Event('click',{bubbles:true}));b.dispatchEvent(new Event('click',{bubbles:true}));});
   await board.locator('.pos-order-counts').screenshot({path:out+'/'+family+'-'+width+'-loading.png',style:'#toasts {visibility:hidden}'});
   await page.waitForFunction(()=>document.querySelector('.pos-order-board')?.getAttribute('aria-busy')==='false');assert.equal(requests.length-before,1,'no duplicate fetch from repeat clicks');
  }else{assert.equal(await board.getAttribute('aria-busy'),'false');assert.equal(requests.length-before,0,'complete cohort filters without a server read');}
  const firstFilterMs=Date.now()-start,afterFirst=requests.length,repeat=Date.now();await board.locator('[data-order-status=all]').click();await web.click();assert.equal(requests.length,afterFirst,'recent exact filters or complete local cohort reuse data');assert.equal(await web.getAttribute('aria-pressed'),'true');assert.equal(await board.getAttribute('aria-busy'),'false');assert.deepEqual(errors,[]);results.push({mode,family,width,firstFilterMs,repeatFiltersMs:Date.now()-repeat,newRequests:requests.length-before,immediateFeedback:true,doubleClickSafe:true,errors});await context.close();
 }
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
