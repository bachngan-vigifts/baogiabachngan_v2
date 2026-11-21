/** Điện thoại: "Đang giao" / "Đã giao" hiện ngay trên thẻ chuyến giao, không phải mở Chi tiết; Huỷ vẫn trong Chi tiết. PGlite cục bộ. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {deliveries} from '../../src/modules/sales/schema.ts';
import {setupWarehouseOps,makeCrm} from '../../tests/helpers/warehouse-approval-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupWarehouseOps(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.SCREENSHOT_DIR||'/tmp/mobile-delivery-actions';await mkdir(out,{recursive:true});
await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:532,kind:'opening',refType:'opening',refId:'mda-opening'}]);
const data=await makeCrm(f,'MDA',300,'00123','pos-wh',false),orderId=data.order.id;
const trip=await f.call('/deliveries',f.emp,'POST',{orderId,plannedDate:'2026-10-26',lines:[{orderLineId:data.lines[0].id,qty:300}]});assert.equal(trip.status,201,JSON.stringify(trip.data));
const made=await f.call('/orders/'+orderId+'/packing',f.mgr,'POST',{allocations:[{orderLineId:data.lines[0].id,qty:300,source:'warehouse'}],sendToWarehouse:true});assert.equal(made.status,201,JSON.stringify(made.data));
const packed=await f.call('/packing/'+made.data.slips[0].id+'/confirm',f.mgr,'POST',{warehouseId:'pos-wh',photos:['data:image/jpeg;base64,'+'A'.repeat(100)]});assert.equal(packed.status,200,JSON.stringify(packed.data));
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://l'),path=u.pathname;
 if(path.startsWith('/api/staff/')){const ch=[];for await(const c of req)ch.push(c);const body=ch.length?JSON.parse(Buffer.concat(ch).toString()):undefined;const t=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(path.slice(10)+u.search,t?'__Host-bn-session='+t:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.svg')?'image/svg+xml':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'vi-VN',hasTouch:true,isMobile:true});await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const user=(await f.call('/me',f.emp)).data.user;await ctx.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.emp.split('=')[1],user});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#/deliveries?deliveryId='+trip.data.id);await page.getByRole('link',{name:'Danh sách chuyến giao'}).click();const row=page.locator('#deliveries-list tr').filter({has:page.locator('[data-to=in_transit]')});await row.waitFor();
 const go=row.locator('[data-to=in_transit]'),done=row.locator('[data-to=delivered]'),cancel=row.locator('[data-to=cancelled]');
 assert.equal(await go.isVisible(),true,'Đang giao thấy ngay');assert.equal(await done.isVisible(),true,'Đã giao thấy ngay');assert.ok(await row.evaluate(r=>r.getBoundingClientRect().width)>300,'thẻ chuyến giao rộng hết màn hình');assert.equal(await cancel.isVisible(),false,'Huỷ vẫn trong Chi tiết');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);await go.scrollIntoViewIfNeeded();await page.evaluate(()=>document.querySelectorAll('.toast').forEach(t=>t.remove()));await page.screenshot({path:out+'/390-list.png'});
 await go.click();let d;for(let i=0;i<25&&(d=(await f.db.select().from(deliveries).where(eq(deliveries.id,trip.data.id)))[0]).status==='planned';i++)await page.waitForTimeout(200);
 assert.equal(d.status,'in_transit');
 await row.getByRole('button',{name:'Chi tiết'}).click().catch(()=>{});assert.deepEqual(errors,[]);console.log('ok 390');await ctx.close();
}finally{await browser.close();server.close();}
