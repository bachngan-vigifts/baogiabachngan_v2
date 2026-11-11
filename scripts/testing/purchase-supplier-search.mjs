/** Real local CRM/router and downloadable files; synthetic data only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {eq} from 'drizzle-orm';
import {suppliers,supplierContacts} from '../../src/modules/suppliers/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/purchase-supplier-search';await mkdir(out,{recursive:true});
let writes=0,imageFetches=0;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  if(req.method!=='GET'&&req.method!=='OPTIONS')writes++;if(u.pathname.endsWith('/images/fetch'))imageFetches++;
  const chunks=[];for await(const c of req)chunks.push(c);const auth=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,auth?'__Host-bn-session='+auth:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(data);
}catch{res.writeHead(404).end('Fixture resource unavailable');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
 const now=new Date().toISOString(),name='CÔNG TY MỸ NGHỆ ĐẠI THÀNH';await f.db.update(suppliers).set({name,nameKey:'dai thanh',taxCode:'0101234567-001',phone:'0901.222.333'}).where(eq(suppliers.id,'a'));
 await f.db.insert(supplierContacts).values({id:'search-contact',supplierId:'a',name:'Nguyễn Thị Ánh',phone:'0988 765 432',email:'synthetic@example.test',createdAt:now});
 for(const width of [390,1280]){
  const quote=await f.call('/quotes',f.cookies.emp,'POST',{type:'B2B',quoteNo:'SEARCH-NCC-'+width,customer:'Khách kiểm thử',vat:8,rows:[{name:'Hàng kiểm thử',sku:'TEST-NCC',qty:27,price:245000}]});assert.equal(quote.status,201);
  const user=(await f.call('/me',f.cookies.emp)).data.user,token=f.cookies.emp.split('=')[1],context=await browser.newContext({viewport:{width,height:1000}});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
  const page=await context.newPage(),errors=[],created=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/staff/purchase-orders'))created.push(r.postDataJSON());});await page.goto(origin+'/#/purchases/new?type=quote&id='+quote.data.id);await page.locator('.pur-create').waitFor();const input=page.locator('.pur-supplier-search input');
  for(const term of ['dai thanh','0101234567001','0901222333','anh nguyen','0988765432']){
   const response=page.waitForResponse(r=>r.url().includes('/purchase-options/suppliers?')&&new URL(r.url()).searchParams.get('q')===term);await input.fill(term);assert.equal((await response).status(),200);await page.locator('.pur-supplier-option b').filter({hasText:name}).waitFor();assert.equal(await page.locator('.pur-sup-chip').count(),0,'typing must not silently choose a supplier');
  }
  // Late response for an obsolete query cannot replace the currently visible supplier result.
  let release;const held=new Promise(r=>release=r);await page.route('**/purchase-options/suppliers?*',async route=>{if(new URL(route.request().url()).searchParams.get('q')==='slow'){await held;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({suppliers:[{id:'wrong-id',name:'WRONG_SUPPLIER'}],nextOffset:null})});}return route.continue();});
  const old=page.waitForRequest(r=>r.url().includes('q=slow'));await input.fill('slow');await old;const ready=page.waitForResponse(r=>r.url().includes('/purchase-options/suppliers?')&&new URL(r.url()).searchParams.get('q')==='dai thanh');await input.fill('dai thanh');await ready;release();await page.locator('.pur-supplier-option b').filter({hasText:name}).waitFor();assert.equal(await page.getByText('WRONG_SUPPLIER').count(),0);
  await page.locator('.pur-supplier-search').screenshot({path:out+'/supplier-results-'+width+'.png'});await input.press('ArrowDown');await input.press('Enter');await page.locator('.pur-sup-chip').filter({hasText:name}).waitFor();assert.equal(created.length,0,'choosing with Enter must not submit purchase form');
  const again=page.waitForResponse(r=>r.url().includes('/purchase-options/suppliers?')&&new URL(r.url()).searchParams.get('q')==='dai thanh');await input.fill('dai thanh');await again;await page.locator('.pur-supplier-option:disabled').waitFor();assert.equal(await page.locator('.pur-sup-chip').count(),1);
  await input.press('Escape');await page.locator('.pur-create').screenshot({path:out+'/supplier-search-'+width+'.png'});
  await page.getByPlaceholder('Nhập địa chỉ giao hàng',{exact:true}).fill('Kho kiểm thử');const saving=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/staff/purchase-orders'));await page.locator('.pur-create').getByRole('button',{name:'Tạo đơn nháp',exact:true}).click();const saved=await saving;assert.equal(saved.status(),201,JSON.stringify(await saved.json()));
  assert.equal(created.length,1);assert.equal(created[0].orders[0].supplierId,'a');assert.equal(created[0].orders[0].lines[0].quantity,27);assert.deepEqual(errors,[]);results.push({width,searchFields:['name','taxCode','phone','contactName','contactPhone'],keyboard:true,staleResponseIgnored:true,duplicatePrevented:true,supplierId:'a',quantity:27,errors:0});await context.close();
 }
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
