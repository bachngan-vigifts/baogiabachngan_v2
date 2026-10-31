/** Real POS UI, synthetic API data only; external traffic blocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/workspace/scratch/web-order-outcome';await mkdir(out,{recursive:true});
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><main id="pos"></main><script type="module">
import {initPos} from '/pos.js';
const risk={total:62,completed:0,unsuccessful:60,ended:60,pending:2,excludedDeleted:1,rate:100,level:'check_data'};
const analytics={total:63,completed:0,unsuccessful:61,pending:2,ended:61,successRate:0,unsuccessfulRate:96.8,closedSuccessRate:0,closedUnsuccessfulRate:100,missingReasons:61,reasons:[{reason:'Chưa ghi nhận lý do',count:61}],kinds:[],advertising:risk};
const ui=initPos({root:document.querySelector('#pos'),user:()=>({id:'test',name:'Nhân viên thử'}),toast(){},go(){},confirmBox:async()=>true,api:async(path)=>{
 if(path.startsWith('/pos/options'))return{registers:[{id:'r',name:'Cửa hàng thử',pricePolicyId:'retail'}],current:null,shifts:[],templates:[],policies:[]};
 if(path.startsWith('/pos/catalog'))return{products:[],nextOffset:null};
 if(path.startsWith('/pos/orders'))return{registerId:'r',registers:[],counts:{all:63,completed:0,cancelled:61,waiting_delivery:2},orders:[],owners:[],totals:[],analytics};throw Error(path);
}});await ui.load();window.ready=true;</script>`;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html; charset=utf-8');res.end(path==='/'?html:await readFile(root+path.slice(1)));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{for(const width of [1280,390]){const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>window.ready);
 const notice=page.locator('#pos .pos-ad-risk');assert.equal(await notice.getAttribute('role'),'status');assert.match(await notice.textContent(),/Cần đối soát dữ liệu web → GHN/);assert.match(await notice.textContent(),/60\/60/);assert.match(await notice.textContent(),/Không tính 1 đơn đã xoá/);assert.equal(await page.locator('.pos-ad-risk.budget').count(),0);
 await notice.screenshot({path:out+'/notice-'+width+'.png'});await page.getByRole('button',{name:'Xem tỷ lệ hoàn thành và lý do huỷ đơn',exact:true}).click();const modal=page.locator('.pos-modal[open]');assert.match(await modal.textContent(),/chưa dùng để đề nghị cắt ngân sách/);assert.match(await modal.textContent(),/100%/);await modal.screenshot({path:out+'/detail-'+width+'.png'});assert.deepEqual(errors,[]);results.push({width,passed:true});await context.close();}
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();server.close();}
