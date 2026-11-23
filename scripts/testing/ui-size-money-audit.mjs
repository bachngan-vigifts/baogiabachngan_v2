/** Rà ô số tiền và kích thước nút/ô trên ứng dụng thật (dữ liệu mẫu PGlite cục bộ, không gọi production).
 *  (1) Liệt kê ô số trên từng trang: ô nào tự có dấu chấm (ô tiền), ô nào không. (2) Báo nút/ô/chọn trong cùng một hàng lệch chiều cao > 2px.
 *  WIDTHS=1440,390 ROUTES=... ROLE=mgr|emp|sa. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {setupWarehouseOps,makeCrm} from '../../tests/helpers/warehouse-approval-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupWarehouseOps(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.SCREENSHOT_DIR||'/tmp/ui-size-money';await mkdir(out,{recursive:true});
await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:500,kind:'opening',refType:'opening',refId:'parity-opening'}]);
await f.db.insert(warehouses).values({id:'w2',name:'Kho thứ hai',kind:'stock'});await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'w2',qty:5,kind:'opening',refType:'opening',refId:'parity-w2'}]);
const order=await makeCrm(f,'PARITY',3,'00123','pos-wh',false);
const tr=(await f.call('/stock-transfers',f.emp,'POST',{fromWarehouseId:'pos-wh',toWarehouseId:'w2',reason:'Kiểm thử nút',lines:[{sku:'00123',qty:1}]})).data;
const adj=await f.call('/inventory/adjustments',f.emp,'POST',{clientKey:crypto.randomUUID(),warehouseId:'pos-wh',reason:'Kiểm thử nút',lines:[{sku:'00123',qty:1}]});
const routes=(process.env.ROUTES||'pos,quotes/new,orders/'+order.order.id+',orders/'+order.order.id+'?returns=1,cash,cashbook,receivables,purchases,early-requests,receiving,payroll,finance,customers,products,deliveries,transfers,stocktake,sepay,suppliers,staff,store-reports,shift-reports').split(',');
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
const widths=(process.env.WIDTHS||'1440,390').split(',').map(Number);
// Mở các hộp thoại/biểu mẫu hay có ô tiền để quét cả ô bên trong.
const OPENERS=/^(thanh toán|thu tiền|ghi thu|ghi chi|tạo phiếu|thêm phiếu|duyệt|hoàn tiền|xác nhận hoàn|tạm ứng|ứng lương|nhập tiền|thêm khoản|tạo đơn mua|tạo yêu cầu)/i;
async function scan(page){return page.evaluate(()=>{
 const view=document.querySelector('main .view:not([hidden])')||document.querySelector('main');
 const shown=n=>n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden';
 const lab=n=>{const l=n.labels?.[0]||n.closest('label');return ((n.getAttribute('aria-label')||n.placeholder||'')+' '+(l?l.textContent:'')+' '+(n.name||'')).replace(/\s+/g,' ').trim().slice(0,70);};
 const nums=[...document.querySelectorAll('input[type=number]')].filter(n=>n.closest('main,dialog,[popover]')).map(n=>({label:lab(n),money:!!n.previousElementSibling?.dataset?.moneyProxy,visible:shown(n.previousElementSibling?.dataset?.moneyProxy?n.previousElementSibling:n)})).filter(x=>x.visible);
 // Lệch chiều cao: các ô/nút cùng một hàng (cùng cha flex/grid, cắt nhau theo chiều dọc).
 const ctl='button,a.btn,input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([type=range]),select';
 const name=n=>(n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+(n.className&&typeof n.className==='string'?'.'+n.className.trim().split(/\s+/).slice(0,2).join('.'):'')+' "'+(n.textContent||n.placeholder||n.value||'').trim().slice(0,18)+'"');
 const unit=c=>{let u=c;while(u.parentElement&&u.parentElement.children.length===1&&!/flex|grid/.test(getComputedStyle(u.parentElement).display))u=u.parentElement;if(u.parentElement?.tagName==='LABEL'&&u.parentElement.children.length<=2)u=u.parentElement;return u;};
 const rows=new Map();
 for(const c of [...document.querySelectorAll(ctl)].filter(n=>n.closest('main,dialog[open],[popover]')&&shown(n)&&!n.closest('table,.task-row,.crm-chip-row,.chips,nav,.sidebar,.scan-field'))){
  const r=c.getBoundingClientRect();if(r.height<20||r.width<20)continue;
  const p=unit(c).parentElement;if(!p||!/flex|grid/.test(getComputedStyle(p).display))continue;
  if(!rows.has(p))rows.set(p,[]);rows.get(p).push({c,r});
 }
 const bad=[];
 for(const [p,list] of rows){if(list.length<2)continue;
  // nhóm theo dòng hiển thị
  const lines=[];for(const it of list.sort((a,b)=>a.r.top-b.r.top)){const L=lines.find(l=>it.r.top<l.bottom-4&&it.r.bottom>l.top+4);if(L){L.items.push(it);L.top=Math.min(L.top,it.r.top);L.bottom=Math.max(L.bottom,it.r.bottom);}else lines.push({top:it.r.top,bottom:it.r.bottom,items:[it]});}
  for(const l of lines){if(l.items.length<2)continue;const hs=l.items.map(i=>Math.round(i.r.height));const mx=Math.max(...hs),mn=Math.min(...hs);
   if(mx-mn>2)bad.push({row:name(p),items:l.items.map(i=>name(i.c)+'='+Math.round(i.r.height)).join(' | ')});}
 }
 return {nums,bad,pageOverflow:document.documentElement.scrollWidth-innerWidth};});}
const report=[];
try{
 for(const width of widths){const ctx=await ctxFor(width);
  for(const route of routes){const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
   await p.goto(origin+'/#/'+route);await p.waitForTimeout(2200);
   const res=[{step:'trang',...await scan(p)}];
   const btns=await p.locator('main .view:not([hidden]) button:visible').evaluateAll((bs,src)=>{const re=new RegExp(src,'i');return bs.map((b,i)=>[i,b.textContent.replace(/\s+/g,' ').trim()]).filter(([,t])=>re.test(t)).slice(0,3);},OPENERS.source);
   for(const [i,t] of btns){try{await p.locator('main .view:not([hidden]) button:visible').nth(i).click({timeout:2000});await p.waitForTimeout(700);res.push({step:'mở "'+t.slice(0,30)+'"',...await scan(p)});await p.keyboard.press('Escape');await p.waitForTimeout(300);}catch{/* nút bị che / đã đổi */}}
   if(process.env.SHOTS)await p.screenshot({path:`${out}/${route.replace(/[\/?=]/g,'_')}-${width}.png`,fullPage:true});
   report.push({width,route,res,errs});await p.close();}
  await ctx.close();}
}finally{await writeFile(out+'/size-money.json',JSON.stringify(report,null,1));await browser.close();server.close();}
let sizeIssues=0;const nonMoney=new Map(),money=new Map();
for(const r of report)for(const s of r.res){for(const n of s.nums)(n.money?money:nonMoney).set(n.label,r.route);
 for(const b of s.bad){sizeIssues++;console.log(`↕ [${r.width}] ${r.route} · ${s.step}: ${b.row}\n     ${b.items}`);}
 if(s.pageOverflow>0)console.log(`⇔ [${r.width}] ${r.route} · ${s.step}: cuộn ngang ${s.pageOverflow}px`);}
for(const r of report)if(r.errs.length)console.log(`! ${r.route}: ${r.errs.slice(0,2).join(' ; ')}`);
console.log('\nÔ TIỀN (có dấu):');for(const [l,r] of money)console.log('  ✓',l,'—',r);
console.log('\nÔ SỐ KHÁC (không dấu):');for(const [l,r] of nonMoney)console.log('  ·',l,'—',r);
console.log(JSON.stringify({sizeIssues,money:money.size,nonMoney:nonMoney.size}));
