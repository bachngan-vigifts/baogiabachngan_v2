import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setupSepay } from "../../tests/helpers/sepay-fixture.ts";
import { customerPayments } from "../../src/modules/sales/schema.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const f = await setupSepay(), root = fileURLToPath(new URL("../../trial-ui/", import.meta.url)), out = process.env.BROWSER_EVIDENCE_DIR || "/tmp/sepay-invoices";
await mkdir(out, { recursive: true });
const a=await f.order("DH-INVOICE-BROWSER",{invoiceNo:"000123"});
const e=await f.incoming("Thanh toán hóa đơn số 000123",40000);
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
 for(const width of [390,1280]) {
  const context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.mgr.split('=')[1],user});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#/sepay?from=2026-11-08&to=2026-11-08');
  await page.locator(`[data-open="${e.id}"]`).click();
  await page.locator(`[data-choose="${a.id}"]`).waitFor();
  assert.match(await page.locator('[data-order-results]').innerText(),/Hóa đơn 000123/);
  const input=page.locator('[name=orderQuery]');await input.fill('000123');
  await input.press('Enter');
  await page.locator(`[data-choose="${a.id}"]`).click();
  await page.locator('[data-preview]').getByText(/100[.]000/).first().waitFor();
  await page.screenshot({path:out+'/'+width+'.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);
  await context.close();
 }
 console.log('PASS invoice narrative suggestions, invoice search and receipt preview on mobile/desktop; no receipt confirmed');
} finally {await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
