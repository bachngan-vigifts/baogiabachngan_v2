import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
const base='https://minhlongonline.com';
const safe=u=>{try{const x=new URL(u);return x.origin+x.pathname+(x.searchParams.has('wc-ajax')?'?wc-ajax='+x.searchParams.get('wc-ajax'):'');}catch{return '?';}};
function curl(url,cookie=''){
 try{
 const args=['-sS','-L','--max-time','40','-A','Mozilla/5.0','-D','/tmp/perf-headers','-o','/dev/null','-w','%{json}',url];
 if(cookie)args.push('-H','Cookie: '+cookie);
 const x=JSON.parse(execFileSync('curl',args,{encoding:'utf8',timeout:45000}));
 const h=execFileSync('cat',['/tmp/perf-headers'],{encoding:'utf8'}).split('\n').filter(l=>/^(HTTP\/|server:|x-litespeed-cache:|cache-control:|cf-cache-status:|content-encoding:|x-litespeed-cache-control:)/i.test(l));
 return {url:safe(url),status:x.http_code,dns:x.time_namelookup,connect:x.time_connect,tls:x.time_appconnect,ttfb:x.time_starttransfer,total:x.time_total,bytes:x.size_download,headers:h};
 }catch(e){return {url:safe(url),error:String(e.message).slice(0,200)};}
}
for(const url of [base+'/',base+'/wp-content/themes/flatsome/style.css',base+'/san-pham/bo-tra-035l-misc-assortment-sen-vang/',base+'/thanh-toan/','https://locknlockonline.com/']){
 for(let i=0;i<2;i++)console.log('HTTP',JSON.stringify(curl(url)));
}
console.log('CART_COOKIE',JSON.stringify(curl(base+'/','woocommerce_items_in_cart=1')));
const browser=await chromium.launch();
for(const width of [390,1440]){
 const ctx=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});
 await ctx.addInitScript(()=>{
  window.__perf={long:[],lcp:0,cls:0};
  for(const type of ['longtask','largest-contentful-paint','layout-shift'])try{new PerformanceObserver(l=>{for(const e of l.getEntries()){
   if(type==='longtask')window.__perf.long.push({at:e.startTime,ms:e.duration});
   if(type==='largest-contentful-paint')window.__perf.lcp=e.startTime;
   if(type==='layout-shift'&&!e.hadRecentInput)window.__perf.cls+=e.value;
  }}).observe({type,buffered:true});}catch{}
 });
 const page=await ctx.newPage();const errors=[],requests=[],failed=[];
 page.on('pageerror',e=>errors.push(e.message.slice(0,200)));
 page.on('requestfailed',r=>failed.push({url:safe(r.url()),error:r.failure()?.errorText}));
 page.on('requestfinished',async r=>{const t=r.timing();const s=await r.sizes().catch(()=>null);requests.push({url:safe(r.url()),type:r.resourceType(),start:t.startTime,ms:t.responseEnd,ttfb:t.responseStart,status:(await r.response())?.status(),bytes:s?.responseBodySize||0});});
 const cdp=await ctx.newCDPSession(page);await cdp.send('Performance.enable');
 const go=Date.now();let navError=null;
 try{await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:45000});}catch(e){navError=String(e.message).slice(0,160);}
 await page.waitForTimeout(10000);
 const metrics1=await cdp.send('Performance.getMetrics');
 await page.evaluate(()=>scrollTo(0,900));await page.waitForTimeout(4000);
 const metrics2=await cdp.send('Performance.getMetrics');
 const dom=await page.evaluate(()=>({
  ...window.__perf,nav:performance.getEntriesByType('navigation').map(n=>({ttfb:n.responseStart,dom:n.domContentLoadedEventEnd,load:n.loadEventEnd,bytes:n.transferSize})),
  nodes:document.querySelectorAll('*').length,images:[...document.images].map(i=>({src:i.currentSrc,w:i.naturalWidth,h:i.naturalHeight,displayW:Math.round(i.getBoundingClientRect().width),loading:i.loading})).filter(i=>i.displayW>0).slice(0,15),
  scripts:[...document.scripts].filter(s=>s.src).map(s=>s.src),
  inline:[...document.scripts].filter(s=>!s.src).map(s=>s.textContent).filter(t=>/MutationObserver|setInterval|ResizeObserver/.test(t)).map(t=>({length:t.length,preview:t.slice(0,160),observers:(t.match(/MutationObserver/g)||[]).length,intervals:(t.match(/setInterval/g)||[]).length})),
 }));
 const totals={};for(const r of requests){totals[r.type]??={count:0,bytes:0};totals[r.type].count++;totals[r.type].bytes+=r.bytes;}
 const counts={};for(const r of requests)counts[r.url]=(counts[r.url]||0)+1;
 const metric=(m,n)=>m.metrics.find(x=>x.name===n)?.value;
 console.log('BROWSER',JSON.stringify({width,wall:Date.now()-go,navError,dom,totals,slow:requests.filter(r=>r.ms>500).sort((a,b)=>b.ms-a.ms).slice(0,20),repeated:Object.entries(counts).filter(([k,v])=>v>1),ajax:requests.filter(r=>/ajax|wp-json/.test(r.url)),failed,errors,cpu:{scriptTotal:metric(metrics2,'ScriptDuration'),layoutTotal:metric(metrics2,'LayoutDuration'),scriptDuringScroll:metric(metrics2,'ScriptDuration')-metric(metrics1,'ScriptDuration'),layoutDuringScroll:metric(metrics2,'LayoutDuration')-metric(metrics1,'LayoutDuration')}}));
 await ctx.close();
}
await browser.close();
