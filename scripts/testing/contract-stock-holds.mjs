/** Local real router/PGlite + Chromium. Never calls production or a carrier. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  fixture,
  ok,
  sku,
} from '../../tests/helpers/warehouse-lifecycle-fixture.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
import { stockMoves } from '../../src/modules/inventory/schema.ts';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const f = await fixture(),
  c = f.cookies;
await postMoves(f.db, 'mgr', [
  {
    sku,
    warehouseId: 'vig',
    qty: 20,
    kind: 'receipt',
    refType: 'supplier_receipt',
    refId: 'browser-stock',
  },
]);
async function quote(no, qty) {
  const q = ok(
    await f.call('/quotes', c.emp, 'POST', {
      type: 'HRC',
      quoteNo: no,
      customer: 'Khách giữ hàng',
      customerTaxCode: '0312345678',
      vat: 8,
      rows: [{ sku, name: 'Bộ trà', unit: 'Bộ', qty, price: 2000 }],
    }),
    201,
  );
  ok(await f.call(`/quotes/${q.id}/approve`, c.mgr, 'POST', { revision: 1 }));
  return q.id;
}
const quoteId = await quote('HOLD-CHECK', 2);
ok(await f.call(`/quotes/${quoteId}/hold`, c.emp, 'POST', {}), 201);
const user = ok(await f.call('/me', c.mgr)).user;
const token = c.mgr.split('=')[1];
const root = fileURLToPath(new URL('../../trial-ui/', import.meta.url));
const beforeMoves = (await f.db.select().from(stockMoves)).length;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/staff/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : undefined;
      const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const result = await f.call(
        url.pathname.slice('/api/staff'.length) + url.search,
        bearer ? '__Host-bn-session=' + bearer : '',
        req.method,
        body,
      );
      res
        .writeHead(result.status, { 'content-type': 'application/json' })
        .end(JSON.stringify(result.data));
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
  } catch (error) {
    res.writeHead(500).end(error.message);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
try {
  for (const width of [390, 1280]) {
    const sourceId = await quote('HOLD-CONTRACT-' + width, 5);
    const contract = ok(
      await f.call('/contracts', c.emp, 'POST', {
        quoteId: sourceId,
        legalEntity: 'VG',
        warehouseId: 'vig',
      }),
      201,
    );
    const base = `/orders/${contract.orderId}/holds`;
    const context = await browser.newContext({
      viewport: { width, height: 940 },
    });
    await context.route('**/*', (route) =>
      route
        .request()
        .url()
        .startsWith(origin + '/')
        ? route.continue()
        : route.abort(),
    );
    await context.addInitScript(
      ({ token, user }) => {
        localStorage.setItem('bn-api-region-manual-off', '1');
        localStorage.setItem('bn-v2-session', token);
        localStorage.setItem(
          'bn-v2-session-profile',
          JSON.stringify({ session: token, user }),
        );
      },
      { token, user },
    );
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/#/contracts/' + contract.orderId);
    const panel = page.locator('#order-holds-card');
    await panel
      .getByRole('heading', { name: 'Giữ hàng HĐKT', exact: true })
      .waitFor();
    assert.match(await panel.innerText(), /Duyệt.*HĐKT/);
    assert.equal(
      await panel
        .getByRole('button', { name: 'Giữ hàng', exact: true })
        .count(),
      0,
    );
    ok(
      await f.call(`/orders/${contract.orderId}/status`, c.mgr, 'PUT', {
        status: 'confirmed',
        verified: true,
        costWarningsReviewed: true,
      }),
    );
    await page.reload();
    await panel.getByRole('button', { name: 'Giữ hàng', exact: true }).click();
    await panel
      .getByRole('button', { name: 'Gia hạn 5 ngày', exact: true })
      .waitFor();
    const before = ok(await f.call(base, c.mgr)).holds[0].expiresAt;
    await panel
      .getByRole('button', { name: 'Gia hạn 5 ngày', exact: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector('#order-holds-card button:disabled'),
    );
    assert.equal(
      Date.parse(ok(await f.call(base, c.mgr)).holds[0].expiresAt) -
        Date.parse(before),
      5 * 864e5,
    );
    page.once('dialog', (dialog) => dialog.accept('Khách đổi lịch'));
    await panel.getByRole('button', { name: 'Huỷ giữ', exact: true }).click();
    await panel
      .getByRole('button', { name: 'Giữ hàng', exact: true })
      .waitFor();
    assert.equal(ok(await f.call(base, c.mgr)).holds.length, 0);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );

    await page.goto(origin + '/#/quotes/' + quoteId);
    if (width <= 850)
      await page.locator('.quote-actions > .mobile-action-trigger').click();
    await page.locator('#quote-stock').click();
    const dialog = page.locator('#stock-check-dialog');
    await dialog
      .getByRole('columnheader', { name: 'Hàng đang giữ', exact: true })
      .waitFor();
    const cells = await dialog
      .locator('tbody tr')
      .first()
      .locator('td')
      .allTextContents();
    assert.match(cells[3], /^2/);
    assert.match(await dialog.innerText(), /báo giá này đang giữ 2/);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    if (process.env.HOLDS_SCREENSHOT_DIR) {
      await mkdir(process.env.HOLDS_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: `${process.env.HOLDS_SCREENSHOT_DIR}/stock-check-${width}.png`,
        fullPage: true,
      });
    }
    await page.keyboard.press('Escape');
    await page.goto(origin + '/#/stock-lookup?q=' + sku);
    const lookup = page.locator('#view-stock-lookup');
    await lookup
      .getByRole('columnheader', { name: 'Hàng đang giữ', exact: true })
      .waitFor();
    const table = lookup.locator('table').first();
    assert.match(await table.innerText(), /Chưa gắn kho/);
    assert.equal(
      (
        await table.locator('tbody tr').last().locator('td').allTextContents()
      ).at(-1),
      '2',
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    if (process.env.HOLDS_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.HOLDS_SCREENSHOT_DIR}/stock-lookup-${width}.png`,
        fullPage: true,
      });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        contractHoldReleaseExtend: true,
        quoteStockColumn: true,
        lookupStockColumn: true,
        overflow: false,
        jsErrors: 0,
      }),
    );
    await context.close();
  }
  assert.equal(
    (await f.db.select().from(stockMoves)).length,
    beforeMoves,
    'giữ / nhả / gia hạn không ghi biến động tồn vật lý',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await f.client.close();
}
