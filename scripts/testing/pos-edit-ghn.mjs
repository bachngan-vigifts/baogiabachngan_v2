/** Real CRM UI + router/PGlite, GHN simulated in memory. No live carrier calls. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { setup } from '../../tests/helpers/pos-fixture.ts';
import { products, productPrices } from '../../src/modules/catalog/schema.ts';
import { salesOrders, deliveries } from '../../src/modules/sales/schema.ts';
import { stockMoves } from '../../src/modules/inventory/schema.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const f = await setup(), shift = await f.open(), user = (await f.call('/me', f.mgr)).data.user, token = f.mgr.split('=')[1];
await f.db.insert(products).values({ sku: 'B', name: 'Bộ trà mới', unit: 'Bộ', updatedAt: new Date().toISOString() });
await f.db.insert(productPrices).values({ sku: 'B', policyId: 'retail-vat', price: 216000 });
await postMoves(f.db, 'mgr', [{ sku: 'B', warehouseId: 'pos-wh', qty: 5, kind: 'opening', refType: 'opening', refId: 'B-opening' }]);
const remotes = new Map(), carrierCalls = [], rejectCodOnce = new Set();
f.env.ghnMlToken = 'test-only'; f.env.ghnMlShopId = '123';
f.env.ghnFetch = async (url, init) => {
  const endpoint = String(url).split('/').pop(), body = JSON.parse(init.body), remote = remotes.get(body.order_code); carrierCalls.push({ endpoint, code: body.order_code });
  assert.equal(init.headers.ShopId, '123'); assert.ok(remote);
  if (endpoint === 'detail') return Response.json({ code: 200, data: structuredClone(remote) });
  if (endpoint === 'update') { remote.items = body.items; remote.content = body.content; return Response.json({ code: 200, data: null }); }
  if (endpoint === 'updateCOD') {
    assert.deepEqual(Object.keys(body).sort(), ['cod_amount','order_code']);
    if (rejectCodOnce.delete(body.order_code)) return Response.json({ code: 400 }, { status: 400 });
    remote.cod_amount = body.cod_amount; return Response.json({ code: 200, data: null });
  }
  throw Error('unexpected carrier request');
};
const root = fileURLToPath(new URL('../../trial-ui/', import.meta.url)), dir = '/workspace/scratch/pos-edit-ghn'; await mkdir(dir, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost'), path = u.pathname;
    if (path.startsWith('/api/staff/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      if (req.method === 'PUT' && path.endsWith('/pos')) await new Promise(r => setTimeout(r, 300));
      const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const r = await f.call(path.slice('/api/staff'.length) + u.search, bearer ? '__Host-bn-session=' + bearer : '', req.method, body);
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.data)); return;
    }
    let data = await readFile(root + (path === '/' ? 'index.html' : path));
    if (path === '/' || path === '/index.html') data = Buffer.from(data.toString().replace('<head>', '<head><meta name="bn-api" content="/api/staff">'));
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.ttf') ? 'font/ttf' : 'text/html'); res.end(data);
  } catch (e) { res.writeHead(500).end(e.message); }
}).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const origin = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] }), results = [];
try {
  for (const width of [1280, 390]) {
    // No GHN token for the fixture's ordinary register; attach a simulated existing Minh Long shipment.
    const sale = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery: { address: 'Kho khách', receiverName: 'Khách', receiverPhone: '0900000000' } })); assert.equal(sale.status, 201, JSON.stringify(sale.data));
    const detail = (await f.call('/orders/' + sale.data.id, f.mgr)).data, snap = JSON.parse(detail.order.posSnapshot); snap.register.name = 'Minh Long';
    await f.db.update(salesOrders).set({ posSnapshot: JSON.stringify(snap) }).where(eq(salesOrders.id, sale.data.id));
    const code = 'BROWSER-' + width;
    await f.db.update(deliveries).set({ carrier: 'GHN', trackingCode: code, trackingStatus: 'picking' }).where(eq(deliveries.id, detail.deliveries[0].id));
    remotes.set(code, { order_code: code, shop_id: 123, client_order_code: detail.order.orderNo, status: 'picking', cod_amount: detail.order.total, items: [{ code: '00123', name: 'Ly sứ', quantity: 2, price: 97200 }], content: 'Ly sứ' });
    if (width === 1280) rejectCodOnce.add(code);
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.route('**/*', r => r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
    await context.addInitScript(({ token, user }) => { localStorage.setItem('bn-v2-session', token); localStorage.setItem('bn-v2-session-profile', JSON.stringify({ session: token, user })); }, { token, user });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/#/orders/' + sale.data.id);
    await page.getByRole('button', { name: 'Sửa đơn POS', exact: true }).evaluate(b => b.click());
    let modal = page.locator('.pos-order-edit-modal'); await modal.waitFor();
    assert.equal(await modal.getByRole('spinbutton', { name: 'Số lượng · Ly sứ', exact: true }).isEnabled(), true);
    await modal.getByRole('button', { name: 'Xoá sản phẩm · Ly sứ', exact: true }).click();
    await modal.getByRole('searchbox', { name: 'Tìm sản phẩm thêm vào đơn POS' }).fill('Bộ trà');
    await modal.locator('.pos-edit-product-choice').filter({ hasText: 'Bộ trà mới' }).click();
    await modal.getByRole('spinbutton', { name: 'Số lượng · Bộ trà mới', exact: true }).fill('2');
    await modal.getByLabel('Lý do sửa đơn *', { exact: true }).fill('Đổi mã trước khi GHN lấy hàng');
    await page.screenshot({ path: dir + '/edit-' + width + '.png', fullPage: true });
    const waitResponse = () => page.waitForResponse(r => r.url().endsWith('/orders/' + sale.data.id + '/pos') && r.request().method() === 'PUT');
    let response = waitResponse(); await modal.getByRole('button', { name: 'Lưu và cập nhật GHN', exact: true }).click();
    assert.equal(await modal.locator('form').evaluate(form => form.inert), true);
    if (width === 1280) {
      assert.equal((await response).status(), 502);
      await modal.getByRole('button', { name: 'Tiếp tục cập nhật GHN', exact: true }).waitFor();
      assert.equal(await modal.getByRole('spinbutton', { name: 'Số lượng · Bộ trà mới', exact: true }).isEnabled(), false);
      await modal.getByRole('button', { name: 'Đóng', exact: true }).click(); await page.reload();
      await page.locator('#order-pos-ghn-edit').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Sửa đơn POS', exact: true }).evaluate(b => b.click()); modal = page.locator('.pos-order-edit-modal');
      await modal.getByRole('button', { name: 'Tiếp tục cập nhật GHN', exact: true }).waitFor();
      await page.screenshot({ path: dir + '/pending-reload.png', fullPage: true });
      response = waitResponse(); await modal.getByRole('button', { name: 'Tiếp tục cập nhật GHN', exact: true }).click();
    }
    assert.equal((await response).status(), 200); await modal.waitFor({ state: 'detached' });
    const d = (await f.call('/orders/' + sale.data.id, f.mgr)).data;
    assert.equal(d.lines[0].sku, 'B'); assert.equal(d.order.total, 432000); assert.equal(d.schedules[0].amount, 432000); assert.equal(d.deliveries[0].codAmount, 432000);
    assert.equal(remotes.get(code).items[0].code, 'B'); assert.equal(remotes.get(code).cod_amount, 432000);
    assert.equal(carrierCalls.filter(c => c.code === code && c.endpoint === 'update').length, 1);
    assert.equal((await f.db.select().from(stockMoves)).length, 2); assert.deepEqual(errors, []);
    await page.screenshot({ path: dir + '/complete-' + width + '.png', fullPage: true });
    results.push({ width, pickingEditable: true, newSku: 'B', cod: 432000, readbackVerified: true, resumedAfterReload: width === 1280, noStockIssue: true }); await context.close();
  }
  console.log(JSON.stringify(results));
} finally { await writeFile(dir + '/results.json', JSON.stringify(results, null, 2)); await browser.close(); server.close(); await f.client.close(); }
