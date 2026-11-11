/** So sánh nút nhìn thấy theo trang × khổ màn hình (PGlite + website giả, không dữ liệu production). Dùng: UI_ROOT=<thư mục trial-ui> OUT=<file json>. */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'), chromium = pw.chromium ?? pw.default.chromium;
const f = await setup();
const root = process.env.UI_ROOT || fileURLToPath(new URL('../../trial-ui/', import.meta.url));
const user = (await f.call('/me', f.mgr)).data.user, token = f.mgr.split('=')[1];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/staff/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const r = await f.call(url.pathname.slice('/api/staff'.length) + url.search, bearer ? '__Host-bn-session=' + bearer : '', req.method, body);
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.data)); return;
    }
    let data = await readFile(root + (url.pathname === '/' ? 'index.html' : url.pathname));
    if (url.pathname === '/' || url.pathname === '/index.html') data = Buffer.from(data.toString().replace('<head>', '<head><meta name="bn-api" content="/api/staff">'));
    res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(data);
  } catch (e) { res.writeHead(404).end(e.message); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const pages = ['#/products', '#/kho', '#/inventory', '#/transfers', '#/stock-moves', '#/stock-lookup', '#/flow', '#/customers', '#/quotes', '#/orders', '#/pos'];
const out = {};
try {
  for (const [w, h] of [[390, 844], [1280, 900]]) for (const hash of pages) {
    const context = await browser.newContext({ viewport: { width: w, height: h } });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await context.addInitScript(({ token, user }) => { localStorage.setItem('bn-api-region-manual-off', '1'); localStorage.setItem('bn-v2-session', token); localStorage.setItem('bn-v2-session-profile', JSON.stringify({ session: token, user })); }, { token, user });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    const t0 = Date.now(); await page.goto(origin + '/' + hash); await page.waitForLoadState('networkidle'); await page.waitForTimeout(700);
    const info = await page.evaluate(() => ({
      buttons: [...document.querySelectorAll('main .view:not([hidden]) button, main .view:not([hidden]) a.btn')].filter(n => n.offsetParent && n.getClientRects().length).map(n => (n.id ? '#' + n.id + ' ' : '') + (n.textContent || n.title || '').trim().replace(/\s+/g, ' ').slice(0, 40)).sort(),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
    let dialog = null;
    if (hash === '#/products' && await page.locator('#new-product').isVisible()) {
      await page.locator('#new-product').click(); await page.locator('dialog.product-admin-dialog').waitFor();
      dialog = await page.evaluate(() => ({ buttons: [...document.querySelectorAll('dialog[open] button')].filter(n => n.offsetParent).map(n => n.textContent.trim().slice(0, 30)), overflow: document.documentElement.scrollWidth > window.innerWidth + 1, dialogOverflow: (d => d.scrollWidth > d.clientWidth + 1)(document.querySelector('dialog[open]')) }));
    }
    out[`${w} ${hash}`] = { ...info, dialog, errors, ms: Date.now() - t0 };
    await context.close();
  }
} finally { await browser.close(); server.close(); }
await writeFile(process.env.OUT || '/dev/stdout', JSON.stringify(out, null, 1));
console.log('OK', Object.keys(out).length, 'trang');
