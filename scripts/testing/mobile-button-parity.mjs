/** So sánh nút giữa PC (1440) và điện thoại (390) trên từng trang, tài khoản Manager, dữ liệu mẫu PGlite cục bộ.
 *  Báo: (1) nút có trên PC mà điện thoại không bấm được (bị ẩn/thiếu); (2) nút trên điện thoại tràn màn hình hoặc bị cắt chữ; (3) trang cuộn ngang.
 *  Nút nằm trong menu ⋮ "Thao tác" hoặc trong "Chi tiết" của dòng vẫn tính là có (bấm được). Không gọi production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {setupWarehouseOps,makeCrm} from '../../tests/helpers/warehouse-approval-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupWarehouseOps(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.SCREENSHOT_DIR||'/tmp/mobile-button-parity';await mkdir(out,{recursive:true});
await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:500,kind:'opening',refType:'opening',refId:'parity-opening'}]);
await f.db.insert(warehouses).values({id:'w2',name:'Kho thứ hai',kind:'stock'});await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'w2',qty:5,kind:'opening',refType:'opening',refId:'parity-w2'}]);
const order=await makeCrm(f,'PARITY',3,'00123','pos-wh',false);
const tr=(await f.call('/stock-transfers',f.emp,'POST',{fromWarehouseId:'pos-wh',toWarehouseId:'w2',reason:'Kiểm thử nút',lines:[{sku:'00123',qty:1}]})).data;
const adj=await f.call('/inventory/adjustments',f.emp,'POST',{clientKey:crypto.randomUUID(),warehouseId:'pos-wh',reason:'Kiểm thử nút',lines:[{sku:'00123',qty:1}]});
const routes=(process.env.ROUTES||'dashboard,tasks,quotes,quotes/new,orders,orders/'+order.order.id+',orders/'+order.order.id+'?returns=1,contracts,customers,products,deliveries,deliveries?view=list,packing,order-products,receivables,cashbook,cash,kho,inventory,stock-lookup,stock-moves,transfers,transfers/'+tr.id+',stocktake,stock-requests,purchases,early-requests,receiving,suppliers,staff,feedback,store-reports,shift-reports,weekly-reports,monthly-reports,finance,profit,payroll,accounting,sepay,care,flow,product-custody').split(',');
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://l'),path=u.pathname;
 if(path.startsWith('/api/staff/')){const ch=[];for await(const c of req)ch.push(c);const body=ch.length?JSON.parse(Buffer.concat(ch).toString()):undefined;const t=req.headers.authorization?.replace(/^Bearer /,'')||'';
  if(req.method!=='GET'&&!/\/(read|seen|presence|heartbeat|telemetry|client-errors)/.test(path)){res.writeHead(200,{'content-type':'application/json'}).end('{}');return;} // trang chỉ xem: không ghi
  const r=await f.call(path.slice(10)+u.search,t?'__Host-bn-session='+t:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.svg')?'image/svg+xml':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
const cookie=process.env.ROLE==='emp'?f.emp:process.env.ROLE==='sa'?f.sa:f.mgr,user=(await f.call('/me',cookie)).data.user;
async function ctxFor(width){const mobile=width<500;const c=await browser.newContext({viewport:{width,height:mobile?844:900},locale:'vi-VN',...(mobile?{isMobile:true,hasTouch:true}:{})});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await c.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:cookie.split('=')[1],user});return c;}
const norm=t=>t.replace(/\d{1,2}:\d{2}(:\d{2})?|\d+([.,/]\d+)*/g,'#').replace(/\s+/g,' ').replace(/[▾›‹✓✅＋+⋮×✕↻←→]/g,'').trim().toLowerCase();
async function scan(page,mobile){return page.evaluate(({mobile})=>{
 const view=document.querySelector('main .view:not([hidden])')||document.querySelector('main');const W=innerWidth;
 const nodes=[...view.querySelectorAll('button,a.btn,[role=button]')].filter(n=>!n.closest('.mobile-action-heading,.sidebar,.crm-mobile-nav,nav.topbar'));
 const label=n=>(n.getAttribute('aria-label')||n.textContent||n.title||'').replace(/\s+/g,' ').trim();
 const shown=n=>{const s=getComputedStyle(n);return n.getClientRects().length>0&&s.visibility!=='hidden';};
 // Có thể bấm trên điện thoại: đang hiện, hoặc nằm trong menu ⋮ / phần "Chi tiết" của dòng (mở ra là thấy).
 const reachable=n=>shown(n)||(mobile&&!n.classList.contains('mobile-desktop-only')&&(n.classList.contains('mobile-secondary-action')||!!n.closest('.crm-simple-more,.crm-simple-actions,.mobile-action-list,.crm-list-card,details,.crm-filter-sheet,[popover],.crm-filter-collapsed,#view-dashboard .dash-grid,#view-dashboard .dash-how,#view-dashboard .dash-kpis')));
 // Nằm trong dải cuộn ngang (chip, tab, bảng cuộn) thì vuốt là thấy – không tính tràn.
 const scrollable=n=>{for(let p=n.parentElement;p&&p!==document.body;p=p.parentElement){const o=getComputedStyle(p).overflowX;if((o==='auto'||o==='scroll')&&p.scrollWidth>p.clientWidth)return true;}return false;};
 const items=nodes.filter(n=>!n.hidden&&!n.closest('[hidden]')).map(n=>{const r=n.getBoundingClientRect(),vis=shown(n);return {text:label(n),visible:vis,reachable:reachable(n),desktopOnly:n.classList.contains('mobile-desktop-only'),
   overflow:vis&&(r.right>W+1||r.left<-1)&&!scrollable(n),clipped:vis&&n.scrollWidth>n.clientWidth+2&&getComputedStyle(n).overflow!=='visible'};});
 const why=n=>{for(let p=n;p&&p!==document.body;p=p.parentElement){if(getComputedStyle(p).display==='none')return (p.tagName.toLowerCase()+(p.id?'#'+p.id:'')+'.'+[...p.classList].join('.')).slice(0,90);}return n.hidden?'[hidden]':'';};
 for(const [i,it] of items.entries())it.why=it.visible?'':why(nodes.filter(n=>!n.hidden&&!n.closest('[hidden]'))[i]);
 return {items,pageOverflow:document.documentElement.scrollWidth-innerWidth};},{mobile});}
