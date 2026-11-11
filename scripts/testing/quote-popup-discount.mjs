/** Real UI + isolated API fixture. No production traffic or customer data. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {products} from '../../src/modules/catalog/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setup(),user=(await f.call('/me',f.mgr)).data.user,token=f.mgr.split('=')[1];
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.QUOTE_SCREENSHOT_DIR||'/tmp/quote-popup-discount';await mkdir(out,{recursive:true});
await f.db.insert(products).values([...Array.from({length:20},(_,i)=>({sku:'BULK-'+i,name:'Sản phẩm kiểm thử '+i,brand:'MINH LONG I',unit:'Cái',updatedAt:new Date().toISOString(),taxable:true,taxOut:8})),{sku:'LATE',name:'LATE sản phẩm chậm',brand:'MINH LONG I',updatedAt:new Date().toISOString()}]);
let pasteGate,pickerGate,releasePaste,releasePicker,pasteWaiting=false,pickerWaiting=false,writes=0;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local'),path=u.pathname;
 if(path.startsWith('/api/staff/')){
  const parts=[];for await(const part of req)parts.push(part);const body=parts.length?JSON.parse(Buffer.concat(parts).toString()):undefined;
  if(path.endsWith('/catalog-snapshot')){res.writeHead(503,{'content-type':'application/json'}).end('{}');return;}
  if(path.endsWith('/products')&&u.searchParams.get('skus')==='LATE'&&pasteGate){pasteWaiting=true;await pasteGate;}
  if(path.endsWith('/products')&&u.searchParams.get('q')==='LATE'&&pickerGate){pickerWaiting=true;await pickerGate;}
  if(req.method==='PUT'&&path.startsWith('/api/staff/quotes/'))writes++;
  const bearer=req.headers.authorization?.replace(/^Bearer /,'')||'',r=await f.call(path.slice('/api/staff'.length)+u.search,bearer?'__Host-bn-session='+bearer:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(data);
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
const wait=async fn=>{for(let n=0;n<600;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('fixture request did not arrive');};
try{for(const width of [1440,390]){
 const created=await f.call('/quotes',f.mgr,'POST',{type:'B2B',quoteNo:'B2B_BULK_TEST_'+width,date:'2026-11-11',customer:'Khách kiểm thử',vat:8,rows:[...Array.from({length:20},(_,i)=>({sku:'BULK-'+i,name:'Sản phẩm kiểm thử '+i,unit:'Cái',qty:2,price:100000,discount:0,discountType:'percent',taxRate:8,printFee:1000})),{manualLine:true,name:'Phụ phí giữ nguyên',qty:1,price:50000,discount:0,printFee:0}]});assert.equal(created.status,201,JSON.stringify(created.data));
 const id=created.data.id,context=await browser.newContext({viewport:{width,height:950}});await context.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort());await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
 const page=await context.newPage(),errors=[];const toolbar=async selector=>{const button=page.locator(selector);if(!await button.isVisible())await button.evaluate(b=>b.closest('[popover]')?.showPopover());await button.click();};page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/#/quotes/'+id);await page.locator('#line-list tr[data-i="20"]').waitFor();
 await toolbar('#bulk-discount');const bulk=page.locator('#bulk-discount-dialog');await bulk.locator('[name=discount]').fill('101');await bulk.locator('[type=submit]').click();assert.match(await bulk.locator('[role=alert]').textContent(),/0 đến 100/);
 await bulk.locator('[name=discount]').fill('20');await bulk.locator('[name=scope]').selectOption('zero');assert.match(await bulk.locator('[data-summary]').textContent(),/20 dòng/);
 await page.screenshot({path:`${out}/${width}-bulk.png`});const geometry=await bulk.evaluate(d=>{const r=d.getBoundingClientRect(),b=d.querySelector('[type=submit]').getBoundingClientRect();return{width:r.width,footerVisible:b.bottom<=innerHeight,noOverflow:d.scrollWidth<=d.clientWidth+1};});assert(geometry.width<=width&&geometry.footerVisible&&geometry.noOverflow);
 await bulk.locator('[type=submit]').click();assert.equal(await page.locator('#line-list [data-k=discount]').evaluateAll(ns=>ns.filter(n=>n.value==='20').length),20);
 const savedResponse=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/quotes/'+id));await page.keyboard.press('Control+s');assert.equal((await savedResponse).status(),200);await page.waitForTimeout(150);
 const saved=(await f.call('/quotes/'+id,f.mgr)).data.data;assert(saved.rows.slice(0,20).every(r=>r.discount===20&&r.discountType==='percent'&&r.price===100000&&r.qty===2));assert.equal(saved.rows[20].discount,0);
 await page.reload();await page.locator('#line-list tr[data-i="20"]').waitFor();assert.equal(await page.locator('#line-list [data-k=discount]').first().inputValue(),'20');
 if(width>850){pasteWaiting=false;pasteGate=new Promise(r=>releasePaste=r);await toolbar('#paste-lines');await page.locator('#paste-text').fill('LATE\t10');await page.locator('#paste-apply').click();await wait(()=>pasteWaiting);await page.locator('#paste-dialog [data-close]').first().click();await toolbar('#paste-lines');assert.equal(await page.locator('#paste-text').inputValue(),'');assert.equal(await page.locator('#paste-apply').isDisabled(),false);
 await page.locator('#paste-text').fill('00123\t3');await page.locator('#paste-apply').click();await page.waitForFunction(()=>!document.querySelector('#paste-dialog').open,{},{timeout:10000}).catch(async e=>{console.log(JSON.stringify({pastePreview:await page.locator('#paste-preview').textContent(),text:await page.locator('#paste-text').inputValue(),errors}));throw e;});await page.locator('#line-list tr[data-i="21"]').waitFor();releasePaste();pasteGate=null;await page.waitForTimeout(150);assert.equal(await page.locator('#line-list tr').count(),22);assert.equal(await page.locator('#line-list [data-k=sku]').evaluateAll(ns=>ns.some(n=>n.value==='LATE')),false);
 }
 pickerWaiting=false;pickerGate=new Promise(r=>releasePicker=r);await toolbar('#pick-products');await page.locator('#picker-search').fill('LATE');await wait(()=>pickerWaiting);await page.locator('#picker-dialog [data-close]').first().click();await toolbar('#pick-products');assert.equal(await page.locator('#picker-search').inputValue(),'');assert.equal(await page.locator('#picker-all').isChecked(),false);
 await page.waitForFunction(()=>document.querySelectorAll('#picker-list li').length>1);const count=await page.locator('#picker-list li').count();releasePicker();pickerGate=null;await page.waitForTimeout(150);assert.equal(await page.locator('#picker-list li').count(),count,'late search cannot replace reopened default results');
 await page.locator('#picker-filter-toggle').click();await page.locator('#picker-group').selectOption('tea');await page.locator('#picker-min').fill('500000');await page.locator('#picker-dialog [data-close]').first().click();await toolbar('#pick-products');for(const name of ['search','group','range','min','max'])assert.equal(await page.locator('#picker-'+name).inputValue(),'');
 await page.screenshot({path:`${out}/${width}-picker-reset.png`});await page.locator('#picker-dialog [data-close]').first().click();if(width>850){await toolbar('#paste-lines');assert.equal(await page.locator('#paste-text').inputValue(),'');await page.screenshot({path:`${out}/${width}-paste-reset.png`});await page.keyboard.press('Escape');}
 assert.deepEqual(errors,[]);results.push({width,geometry,bulk20RowsPersisted:true,manualFeePreserved:true,pasteReopenRace:width>850?'passed':'existing desktop-only control',pickerReopenRace:true,filtersReset:true,errors});await context.close();
}await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{releasePaste?.();releasePicker?.();await browser.close();server.close();await f.client.close();}
