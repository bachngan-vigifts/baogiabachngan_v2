/** Actual purchase factory inside #workspace, with local fake API and no external requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../../trial-ui/',import.meta.url),out=process.env.POPUP_SCREENSHOTS||'/tmp/crm-centered-popups';
await mkdir(out,{recursive:true});
const baseline=process.env.POPUP_BASELINE==='1';
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;
 let bytes=baseline&&['/style.css','/suppliers.css','/dialog-layout.css'].includes(path)
  ?execFileSync('git',['show','HEAD:trial-ui'+path]):await readFile(new URL('.'+(path==='/'?'/index.html':path),root));
 if(path==='/')bytes=Buffer.from(bytes.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(bytes);
}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
const bounds=async(page,selector)=>page.locator(selector).evaluate(n=>{let r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight};});
const assertCentered=b=>{assert.ok(b.y>=-1&&b.bottom<=b.viewportHeight+1,'popup vertically clipped: '+JSON.stringify(b));assert.ok(b.x>=-1&&b.right<=b.viewportWidth+1,'popup horizontally clipped');assert.ok(Math.abs(b.y+b.height/2-b.viewportHeight/2)<2,'not vertically centered');assert.ok(Math.abs(b.x+b.width/2-b.viewportWidth/2)<2,'not horizontally centered');};
try{for(const viewport of [{width:1692,height:1338},{width:1440,height:900},{width:1024,height:600},{width:390,height:844},{width:844,height:390},{width:1280,height:420}]){
 const c=await browser.newContext({viewport});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const page=await c.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 await page.evaluate(async()=>{
  document.querySelector('#auth').hidden=true;document.querySelector('#workspace').hidden=false;document.body.style.background='var(--bg)';const root=document.querySelector('#view-purchases');root.hidden=false;
  window.writes=[];window.popups=[];const{installDialogLayouts}=await import('/dialog-layout.js');installDialogLayouts();const{initPurchases}=await import('/purchases.js');
  const order={id:'popup-probe',ticketNumber:'DMH_20261110_001',state:'draft',stateLabel:'Chờ Manager duyệt',revision:1,supplier:{id:'s',name:'CÔNG TY TNHH MINH LONG I'},actions:['approve'],progress:{ordered:32,good:0,damaged:0,missing:32},schedules:[],receipts:[],payments:[],events:[],lines:Array.from({length:32},(_,i)=>({id:'l'+i,sku:'LHC6150NVY-'+i,name:'Bình giữ nhiệt LOCK&LOCK · Màu xanh',quantity:1,good:0,price:145000,purchaseDiscount:0,taxRate:8,sources:[]}))};
  const api=async(path,method='GET',body)=>{if(method!=='GET'){writes.push({path,body});throw Error('No writes in layout test');}if(path==='/purchase-options')return {isManager:true,suppliers:[],warehouses:[]};if(path==='/purchase-orders/popup-probe')return structuredClone(order);if(path.startsWith('/purchase-orders?'))return{orders:[],counts:{},canSeePrices:true};return {products:[],policies:[]};};
  window.purchaseUi=initPurchases({root,api,toast:s=>popups.push(s),confirmBox:async()=>false,money:String,go:()=>{},today:()=> '2026-11-10'});await purchaseUi.show('popup-probe');
 });
 await page.locator('.pur-actions button.primary').waitFor();await page.locator('.pur-actions button.primary').click();await page.locator('.sup-drawer form input').first().waitFor();await page.waitForTimeout(100);
 assert.ok(await page.locator('.sup-drawer form input').first().evaluate(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'first purchase price field must be visible');
 await page.screenshot({path:out+`/purchase-approval-${viewport.width}x${viewport.height}.png`});const box=await bounds(page,'.sup-drawer');assertCentered(box);
 assert.ok(await page.locator('.sup-drawer-head button[aria-label="Đóng"]').evaluate(b=>{let r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'header close is covered');
 await page.locator('.sup-drawer form input').last().focus();await page.locator('.sup-drawer .landscape-dialog-body').evaluate(n=>n.scrollTop=n.scrollHeight);
 assertCentered(await bounds(page,'.sup-drawer'));
 assert.ok(await page.locator('.sup-drawer-head button[aria-label="Đóng"]').evaluate(b=>{let r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'header close is covered after focusing the final field');
 assert.ok(await page.locator('.sup-drawer-foot button').evaluateAll(a=>a.every(b=>{let r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})),'footer is covered');
 // Page scroll and viewport resize must not move the fixed popup out of view.
 await page.evaluate(()=>window.scrollTo(0,1000));assertCentered(await bounds(page,'.sup-drawer'));
 await page.setViewportSize({width:viewport.width,height:Math.max(360,viewport.height-100)});assertCentered(await bounds(page,'.sup-drawer'));await page.setViewportSize(viewport);
 // Reopen the same drawer as read-only details; it must not retain overflow:hidden.
 await page.locator('.sup-drawer-head button').first().click();await page.evaluate(()=>purchaseUi.show('popup-probe'));await page.locator('.pur-actions button.primary').waitFor();await page.waitForTimeout(80);
 assertCentered(await bounds(page,'.sup-drawer'));assert.equal(await page.locator('.sup-drawer').evaluate(n=>n.classList.contains('landscape-drawer')),false);
 await page.locator('.sup-drawer').evaluate(n=>n.scrollTop=n.scrollHeight);assert.ok(await page.locator('.sup-drawer').evaluate(n=>n.scrollTop>0));
 await page.locator('.sup-drawer').evaluate(n=>n.hidden=true);
 // Short native dialogs used to stick to the bottom on phones.
 await page.evaluate(()=>{const d=document.createElement('dialog');d.id='center-confirm';d.className='modal narrow';d.innerHTML='<div class="modal-head"><h2>Xác nhận</h2></div><div class="modal-body">Kiểm tra vị trí popup</div><div class="modal-foot"><button>Đóng</button></div>';document.body.append(d);d.showModal();});assertCentered(await bounds(page,'#center-confirm'));await page.locator('#center-confirm').evaluate(n=>n.close());
 if([1440,390].includes(viewport.width)){
  await page.evaluate(async()=>{
   document.querySelector('#view-purchases').hidden=true;const root=document.createElement('section');root.id='report-timing-probe';root.className='view';root.style.background='#f4f6f9';document.querySelector('.main').append(root);
   const week={period:'2026-11-30',deadline:'2026-12-07T03:00:00Z',submittedAt:'2026-12-07T02:00:00Z',state:'on_time',review:'pending',score:1,reportId:'w'};
   const monthly={period:'2026-12',deadline:'2027-01-02T03:00:00Z',submittedAt:'2027-01-02T02:00:00Z',state:'on_time',review:'pending',score:1,reportId:'m'};
   const{initWeeklyReports}=await import('/weekly-reports.js');
   const labels={pending:'Chờ duyệt',ok:'Đạt',rejected:'Chưa đạt',excused:'Miễn'};
   const ui=initWeeklyReports({root,api:async p=>p.startsWith('/staff-reports/me')?{canReview:true}:{applies:true,hasMonthly:true,weeks:[week.period],reviewLabels:labels,people:[{id:'emp',name:'Nhân viên kiểm thử',positionId:'sale',points:2,required:5,weeks:[week],monthly}]},toast:()=>{},esc:s=>String(s),go:()=>{},money:String});await ui.show('month=2026-12');
   const{createReportScoreCard}=await import('/report-scores.js');root.append(createReportScoreCard({month:'2026-12',source:'live',basis:{points:2,required:5,weeks:[week],monthly}}));window.scrollTo(0,0);
  });
  const text=await page.locator('#report-timing-probe').innerText();assert.equal((text.match(/Nộp lần đầu:/g)||[]).length,4);assert.match(text,/Chờ duyệt/);assert.match(text,/Đúng hạn/);assert.match(text,/Chưa đạt mới trừ điểm/);
  await page.screenshot({path:out+`/report-submission-${viewport.width}.png`,fullPage:true});
 }
 assert.deepEqual(await page.evaluate(()=>writes),[]);assert.deepEqual(errors,[]);results.push({viewport,box,headerVisible:true,footerVisible:true,afterFocus:true,afterScroll:true,afterResize:true,reusedDrawerScrolls:true,nativeCentered:true,noWrites:true});await c.close();
}await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS '+results.length+' centered popup viewports');}
finally{await browser.close();await new Promise(r=>server.close(r));}
