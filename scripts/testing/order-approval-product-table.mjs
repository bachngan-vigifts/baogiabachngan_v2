/** Local CRM router/PGlite and Chromium only; never reads or approves production contracts. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import { stockMoves } from '../../src/modules/inventory/schema.ts';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const f = await setup(),
  root = fileURLToPath(new URL('../../trial-ui/', import.meta.url));
const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};
const user = ok(await f.call('/me', f.mgr)).user,
  token = f.mgr.split('=')[1];
await f.db.insert(warehouses).values({id:'second-wh',name:'Kho phụ',kind:'stock'});
await f.db.transaction(tx=>postMoves(tx,'mgr',[{warehouseId:'second-wh',sku:'00123',qty:20,kind:'opening',refType:'opening',refId:'second-stock'},{warehouseId:'pos-wh',sku:'00123',qty:1000,kind:'opening',refType:'opening',refId:'first-stock'}]));
const writes = [],
  movesBefore = await f.db.select().from(stockMoves);
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
  for (const width of [390, 1280]) for (const kind of ['order','contract']) {
    const q = ok(
      await f.call('/quotes', f.mgr, 'POST', {
        type: 'HRC',
        quoteNo: 'APPROVAL-TABLE-' + kind + '-' + width,
        customer: 'CÔNG TY CỔ PHẦN ĐỐI CHIẾU HỢP ĐỒNG',
        customerTaxCode: '1501147816',
        contact: 'Chị Nhi',
        phone: '0901234567',
        customerAddress:
          'Số 0169A, Tổ 8, Ấp Thành Phú, Xã Tân Quới, Tỉnh Vĩnh Long, Việt Nam',
        vat: 8,
        shipping: { payer: 'receiver' },
        rows: Array.from({ length: 24 }, (_, i) => ({
          sku: '00123',
          name: `${i + 1}. Tách trà Daisy Trắng Ngà – sản phẩm tên dài để kiểm tra bố cục${i === 0 ? ' <img data-injected src=x>' : ''}`,
          unit: 'Cái',
          qty: i + 1,
          price: 100000,
          commission: { value: 0 },
        })),
      }),
      201,
    );
    ok(await f.call(`/quotes/${q.id}/approve`, f.mgr, 'POST', { revision: 1 }));
    const made=kind==='contract'?ok(await f.call('/contracts',f.mgr,'POST',{quoteId:q.id,legalEntity:'BN',warehouseId:'pos-wh',contractNo:'TABLE-'+width}),201):ok(await f.call('/orders',f.mgr,'POST',{quoteId:q.id}),201);
    const contract=kind==='contract'?made:{orderId:made.id,contractNo:made.orderNo};
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
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/#/'+(kind==='contract'?'contracts':'orders')+'/' + contract.orderId);
    await page.locator('#order-confirm').waitFor({ state: 'attached' });
    async function openReview() {
      if (width <= 850)
        await page.locator('[data-progress-action="approve"]').click();
      else await page.locator('#order-confirm').click();
      const costs = page.getByRole('dialog', {
        name: /^(Kiểm tra chi phí trước khi duyệt|Nhập đủ chi phí trước khi duyệt)$/,
        exact: true,
      });
      await costs.waitFor();
      for (const input of await costs.locator('input[name^="purchase-"]:not([name^="purchase-discount-"]):not([readonly])').all())
        if (!(await input.inputValue())) await input.fill('50000');
      for (const check of await costs.locator('[data-check]').all())
        await check.check();
      await costs.locator('[data-ok]').click();
      const dialog = page.getByRole('dialog', {
        name: kind==='contract'?'Duyệt HĐKT':/^Duyệt đơn/,
        exact: true,
      });
      await dialog.waitFor();
      return dialog;
    }
    let dialog = await openReview();
    assert.equal(await dialog.locator('.verify-products tbody tr').count(), 24, 'đơn và HĐKT đều có bảng sản phẩm');
    assert.match(await dialog.locator('.verify-products thead').innerText(),/Kho POS/i);
    assert.match(await dialog.locator('.verify-products thead').innerText(),/Kho phụ/i);
    assert.match(await dialog.locator('.verify-products tbody tr').first().innerText(),/Thiếu hàng/);
    assert.match(await dialog.locator('.verify-products tbody tr').first().innerText(),/Đủ hàng/);
    assert.equal(await dialog.locator('.verify-stock-list').count(),0,'không lặp khối tồn kho');
    assert.equal(
      await dialog.locator('[data-injected]').count(),
      0,
      'tên sản phẩm được escape',
    );
    assert.match(
      await dialog.locator('.verify-products tbody tr').first().innerText(),
      /<img data-injected/,
    );
    assert.equal(await dialog.locator('[data-check]').count(), 5);
    assert.equal(await dialog.locator('[data-ok]').isDisabled(), true);
    assert.equal(
      await dialog.locator('.verify-subtitle').innerText(),
      contract.contractNo,
    );
    assert.match(
      await dialog.locator('.verify-customer').innerText(),
      /Số 0169A/,
    );
    const bounds = await dialog.boundingBox();
    assert.ok(
      bounds.width >= width - 2 && bounds.x <= 1,
      'không gian duyệt chiếm trọn chiều rộng',
    );
    assert.ok(
      bounds.height >= 938 && bounds.y <= 1,
      'không bị giới hạn chiều cao popup',
    );
    const firstFooter = await dialog.locator('.modal-foot').boundingBox();
    await dialog.locator('.modal-body').evaluate((n) => {
      n.scrollTop = n.scrollHeight;
    });
    const lastFooter = await dialog.locator('.modal-foot').boundingBox();
    assert.equal(
      Math.round(lastFooter.y),
      Math.round(firstFooter.y),
      'thanh hành động luôn nhìn thấy',
    );
    assert.ok(lastFooter.y + lastFooter.height <= 941);
    assert.equal(
      await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
      true,
      'không tràn ngang màn hình',
    );
    let beforeCancel = writes.length;
    await dialog
      .getByRole('button', { name: 'Quay lại kiểm tra', exact: true })
      .click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(writes.length, beforeCancel, 'quay lại không ghi dữ liệu');
    assert.equal(
      ok(await f.call('/orders/' + contract.orderId, f.mgr)).order.status,
      'draft',
    );
    dialog = await openReview();
    beforeCancel = writes.length;
    if (width === 390)
      await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    else await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      writes.length,
      beforeCancel,
      'Escape / đóng không duyệt chứng từ',
    );
    dialog = await openReview();
    beforeCancel = writes.length;
    for (const check of await dialog.locator('[data-check]').all())
      await check.check();
    const first = dialog.locator('[data-check]').first();
    await first.uncheck();
    assert.equal(await dialog.locator('[data-ok]').isDisabled(), true);
    await first.check();
    await dialog.locator('[name="deliveryDate"]').fill('');
    await dialog.locator('[data-ok]').click();
    await dialog
      .locator('[data-err]')
      .filter({ hasText: 'Chọn ngày giao dự kiến.' })
      .waitFor();
    assert.equal(
      ok(await f.call('/orders/' + contract.orderId, f.mgr)).order.status,
      'draft',
    );
    const date = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    await dialog.locator('[name="deliveryDate"]').fill(date);
    await dialog.locator('[name="warehouseId"]').selectOption('pos-wh');
    await dialog.locator('.modal-body').evaluate((n) => {
      n.scrollTop = 0;
    });
    if (process.env.CONTRACT_APPROVAL_SCREENSHOT_DIR) {
      await mkdir(process.env.CONTRACT_APPROVAL_SCREENSHOT_DIR, {
        recursive: true,
      });
      await page.screenshot({
        path: `${process.env.CONTRACT_APPROVAL_SCREENSHOT_DIR}/approval-${kind}-${width}.png`,
      });
    }
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/orders/${contract.orderId}/status`) &&
        r.request().method() === 'PUT',
    );
    await dialog.locator('[data-ok]').click();
    assert.equal((await saved).status(), 200);
    const current = ok(
      await f.call('/orders/' + contract.orderId, f.mgr),
    ).order;
    assert.equal(current.status, 'confirmed');
    assert.equal(current.expectedDeliveryDate, date);
    const statusWrite = writes.filter(
      (w) => w.path === `/orders/${contract.orderId}/status`,
    );
    assert.equal(statusWrite.length, 1);
    assert.equal(statusWrite[0].body.verified, true);
    assert.equal(statusWrite[0].body.warehouseId, 'pos-wh');
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,kind,
        productRows: 24,
        fullPage: true,
        footerVisible: true,
        cancelWithoutWrites: true,
        checkboxAndDateGates: true,
        confirmed: true,
        jsErrors: 0,
      }),
    );
    await context.close();
  }
  // Callers using the shared compact dialog keep their summary, fields, validation and cancel result.
  const page = await browser.newPage();
  await page.route('**/*', (route) =>
    route
      .request()
      .url()
      .startsWith(origin + '/')
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin);
  await page.evaluate(async () => {
    const { verifyBox } = await import('/verify.js');
    window.compactResult = 'pending';
    verifyBox({
      title: 'Xác nhận thông tin khác',
      rows: [['Khách hàng', 'Khách thử nghiệm']],
      fields: '<label>Ngày giao<input type="date" name="deliveryDate"></label>',
      checks: ['Đã kiểm tra'],
      validate: (v) => (v.deliveryDate ? '' : 'Cần chọn ngày.'),
    }).then((v) => {
      window.compactResult = v;
    });
  });
  const compact = page.getByRole('dialog', {
    name: 'Xác nhận thông tin khác',
    exact: true,
  });
  await compact.waitFor();
  assert.equal(
    await compact.evaluate((n) => n.classList.contains('verify-page')),
    false,
  );
  assert.match(
    await compact.locator('.verify-summary').innerText(),
    /Khách thử nghiệm/,
  );
  await compact.locator('[data-check]').check();
  await compact.locator('[data-ok]').click();
  await compact
    .locator('[data-err]')
    .filter({ hasText: 'Cần chọn ngày.' })
    .waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.compactResult === null);
  await page.close();
  assert.deepEqual(
    await f.db.select().from(stockMoves),
    movesBefore,
    'duyệt không xuất kho vật lý',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await f.client.close();
}
