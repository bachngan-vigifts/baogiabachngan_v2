/** Local CRM/router/PGlite only: collect CRM cash without an open POS shift. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupWarehouseOps,makeCrm} from '../../tests/helpers/warehouse-approval-fixture.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {customerPayments} from '../../src/modules/sales/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupWarehouseOps(),order=(await makeCrm(f,'cash-browser')).order,root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),results=[],out='/workspace/scratch/crm-cash-without-drawer';await mkdir(out,{recursive:true});
await f.db.update(employees).set({positionId:'sale'}).where(eq(employees.id,'emp'));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;if(path.includes('..')){res.writeHead(404).end();return;}let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 for(const [actor,cookie,width]of [['sale',f.emp,1280],['sale-admin',f.sa,390],['manager',f.mgr,1280]]){
  const user=(await f.call('/me',cookie)).data.user,context=await browser.newContext({viewport:{width,height:1004},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:cookie.split('=')[1]});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/orders/'+order.id);
  if(actor==='manager'){
   await page.getByRole('button',{name:'Xác nhận đã nhận tiền',exact:true}).first().waitFor();
   await page.locator('#order-payments .cash-collections').screenshot({path:out+'/manager-pending.png',style:'#toasts {visibility:hidden}'});
   for(let n=0;n<2;n++){
    const paid=(await f.call('/orders/'+order.id,cookie)).data.receivable.paid;
    await page.getByRole('button',{name:'Xác nhận đã nhận tiền',exact:true}).first().click();await page.locator('#confirm-ok').click();
    await page.waitForFunction(expected=>document.querySelectorAll('.cash-collections button.btn.primary').length===expected,1-n);
    assert.equal((await f.call('/orders/'+order.id,cookie)).data.receivable.paid,paid+100);
   }
   assert.equal((await f.call('/orders/'+order.id,cookie)).data.cashHeld,0);
  }
  await page.locator('#order-new-payment').click();const form=page.locator('#payment-form');await form.locator('input[name=amount]').fill('100');await form.locator('select[name=method]').selectOption('cash');await page.locator('#payment-cash-note').waitFor();await form.locator('select[name=method]').selectOption('transfer');assert.equal(await page.locator('#payment-cash-note').isVisible(),false);await form.locator('select[name=method]').selectOption('cash');await page.locator('#payment-dialog').screenshot({path:out+'/'+actor+'-'+width+'.png'});
  const before=(await f.call('/cash',f.mgr)).data.balance,paidBefore=(await f.call('/orders/'+order.id,cookie)).data.receivable.paid;
  await page.getByRole('button',{name:actor==='manager'?'Lưu phiếu thu':'Ghi nhận tiền nhân viên giữ',exact:true}).click();await page.locator('#payment-dialog').waitFor({state:'hidden'});const detail=(await f.call('/orders/'+order.id,cookie)).data;
  assert.equal(detail.receivable.paid,paidBefore+(actor==='manager'?100:0));assert.equal((await f.call('/cash',f.mgr)).data.balance,before);
  if(actor!=='manager'){
   assert.ok(detail.cashCollections.some(p=>p.collectedBy===user.id&&p.status==='held'));
   await page.locator('.cash-collections').waitFor();assert.equal(await page.getByRole('button',{name:'Xác nhận đã nhận tiền',exact:true}).count(),0);
   await page.locator('.cash-collections').screenshot({path:out+'/'+actor+'-held.png',style:'#toasts {visibility:hidden}'});
  }else{const payments=await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,order.id));assert.equal(payments.length,3);assert.ok(payments.every(p=>p.shiftId===null));}
  assert.deepEqual(errors,[]);results.push({actor,width,noOpenShift:true,heldUntilManager:actor!=='manager',managerConfirmationWorks:actor==='manager',drawerUnchanged:true,cashNoteVisible:true,errors});await context.close();
 }
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
