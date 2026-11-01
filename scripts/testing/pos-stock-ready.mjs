/** Local real CRM/router/PGlite: preload stock for both stores before slow detail requests; no production data. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {products,productPrices,productBarcodes,warehouses} from '../../src/modules/catalog/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {setup} from '../../tests/helpers/pos-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
let slowStock=null;
const f=await setup(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);if(u.pathname.endsWith('/pos/stock-snapshot')&&slowStock){const delayed=slowStock;slowStock=null;delayed.read();await new Promise(done=>setTimeout(done,3500));}if(u.pathname.endsWith('/catalog-snapshot')){res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Catalog index deliberately unavailable in preload test'}));return;}if(u.pathname.endsWith('/pos/catalog'))await new Promise(done=>setTimeout(done,2000));res.writeHead(r.status,{'content-type':'application/json','server-timing':'local;dur=1'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/pos-stock-ready',results=[];await mkdir(out,{recursive:true});



async function pageFor(width,cookie){
 const context=await browser.newContext({viewport:{width,height:1050},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=(await f.call('/me',cookie)).data.user;
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:cookie.split('=')[1]});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};
}

try{
 const at=new Date().toISOString(),dummy=Array.from({length:75},(_,i)=>({sku:'WARM-'+i,name:'A sản phẩm mẫu '+String(i).padStart(3,'0'),unit:'cái',updatedAt:at}));
 const targets=[{sku:'LHC3329BEG',name:'Bình LocknLock LHC3329BEG',brand:'LocknLock',unit:'cái',updatedAt:at},{sku:'LHC3329DGRN',name:'Bình LocknLock LHC3329DGRN',brand:'LocknLock',unit:'cái',updatedAt:at},{sku:'ML-NEW',name:'Chén Minh Long mới',brand:'Minh Long',unit:'cái',updatedAt:at}];
 await f.db.insert(products).values([...dummy,...targets]);await f.db.insert(productPrices).values([...dummy,...targets].flatMap(p=>[{sku:p.sku,policyId:'retail-vat',price:587001},{sku:p.sku,policyId:'retail',price:500000}]));await f.db.insert(productBarcodes).values({sku:'LHC3329BEG',barcode:'8933329001'});
 await postMoves(f.db,'mgr',targets.slice(0,2).map((p,i)=>({sku:p.sku,warehouseId:'pos-wh',qty:7-i*2,kind:'adjust',refType:'adjustment',refId:'fixture-'+p.sku})));await f.open();
 await f.db.insert(warehouses).values({id:'ml-ready-wh',name:'Kho Minh Long thử',kind:'stock'});await postMoves(f.db,'mgr',[{sku:'ML-NEW',warehouseId:'ml-ready-wh',qty:9,kind:'opening',refType:'opening',refId:'ml-ready-opening'}]);
 const ml=await f.call('/pos/registers',f.mgr,'POST',{name:'Quầy Minh Long',warehouseId:'ml-ready-wh',pricePolicyId:'retail-vat',secondPricePolicyId:'retail'});assert.equal(ml.status,200,JSON.stringify(ml.data));
 await f.db.update(employees).set({positionId:'sales-ml'}).where(eq(employees.id,'cashier2'));const drawer=await f.call('/cash/drawers',f.mgr,'POST',{key:crypto.randomUUID(),name:'Két ML thử',registerId:ml.data.id});assert.equal(drawer.status,201);const config=await f.call('/cash/config?drawerId='+drawer.data.id,f.mgr,'POST',{openingAmount:0,reason:'Tiền đầu kỳ thử ML'});assert.equal(config.status,200,JSON.stringify(config.data));
 const opened=await f.call('/pos/shifts/open',f.other,'POST',{key:crypto.randomUUID(),registerId:ml.data.id,openingCash:0});assert.equal(opened.status,201,JSON.stringify(opened.data));
 for(const [family,cookie,sku,registerId,warehouseId]of [['lock',f.emp,'LHC3329BEG',f.registerId,'pos-wh'],['ml',f.other,'ML-NEW',ml.data.id,'ml-ready-wh']])for(const width of [1280,390]){
  const expected=(await f.call('/pos/stock-snapshot?registerId='+registerId,cookie)).data.rows.find(r=>r[0]===sku)[2];
  const {context,page,errors}=await pageFor(width,cookie);await page.goto(origin+'/#/pos');await page.locator('.pos-product[data-sku="WARM-0"]').waitFor();
  assert.equal(await page.locator('.pos-product[data-sku="'+sku+'"]').count(),0,'target has not been opened in first page');
  let read;const captured=new Promise(resolve=>read=resolve);slowStock={read};await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await captured;
  await postMoves(f.db,'mgr',[{sku,warehouseId,qty:2,kind:'adjust',refType:'adjustment',refId:'concurrent-'+family+'-'+width}]);
  const input=page.getByRole('searchbox',{name:'Tìm hoặc quét sản phẩm'}),start=Date.now();await input.fill(sku);
  const product=page.locator('.pos-product[data-sku="'+sku+'"]');await product.waitFor();assert.match(await product.innerText(),new RegExp('Còn '+expected));assert.equal(await product.isEnabled(),true);
  const searchMs=Date.now()-start;assert.ok(searchMs<1500,'stock renders before the deliberately delayed2000ms detail API');await product.click();await page.waitForFunction(sku=>[...document.querySelectorAll('.pos-line')].some(n=>n.textContent.includes(sku)),sku);
  await product.getByText('Còn '+(expected+2),{exact:true}).waitFor();
  await page.waitForTimeout(1800);assert.match(await product.innerText(),new RegExp('Còn '+(expected+2)),'slow old full snapshot must not overwrite newer product detail');
  await postMoves(f.db,'mgr',[{sku,warehouseId,qty:1,kind:'adjust',refType:'adjustment',refId:'external-'+family+'-'+width}]);await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await product.getByText('Còn '+(expected+3),{exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Chính sách giá',exact:true}).selectOption('retail');await product.getByText('500.000 đ',{exact:true}).waitFor();assert.match(await product.innerText(),new RegExp('Còn '+(expected+3)));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);await page.locator('.pos-catalog').screenshot({path:out+'/'+family+'-'+width+'.png'});results.push({family,width,searchMs,detailApiDelayMs:2000,stockReadyBeforeDetail:true,cartAddImmediate:true,externalStockRefresh:true,oldResponseCannotOverwrite:true,policyScoped:true,errors});await context.close();
 }
 const unknown=await pageFor(390,f.emp);
 await unknown.context.route('**/unknown-case',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><section id="view-pos"></section><script type="module">
 import {initPos} from '/pos.js';
 const product={sku:'UNKNOWN',name:'Sản phẩm chưa xác nhận tồn',price:100000},register={id:'r',name:'Quầy thử',pricePolicyId:'vat',secondPricePolicyId:'retail'};
 const local=()=>[product];local.ready=()=>true;
 const api=async path=>{if(path.startsWith('/pos/options'))return{registers:[register],current:{id:'s',registerId:'r',memberId:'emp'},policies:[],templates:[],shifts:[]};if(path.startsWith('/pos/catalog'))return new Promise(resolve=>window.stockArrived=()=>resolve({products:[{...product,onHand:5,reserved:0,available:5}],nextOffset:null}));return{registers:[],orders:[],counts:{},nextOffset:null};};
 initPos({root:document.querySelector('#view-pos'),api,user:()=>({id:'emp',role:'manager'}),localSearch:local,toast(){},confirmBox:async()=>false,go(){}}).load();
 </script>`}));
 await unknown.page.goto(origin+'/unknown-case');await unknown.page.getByText('Chưa xác nhận tồn',{exact:true}).waitFor();assert.equal(await unknown.page.locator('.pos-product').isDisabled(),true);
 await unknown.page.getByRole('button',{name:'Xem bộ lọc ▾',exact:true}).click();await unknown.page.getByRole('button',{name:'Hết hàng',exact:true}).click();assert.equal(await unknown.page.locator('.pos-product').count(),0,'unknown stock is excluded from Out of stock');
 await unknown.page.evaluate(()=>window.stockArrived());await unknown.page.getByRole('button',{name:'Tất cả',exact:true}).click();await unknown.page.getByText('Còn 5',{exact:true}).waitFor();assert.equal(await unknown.page.locator('.pos-product').isEnabled(),true);assert.deepEqual(unknown.errors,[]);results.push({unknownNeverOutOfStock:true,unknownNotSelectable:true,readyAfterConfirmation:true});await unknown.context.close();
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
