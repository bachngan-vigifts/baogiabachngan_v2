/** Local UI regression of actual approval/review handlers; all server calls are mocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),root=fileURLToPath(new URL('../../',import.meta.url));
const app=await readFile(root+'trial-ui/app.js','utf8');
const costStart=app.indexOf('async function refreshPurchaseCosts('),cost=app.slice(costStart,app.indexOf('// ----- hộp "Tạo báo giá mới"',costStart));
const approval=app.slice(app.indexOf("$('#approve-quote').addEventListener"),app.indexOf("$('#reject-quote').addEventListener"));
const html=`<!doctype html><html class="app-shell" lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/trial-ui/style.css"><link rel="stylesheet" href="/trial-ui/typography.css"><main><button id="approve-quote">Duyệt</button><button id="refresh-profit-costs">Cập nhật CK mua vào</button><p id="result"></p></main><script type="module">
import {reviewPurchaseCosts,missingPurchaseCost} from '/trial-ui/purchase-cost-review.js';import {applyPurchaseCost} from '/trial-ui/quote-math.js';
const $=s=>document.querySelector(s);window.calls=[];window.confirms=[];const scenario=new URL(location).searchParams.get('scenario');
window.editor={id:'q',revision:1,dirty:false,approval:{canApprove:true,status:'pending'},rows:[{sku:'KNOWN',name:'Giá đã nhập',qty:1,price:400000,costMode:'manual',costPrice:160000},{sku:'FREE',name:'Giá 0 đã xác nhận',qty:1,price:100000,costPrice:0},...(scenario==='complete'?[]:[{sku:'MISSING',name:'Chưa có giá mua',qty:2,price:200000}]),{sku:'UNUSED',name:'Dòng chưa dùng',qty:0,price:1000}]};
const isManager=()=>true,markDirty=()=>{editor.dirty=true;},renderLines=()=>{},refreshCostToggle=()=>{},loadQuotes=()=>{},refreshQuoteHold=()=>{},toast=m=>{$('#result').textContent=m;},updateQuoteActions=()=>{$('#approve-quote').disabled=false;},confirmBox=async(...args)=>{confirms.push(args);return true;};
const api=async(path,method='GET',body)=>{calls.push({path,method,body});if(path.endsWith('approval-preflight'))return {purchaseCostsReady:scenario==='complete'};if(path.startsWith('/products?'))return {products:[]};if(path.endsWith('/approve'))return {approvedAt:'today',approvedByName:'Manager'};throw Error(path);};
const saveQuote=async()=>{calls.push({path:'/quotes/q',method:'PUT',rows:structuredClone(editor.rows)});editor.dirty=false;editor.revision++;};
${cost}
${approval}
window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname,file=resolve(root,'.'+p);if(p!=='/'&&!file.startsWith(resolve(root,'trial-ui')+'/')){res.writeHead(404).end();return;}res.setHeader('Content-Type',{'.js':'text/javascript','.css':'text/css'}[extname(p)]||'text/html');res.end(p==='/'?html:await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/quote-approval-cost';await mkdir(out,{recursive:true});const results=[];
try{for(const width of [1440,390])for(const scenario of ['complete','missing','cancel']){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/?scenario='+scenario);await page.waitForFunction(()=>window.ready);await page.locator('#approve-quote').click();
 if(scenario==='complete'){await page.waitForFunction(()=>calls.some(c=>c.method==='POST'));assert.equal(await page.locator('.purchase-cost-dialog').count(),0);assert.equal(await page.evaluate(()=>confirms.length),1);assert.equal(await page.evaluate(()=>calls.filter(c=>c.method==='PUT').length),0);}
 else{const dialog=page.locator('.purchase-cost-dialog');await dialog.waitFor();assert.equal(await dialog.locator('tbody tr').count(),1);assert.match(await dialog.locator('tbody').innerText(),/MISSING/);assert.ok(!(await dialog.locator('tbody').innerText()).includes('KNOWN'));assert.equal(await page.evaluate(()=>confirms.length),0);await page.screenshot({path:out+'/'+scenario+'-'+width+'.png'});
 if(scenario==='cancel'){await dialog.getByRole('button',{name:'Huỷ',exact:true}).click();assert.equal(await page.evaluate(()=>calls.filter(c=>c.method==='POST'||c.method==='PUT').length),0);}
 else{await dialog.getByRole('textbox',{name:'CK hoặc giá nhập dòng 3'}).fill('120k');await dialog.getByRole('button',{name:'Lưu giá mua & duyệt',exact:true}).click();await page.waitForFunction(()=>calls.some(c=>c.method==='POST'));const saved=await page.evaluate(()=>calls.find(c=>c.method==='PUT'));assert.equal(saved.rows[0].costPrice,160000);assert.equal(saved.rows[1].costPrice,0);assert.equal(saved.rows[2].costPrice,120000);assert.equal(await page.evaluate(()=>calls.find(c=>c.method==='POST').body.revision),2);}}
 assert.deepEqual(errors,[]);results.push({width,scenario,extraCostConfirmation:false,approved:scenario!=='cancel'});await page.close();
}console.log(JSON.stringify(results,null,2));}finally{await browser.close();await new Promise(r=>server.close(r));}