const report=[];
try{
 const pc=await ctxFor(1440),ph=await ctxFor(390);
 for(const route of routes){
  const pp=await pc.newPage(),mp=await ph.newPage();
  for(const p of [pp,mp]){await p.goto(origin+'/#/'+route);await p.waitForTimeout(2200);}
  const a=await scan(pp,false),b=await scan(mp,true);
  const pcSet=[...new Set(a.items.filter(i=>i.visible&&i.text).map(i=>norm(i.text)))].filter(Boolean);
  const mobSet=new Set(b.items.filter(i=>i.reachable).map(i=>norm(i.text)));
  const missing=pcSet.filter(t=>!mobSet.has(t));
  const hiddenDesktop=b.items.filter(i=>i.desktopOnly).map(i=>i.text);
  const overflow=b.items.filter(i=>i.overflow).map(i=>i.text),clipped=b.items.filter(i=>i.clipped).map(i=>i.text);
  const reasons=missing.map(t=>t+' ⇐ '+(b.items.find(i=>norm(i.text)===t)?.why||'không có trong DOM'));
  report.push({route,missing:reasons,hiddenDesktop:[...new Set(hiddenDesktop)],overflow:[...new Set(overflow)],clipped:[...new Set(clipped)],pageOverflow:b.pageOverflow});
  if(missing.length||overflow.length||b.pageOverflow>0)await mp.screenshot({path:`${out}/${route.replace(/[\/?=]/g,'_')}-390.png`,fullPage:true});
  await pp.close();await mp.close();
 }
}finally{await writeFile(out+'/report.json',JSON.stringify(report,null,1));await browser.close();server.close();}
const bad=report.filter(r=>r.missing.length||r.overflow.length||r.clipped.length||r.pageOverflow>0);
for(const r of bad)console.log(`✘ ${r.route}: thiếu [${r.missing.join(' | ')}] tràn [${r.overflow.join(' | ')}] cắt chữ [${r.clipped.join(' | ')}] cuộn ngang ${r.pageOverflow}px`);
console.log(JSON.stringify({routes:report.length,problems:bad.length}));
if(process.env.STRICT)assert.equal(bad.length,0);
