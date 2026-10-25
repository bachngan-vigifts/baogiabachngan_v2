// Mock-only browser regression. See docs/PURCHASE-EARLY-FILE.md for setup.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {runInNewContext} from 'node:vm';
const repo=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'');
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/trial-ui/style.css"><section id="root"></section><script type="module">
import {initPurchases} from '/trial-ui/purchases.js';window.writes=[];window.saved=null;window.failFirst=true;window.reads=[];
const api=async(path,method,body)=>{
 if(method){writes.push({path,body});if(path==='/purchase-early-requests'){saved ||= {id:'file-request',revision:1,status:'draft'};if(failFirst){failFirst=false;throw Error('Mất kết nối giả lập sau lưu');}return {request:saved};}throw Error('Unexpected write: '+path);}
 reads.push(path);
 if(path==='/purchase-options')return {suppliers:[{id:'a',name:'NCC A'}],isManager:true,canRequestEarly:true};
 if(path.startsWith('/purchase-orders?'))return {orders:[],counts:{}};
 if(path.startsWith('/purchase-incoming?')){const p=new URL(path,location.origin).searchParams;return {canRequest:true,rows:p.getAll('sku').filter(s=>s==='031106000').map(sku=>({sku,name:'Ly chuẩn theo đơn mua',quantity:20,unitConflict:false}))};}
 throw Error('Unexpected read: '+path);
};
window.ui=initPurchases({root:document.querySelector('#root'),api,toast:console.log,confirmBox:async()=>true,money:String,go:href=>window.dest=href,today:()=> '2026-10-25'});await ui.load();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(req.url==='/trial-ui/test'?html:await readFile(repo+req.url));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const ctx={};runInNewContext(await readFile(repo+'/trial-ui/xlsx.full.min.js','utf8'),ctx);const X=ctx.XLSX;
const buffer=qty=>{const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet([['Mã hàng','Tên hàng','Số lượng xin trước'],['031106000','Tên tham khảo',qty]]),'Xin hàng trước');return Buffer.from(new Uint8Array(X.write(b,{bookType:'xlsx',type:'array'})));};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const width of [390,1280]){const context=await browser.newContext({viewport:{width,height:844}});const origin='http://127.0.0.1:'+server.address().port;await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/trial-ui/test');await page.waitForFunction(()=>window.ready);
 await page.getByRole('button',{name:'Xin hàng trước bằng file',exact:true}).click();assert.ok(await page.locator('.early-file-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'mobile dialog stays within viewport');
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'⬇ Tải file mẫu',exact:true}).click()]);assert.equal(download.suggestedFilename(),'mau-xin-hang-truoc.xlsx');
 const template=X.read(await readFile(await download.path()),{type:'buffer',cellNF:true});assert.equal(template.Sheets[template.SheetNames[0]].A2.z,'@');
 await page.getByLabel('File xin hàng trước').setInputFiles({name:'xin.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:buffer(21)});
 await page.waitForFunction(()=>document.querySelector('.early-file-dialog').textContent.includes('Vượt lượng'));
 assert.equal(await page.getByRole('button',{name:'Lưu phiếu nháp',exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>writes.length),0);
 await page.getByLabel('File xin hàng trước').setInputFiles({name:'xin.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:buffer(5)});
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Lưu phiếu nháp').disabled);
 await page.getByRole('button',{name:'Lưu phiếu nháp',exact:true}).click();
 await page.getByRole('button',{name:'Thử lưu lại',exact:true}).click();
 await page.getByRole('link',{name:'Mở phiếu / Gửi NCC',exact:true}).waitFor();
 const writes=await page.evaluate(()=>window.writes);assert.equal(writes.length,2);assert.equal(writes[0].body.clientKey,writes[1].body.clientKey);assert.deepEqual(writes[0].body.lines,[{sku:'031106000',quantity:5}]);assert.ok(writes.every(w=>w.path==='/purchase-early-requests'));
 await page.getByRole('link',{name:'Mở phiếu / Gửi NCC',exact:true}).click();assert.equal(await page.evaluate(()=>window.dest),'#/purchases?mode=incoming&request=file-request');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({width,template:true,leadingZero:true,invalidBlocked:true,draftRetrySameKey:true,autoSubmit:false}));await context.close();}}
finally{await browser.close();server.close();}
