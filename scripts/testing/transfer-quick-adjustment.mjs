/** Local CRM/router/PGlite only; never connects to production or a carrier. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {and,eq} from 'drizzle-orm';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {stockBalances} from '../../src/modules/inventory/schema.ts';
import {setupWarehouseOps} from '../../tests/helpers/warehouse-approval-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupWarehouseOps(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),results=[],out='/workspace/scratch/transfer-quick-adjustment';
await mkdir(out,{recursive:true});await f.db.insert(warehouses).values({id:'target',name:'Kho nhận thử',kind:'stock'});
const made=await f.call('/stock-transfers',f.mgr,'POST',{clientKey:crypto.randomUUID(),fromWarehouseId:'pos-wh',toWarehouseId:'target',reason:'Lấy qua bán thử',lines:[{sku:'00123',qty:24}]});assert.equal(made.status,201,JSON.stringify(made.data));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;if(path.includes('..')){res.writeHead(404).end();return;}let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const user=(await f.call('/me',f.mgr)).data.user;
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1004},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.mgr.split('=')[1]});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#/transfers/'+made.data.id);const quick=page.getByRole('button',{name:'Cân bằng kho nhanh',exact:true});if(width===390){await page.locator('.transfer-detail-table').waitFor();assert.equal(await quick.isVisible(),false,'existing mobile inventory policy remains read-only');await page.locator('.sup-drawer').screenshot({path:out+'/readonly-'+width+'.png'});assert.deepEqual(errors,[]);results.push({width,existingMobileReadOnlyPolicy:true,errors});await context.close();continue;}await quick.waitFor();await quick.click();
  const form=page.locator('.inv-adjust-form');await form.waitFor();const wh=form.getByRole('combobox',{name:'Kho cân bằng'});assert.equal(await wh.inputValue(),'');assert.equal(await form.getByRole('textbox',{name:'Mã hàng',exact:true}).inputValue(),'00123');assert.equal(await form.getByRole('spinbutton',{name:'Số tăng / giảm',exact:true}).inputValue(),'');
  await page.locator('.inv-adjust-editor').screenshot({path:out+'/prefill-'+width+'.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  const balance=async()=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,'pos-wh'))))[0].qty;
  const before=await balance();await wh.selectOption('pos-wh');await form.getByRole('spinbutton',{name:'Số tăng / giảm',exact:true}).fill('2');await form.getByRole('button',{name:'Ghi phiếu điều chỉnh',exact:true}).click();await form.waitFor({state:'detached'});assert.equal(await balance(),before+2);const transfer=(await f.call('/stock-transfers/'+made.data.id,f.mgr)).data;assert.equal(transfer.status,'pending');assert.equal(transfer.lines[0].qty,24);assert.deepEqual(errors,[]);
  results.push({width,blankWarehouse:true,blankAdjustment:true,preloadedSku:true,confirmedAdjustmentPostedOnce:true,transferUnchanged:true,noOverflow:true,errors});await context.close();
 }
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
