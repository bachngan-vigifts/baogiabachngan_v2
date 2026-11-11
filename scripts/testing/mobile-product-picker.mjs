/** Real UI + isolated API fixture. No production traffic or customer data. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {products, productPrices, productStock, warehouses} from '../../src/modules/catalog/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setup(),user=(await f.call('/me',f.mgr)).data.user,token=f.mgr.split('=')[1];
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.QUOTE_SCREENSHOT_DIR||'/tmp/mobile-product-picker-thumbnail';await mkdir(out,{recursive:true});
await f.db.insert(products).values([...Array.from({length:20},(_,i)=>({sku:'BULK-'+i,name:'Sản phẩm kiểm thử '+i,brand:'MINH LONG I',unit:'Cái',updatedAt:new Date().toISOString(),taxable:true,taxOut:8})),{sku:'LATE',imageUrl:'https://images.example.test/product.png',name:'Bộ đồ ăn Minh Long Hoàng Cung Sen Ngọc Bích nhiều chi tiết' ,brand:'LOCK&LOCK',updatedAt:new Date().toISOString()}]);
await f.db.insert(productPrices).values([{sku:'LATE',policyId:'retail',price:100000},{sku:'LATE',policyId:'retail-vat',price:108000}]);
await f.db.insert(warehouses).values([{id:'test-incoming',name:'Hàng đang về',kind:'incoming'},{id:'test-supplier',name:'NCC',kind:'supplier'}]);
await f.db.insert(productStock).values([{sku:'LATE',warehouseId:'pos-wh',quantity:12345},{sku:'LATE',warehouseId:'test-incoming',quantity:1250},{sku:'LATE',warehouseId:'test-supplier',quantity:24680}].map(r=>({...r,updatedAt:new Date().toISOString()})));
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local'),path=u.pathname;
 if(path.startsWith('/api/staff/')){
  const parts=[];for await(const part of req)parts.push(part);const body=parts.length?JSON.parse(Buffer.concat(parts).toString()):undefined;
  if(path.endsWith('/catalog-snapshot')){res.writeHead(503,{'content-type':'application/json'}).end('{}');return;}
  const bearer=req.headers.authorization?.replace(/^Bearer /,'')||'',r=await f.call(path.slice('/api/staff'.length)+u.search,bearer?'__Host-bn-session='+bearer:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(data);
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try { for (const width of [320,390,430,1440]) {
 const context=await browser.newContext({viewport:{width,height:932}});
 await context.route('**/*',r=>r.request().url()==='https://images.example.test/product.png'?r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="white"/><path d="M43 25h7c10 0 10 15 0 15h-7" fill="none" stroke="#8194a8" stroke-width="3"/><path d="M13 23h32v19c0 13-32 13-32 0z" fill="#e7eef8" stroke="#8194a8" stroke-width="2"/><ellipse cx="29" cy="23" rx="16" ry="4" fill="#bca48d"/><path d="M9 54h42" stroke="#8194a8" stroke-width="2"/></svg>' }):r.request().url().startsWith(base+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#/quotes/new');await page.locator('#pick-products').waitFor({state:'attached'});
 const launch=page.locator('#pick-products');if(!await launch.isVisible())await launch.evaluate(b=>b.closest('[popover]')?.showPopover());await launch.click();
 await page.locator('#picker-list .picker-product').first().waitFor();
 const target=page.locator('#picker-list [data-sku="LATE"]');await target.waitFor();
 const inspect=()=>target.evaluate(li=>{const d=li.closest('dialog'),list=li.parentElement,results=list.parentElement,r=li.getBoundingClientRect(),input=li.querySelector('input').getBoundingClientRect(),add=li.querySelector('[data-add]').getBoundingClientRect(),thumb=li.querySelector('.picker-product-thumbnail').getBoundingClientRect();return {dialogFits:d.scrollWidth<=d.clientWidth+1,listFits:list.scrollWidth<=list.clientWidth+1,resultsFits:results.scrollWidth<=results.clientWidth+1,inputFits:input.left>=r.left&&input.right<=r.right,addFits:add.left>=r.left&&add.right<=r.right,quantityVisible:input.width>0&&input.height>=32,thumbnailVisible:thumb.width===44&&thumb.height===44,thumbnailBeforeQuantity:thumb.right<=input.left,quantityBesideAdd:input.right<=add.left&&Math.abs(input.top-add.top)<2,labels:[...li.querySelectorAll('[data-stock-label]')].map(s=>s.dataset.stockLabel)};});
 if(width<=640){await target.scrollIntoViewIfNeeded();await target.locator('.picker-product-thumbnail img').evaluate(img=>img.decode());const metrics=await inspect();assert(Object.entries(metrics).filter(([k])=>k!=='labels').every(([,v])=>v),JSON.stringify(metrics));assert.deepEqual(metrics.labels,['Tồn','Tạm giữ','Khả dụng','Đang về','NCC']);}
 await target.locator('input').fill('3');await target.locator('[data-picker-details]').click();assert.equal(await target.locator('input').inputValue(),'3');assert(await target.locator('.picker-product-details').isVisible());await target.locator('[data-picker-details]').click();assert.equal(await target.locator('input').inputValue(),'3');
 await target.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/${width}-picker.png`});
 if(width<=640){await page.setViewportSize({width,height:520});await target.locator('input').focus();await target.scrollIntoViewIfNeeded();const compact=await inspect();assert(compact.listFits&&compact.inputFits&&compact.addFits);await page.screenshot({path:`${out}/${width}-keyboard-height.png`});await page.setViewportSize({width,height:932});}
 await target.locator('[data-add]').click();await page.locator('#picker-dialog [data-close]').first().click();assert.equal(await page.locator('#line-list [data-k=qty]').last().inputValue(),'3');
 assert.deepEqual(errors,[]);results.push({width,quantity3Added:true,noHorizontalScroll:width<=640?'passed':'desktop columns retained',detailsPreserveQuantity:true,thumbnailBesideQuantity:width<=640?'passed':'mobile only',errors});await context.close();
 }await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();server.close();await f.client.close();}
