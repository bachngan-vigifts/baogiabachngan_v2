import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setup } from "../../tests/helpers/pos-fixture.ts";
import { postMoves } from "../../src/modules/inventory/api/ledger.ts";
import { eq } from "drizzle-orm";
import { products, productPrices } from "../../src/modules/catalog/schema.ts";
import { posRegisters } from "../../src/modules/sales/pos-schema.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const f = await setup({productBrand:'Minh Long'});
await f.db.update(posRegisters).set({name:'CỬA HÀNG MINH LONG'}).where(eq(posRegisters.id,f.registerId));
await f.open(f.mgr);
await f.db.update(products).set({name:'Chén cơm 11.2cm Jas Lys — bộ sưu tập gốm sứ hoa văn dành cho khách hàng doanh nghiệp, màu trắng ngà',unit:'Cái'}).where(eq(products.sku,'00123'));
await f.db.update(productPrices).set({price:20000}).where(eq(productPrices.sku,'00123'));
await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku: "00123", warehouseId: "pos-wh", qty: 200, kind: "opening", refType: "opening", refId: "workspace-stock" }]));
const user = (await f.call("/me", f.mgr)).data.user;
const root = process.env.POS_UI_ROOT || fileURLToPath(new URL("../../trial-ui/", import.meta.url)), calls = [], qrResults = [];
const screenStyles=(await readFile(root+'index.html','utf8')).match(/<link[^>]+rel="stylesheet"[^>]*>/g).join('');
const html = `<!doctype html><html class="app-shell"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${screenStyles}<script type="module" src="/mobile-actions-init.js"><\/script><button id="approval-launcher" class="approval-launcher" aria-label="Cần duyệt: 42 việc">42</button><div class="workspace"><main class="main"><section id="view-pos"></section></main></div><script type="module">
import {initPos} from '/pos.js';location.hash='#/pos';window.notices=[];window.confirmCount=0;window.printCount=0;new MutationObserver(list=>{for(const m of list)for(const n of m.addedNodes)if(n.tagName==='IFRAME')n.contentWindow.print=()=>{window.printCount++;n.contentWindow.dispatchEvent(new n.contentWindow.Event('afterprint'));};}).observe(document.body,{childList:true});
const api=async(path,method='GET',body)=>{const r=await fetch('/api'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw Object.assign(Error(data.error),{status:r.status});return data;};
window.pos=initPos({api,root:document.querySelector('#view-pos'),user:()=>(${JSON.stringify(user)}),toast:(message)=>window.notices.push(message),confirmBox:async()=>{window.confirmCount++;return window.confirmAnswer!==false;},go:hash=>location.hash=hash});await pos.load();window.ready=true;
<\/script>`;
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost"), path = u.pathname;
    if (path.startsWith("/api/")) {
      let body;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString());
      calls.push({ path: path.slice(4), method: req.method, body });
      if(path==='/api/pos/ghn/locations'){res.setHeader('content-type','application/json');res.end(JSON.stringify({locations:[{id:body.districtId?'3':body.provinceId?'2':'1',name:body.districtId?'Phường kiểm thử':body.provinceId?'Quận kiểm thử':'Cần Thơ'}]}));return;}
      if (path === "/api/pos/catalog" && u.searchParams.get("q")) await new Promise((r2) => setTimeout(r2, u.searchParams.get("q") === "00123" ? 350 : 100));
      const r = await f.call(path.slice(4) + u.search, f.mgr, req.method, body);
      if (path === "/api/pos/qr" && r.status === 200) qrResults.push(r.data);
      res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.data));
      return;
    }
    if (path === "/barcode-camera.js") {
      res.setHeader("content-type", "text/javascript");
      res.end("export async function startBarcodeCamera(video,onCode){window.cameraCode=onCode;return {stop(){}};}");
      return;
    }
    res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".ttf") ? "font/ttf" : "text/html");
    res.end(path === "/" ? html : await readFile(root + path));
  } catch (e) {
    res.writeHead(500).end(e.message);
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port, browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
const shot = process.env.POS_SCREENSHOT_DIR || "/workspace/artifacts/pos-fees";
await mkdir(shot, { recursive: true });

try {
 for(const [width,height] of [[1366,768],[1024,768],[1280,600]]) {
  const context=await browser.newContext({viewport:{width,height},locale:'vi-VN'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>window.ready);
  await page.getByRole('searchbox',{name:'Tìm hoặc quét sản phẩm'}).fill('00123');
  await page.locator('.pos-product[data-sku="00123"]').click();
  await page.getByRole('button',{name:'Bán thường',exact:true}).click();
  await page.locator('.pos-ref-fees summary').click();
  await page.getByRole('button',{name:'+ Thêm khoản phí',exact:true}).click();
  const fee=page.locator('.pos-ref-fees .pos-service-fee');
  await fee.getByLabel('Khoản phí',{exact:true}).fill('Phí khắc');
  await fee.getByLabel('Số lượng',{exact:true}).fill('2');
  const preview=page.waitForResponse(async r=>r.url().endsWith('/pos/preview')&&r.status()===200&&(await r.json()).fees?.services?.[0]?.amount>0);
  await fee.getByLabel('Đơn giá',{exact:true}).fill('10000');
  const data=await (await preview).json();assert.equal(data.fees.services[0].amount,20000);
  assert.equal(await fee.getByLabel('Thành tiền',{exact:true}).inputValue(),'20.000 đ');
  for(const mode of ['Bán giao hàng','Bán nhanh','Bán thường']) {
   await page.getByRole('button',{name:mode,exact:true}).click();
   assert.equal(await fee.getByLabel('Khoản phí',{exact:true}).inputValue(),'Phí khắc');
   await fee.getByLabel('Đơn giá',{exact:true}).scrollIntoViewIfNeeded();
   assert.equal(await fee.getByLabel('Đơn giá',{exact:true}).isVisible(),true);
   await page.screenshot({path:shot+`/${width}-${mode}.png`});
  }
  await page.locator('.pos-ref-menu > summary').click();
  if(!await page.locator('.pos-workspace-quick').evaluate(n=>n.open))await page.locator('.pos-workspace-quick > summary').click();
  await page.getByRole('button',{name:'Phí dịch vụ',exact:true}).click();
  assert.equal(await fee.count(),2,'shortcut adds a fee instead of removing the first');
  await page.locator('.pos-ref-menu > summary').click();
  await fee.nth(1).getByRole('button',{name:'Bỏ khoản phí',exact:true}).click();
  await page.reload();await page.waitForFunction(()=>window.ready);
  await page.locator('.pos-ref-fees summary').click();
  assert.equal(await fee.getByLabel('Khoản phí',{exact:true}).inputValue(),'Phí khắc');
  const cleared=page.waitForResponse(async r=>r.url().endsWith('/pos/preview')&&r.status()===200&&!(await r.json()).fees?.services?.length);
  await page.getByRole('button',{name:'Bỏ khoản phí',exact:true}).click();await cleared;
  assert.equal(await fee.count(),0);assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS fees in all desktop modes: totals, quantity, switching, draft reload, removal at 3 viewport sizes');
} finally {await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
