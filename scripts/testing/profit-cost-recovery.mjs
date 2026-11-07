/** Local Chromium + real CRM router/PGlite. No production data, orders or tax settings. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';
import { productStock } from '../../src/modules/catalog/schema.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {salesLineCosts} from '../../src/modules/sales/line-cost-schema.ts';

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
const stamp=new Date().toISOString(),day=stamp.slice(0,10);
for(const [id,sku] of [['recovered','00123'],['missing','MISSING-COST']]){
 await f.db.insert(salesOrders).values({id,orderNo:'DH-'+id,quoteType:'HRC',customerName:'Khách kiểm thử',ownerId:'emp',createdBy:'emp',orderDate:day,status:'confirmed',subtotal:200000,total:200000,createdAt:stamp,updatedAt:stamp});
 await f.db.insert(salesOrderLines).values({id:'line-'+id,orderId:id,lineNo:1,sku,name:'Ly kiểm thử',qty:2,unitPrice:100000,amount:200000});
}
await f.db.insert(salesLineCosts).values({orderLineId:'line-recovered',orderId:'recovered',sku:'00123',unitCost:42000,source:'catalog_rule',confidence:'estimate',costAt:stamp,capturedAt:stamp,note:'Công thức NCC: CK 58%; <script>bad()</script> – chỉ là giá tham chiếu.'});

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
 for(const width of [1447,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/profit');
  await page.locator('#view-profit .pf-warn').filter({hasText:'giá mua tham chiếu'}).waitFor();
  assert.ok(await page.locator('#view-profit .pf-warn').filter({hasText:'thiếu giá vốn'}).count());
  await page.getByRole('tab',{name:'Đơn hàng',exact:true}).click();await page.locator('[data-order="recovered"]').click();
  const dialog=page.locator('dialog[open]');await dialog.getByText('Công thức mua NCC theo thương hiệu (giá tham chiếu)',{exact:true}).waitFor();
  assert.match(await dialog.innerText(),/42[.,]000/);assert.match(await dialog.innerText(),/CK 58%/);assert.match(await dialog.innerText(),/<script>bad\(\)<\/script>/);
  assert.equal(await dialog.locator('script').count(),0);assert.deepEqual(errors,[]);
  await mkdir('/tmp/profit-recovery-browser',{recursive:true});await page.screenshot({path:'/tmp/profit-recovery-browser/'+width+'.png'});await context.close();
 }
 assert.equal(writes.length,0,'profit screens stay read-only');console.log('PASS: recovered source, provenance, missing warning and escaped notes on desktop/mobile; no writes or JS errors');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await f.db.$client.close();}
