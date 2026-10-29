/** Browser check of real creation forms and Sapo chooser with mocked APIs only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../',import.meta.url)),index=await readFile(root+'trial-ui/index.html','utf8'),app=await readFile(root+'trial-ui/app.js','utf8');
const dialogs=['order-create-dialog','contract-dialog','sapo-push-dialog'].map(id=>index.match(new RegExp('<dialog id="'+id+'"[\\s\\S]*?</dialog>'))[0]).join('\n');
const contractHandler=app.slice(app.indexOf("$('#contract-form').addEventListener('submit'"),app.indexOf("$('#order-new-delivery').addEventListener"));
const html=`<!doctype html><html class="app-shell" lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/trial-ui/style.css"><link rel="stylesheet" href="/trial-ui/typography.css">${dialogs}
<script type="module">
import {initOrderCreate} from '/trial-ui/order-create.js';import {initSapoPush} from '/trial-ui/sapo-push.js';
const $=s=>document.querySelector(s);window.calls=[];window.notices=[];
const api=async(path,method='GET',body)=>{calls.push({path,method,body});if(path.startsWith('/quotes/'))return {data:{quoteNo:'BG_TEST',customer:'Khách thử',contact:'Người nhận',phone:'0900000000'}};if(path==='/orders/create-config')return {version:2,noteMaxLength:20000,recipientFields:true};if(path.startsWith('/orders/next-no'))return {orderNo:'DH_TEST'};if(path.startsWith('/sapo/preview')){await new Promise(r=>setTimeout(r,150));return {connected:true,viaClaw:true,required:true,problems:[],locations:[]};}if(path==='/orders')return {id:'o'};if(path==='/contracts')return {orderId:'o',contractNo:'HD_TEST'};throw Error(path);};
const chooser=initSapoPush({api,$,esc:s=>String(s)}),sapoPush=()=>chooser,parseNum=Number,toast=m=>notices.push(m),sapoToast=()=>{},loadHolds=()=>{},go=()=>{};
let contractTarget=null;
${contractHandler}
const order=initOrderCreate({api,$,todayIso:()=> '2026-10-29',chooseSapo:(ref,opts)=>chooser.choose(ref,opts),confirmBox:async()=>true});
window.openOrder=()=>order.choose({quoteId:'q',quoteNo:'BG_TEST'},(fields,loc,push)=>api('/orders','POST',{...fields,pushSapo:push,sapoLocationId:loc}));
window.openContract=()=>{contractTarget={quoteId:'q',sourcing:{read:()=>({}),prepare:async()=>({})}};$('#contract-form').reset();$('#contract-form').signedDate.value='2026-10-29';$('#contract-dialog').showModal();};
window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname,f=resolve(root,'.'+p);if(p!=='/'&&!f.startsWith(resolve(root,'trial-ui')+'/')){res.writeHead(404).end();return;}res.setHeader('Content-Type',{'.js':'text/javascript','.css':'text/css'}[extname(p)]||'text/html');res.end(p==='/'?html:await readFile(f));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const out='/workspace/scratch/single-sapo-choice';await mkdir(out,{recursive:true});const results=[];
try{for(const width of [1440,390])for(const kind of ['order','contract'])for(const push of [true,false]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
 if(kind==='order'){await page.evaluate(()=>{window.openOrder();});await page.locator('#order-create-submit:not([disabled])').waitFor();}else await page.evaluate(()=>window.openContract());
 const form=page.locator(kind==='order'?'#order-create-form':'#contract-form');await form.locator('input[name=pushSapo][value='+ (push?'yes':'no')+']').check();
 if(push)await page.screenshot({path:out+'/'+kind+'-'+width+'.png'});
 await form.locator('.modal-foot .btn.primary').click();await page.waitForFunction(()=>calls.some(c=>c.method==='POST'));await page.waitForTimeout(30);
 const posts=await page.evaluate(()=>calls.filter(c=>c.method==='POST'));assert.equal(posts.length,1);assert.equal(posts[0].body.pushSapo,push);assert.equal(posts[0].path,kind==='order'?'/orders':'/contracts');assert.equal(await page.locator('#sapo-push-dialog').isVisible(),false);
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.path.startsWith('/sapo/preview')).length),push?1:0);assert.deepEqual(errors,[]);results.push({width,kind,pushSapo:push,creationRequests:posts.length,secondPopup:false});await page.close();
}console.log(JSON.stringify(results,null,2));}finally{await browser.close();await new Promise(r=>server.close(r));}
