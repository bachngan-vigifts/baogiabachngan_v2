import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setupSepay } from "../../tests/helpers/sepay-fixture.ts";
import { customerPayments } from "../../src/modules/sales/schema.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const f = await setupSepay(), root = fileURLToPath(new URL("../../trial-ui/", import.meta.url)), out = process.env.BROWSER_EVIDENCE_DIR || "/tmp/sepay-difference";
await mkdir(out, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://local");
    if (u.pathname.startsWith("/api/staff/")) {
      const chunks = [];
      for await (const x of req) chunks.push(x);
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      const r = await f.call(u.pathname.slice(10) + u.search, token ? "__Host-bn-session=" + token : "", req.method, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : void 0);
      res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(r.data));
      return;
    }
    const path = u.pathname === "/" ? "/index.html" : u.pathname;
    let data = await readFile(root + path);
    if (path === "/index.html") data = Buffer.from(data.toString().replace("<head>", '<head><meta name="bn-api" content="/api/staff">'));
    res.writeHead(200, { "content-type": path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".ttf") ? "font/ttf" : "text/html" }).end(data);
  } catch (e) {
    res.writeHead(500).end(e.message);
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port, browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] }), results = [];
try {
 const user=(await f.call('/me',f.mgr)).data.user;
 for(const width of [390,1280]) for(const delta of [-200,200]){
  const o=await f.order('DIFF_UI_'+width+'_'+(delta<0?'SHORT':'OVER')),e=await f.incoming('UNMATCHED UI '+width+' '+delta,100000+delta);
  const existing=width===1280&&delta<0;
  if(existing)await f.db.insert(customerPayments).values({id:'browser-difference-receipt',orderId:o.id,amount:100000,method:'transfer',paidAt:'2026-11-08',paymentSource:'manual',createdBy:'mgr',createdAt:f.stamp});
  const context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.mgr.split('=')[1],user});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#/sepay?from=2026-11-08&to=2026-11-08');
  await page.locator(`[data-open="${e.id}"]`).click();await page.locator(`a[href="#/sepay?allocation=${e.id}"]`).click();
  await page.locator('[data-search] [name=q]').fill(o.orderNo);await page.locator('[data-search] button').click();
  await page.locator(`[data-add="${o.id}"]`).click();if(existing)await page.locator('[data-receipt]').selectOption('browser-difference-receipt');await page.locator('[data-full]').click();
  if(delta<0){assert.equal(await page.locator('[data-review]').isEnabled(),false);await page.locator('[data-bank-remaining]').click();assert.match(await page.locator('[data-line-difference]').textContent(),/200/);}
  await page.locator('[data-review]').click();await page.locator('[data-verified]').check();
  await page.screenshot({path:out+`/review-${width}-${delta}.png`,fullPage:true});
  await page.locator('[data-confirm]').click();await page.locator('.sa-history').waitFor();
  await page.reload();await page.locator('.sa-history').waitFor();
  if(delta<0)assert.match(await page.locator('.sa-history').textContent(),/Chênh thiếu 200/);
  else assert.match(await page.locator('[data-total-remaining]').textContent(),/200/);
  const d=(await f.call(`/sepay/transactions/${e.id}/allocations`,f.mgr)).data;
  assert.equal(d.allocated,100000+Math.min(0,delta));assert.equal(d.remaining,Math.max(0,delta));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  if(existing){const receipts=await f.db.select().from(customerPayments);assert.equal(receipts.find(p=>p.id==='browser-difference-receipt').amount,100000);assert.equal(receipts.filter(p=>p.orderId===o.id).length,1);}
  results.push({width,delta,existingReceipt:existing,allocated:d.allocated,remaining:d.remaining,reloaded:true});await context.close();
 }
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',JSON.stringify(results));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
