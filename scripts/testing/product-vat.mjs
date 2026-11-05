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
  // Product management is intentionally read-only on mobile; exercise supported desktop/tablet widths.
  for (const width of [1024, 1280]) {
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
      errors = [],
      sku = 'VAT-BROWSER-' + width;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/#/products');
    await page.locator('[data-product-card="00123"]').waitFor();
    await page.locator('#new-product').click();
    let dialog = page.getByRole('dialog', {
      name: 'Thêm sản phẩm',
      exact: true,
    });
    await dialog.waitFor();
    const tax = dialog.getByLabel('Thuế sản phẩm (VAT)');
    assert.equal(await tax.inputValue(), '8');
    assert.deepEqual(await tax.locator('option').allTextContents(), [
      '8%',
      '10%',
    ]);
    if (width === 1024) await tax.selectOption('10');
    const rate = width === 1024 ? 10 : 8;
    await dialog.locator('[name="sku"]').fill(sku);
    await dialog.locator('[name="name"]').fill('Sản phẩm thuế ' + width);
    await dialog.locator('[name="unit"]').fill('cái');
    await dialog.locator('[name="price:retail"]').fill('100000');
    await dialog
      .locator('[name="price:retail-vat"]')
      .fill(String(Math.round(100000 * (1 + rate / 100))));
    await dialog
      .getByRole('button', { name: 'Lưu sản phẩm', exact: true })
      .click();
    await dialog.waitFor({ state: 'hidden' });
    let p = (await f.call('/products/' + sku, f.mgr)).data.product;
    assert.equal(p.taxOut, rate);
    assert.equal(p.taxable, true);
    const prices = p.prices;

    await page.goto(origin + '/#/products/' + sku);
    await page.locator('[data-pd-edit]').click();
    dialog = page.getByRole('dialog', {
      name: 'Cập nhật sản phẩm',
      exact: true,
    });
    await dialog.waitFor();
    assert.equal(
      await dialog.getByLabel('Thuế sản phẩm (VAT)').inputValue(),
      String(rate),
    );
    const nextRate = rate === 8 ? 10 : 8;
    await dialog
      .getByLabel('Thuế sản phẩm (VAT)')
      .selectOption(String(nextRate));
    if (process.env.PRODUCT_VAT_SCREENSHOT_DIR) {
      await mkdir(process.env.PRODUCT_VAT_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: `${process.env.PRODUCT_VAT_SCREENSHOT_DIR}/product-vat-${width}.png`,
        fullPage: true,
      });
    }
    if (width === 1280) {
      failUpdate = true;
      const beforeWrites = writes.length;
      await dialog
        .getByRole('button', { name: 'Lưu cập nhật', exact: true })
        .click();
      await dialog
        .locator('[data-err]')
        .filter({ hasText: 'Kiểm thử lỗi lưu' })
        .waitFor();
      assert.equal(writes.length, beforeWrites + 1, 'PUT không tự gửi lại');
      assert.equal(
        await dialog.getByLabel('Thuế sản phẩm (VAT)').inputValue(),
        String(nextRate),
      );
    }
    await dialog
      .getByRole('button', { name: 'Lưu cập nhật', exact: true })
      .click();
    await dialog.waitFor({ state: 'hidden' });
    p = (await f.call('/products/' + sku, f.mgr)).data.product;
    assert.equal(p.taxOut, nextRate);
    assert.deepEqual(p.prices, prices);
    await page.locator('[data-pd-edit]').click();
    dialog = page.getByRole('dialog', {
      name: 'Cập nhật sản phẩm',
      exact: true,
    });
    await dialog.waitFor();
    assert.equal(
      await dialog.getByLabel('Thuế sản phẩm (VAT)').inputValue(),
      String(nextRate),
    );
    await dialog.locator('[name="name"]').fill('Chỉ sửa tên ' + width);
    await dialog
      .getByRole('button', { name: 'Lưu cập nhật', exact: true })
      .click();
    await dialog.waitFor({ state: 'hidden' });
    const latest = writes
      .filter((w) => w.method === 'PUT' && w.path === '/products/' + sku)
      .at(-1);
    assert.equal(
      Object.hasOwn(latest.body, 'taxRate'),
      false,
      'không chọn thuế mới thì không ghi đè thuế',
    );
    assert.equal(
      (await f.call('/products/' + sku, f.mgr)).data.product.taxOut,
      nextRate,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        default8: true,
        createAndUpdateTax: true,
        reopenSavedTax: true,
        pricesPreserved: true,
        jsErrors: 0,
      }),
    );
    await context.close();
  }
  assert.deepEqual(await f.db.select().from(productStock), beforeStock);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await f.client.close();
}
