/** Real CRM UI/router/PGlite: original slip banner, decoded before print, portrait/landscape PDFs. Local synthetic data only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {salesOrders,deliveries,deliveryLines,packingSlips,packingSlipLines} from '../../src/modules/sales/schema.ts';
import {setupCrmReturns} from '../../tests/helpers/crm-return-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupCrmReturns(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json','server-timing':'local;dur=1'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/slip-letterhead',results=[];await mkdir(out,{recursive:true});


try{
 const id='letterhead-test',at='2026-11-01T00:00:00Z';await f.seed(id,0,'emp',false);
 await f.db.update(salesOrders).set({status:'confirmed'}).where(eq(salesOrders.id,id));
 await f.db.insert(deliveries).values({id:'letterhead-trip',deliveryNo:'GH-LETTERHEAD-TEST',orderId:id,plannedDate:'2026-11-02',createdBy:'emp',createdAt:at,updatedAt:at});
 await f.db.insert(deliveryLines).values([{deliveryId:'letterhead-trip',orderLineId:id+'-b',qty:2},{deliveryId:'letterhead-trip',orderLineId:id+'-a',qty:2}]);
 await f.db.insert(packingSlips).values({id:'letterhead-pack',slipNo:'PK-LETTERHEAD-TEST',orderId:id,createdBy:'emp',createdAt:at,updatedAt:at});
 await f.db.insert(packingSlipLines).values([{id:'pl-b',slipId:'letterhead-pack',orderLineId:id+'-b',sku:'22566',name:'Bộ đồ ăn 22 sản phẩm',unit:'Bộ',qty:2},{id:'pl-a',slipId:'letterhead-pack',orderLineId:id+'-a',sku:'09566',name:'Bộ đồ ăn 09 sản phẩm',unit:'Bộ',qty:2}]);
 const context=await browser.newContext({viewport:{width:1440,height:1100},locale:'vi-VN'});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const user=f.ok(await f.call('/me',f.emp)).user;
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));window.printCalls=[];window.print=()=>window.printCalls.push({decoded:document.querySelector('#print-sheet .slip-letterhead')?.naturalWidth,rule:document.querySelector('[data-print-page]')?.textContent});},{user,token:f.emp.split('=')[1]});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/orders/'+id);await page.locator('[data-ship-print-for]').waitFor();
 for(const kind of ['delivery','packing']){
  await page.locator(kind==='delivery'?'[data-ship-print-for]':'[data-pack-print-for]').first().click();
  const dlg=page.locator('.order-print-dialog[open]');await dlg.waitFor();
  const banner=dlg.locator('.slip-letterhead');await banner.evaluate(n=>n.decode());
  const image=await banner.evaluate(n=>({width:n.naturalWidth,height:n.naturalHeight,displayWidth:n.getBoundingClientRect().width,displayHeight:n.getBoundingClientRect().height}));
  assert.equal(image.width,1280);assert.equal(image.height,230);assert.ok(Math.abs(image.displayHeight/image.displayWidth-230/1280)<0.001);
  await dlg.locator('[data-sheet]').screenshot({path:out+'/'+kind+'-preview.png'});
  for(const orient of ['portrait','landscape']){
   await dlg.locator('[data-orient]').selectOption(orient);
   const previous=await page.evaluate(()=>window.printCalls.length);
   await dlg.locator('[data-print]').click();await page.waitForFunction(n=>window.printCalls.length>n,previous);
   const call=await page.evaluate(()=>window.printCalls.at(-1));assert.equal(call.decoded,1280);assert.match(call.rule,/margin: 20mm 8mm 10mm 8mm/);
   await page.pdf({path:out+'/'+kind+'-'+orient+'.pdf',preferCSSPageSize:true,printBackground:true});
   results.push({kind,orient,headerDecodedBeforePrint:true,marginTopMm:20,image});
   await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await page.waitForTimeout(550);
  }
  await dlg.getByRole('button',{name:'Đóng',exact:true}).first().click();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({results,errors}));await context.close();
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
