/** Local browser regression; mocks all business APIs, never accesses production.
 * npm install --prefix /tmp/pos-browser playwright
 * PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/pos-mobile-scroll.mjs
 * Optional CHROMIUM_PATH and POS_SCREENSHOT_DIR. Browser dependency is deliberately outside CRM's runtime.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const html = `<!doctype html><html class="app-shell" lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/trial-ui/style.css"><link rel="stylesheet" href="/trial-ui/pos.css">
<link rel="stylesheet" href="/trial-ui/typography.css"><link rel="stylesheet" href="/trial-ui/mobile-actions.css">
<script type="module" src="/trial-ui/mobile-actions-init.js"></script>
<div class="workspace"><main class="main"><header class="topbar">CRM thử nghiệm</header><section class="view" id="view-pos"></section></main></div>
<script type="module">
import {initPos} from '/trial-ui/pos.js';
window.catalogCalls=[]; window.failNext=false;window.holdCustomer=false;
const api=async(path)=>{
 if(path.startsWith('/pos/options'))return {registers:[{id:'r',name:'Mr Thái test',pricePolicyId:'vat'},{id:'r2',name:'Quầy Minh Long',pricePolicyId:'vat'}],canChooseOpenRegister:true,current:{id:'s',registerId:'r',memberId:'emp',templateId:'morning'},policies:[{id:'vat',name:'Giá lẻ + VAT'}],templates:[{id:'morning',name:'Ca sáng',startsAt:'08:00',endsAt:'14:00'}],shifts:[]};
 if(path.startsWith('/pos/orders'))return {orders:[],counts:{all:30,web:3}};
 if(path.startsWith('/pos/customers')){
  while(window.holdCustomer)await new Promise(r=>setTimeout(r,20));
  const p=new URL(path,location.origin).searchParams,offset=Number(p.get('offset')||0),kind=p.get('kind');
  return {canListRetail:true,customers:Array.from({length:Math.min(20,45-offset)},(_,i)=>({id:kind+(offset+i),name:kind==='business'?'B2B thử nghiệm '+(offset+i):offset+i===0?'Khách thử nghiệm':'Khách thử '+(offset+i),phone:'0901234567'})),nextOffset:offset+20<45?offset+20:null};
 }
 if(path.startsWith('/pos/catalog')){
  catalogCalls.push(path); if(window.failNext){window.failNext=false;throw Error('Lỗi mạng giả lập');}
  const p=new URL(path,location.origin).searchParams,o=Number(p.get('offset')),n=Number(p.get('limit'));
  return {products:Array.from({length:n},(_,i)=>({sku:'SP'+(o+i),name:'LHC4437IVY - BÌNH GIỮ NHIỆT - 150ML - CN - '+(o+i),imageUrl:'https://fixture.invalid/product.svg',price:310000,available:10,stockSources:{vigifts:{qty:10},supplier:{qty:5},incoming:{qty:0,orders:[]}}})),nextOffset:o+n<1000?o+n:null};
 }
 throw Error('Unexpected mock API: '+path);
};
window.pos=initPos({root:document.querySelector('#view-pos'),api,user:()=>({id:'emp',role:'manager'}),toast:()=>{},confirmBox:async()=>false,go:()=>{}});
await pos.load();window.ready=true;
</script>`;
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(repo, '.' + path);
    if (path !== '/' && !file.startsWith(resolve(repo, 'trial-ui') + '/')) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', {'.js':'text/javascript','.css':'text/css'}[extname(path)] || 'text/html');
    res.end(path === '/' ? html : await readFile(path==='/trial-ui/pos.css'&&process.env.POS_CSS_SOURCE?process.env.POS_CSS_SOURCE:file));
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
const out=process.env.POS_SCREENSHOT_DIR||'/workspace/scratch/pos-mobile-spacing';await mkdir(out,{recursive:true});const results=[];
try{for(const width of [360,390,430,768,1280]){
 const context=await browser.newContext({viewport:{width,height:844},locale:'vi-VN',reducedMotion:'reduce'});
 await context.route('**/*',r=>r.request().url()==='https://fixture.invalid/product.svg'?r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#edf8f2"/><rect x="55" y="20" width="50" height="125" rx="12" fill="#64a590"/></svg>'}):r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>window.ready);await page.evaluate(()=>document.fonts.ready);await page.waitForLoadState('networkidle');
 const facts=await page.evaluate(()=>{const box=n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,right:b.right,bottom:b.bottom};};const first=document.querySelector('.pos-product');const price=box(first.querySelector('.pos-product-price-stock')),sku=box(first.querySelector('.pos-product-sku'));return {width:innerWidth,overflow:document.querySelector('.main').scrollWidth>innerWidth+1,head:[...document.querySelectorAll('.pos-head-tools>*')].map(box),policy:box(document.querySelector('.pos-policy select')),find:box(document.querySelector('.pos-find-all')),product:box(document.querySelector('.pos-product-tile')),priceGap:price.y-sku.bottom,count:box(document.querySelector('.pos-order-count')),badge:box(document.querySelector('.pos-web-badge'))};});
 await page.screenshot({path:out+'/pos-'+width+'.png'});await page.locator('.pos-order-counts').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/orders-'+width+'.png'});
 if(process.env.POS_LAYOUT_VERIFY==='1'&&width<=850){assert.equal(facts.overflow,false);for(const b of facts.head){assert.ok(b.x>=0&&b.right<=width,JSON.stringify(facts));}assert.ok(Math.abs(facts.policy.w-facts.find.w)<1);assert.ok(Math.abs(facts.policy.h-facts.find.h)<1);assert.ok(Math.abs(facts.policy.y-facts.find.y)<1);assert.ok(facts.priceGap<=10,JSON.stringify(facts));assert.ok(facts.count.h<=52,JSON.stringify(facts));await page.locator('.main').evaluate(n=>n.scrollTop=0);await page.getByLabel('Thao tác khác',{exact:true}).click();assert.equal(await page.getByRole('button',{name:'Báo cáo ca',exact:true}).isVisible(),true);}
 assert.deepEqual(errors,[]);results.push(facts);await context.close();
}console.log(JSON.stringify(results));}finally{await writeResults();await browser.close();server.close();}
async function writeResults(){const {writeFile}=await import('node:fs/promises');await writeFile(out+'/metrics.json',JSON.stringify(results,null,2));}
