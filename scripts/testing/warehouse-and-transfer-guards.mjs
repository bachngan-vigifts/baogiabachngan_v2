/** Actual UI modules and shared confirmation dialog, synthetic data, no production requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),app=await readFile(root+'app.js','utf8'),index=await readFile(root+'index.html','utf8');
const confirm=app.slice(app.indexOf('function confirmBox('),app.indexOf("$$('[data-close]')"));
const dir='/workspace/scratch/warehouse-transfer-guards';await mkdir(dir,{recursive:true});
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><main style="padding:16px"><section id="sourcing"></section><section id="transfers"></section><section id="pos"></section></main>
<script type="module">
import {initPos} from '/pos.js';import {initQuoteSourcing} from '/quote-sourcing.js';import {initTransfers} from '/stock-ops.js';import {confirmBox} from '/confirm-actual.js';
const parsed=new DOMParser().parseFromString(await(await fetch('/index.html')).text(),'text/html');document.body.append(parsed.getElementById('confirm-dialog'));
window.writes=[];let status='approved';
const api=async(path,method='GET',body)=>{
 if(method!=='GET'){writes.push({path,body});await new Promise(r=>setTimeout(r,200));status='cancelled';return{ok:true};}
 if(path.endsWith('/stock-plan'))return{quoteNo:'BG-DEMO',customerName:'Khách thử',canPurchase:true,canRequestEarly:true,warehouses:[{id:'a',name:'Kho A',opened:true,canSell:true},{id:'b',name:'Kho B',opened:true,canSell:true}],lines:[{sku:'X',name:'Bộ trà thử',qty:3,unit:'bộ',stock:{a:2,b:1},incoming:0}]};
 if(path==='/stock-transfers/t1')return{id:'t1',transferNo:'PCK-DEMO',status,statusLabel:status==='approved'?'Đã duyệt – chờ kho chuyển':'Đã huỷ',fromWarehouseId:'a',toWarehouseId:'b',fromName:'Kho A',toName:'Kho B',requestedByName:'NV thử',createdAt:'2026-10-31T01:00:00Z',reason:'Kiểm tra UI',revision:1,lines:[{sku:'X',name:'Bộ trà thử',qty:1,unit:'bộ',fromStock:2,toStock:1}],actions:status==='approved'?{done:true,cancel:true}:{}};
 return{transfers:[],warehouses:[{id:'a',name:'Kho A'},{id:'b',name:'Kho B'}]};
};
window.planner=await initQuoteSourcing({api,host:document.querySelector('#sourcing'),quoteId:'demo',confirmBox});
window.transfers=initTransfers({api,root:document.querySelector('#transfers'),toast:()=>{},go:()=>{},confirmBox});await transfers.load();
const analytics={total:100,completed:30,unsuccessful:50,pending:20,ended:80,missingReasons:25,unsuccessfulRate:50,successRate:30,closedSuccessRate:37.5,closedUnsuccessfulRate:62.5,kinds:[{kind:'cancelled',count:40},{kind:'returned',count:10}],reasons:[{reason:'Khách đổi ý',count:25},{reason:'Chưa ghi nhận lý do',count:25}]};
window.pos=initPos({root:document.querySelector('#pos'),user:()=>({id:'tester',name:'NV thử'}),toast:()=>{},go:()=>{},confirmBox,api:async(path)=>{
 if(path.startsWith('/pos/options'))return{registers:[{id:'r',name:'Cửa hàng thử',pricePolicyId:'retail'}],current:null,shifts:[],templates:[],policies:[]};
 if(path.startsWith('/pos/catalog'))return{products:[],nextOffset:null};
 if(path.startsWith('/pos/orders'))return{registerId:'r',registers:[{id:'r',name:'Cửa hàng thử'}],counts:{all:100,cancelled:50,completed:30,pending:20},orders:[],totals:[],owners:[],analytics};
 throw Error(path);
}});await pos.load();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(path==='/'?html:path==='/confirm-actual.js'?"const $=s=>document.querySelector(s);export "+confirm:path==='/index.html'?index:await readFile(root+path.slice(1)));}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{for(const width of [1280,390]){
 const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>window.ready);
 const source=page.locator('#sourcing'),list=source.locator('.quote-source-list'),warehouse=source.getByLabel('Kho bán / kho xuất',{exact:true});assert.equal(await list.isVisible(),false);assert.equal(await list.locator('.pack-line').count(),0);assert.match(await page.evaluate(()=>{try{planner.read();return '';}catch(e){return e.message;}}),/Chọn kho bán/);
 await source.screenshot({path:dir+'/before-'+width+'.png'});await warehouse.selectOption('a');assert.equal(await list.isVisible(),true);assert.equal(await source.getByLabel('Lấy từ kho X',{exact:true}).inputValue(),'2');await warehouse.selectOption('b');assert.equal(await source.getByLabel('Lấy từ kho X',{exact:true}).inputValue(),'1');await warehouse.selectOption('');assert.equal(await list.isVisible(),false);assert.equal(await list.locator('.pack-line').count(),0);await warehouse.selectOption('a');await source.screenshot({path:dir+'/selected-'+width+'.png'});
 await page.evaluate(()=>transfers.show('t1'));await page.getByRole('button',{name:'Huỷ phiếu',exact:true}).click();const ok=page.locator('#confirm-ok');assert.equal(await ok.isDisabled(),true);assert.match(await ok.textContent(),/\(3\)/);await ok.evaluate(b=>b.click());assert.equal(await page.evaluate(()=>writes.length),0);await page.getByRole('button',{name:'Không, giữ lại',exact:true}).click();assert.equal(await page.evaluate(()=>writes.length),0);
 await page.getByRole('button',{name:'Huỷ phiếu',exact:true}).click();assert.equal(await ok.isDisabled(),true);await page.screenshot({path:dir+'/confirm-'+width+'.png',fullPage:true});await page.waitForFunction(()=>!document.querySelector('#confirm-ok').disabled,{},{timeout:6000});await ok.click();await page.waitForFunction(()=>document.querySelector('#transfers').textContent.includes('Đã huỷ'));const writes=await page.evaluate(()=>window.writes);assert.equal(writes.length,1);assert.equal(writes[0].path,'/stock-transfers/t1/cancel');assert.equal(writes[0].body.revision,1);await page.locator('#transfers .sup-drawer .icon-btn').click();
 await page.getByRole('button',{name:'Xem tỷ lệ huỷ đơn và lý do',exact:true}).click();const report=page.locator('.pos-modal[open]');await report.waitFor();assert.match(await report.textContent(),/50%/);assert.match(await report.textContent(),/37,5%/);assert.match(await report.textContent(),/Khách đổi ý/);assert.match(await report.textContent(),/20/);await report.screenshot({path:dir+'/analytics-'+width+'.png'});
 assert.deepEqual(errors,[]);results.push({width,hiddenBeforeSelection:true,stockChangesWithWarehouse:true,clearingWarehouseHidesGoods:true,cancelWaits3Seconds:true,dismissDoesNotWrite:true,confirmedWrites:1,analyticsReport:true,pageErrors:errors});await context.close();
}console.log(JSON.stringify(results));}finally{await writeFile(dir+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();}
