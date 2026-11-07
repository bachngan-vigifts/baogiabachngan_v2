/** Local Chromium + real CRM router/PGlite. No production data, orders or tax settings. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';
import { productStock } from '../../src/modules/catalog/schema.ts';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const f = await setup(),
  root = fileURLToPath(new URL('../../trial-ui/', import.meta.url));
const user = (await f.call('/me', f.mgr)).data.user,
  token = f.mgr.split('=')[1];
const writes = [],
  beforeStock = await f.db.select().from(productStock);
let failUpdate = false;
for(const sku of ['MOBILE-APPROVE','MOBILE-SECOND'])assert.equal((await f.call('/products',f.emp,'POST',{sku,name:'Bàn chải đánh răng điện LocknLock Electric toothbrush 3.7V, 2W – Màu trắng '+sku,prices:{retail:100000,'retail-vat':108000}})).status,201);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/staff/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : undefined;
      const path = url.pathname.slice('/api/staff'.length) + url.search;
      if (req.method !== 'GET') writes.push({ path, method: req.method, body });
      if (failUpdate && req.method === 'PUT' && path.startsWith('/products/')) {
        failUpdate = false;
        res
          .writeHead(503, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: 'Kiểm thử lỗi lưu, thử lại.' }));
        return;
      }
      const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const r = await f.call(
        path,
        bearer ? '__Host-bn-session=' + bearer : '',
        req.method,
        body,
      );
      res
        .writeHead(r.status, { 'content-type': 'application/json' })
        .end(JSON.stringify(r.data));
      return;
    }
    let data = await readFile(
      root + (url.pathname === '/' ? 'index.html' : url.pathname),
    );
    if (url.pathname === '/' || url.pathname === '/index.html')
      data = Buffer.from(
        data
          .toString()
          .replace('<head>', '<head><meta name="bn-api" content="/api/staff">'),
      );
    res.setHeader(
      'content-type',
      url.pathname.endsWith('.js')
        ? 'text/javascript'
        : url.pathname.endsWith('.css')
          ? 'text/css'
          : url.pathname.endsWith('.png')
            ? 'image/png'
            : 'text/html',
    );
    res.end(data);
  } catch (e) {
    res.writeHead(500).end(e.message);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
try {
 for(const width of [390,320,900,1447]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:width<900,hasTouch:width<900});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#/products');
  const approve=page.locator('[data-approve-product="'+(width===390?'MOBILE-APPROVE':'MOBILE-SECOND')+'"]');
  await approve.waitFor({state:'attached'});await page.waitForTimeout(500);
  if(width<=850)assert.equal(await page.locator('#new-product').isVisible(),false,'mobile creation remains hidden');
  assert.equal(await approve.isVisible(),true,'approve must be visible at '+width);
  await approve.scrollIntoViewIfNeeded();const rect=await approve.boundingBox();assert.ok(rect&&rect.x>=0&&rect.x+rect.width<=width,'approve fits viewport');
  assert.deepEqual(errors,[]);await mkdir('/tmp/product-approval-mobile',{recursive:true});await page.screenshot({path:'/tmp/product-approval-mobile/'+width+'.png'});
  if(width===390){await approve.click();await approve.waitFor({state:'detached'});assert.equal((await f.call('/products/MOBILE-APPROVE',f.mgr)).data.product.approvalStatus,'approved');}
  await context.close();
 }
 // Staff who cannot approve must not gain an approval control on mobile.
 const employee=(await f.call('/me',f.emp)).data.user;
 const ctx=await browser.newContext({viewport:{width:390,height:844}});await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await ctx.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user:employee,token:f.emp.split('=')[1]});
 const page=await ctx.newPage();await page.goto(origin+'/#/products');await page.locator('#product-pending li').first().waitFor();assert.equal(await page.locator('[data-approve-product]').count(),0);await ctx.close();
 assert.equal(writes.filter(w=>w.path.endsWith('/approve')).length,1);
 console.log('PASS: approval visible at 320/390/900/1447, existing approve handler and staff permissions retained');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await f.db.$client.close();}
