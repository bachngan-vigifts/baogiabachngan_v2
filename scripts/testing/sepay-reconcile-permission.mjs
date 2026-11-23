/** Synthetic bank evidence only; all browser requests outside localhost are blocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {customerPayments} from '../../src/modules/sales/schema.ts';
import {employees,positionPermissions} from '../../src/modules/staff/schema.ts';
import {setupSepay} from '../../tests/helpers/sepay-fixture.ts';
import {sepayTransactions as bank} from '../../src/modules/integrations/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSepay(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.BROWSER_EVIDENCE_DIR||'/workspace/artifacts/sepay-reconcile';await mkdir(out,{recursive:true});
const user=(await f.call('/me',f.emp)).data.user,catalog=(await f.call('/permissions',f.mgr)).data,position=catalog.positions.find(p=>p.id===user.positionId);
f.env.sepayDebitImportEnabled=true;
await f.call('/permissions/positions/'+position.id,f.mgr,'PUT',{perms:[...new Set([...position.perms,'page.sepay'])]});
await f.incoming('BN INCOMING',100000);await f.incoming('VG INCOMING',200000,{accountNumber:'159063909'});
const debit=(id,accountNumber,amount)=>({id,providerId:id,transferType:'out',accountNumber,amount,transactionAt:f.stamp,content:'PRIVATE DEBIT '+id,status:'review',reason:'Tiền ra; không ghi thu.',payload:'{}',receivedAt:f.stamp});
await f.db.insert(bank).values([debit('BN-DEBIT','123456',888888),debit('VG-DEBIT','159063909',777777)]);
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,'');const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(r.data));return;}const path=u.pathname==='/'?'/index.html':u.pathname;let body=await readFile(root+path);if(path==='/index.html')body=Buffer.from(body.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(body);}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];

try{for(const positionId of ['sales-lock','sale-admin','accounting'])for(const width of [1280,390]){
 await f.db.update(employees).set({positionId}).where(eq(employees.id,'emp'));
 await f.db.insert(positionPermissions).values(['page.sepay','sepay.reconcile-incoming'].map(permission=>({positionId,permission}))).onConflictDoNothing();
 const target=await f.order('RECONCILE_'+positionId+'_'+width,{ownerId:'emp',createdBy:'emp',customerId:null}),event=await f.incoming('MANUAL PROOF '+positionId+' '+width);
 const context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(token=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);},f.emp.split('=')[1]);
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(origin+'/#/sepay?from=2026-11-08&to=2026-11-08');
 const query=p.locator('[data-filters] input[name=q]');await query.fill(event.content);await p.locator('[data-filters] button[type=submit]').click();
 await p.locator('[data-open="'+event.id+'"]').click();await p.locator('[data-order-search]').waitFor();
 if(positionId!=='accounting'){assert.equal(await p.locator('[name=direction]').isVisible(),false);assert.doesNotMatch(await p.locator('#view-sepay').innerText(),/PRIVATE DEBIT/);}
 await p.locator('[name=orderQuery]').fill(target.orderNo);await p.locator('[data-order-search] button[type=submit]').click();
 await p.locator('[data-choose="'+target.id+'"]').click();await p.locator('[data-approval-form] textarea').fill('Đã đối chiếu đúng giao dịch ngân hàng và đúng đơn khách hàng.');
 await p.locator('[data-approval-form] input[type=checkbox]').check();await p.locator('[data-approval-form] button[type=submit]').click();await p.locator('[data-confirm]').waitFor();
 assert.equal((await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,target.id))).length,0,'review is read only');
 await p.screenshot({path:out+'/'+positionId+'-'+width+'.png',fullPage:true});await p.locator('[data-confirm]').click();
 await p.locator('[data-detail]').filter({hasText:'Đã ghi thu'}).waitFor();
 const receipts=await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,target.id));assert.equal(receipts.length,1);assert.equal(receipts[0].createdBy,'emp');assert.deepEqual(errors,[]);
 results.push({positionId,width,reviewBeforeWrite:true,confirmed:true,debitAccess:positionId==='accounting'});await context.close();
}await writeFile(out+'/browser.json',JSON.stringify(results,null,2));console.log('PASS',JSON.stringify(results));}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
