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
const results=[];
try {for(const [width,role] of [[320,'mgr'],[390,'mgr'],[430,'mgr'],[1440,'mgr'],[390,'emp']]){
 const account=(await f.call('/me',f[role])).data.user,session=f[role].split('=')[1],context=await browser.newContext({viewport:{width,height:900},isMobile:width<900,hasTouch:width<900});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user:account,token:session});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/products');const update=page.locator('[data-update-product="00123"]');await update.waitFor({state:'visible'});await page.waitForTimeout(200);assert(await update.isVisible());await update.scrollIntoViewIfNeeded();const box=await update.boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width);await mkdir('/tmp/mobile-product-update',{recursive:true});await page.screenshot({path:'/tmp/mobile-product-update/'+role+'-'+width+'-list.png'});
 await update.click();const edit=page.getByRole('dialog',{name:'Cập nhật sản phẩm',exact:true});await edit.locator('[name=name]').waitFor();assert(await edit.getByRole('button',{name:'Lưu cập nhật',exact:true}).isVisible());await edit.getByRole('button',{name:'Huỷ',exact:true}).click();await edit.waitFor({state:'detached'});
 await page.goto(origin+'/#/quotes/new');const picker=page.locator('#pick-products');if(!await picker.isVisible())await picker.evaluate(b=>b.closest('[popover]')?.showPopover());await picker.click();await page.locator('#picker-all').check();await page.locator('#picker-list [data-sku="00123"] [data-add]').click();await page.locator('#picker-dialog [data-close]').first().click();await page.locator('#line-list [data-stock]').first().click();const cardUpdate=page.locator('[data-update-product-card]');await cardUpdate.waitFor({state:'visible'});await cardUpdate.click();await edit.locator('[name=name]').waitFor();assert(await edit.getByRole('button',{name:'Lưu cập nhật',exact:true}).isVisible());await page.screenshot({path:'/tmp/mobile-product-update/'+role+'-'+width+'-editor.png'});
 if(width===390&&role==='mgr'){const name='Ly sứ cập nhật mobile';await edit.locator('[name=name]').fill(name);await edit.getByRole('button',{name:'Lưu cập nhật',exact:true}).click();await edit.waitFor({state:'detached'});assert.equal((await f.call('/products/00123',f.mgr)).data.product.name,name);}else{await edit.getByRole('button',{name:'Huỷ',exact:true}).click();await edit.waitFor({state:'detached'});}
 const detailPage=await context.newPage();detailPage.on('pageerror',e=>errors.push(e.message));await detailPage.goto(origin+'/#/products/00123');const detailUpdate=detailPage.locator('[data-pd-edit]');await detailUpdate.waitFor({state:'visible'});await detailUpdate.click();const detailEdit=detailPage.getByRole('dialog',{name:'Cập nhật sản phẩm',exact:true});await detailEdit.locator('[name=name]').waitFor();assert(await detailEdit.getByRole('button',{name:'Lưu cập nhật',exact:true}).isVisible());await detailEdit.getByRole('button',{name:'Huỷ',exact:true}).click();assert.deepEqual(errors,[]);results.push({width,role,listUpdateVisible:true,cardUpdateVisible:true,detailUpdateVisible:true,saveVisible:true,saved:width===390&&role==='mgr',errors});await context.close();
}assert.equal(writes.filter(w=>w.method==='PUT').length,1);assert.deepEqual(await f.db.select().from(productStock),beforeStock);console.log(JSON.stringify(results));}finally{await browser.close();server.close();await f.client.close();}
