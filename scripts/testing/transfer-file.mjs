/** Manager "Tạo & xuất kho" / "Tạo & duyệt" trên form điều chuyển; nhân viên vẫn "Gửi duyệt". Router thật + PGlite cục bộ, không gọi production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {and,eq} from 'drizzle-orm';
import {warehouses,products} from '../../src/modules/catalog/schema.ts';
import {stockBalances,stockTransfers} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {setupWarehouseOps} from '../../tests/helpers/warehouse-approval-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupWarehouseOps(),root=process.env.UI_ROOT||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.SCREENSHOT_DIR||'/tmp/transfer-file';await mkdir(out,{recursive:true});
await f.db.insert(warehouses).values({id:'target',name:'Kho nhận thử',kind:'stock'});
const opened=await f.db.select().from(stockBalances).where(eq(stockBalances.warehouseId,'pos-wh'));
const initial=opened.find(b=>b.sku==='00123')?.qty??0;
if(initial<100)await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:100-initial,kind:'opening',refType:'opening',refId:'fast-open'}]);
await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'target',qty:0.001,kind:'opening',refType:'opening',refId:'fast-open-target'}]);
const skus=Array.from({length:30},(_,i)=>'00FILE'+String(i).padStart(3,'0'));
await f.db.insert(products).values(skus.map(sku=>({sku,name:'Chén cơm sản phẩm thử '+sku+' tên đầy đủ để rà soát điều chuyển',unit:'Cái',updatedAt:new Date().toISOString()})));
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://l'),path=u.pathname;
 if(path.startsWith('/api/staff/')){const ch=[];for await(const c of req)ch.push(c);const body=ch.length?JSON.parse(Buffer.concat(ch).toString()):undefined;const t=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(path.slice(10)+u.search,t?'__Host-bn-session='+t:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.svg')?'image/svg+xml':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
const bal=async wh=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,wh))))[0]?.qty??0;
async function open(cookie,width){const ctx=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=(await f.call('/me',cookie)).data.user;
 await ctx.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:cookie.split('=')[1],user});const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return {ctx,page,errors};}

try{for(const width of [1280,390]){
 const {ctx,page,errors}=await open(f.mgr,width);await page.goto(origin+'/#/transfers');await page.getByRole('button',{name:'＋ Xin điều chuyển'}).click();const d=page.locator('.transfer-compose');
 const baseline=JSON.stringify(await f.db.select().from(stockBalances));const countBefore=(await f.db.select().from(stockTransfers)).length;
 const downloadEvent=page.waitForEvent('download');await d.getByRole('button',{name:'Tải file mẫu',exact:true}).click();const download=await downloadEvent;await download.saveAs(out+'/template-'+width+'.xlsx');
 const downloaded=await readFile(await download.path());
 const headers=await page.evaluate(base64=>{const w=XLSX.read(base64,{type:'base64',cellNF:true}),ws=w.Sheets[w.SheetNames[0]];if(ws.C2.z!=='@')throw Error('SKU not text formatted');return XLSX.utils.sheet_to_json(ws,{header:1})[0];},downloaded.toString('base64'));assert.deepEqual(headers,['Kho đi','Kho đến','Mã hàng','Số lượng']);
 const file=async rows=>Buffer.from(await page.evaluate(rows=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['Kho đi','Kho đến','Mã hàng','Số lượng'],...rows]),'Điều chuyển');return XLSX.write(w,{type:'base64',bookType:'xlsx'});},rows),'base64');
 await d.locator('input[type=file]').setInputFiles({name:'bad.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await file([['pos-wh','target','NOT_FOUND_FILE',1]])});
 await d.locator('.transfer-file-notice').filter({hasText:'không tìm thấy chính xác'}).waitFor();assert.equal((await f.db.select().from(stockTransfers)).length,countBefore);assert.equal(await d.locator('.transfer-lines [data-sku]:not([data-sku=""])').count(),0);
 await d.locator('input[type=file]').setInputFiles({name:'request.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await file(skus.map((sku,i)=>['pos-wh','target',sku,i+1]))});
 await d.locator('.transfer-file-notice').filter({hasText:'Đã kiểm tra 30 mã'}).waitFor();assert.equal(await d.locator('.transfer-lines [data-sku]').count(),30);assert.equal(await d.locator('select').nth(0).inputValue(),'pos-wh');assert.equal(await d.locator('select').nth(1).inputValue(),'target');
 assert.equal((await f.db.select().from(stockTransfers)).length,countBefore);assert.equal(JSON.stringify(await f.db.select().from(stockBalances)),baseline);
 await d.getByPlaceholder(/VD: đơn/).fill('Xin bằng file để bổ sung trưng bày');await d.locator('.transfer-lines input[type=number]').last().fill('32');
 assert.equal(await d.evaluate(n=>n.scrollWidth>n.clientWidth),false);await d.locator('.transfer-lines').evaluate(n=>n.scrollTop=n.scrollHeight);await page.screenshot({path:out+'/table-'+width+'.png'});
 await d.getByRole('button',{name:'Tạo & duyệt (kho xuất sau)',exact:true}).click();await page.waitForURL(/#\/transfers\//);
 const created=(await f.db.select().from(stockTransfers)).filter(t=>t.reason==='Xin bằng file để bổ sung trưng bày').at(-1);assert.ok(created);const detail=(await f.call('/stock-transfers/'+created.id,f.mgr)).data;assert.equal(detail.lines.length,30);assert.equal(detail.lines.find(l=>l.sku===skus.at(-1)).qty,32);assert.equal(created.status,'approved');assert.equal(JSON.stringify(await f.db.select().from(stockBalances)),baseline);assert.deepEqual(errors,[]);console.log('PASS '+width+'px: template, invalid file, 30-code XLSX preview/edit/approve, no stock movement');await ctx.close();
}}finally{await browser.close();server.close();await f.client.close();}
