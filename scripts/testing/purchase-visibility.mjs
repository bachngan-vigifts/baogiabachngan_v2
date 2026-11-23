/** Real local API/PGlite and browser modules; no production data or external integration calls. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {eq} from 'drizzle-orm';
import {warehouses,products} from '../../src/modules/catalog/schema.ts';
import {warehouseSellers} from '../../src/modules/inventory/schema.ts';
import {incomingShipments,supplierReceipts,suppliers} from '../../src/modules/suppliers/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),root=new URL('../../trial-ui/',import.meta.url).pathname;
await f.db.insert(warehouses).values({id:'scope-wh',name:'Kho nhận',kind:'stock'});await f.db.insert(warehouseSellers).values({warehouseId:'scope-wh',positionId:'warehouse'});
await f.db.insert(products).values({sku:'0001',name:'Ly thử <img src=x>',unit:'Cái',updatedAt:new Date().toISOString()});await f.db.transaction(tx=>postMoves(tx,'mgr',[{sku:'0001',warehouseId:'scope-wh',qty:1,kind:'opening',refType:'opening',refId:'visibility-opening'}]));
const html=`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/suppliers.css"><main id="root"></main><script type="module">
import {initSuppliers} from '/suppliers.js';import {initReceivingCalendar} from '/receiving-calendar.js';
const api=async(path,method='GET',body)=>{const r=await fetch('/api/staff'+path,{method,headers:{authorization:'Bearer '+window.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||data.message||'Không lưu được'),{status:r.status});return data;};
const user=(await api('/me')).user,root=document.querySelector('#root');window.api=api;
if(user.positionId==='warehouse'){await initReceivingCalendar({api,root,warehouse:()=>true}).load();}else{const view=initSuppliers({api,root,toast:m=>{window.message=m;},confirmBox:async()=>true,canLinkAccounts:()=>user.role==='manager'});await view.load();await view.open('a');}window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,'')||'',r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}if(u.pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}const path=root+u.pathname;res.setHeader('content-type',u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path));}catch(e){res.writeHead(500).end(e.message);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});await mkdir('/tmp/codex3-purchase-visibility',{recursive:true});
try{for(const width of [390,1280]){
 const context=await browser.newContext({viewport:{width,height:940}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(()=>window.token=localStorage.getItem('test-token'));
 const errors=[],page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.goto(origin+'/style.css');
 async function login(cookie){await page.evaluate(token=>localStorage.setItem('test-token',token),cookie.split('=')[1]);await page.goto(origin);await page.waitForFunction(()=>window.ready);}
 await login(f.cookies.mgr);const brand=page.locator('select[name="saleAdminBrand"]');await brand.selectOption(width===390?'minhlong':'locknlock');
 const saved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/suppliers/a'));await page.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();assert.equal((await saved).status(),200);await page.screenshot({path:'/tmp/codex3-purchase-visibility/manager-'+width+'.png'});
 await login(f.cookies.kt);assert.equal(await page.locator('select[name="saleAdminBrand"]').count(),0,'Kế toán không có ô cấp hãng');
 // Only one open receipt source at the mapped warehouse, isolated for each viewport.
 const made=await f.call('/purchase-orders',f.cookies.mgr,'POST',{orders:[{supplierId:'a',warehouse:'Kho nhận',lines:[{sku:'0001',quantity:3}]}]});assert.equal(made.status,201,JSON.stringify(made.data));const id=made.data.ids[0];await f.db.update(incomingShipments).set({approvalStatus:'approved'}).where(eq(incomingShipments.id,id));
 await login(f.cookies.kho);assert.match(await page.locator('body').innerText(),/Nhận hàng được giao/);assert.equal(await page.locator('img').count(),0,'Tên SKU là chữ');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'không tràn ngang');await page.getByRole('button',{name:'Nhận hàng',exact:true}).last().click();await page.getByLabel('SL đạt', {exact:true}).fill('1');await page.getByLabel('Tạo phiếu Sapo sau khi lưu').uncheck();
 const bodies=[];let drop=true;await page.route('**/api/staff/purchase-orders/*/receipts',async r=>{bodies.push(r.request().postDataJSON());if(drop){drop=false;await r.fetch();await r.abort('connectionreset');}else await r.continue();});
 await page.getByRole('button',{name:'Lưu phiếu nhận',exact:true}).click();await page.locator('form p').filter({hasText:/fetch|Không lưu được/i}).waitFor();assert.equal(await page.getByLabel('SL đạt',{exact:true}).inputValue(),'1');
 await page.getByRole('button',{name:'Lưu phiếu nhận',exact:true}).click();await page.getByText('Đã lưu phiếu nhận.',{exact:true}).waitFor();assert.equal(bodies.length,2);assert.deepEqual(bodies[0],bodies[1]);
 assert.equal((await f.db.select().from(supplierReceipts).where(eq(supplierReceipts.shipmentId,id))).length,1);
 const privateRead=await page.evaluate(id=>api('/purchase-orders/'+id).then(()=>200,e=>e.status),id);assert.equal(privateRead,403);
 await page.screenshot({path:'/tmp/codex3-purchase-visibility/warehouse-'+width+'.png'});assert.deepEqual(errors,[]);console.log(JSON.stringify({width,managerBrand:true,accountantNoBrandEdit:true,warehouseOperationalOnly:true,lostAckOneReceipt:true,jsErrors:0}));await context.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
