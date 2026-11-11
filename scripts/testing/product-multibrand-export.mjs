/** Real browser and downloaded XLSX on synthetic local data; external requests blocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {multiBrandFixture} from '../../tests/helpers/product-multibrand-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const f=await multiBrandFixture(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.REVIEW_DIR||'/tmp/product-multibrand-review';await mkdir(out,{recursive:true});
const errors=[],writes=[],exportQueries=[],popupTrialsMs=[];
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){if(u.pathname.endsWith('/products-export'))exportQueries.push(u.search);const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,body);
 if(req.method!=='GET')writes.push({path:u.pathname,status:r.status});
 res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({...r.data,...(r.cookie?{sessionToken:/__Host-bn-session=([a-f0-9]{64})/.exec(r.cookie)?.[1]||''}:{})}));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.png')?'image/png':'text/html'}).end(bytes);
 }catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});

const contexts=[];
const box=()=>'.product-brand-dialog[open]';
async function login(width){
 const context=await browser.newContext({viewport:{width,height:980},locale:'vi-VN',acceptDownloads:true});contexts.push(context);await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/#/products');await p.locator('#email').fill('emp@x.vn');await p.locator('#password').fill('mat-khau-12345');await p.locator('#login-button').click();await p.locator('#workspace').waitFor({state:'visible'});await p.goto(origin+'/#/products');await p.locator('#product-brand-trigger').waitFor();await p.locator('#product-count').filter({hasText:'63 sản phẩm'}).waitFor();return p;
}
const xctx={};vm.createContext(xctx);vm.runInContext(await readFile(root+'xlsx.full.min.js','utf8'),xctx);const X=xctx.XLSX;
async function exported(p,name,scope='filter'){
 await p.locator('#product-export').click();const d=p.locator('dialog[open]').filter({has:p.locator('[data-export]')});await d.locator('[data-scope]').selectOption(scope);
 const download=p.waitForEvent('download');await d.locator('[data-export]').click();const file=await download;await file.saveAs(out+'/'+name+'.xlsx');const w=X.read(await readFile(out+'/'+name+'.xlsx'),{type:'buffer'}),sheet=w.Sheets['Sản phẩm'],rows=X.utils.sheet_to_json(sheet);
 assert.ok(sheet['!autofilter']);assert.equal(sheet.A2.t,'s');assert.deepEqual(Array.from(X.utils.sheet_to_json(sheet,{header:1})[0]),['Mã SKU','Barcode','Tên sản phẩm','Thương hiệu','Đơn vị tính','Tổng tồn']);return rows;
}
try{
 const p=await login(1440);
 for(let i=0;i<3;i++){const at=performance.now();await p.locator('#product-brand-trigger').click();await p.locator(box()+' [data-search]').waitFor();popupTrialsMs.push(performance.now()-at);if(i<2)await p.keyboard.press('Escape');}
 let d=p.locator(box());await d.locator('input[value="Minh Long"]').check();await d.locator('[data-search]').fill('lock');assert.equal(await d.locator('label:visible input[type=checkbox]').count(),1);await d.locator('input[value="Lock&Lock"]').check();await d.locator('[type=submit]').click();await p.locator('#product-count').filter({hasText:'58 sản phẩm'}).waitFor();assert.equal(await p.locator('#product-list tr').count(),50);await p.screenshot({path:out+'/desktop-1440.png'});
 let rows=await exported(p,'two-brands');assert.equal(rows.length,58);assert.equal(new Set(rows.map(r=>r['Mã SKU'])).size,58);assert.deepEqual([...new Set(rows.map(r=>r['Thương hiệu']))].sort(),['Lock&Lock','Minh Long']);assert.deepEqual(new URLSearchParams(exportQueries.at(-1)).getAll('brand').sort(),['Lock&Lock','Minh Long']);
 await p.locator('#product-brand-trigger').click();d=p.locator(box());await d.locator('[data-clear]').click();await p.keyboard.press('Escape');assert.equal(await p.locator('#product-brand-trigger').innerText(),'2 thương hiệu');
 await p.locator('#product-warehouse').selectOption('public');await p.locator('#product-min-stock').fill('10');await p.locator('#product-count').filter({hasText:'1 sản phẩm'}).waitFor();rows=await exported(p,'with-stock');assert.equal(rows.length,1);assert.equal(rows[0]['Mã SKU'],'A0');
 await p.locator('#product-list input[data-select]').check();rows=await exported(p,'selected','selected');assert.equal(rows.length,1);assert.equal(rows[0]['Mã SKU'],'A0');assert.equal(new URLSearchParams(exportQueries.at(-1)).get('skus'),'A0');
 rows=await exported(p,'all','all');assert.equal(rows.length,63);
 const m=await login(390);await m.locator('#product-brand-trigger').click();d=m.locator(box());await d.locator('[data-search]').fill('gom');assert.equal(await d.locator('label:visible input[type=checkbox]').count(),1);await d.locator('input[type=checkbox]:visible').check();await d.screenshot({path:out+'/mobile-brand-picker-390.png'});assert.ok(await d.evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert.ok(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await d.locator('[type=submit]').click();await m.locator('#product-count').filter({hasText:'3 sản phẩm'}).waitFor();rows=await exported(m,'punctuation');assert.equal(rows.length,3);assert.ok(rows.every(r=>r['Thương hiệu']===f.brands[2]));
 await m.locator('#product-brand-trigger').click();d=m.locator(box());await d.locator('[data-clear]').click();await d.locator('[type=submit]').click();await m.locator('#product-count').filter({hasText:'63 sản phẩm'}).waitFor();
 assert.deepEqual(errors,[]);assert.ok(writes.every(w=>w.path.endsWith('/login')),'export must not write business data');
 const result={desktop1440:true,mobile390:true,workbooks:5,union58:true,stock1:true,selected1:true,all63:true,punctuation3:true,cancelPreserves:true,noHorizontalOverflow:true,popupTrialsMs,popupMedianMs:[...popupTrialsMs].sort((a,b)=>a-b)[1],errors};await writeFile(out+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){console.error(e);for(const c of contexts)for(const p of c.pages()){await p.screenshot({path:out+'/debug-'+p.viewportSize().width+'.png'});console.error((await p.locator('body').innerText()).slice(-2200));}throw e;
}finally{for(const c of contexts)await c.close();await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
