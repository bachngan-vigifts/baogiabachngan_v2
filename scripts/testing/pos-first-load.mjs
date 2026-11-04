/** Real local router/PGlite + Chromium. Controlled slow full snapshots; no production requests. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { setup } from '../../tests/helpers/pos-fixture.ts';
import {
  products,
  productPrices,
  warehouses,
} from '../../src/modules/catalog/schema.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import { stockMoves } from '../../src/modules/inventory/schema.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const f = await setup(),
  delayMs = 3000;
const root = fileURLToPath(new URL('../../trial-ui/', import.meta.url));
const baseline = execFileSync('git', [
  'show',
  (process.env.POS_BASELINE_REF || '4291e921ff2cc99e0b79bb0db6a5bde9f04ac587') +
    ':trial-ui/pos.js',
]);
const at = new Date().toISOString();
const catalog = ['lock', 'ml'].flatMap((family) =>
  Array.from({ length: 90 }, (_, i) => ({
    sku: family + '-' + String(i).padStart(3, '0'),
    name:
      (family === 'lock' ? 'Bình LocknLock ' : 'Chén Minh Long ') +
      String(i).padStart(3, '0'),
    brand: family === 'lock' ? 'LocknLock' : 'Minh Long',
    unit: 'cái',
    updatedAt: at,
  })),
);
await f.db.insert(products).values(catalog);
await f.db.insert(productPrices).values(
  catalog.flatMap((p) => [
    { sku: p.sku, policyId: 'retail-vat', price: 108000 },
    { sku: p.sku, policyId: 'retail', price: 100000 },
  ]),
);
await postMoves(f.db, 'mgr', [
  {
    sku: 'lock-000',
    warehouseId: 'pos-wh',
    qty: 7,
    kind: 'adjust',
    refType: 'adjustment',
    refId: 'lock-fixture',
  },
]);
await f.open();
await f.db
  .insert(warehouses)
  .values({ id: 'ml-first-wh', name: 'Kho Minh Long', kind: 'stock' });
await postMoves(f.db, 'mgr', [
  {
    sku: 'ml-000',
    warehouseId: 'ml-first-wh',
    qty: 9,
    kind: 'opening',
    refType: 'opening',
    refId: 'ml-first-fixture',
  },
]);
const register = await f.call('/pos/registers', f.mgr, 'POST', {
  name: 'Quầy Minh Long',
  warehouseId: 'ml-first-wh',
  pricePolicyId: 'retail-vat',
  secondPricePolicyId: 'retail',
});
assert.equal(register.status, 200);
await f.db
  .update(employees)
  .set({ positionId: 'sales-ml' })
  .where(eq(employees.id, 'cashier2'));
const drawer = await f.call('/cash/drawers', f.mgr, 'POST', {
  key: crypto.randomUUID(),
  name: 'Két ML',
  registerId: register.data.id,
});
assert.equal(drawer.status, 201);
assert.equal(
  (
    await f.call('/cash/config?drawerId=' + drawer.data.id, f.mgr, 'POST', {
      openingAmount: 0,
      reason: 'Fixture',
    })
  ).status,
  200,
);
assert.equal(
  (
    await f.call('/pos/shifts/open', f.other, 'POST', {
      key: crypto.randomUUID(),
      registerId: register.data.id,
      openingCash: 0,
    })
  ).status,
  201,
);
const profiles = {
  lock: (await f.call('/me', f.emp)).data.user,
  ml: (await f.call('/me', f.other)).data.user,
};
const beforeStock = await f.db.select().from(stockMoves);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      const mode =
          url.searchParams.get('mode') === 'before' ? 'before' : 'after',
        family = url.searchParams.get('family') === 'ml' ? 'ml' : 'lock';
      res.writeHead(200, { 'content-type': 'text/html' })
        .end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><style>.main{margin:0;padding:16px;max-width:none}</style><main class="main"><section id="pos"></section></main><script type="module">
import {initPos} from '/pos.js?mode=${mode}';
window.requests=[];window.snapshotDone=false;window.ready=false;
const api=async(path,method='GET',body)=>{window.requests.push(path);const res=await fetch('/api/staff'+path,{method,headers:{'content-type':'application/json','x-fixture-family':'${family}'},body:body?JSON.stringify(body):undefined});const data=await res.json();if(path.startsWith('/pos/stock-snapshot')||path.startsWith('/pos/options?stock=1'))window.snapshotDone=true;if(!res.ok)throw Error(data.error);return data;};
window.ui=initPos({root:document.querySelector('#pos'),api,user:()=>(${JSON.stringify(profiles[family])}),toast(){},go(){},confirmBox:async()=>true,localSearch:()=>null});
window.ui.load().then(()=>window.ready=true);
</script>`);
      return;
    }
    if (url.pathname.startsWith('/api/staff/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : undefined;
      const result = await f.call(
        url.pathname.slice('/api/staff'.length) + url.search,
        req.headers['x-fixture-family'] === 'ml' ? f.other : f.emp,
        req.method,
        body,
      );
      if (
        url.pathname.endsWith('/pos/stock-snapshot') ||
        (url.pathname.endsWith('/pos/options') &&
          url.searchParams.get('stock') === '1')
      )
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      res
        .writeHead(result.status, { 'content-type': 'application/json' })
        .end(JSON.stringify(result.data));
      return;
    }
    const data =
      url.pathname === '/pos.js' && url.searchParams.get('mode') === 'before'
        ? baseline
        : await readFile(root + url.pathname);
    res
      .writeHead(200, {
        'content-type': url.pathname.endsWith('.js')
          ? 'text/javascript'
          : url.pathname.endsWith('.css')
            ? 'text/css'
            : 'application/octet-stream',
      })
      .end(data);
  } catch (error) {
    res.writeHead(500).end(String(error.message));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const results = [],
  output = process.env.POS_SCREENSHOT_DIR || '/tmp/pos-first-load-screens';
await mkdir(output, { recursive: true });
try {
  for (const [mode, family, width] of [
    ['before', 'lock', 1280],
    ['after', 'lock', 1280],
    ['after', 'lock', 390],
    ['after', 'ml', 1280],
    ['after', 'ml', 390],
  ]) {
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
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const start = Date.now();
    await page.goto(`${origin}/?mode=${mode}&family=${family}`);
    const sku = family + '-000',
      card = page.locator('.pos-product[data-sku="' + sku + '"]');
    await card.waitFor();
    const firstProductMs = Date.now() - start;
    if (mode === 'after') {
      assert.equal(
        await page.evaluate(() => window.snapshotDone),
        false,
        'first page precedes slow preload',
      );
      assert.ok(
        firstProductMs < delayMs,
        'first page does not wait for the large preload',
      );
      await page.waitForFunction(() => window.ready);
      assert.equal(
        await page.evaluate(() => window.snapshotDone),
        false,
        'load itself resolves without preload',
      );
      assert.ok(
        (await page.locator('.pos-product').count()) <=
          (width <= 850 ? 20 : 60),
      );
      const paths = await page.evaluate(() => window.requests);
      assert.ok(paths[0].startsWith('/pos/options?stock=0'));
      assert.equal(await card.isEnabled(), true);
      const readsBefore = paths.filter((p) =>
        p.startsWith('/pos/catalog'),
      ).length;
      await page
        .getByRole('searchbox', { name: 'Tìm hoặc quét sản phẩm' })
        .fill(sku);
      await page
        .getByRole('searchbox', { name: 'Tìm hoặc quét sản phẩm' })
        .press('Enter');
      await page.locator('.pos-line').filter({ hasText: sku }).waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            window.requests.filter((p) => p.startsWith('/pos/catalog')).length,
        ),
        readsBefore,
        'cached scan does not reload catalog',
      );
      await page.waitForFunction(() => window.snapshotDone);
      assert.equal(
        await page.locator('.pos-line').count(),
        1,
        'background completion preserves the cart',
      );
      assert.match(
        await card.innerText(),
        new RegExp('Còn ' + (family === 'lock' ? 7 : 9)),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await page.screenshot({
        path: `${output}/${family}-${width}.png`,
        fullPage: true,
      });
    } else assert.ok(firstProductMs >= delayMs);
    assert.deepEqual(errors, []);
    results.push({
      mode,
      family,
      width,
      firstProductMs,
      delayedSnapshotMs: delayMs,
    });
    console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
  assert.deepEqual(await f.db.select().from(stockMoves), beforeStock);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await f.client.close();
}
