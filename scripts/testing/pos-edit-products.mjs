/** Real CRM UI + local router/PGlite. No production writes. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';
import { products, productPrices } from '../../src/modules/catalog/schema.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const f = await setup(), shift = await f.open(), user = (await f.call('/me', f.mgr)).data.user, token = f.mgr.split('=')[1];
await f.db.insert(products).values({ sku: 'B', name: 'Bộ trà mới', unit: 'Bộ', updatedAt: new Date().toISOString() });
await f.db.insert(productPrices).values({ sku: 'B', policyId: 'retail-vat', price: 216000 });
await postMoves(f.db, 'mgr', [{ sku: 'B', warehouseId: 'pos-wh', qty: 5, kind: 'opening', refType: 'opening', refId: 'B-opening' }]);
const root = fileURLToPath(new URL('../../trial-ui/', import.meta.url)), dir = '/workspace/scratch/pos-edit-products'; await mkdir(dir, { recursive: true });
let writes = 0;
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost'), path = u.pathname;
    if (path.startsWith('/api/staff/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      if (req.method === 'PUT' && /\/orders\/[^/]+\/pos$/.test(path)) { writes++; await new Promise(r => setTimeout(r, 300)); }
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
    const sale = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery: { address: 'Kho khách', receiverName: 'Khách', receiverPhone: '0900000000' } })); assert.equal(sale.status, 201, JSON.stringify(sale.data));
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.route('**/*', r => r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
    await context.addInitScript(({ token, user }) => { localStorage.setItem('bn-v2-session', token); localStorage.setItem('bn-v2-session-profile', JSON.stringify({ session: token, user })); }, { token, user });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/#/orders/' + sale.data.id); await page.locator('#order-contract').getByText(sale.data.orderNo, { exact: false }).first().waitFor();
    const positions = await page.evaluate(() => Object.fromEntries(['customer', 'summary', 'delivery', 'debt'].map(k => { const r = document.querySelector('#order-' + k + '-card').getBoundingClientRect(); return [k, { top: r.top, left: r.left }]; })));
    if (width > 850) { assert.equal(positions.customer.top, positions.summary.top); assert.ok(positions.customer.left < positions.summary.left); assert.equal(positions.delivery.top, positions.debt.top); assert.ok(positions.delivery.left < positions.debt.left); }
    else { assert.ok(positions.customer.top < positions.summary.top); assert.ok(positions.delivery.top < positions.debt.top); }
    await page.screenshot({ path: dir + '/layout-' + width + '.png', fullPage: true });
    await page.getByRole('button', { name: 'Sửa đơn POS', exact: true }).evaluate(b => b.click());
    const modal = page.locator('.pos-order-edit-modal'); await modal.waitFor();
    await modal.getByRole('button', { name: 'Xoá sản phẩm · Ly sứ', exact: true }).click();
    for (let i = 0; i < 2; i++) {
      await modal.getByRole('searchbox', { name: 'Tìm sản phẩm thêm vào đơn POS' }).fill('Bộ trà');
      await modal.locator('.pos-edit-product-choice').filter({ hasText: 'Bộ trà mới' }).click();
    }
    assert.equal(await modal.locator('tbody tr').count(), 1); assert.equal(await modal.getByRole('spinbutton', { name: 'Số lượng · Bộ trà mới', exact: true }).inputValue(), '2');
    await modal.getByLabel('Lý do sửa đơn *', { exact: true }).fill('Đổi sang bộ trà mới');
    await page.screenshot({ path: dir + '/editor-' + width + '.png', fullPage: true });
    const before = writes, response = page.waitForResponse(r => r.url().endsWith('/orders/' + sale.data.id + '/pos') && r.request().method() === 'PUT');
    await modal.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    assert.equal(await modal.locator('form').evaluate(form => form.inert), true);
    await modal.locator('form').evaluate(form => form.requestSubmit()); assert.equal((await response).status(), 200);
    await modal.waitFor({ state: 'detached' }); assert.equal(writes, before + 1);
    const d = (await f.call('/orders/' + sale.data.id, f.mgr)).data;
    assert.equal(d.lines.length, 1); assert.deepEqual([d.lines[0].sku, d.lines[0].qty, d.order.total, d.schedules[0].amount, d.deliveries[0].codAmount], ['B', 2, 432000, 432000, 432000]);
    assert.deepEqual(errors, []); results.push({ width, positions, addRemove: true, repeatedSkuMerged: true, saveOnce: true, serverTotals: true }); await context.close();
  }
  console.log(JSON.stringify(results));
} finally { await writeFile(dir + '/results.json', JSON.stringify(results, null, 2)); await browser.close(); server.close(); await f.client.close(); }
