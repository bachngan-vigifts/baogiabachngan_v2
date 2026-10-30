/** Local PGlite/router + real UI; no production reads or writes. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const f = await setup(), user = (await f.call('/me', f.mgr)).data.user, token = f.mgr.split('=')[1];
const root = fileURLToPath(new URL('../../trial-ui/', import.meta.url));
const dir = '/workspace/scratch/quote-stock-warning'; await mkdir(dir, { recursive: true });
let currentQuote = '', lookups = 0;
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost'), path = u.pathname;
    if (path.startsWith('/api/staff/')) {
      if (path === '/api/staff/stock-holds') {
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ holds: [
          { sku: '00123', qty: 5, quoteId: currentQuote, quoteNo: 'Báo giá đang sửa' },
          { sku: '00123', qty: 2, quoteId: 'other', quoteNo: 'Báo giá khác' },
        ] })); return;
      }
      if (path === '/api/staff/products' && u.searchParams.has('skus')) lookups++;
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const r = await f.call(path.slice('/api/staff'.length) + u.search, bearer ? '__Host-bn-session=' + bearer : '', req.method, body);
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.data)); return;
    }
    let data = await readFile(root + (path === '/' ? 'index.html' : path));
    if (path === '/' || path === '/index.html') data = Buffer.from(data.toString().replace('<head>', '<head><meta name="bn-api" content="/api/staff">'));
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.ttf') ? 'font/ttf' : 'text/html'); res.end(data);
  } catch (e) { res.writeHead(500).end(e.message); }
}).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const results = [];
try {
  for (const [type, width] of [['HRC', 1354], ['B2B', 1024], ['VIGIFTS', 1354], ['HRC', 390]]) {
    const q = await f.call('/quotes', f.mgr, 'POST', { type, quoteNo: type + '_STOCK_' + width, date: '2026-10-30', customer: 'Khách kiểm thử', vat: 8, rows: [
      { sku: '00123', name: 'Bộ trà 0.5 L Came CXD', unit: 'Bộ', qty: 4, price: 716000, discount: 10 },
      { sku: '00123', name: 'Cùng mã dòng 2', unit: 'Bộ', qty: 5, price: 716000, discount: 10, discountType: type === 'B2B' ? 'amount' : 'percent' },
      { sku: '00123', name: 'Phí thêm', qty: 100, price: 12000, manualLine: true },
    ] }); assert.equal(q.status, 201); currentQuote = q.data.id;
    const context = await browser.newContext({ viewport: { width, height: 1004 } });
    await context.route('**/*', r => r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
    await context.addInitScript(({ token, user }) => {
      localStorage.setItem('bn-v2-session', token); localStorage.setItem('bn-v2-session-profile', JSON.stringify({ session: token, user }));
    }, { token, user });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/#/quotes/' + q.data.id);
    const badge = page.locator('#line-list tr[data-i="0"] [data-stock-warning]'); await badge.waitFor({ state: 'visible' });
    assert.match(await badge.getAttribute('aria-label'), /tổng 9, có thể bán 8, thiếu 1/);
    assert.equal(await page.locator('#line-list tr[data-i="2"] [data-stock-warning]').count(), 0);
    const before = lookups;
    await page.locator('#line-list tr[data-i="1"] [data-k="qty"]').fill('4'); await badge.waitFor({ state: 'hidden' });
    await page.locator('#line-list tr[data-i="1"] [data-k="qty"]').fill('1000'); await badge.waitFor({ state: 'visible' });
    await page.waitForTimeout(250); assert.equal(lookups, before, 'quantity edits use cached stock');
    const layout = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth, overflow: getComputedStyle(document.querySelector('.lines-wrap')).overflowX, wrapper: document.querySelector('.lines-wrap').clientWidth, table: document.querySelector('#line-table').clientWidth }));
    assert.ok(layout.page <= layout.viewport + 1, JSON.stringify(layout));
    let headers = [];
    if (width > 850) {
      headers = await page.locator('#line-head').evaluate(root => [...root.querySelectorAll('.col-qty,.col-price,.col-disc,.col-print,.col-after,.col-total')].map(th => {
        const range = document.createRange(); range.selectNodeContents(th); const r = range.getBoundingClientRect();
        return { label: th.textContent, left: r.left, right: r.right };
      }));
      for (let i = 1; i < headers.length; i++) assert.ok(headers[i - 1].right + 4 <= headers[i].left, JSON.stringify(headers));
    }
    await page.locator('.lines-wrap').scrollIntoViewIfNeeded(); await page.screenshot({ path: dir + '/' + type + '-' + width + '.png', fullPage: true });
    assert.deepEqual(errors, []); results.push({ type, width, layout, headers, duplicateSku: true, ownHoldExcluded: true, manualExcluded: true, noLookupOnQuantityInput: true });
    await context.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await writeFile(dir + '/results.json', JSON.stringify(results, null, 2)); await browser.close(); server.close(); await f.client.close();
}
