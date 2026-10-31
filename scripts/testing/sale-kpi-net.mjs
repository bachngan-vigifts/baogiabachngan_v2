/** Real local CRM/router/PGlite: discover salary settings and configure Sale Admin rewards, never production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSalesPayroll(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json','server-timing':'local;dur=1'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/sale-kpi-net',results=[];await mkdir(out,{recursive:true});



async function pageFor(width,cookie){
 const context=await browser.newContext({viewport:{width,height:1050},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=(await f.call('/me',cookie)).data.user;
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:cookie.split('=')[1]});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};
}

try{
 const [l]=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,'liq-order'));
 await f.db.insert(quotations).values({id:'net-quote',creatorId:'emp',quoteNo:'BG-NET',quoteType:'B2B',customer:'Khách thử',data:JSON.stringify({rows:[{name:l.name,sku:l.sku,qty:1,price:100000000,commission:{mode:'percent',value:5}}]}),createdAt:f.stamp,updatedAt:f.stamp});
 await f.db.update(salesOrders).set({quoteId:'net-quote',subtotal:100000000,tax:8000000,total:108000000}).where(eq(salesOrders.id,'liq-order'));await f.db.update(salesOrderLines).set({qty:1,unitPrice:100000000,amount:100000000}).where(eq(salesOrderLines.id,l.id));
 await f.setPolicy(1,'2026-10',{saleKpiNetFrom:202610});await f.salary();
 for(const width of [1280,390]){
  await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{kpiOverride:1.2});
  const {context,page,errors}=await pageFor(width,f.mgr);await page.goto(origin+'/#/members/emp?month=2026-10&tab=payroll');const root=page.locator('#member-detail');await root.getByText('DS net tính thưởng KPI:',{exact:false}).waitFor();
  assert.match(await root.locator('.md-slip').innerText(),/95.000.000/);assert.match(await root.locator('.md-slip').innerText(),/950.000/);assert.equal(await root.locator('[data-act="contract-bonus"]').count(),0);
  await root.locator('[data-act="inputs"]').click();const dialog=page.locator('dialog[open]').filter({has:page.locator('[name="kpiOverride"]')});await dialog.locator('[name="kpiOverride"]').fill('130');await dialog.getByRole('button',{name:'Lưu số liệu',exact:true}).click();await dialog.waitFor({state:'detached'});await root.getByText('1.140.000',{exact:false}).first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('#toasts .toast').length===0);
  const view=(await f.overview()).data.payroll.payslip;assert.equal(view.kpiNetBasis.netRevenue,95000000);assert.equal(view.kpiNetBasis.rate,0.012);assert.equal(view.income.find(l=>l.key==='kpiBonus').amount,1140000);assert.equal(view.income.find(l=>l.key==='contractBonus').amount,0);await root.locator('.md-slip').screenshot({path:out+'/sale-'+width+'.png'});assert.deepEqual(errors,[]);results.push({width,kpi120:950000,kpi130:1140000,net:95000000,vatExcluded:true,customerCommission:5000000,starBonus:0,errors});await context.close();
 }
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
