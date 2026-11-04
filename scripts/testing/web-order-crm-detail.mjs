/** Local browser + real CRM router/PGlite. No production orders or carrier calls. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';
import { PASSWORD } from '../../tests/helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { employees, credentials } from '../../src/modules/staff/schema.ts';
import { webStoreOrders } from '../../src/modules/sales/pos-schema.ts';
import { stockMoves } from '../../src/modules/inventory/schema.ts';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const f = await setup(),
  shift = await f.open();
await f.db.insert(employees).values({
  id: 'accountant',
  name: 'Kế toán',
  email: 'accountant@x.vn',
  role: 'employee',
  positionId: 'accounting',
  createdAt: new Date().toISOString(),
});
await f.db.insert(credentials).values({
  memberId: 'accountant',
  passwordHash: await hashPassword(PASSWORD, 1000),
  version: 0,
});
const login = await f.call('/login', '', 'POST', {
    email: 'accountant@x.vn',
    password: PASSWORD,
  }),
  token = login.cookie.split('=')[1];
assert.equal(login.status, 200);
const user = (await f.call('/me', login.cookie)).data.user;
await f.db.insert(webStoreOrders).values(
  ['delivered', 'pending'].map((status) => ({
    id: 'web-' + status,
    source: 'lock',
    externalId: status,
    orderNo: status === 'delivered' ? '21553' : '21554',
    registerId: f.registerId,
    customerName: 'Nang',
    phone: '0901234567',
    address: 'Cần Thơ',
    status: 'processing',
    ghnOrderCode: status === 'delivered' ? 'FIXTURE-GHN' : '',
    ghnStatus: status === 'delivered' ? 'delivered' : '',
    stockStatus: status === 'delivered' ? 'issued' : 'none',
    total: 108000,
    lines: JSON.stringify([
      {
        sku: '00123',
        name: 'Ly sứ',
        quantity: 1,
        subtotal: 100000,
        subtotalTax: 8000,
        total: 100000,
        totalTax: 8000,
      },
    ]),
    orderedAt: '2026-11-04T00:00:00Z',
    updatedAt: '2026-11-04T00:00:00Z',
  })),
);
const sale = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id));
assert.equal(sale.status, 201);
const beforeStock = await f.db.select().from(stockMoves),
  root = fileURLToPath(new URL('../../trial-ui/', import.meta.url));
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
      const r = await f.call(
        url.pathname.slice('/api/staff'.length) + url.search,
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
  } catch (error) {
    res.writeHead(500).end(error.message);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port,
  browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
  });
try {
  for (const width of [390, 1280]) {
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
        localStorage.setItem('bn-api-region-off', '1'); // Local fixture has no regional gateway.
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
    await page.goto(origin + '/#/orders/web%3Aweb-delivered');
    await page
      .locator('#order-title')
      .filter({ hasText: 'Web_21553_Nang' })
      .waitFor();
    assert.equal(await page.locator('#web-order-content').isVisible(), false);
    assert.equal(await page.locator('#order-customer').isVisible(), true);
    assert.equal(
      await page.locator('.web-order-paper').count(),
      0,
      'normal order cards replace print preview',
    );
    if (
      await page
        .getByRole('button', { name: 'Sửa số hoá đơn', exact: true })
        .count()
    )
      await page
        .getByRole('button', { name: 'Sửa số hoá đơn', exact: true })
        .click();
    const form = page.locator('#invoice-form');
    await form.waitFor({ state: 'visible' });
    const number = '000' + width;
    await form.locator('[name=invoiceNo]').fill(number);
    await form.locator('[name=invoiceDate]').fill('2026-11-04');
    await form.locator('button').click();
    await page
      .locator('#order-invoice b')
      .filter({ hasText: number })
      .waitFor();
    await page
      .getByRole('button', { name: 'Sửa thông tin xuất hoá đơn', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Thông tin xuất hoá đơn',
      exact: true,
    });
    await dialog.getByLabel('Mã số thuế', { exact: true }).fill('0012345678');
    await dialog
      .getByRole('button', { name: 'Lưu thông tin', exact: true })
      .click();
    await dialog.waitFor({ state: 'hidden' });
    await page
      .locator('#order-customer')
      .filter({ hasText: '0012345678' })
      .waitFor();
    if (process.env.WEB_DETAIL_SCREENSHOT_DIR) {
      await mkdir(process.env.WEB_DETAIL_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path:
          process.env.WEB_DETAIL_SCREENSHOT_DIR +
          '/web-detail-' +
          width +
          '.png',
        fullPage: true,
      });
    }
    await page.evaluate((id) => {
      location.hash = '#/orders/' + id;
    }, sale.data.id);
    await page
      .locator('#order-title')
      .filter({ hasText: sale.data.orderNo })
      .waitFor();
    assert.equal(await page.locator('#order-customer').isVisible(), true);
    await page.evaluate(() => {
      location.hash = '#/orders/web%3Aweb-delivered';
    });
    await page
      .locator('#order-title')
      .filter({ hasText: 'Web_21553_Nang' })
      .waitFor();
    await page
      .locator('#order-invoice b')
      .filter({ hasText: number })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        accountingCanEnterAndCorrectInvoice: true,
        sharedDetailCards: true,
        crmNavigationPreserved: true,
        errors,
      }),
    );
    await context.close();
  }
  const manager = (await f.call('/me', f.mgr)).data.user;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 940 },
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
      localStorage.setItem('bn-api-region-off', '1');
      localStorage.setItem('bn-v2-session', token);
      localStorage.setItem(
        'bn-v2-session-profile',
        JSON.stringify({ session: token, user }),
      );
    },
    { token: f.mgr.split('=')[1], user: manager },
  );
  const page = await context.newPage();
  await page.goto(origin + '/#/orders/web%3Aweb-pending');
  await page
    .locator('#order-title')
    .filter({ hasText: 'Web_21554_Nang' })
    .waitFor();
  await page
    .getByRole('button', { name: 'Sửa sản phẩm / giá', exact: true })
    .click();
  const editor = page.locator('.web-order-edit');
  await editor.waitFor();
  await editor.getByLabel('Số lượng', { exact: true }).fill('2');
  await editor
    .locator('label.web-edit-field')
    .filter({ hasText: 'Lý do sửa' })
    .locator('input')
    .fill('Khách đổi số lượng trước khi tạo GHN');
  await editor
    .getByLabel('Đã kiểm tra giá, CK, VAT, phí và tổng tiền', { exact: true })
    .check();
  await editor
    .getByLabel('Đã đối chiếu thanh toán với khách / chứng từ', { exact: true })
    .check();
  await editor
    .getByRole('button', { name: 'Kiểm tra tổng tiền', exact: true })
    .click();
  await editor
    .locator('.web-edit-total')
    .filter({ hasText: '216.000' })
    .waitFor();
  await editor
    .getByRole('button', { name: 'Lưu bản sửa', exact: true })
    .click();
  await editor.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#order-customer').isVisible(), true);
  assert.match(await page.locator('#order-contract').innerText(), /216.000/);
  console.log(JSON.stringify({ preGhnCartEditReturnsToCrmDetail: true }));
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 940 });
    await page.goto(origin + '/#/pos');
    const delivered = page
      .locator('.pos-order-row')
      .filter({ hasText: '21553' });
    await delivered.waitFor();
    assert.match(
      await delivered.innerText(),
      /GHN FIXTURE-GHN · Đã giao thành công/,
    );
    assert.match(
      await page
        .locator('.pos-order-row')
        .filter({ hasText: '21554' })
        .innerText(),
      /Chưa tạo GHN/,
    );
    const shipping = delivered.locator('.pos-order-shipping');
    assert.equal(await shipping.isVisible(), true);
    assert.equal(
      await delivered.evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
    );
    if (process.env.WEB_DETAIL_SCREENSHOT_DIR) {
      await delivered.screenshot({
        path:
          process.env.WEB_DETAIL_SCREENSHOT_DIR + '/pos-ghn-' + width + '.png',
      });
    }
    await delivered.click();
    await page
      .locator('#order-title')
      .filter({ hasText: 'Web_21553_Nang' })
      .waitFor();
    assert.equal(await page.locator('#order-invoice').isVisible(), true);
    assert.equal(await page.locator('.pos-modal').count(), 0);
    console.log(
      JSON.stringify({
        width,
        posCarrierSnapshot: true,
        posRowOpensCrmDetail: true,
      }),
    );
  }
  for (const [title, dueDate] of [
    ['Gọi khách kiểm tra báo giá', '2026-11-03'],
    ['Chuẩn bị hồ sơ hợp đồng', null],
  ]) {
    const task = await f.call('/tasks', f.mgr, 'POST', {
      title,
      assigneeId: manager.id,
      priority: 'high',
      dueDate,
    });
    assert.equal(task.status, 201, JSON.stringify(task.data));
  }
  const taskErrors = [];
  page.on('pageerror', (error) => taskErrors.push(error.message));
  for (const width of [390, 1280, 1660]) {
    await page.setViewportSize({ width, height: 940 });
    await page.goto(origin + '/#/tasks');
    const taskPage = page.locator('#view-tasks');
    await taskPage
      .locator('.task-row')
      .filter({ hasText: 'Gọi khách kiểm tra báo giá' })
      .waitFor();
    assert.equal(await taskPage.locator('.task-due-card').count(), 4);
    assert.equal(
      await taskPage.locator('.task-list-panel .task-filterbar').isVisible(),
      true,
    );
    assert.equal(
      await taskPage.locator('.task-list-head').isVisible(),
      width > 850,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    if (process.env.WEB_DETAIL_SCREENSHOT_DIR) {
      await page.waitForFunction(
        () =>
          !document.querySelector(
            '#view-tasks.is-refreshing, #view-tasks .is-refreshing',
          ),
      );
      await page.evaluate(() =>
        document.querySelector('#toasts')?.replaceChildren(),
      );
      await page.screenshot({
        path:
          process.env.WEB_DETAIL_SCREENSHOT_DIR +
          '/tasks-layout-' +
          width +
          '.png',
        fullPage: true,
      });
    }
    const overdue = taskPage.locator('[data-stat=overdue]');
    await overdue.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-stat=overdue]')
          ?.getAttribute('aria-pressed') === 'true',
    );
    await overdue.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-stat=overdue]')
          ?.getAttribute('aria-pressed') === 'false',
    );
    await taskPage
      .locator('.task-row')
      .filter({ hasText: 'Gọi khách kiểm tra báo giá' })
      .locator('.task-title')
      .click();
    const detail =
      width >= 1280
        ? taskPage.locator('#tasks-panel')
        : page.locator('dialog.task-dialog');
    await detail.waitFor({ state: 'visible' });
    assert.equal(
      await detail.getByLabel('Tên việc', { exact: true }).inputValue(),
      'Gọi khách kiểm tra báo giá',
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await detail
      .getByRole('button', { name: 'Đóng', exact: true })
      .first()
      .click();
    await detail.waitFor({ state: 'hidden' });
    await taskPage.locator('[data-v=approvals]').click();
    await taskPage.locator('#tasks-approvals').waitFor({ state: 'visible' });
    assert.equal(await taskPage.locator('.task-list-head').isVisible(), false);
    await taskPage.locator('[data-v=mine]').click();
    await taskPage.locator('.task-row').first().waitFor();
    console.log(
      JSON.stringify({
        width,
        taskLayout: true,
        dueFiltersAndDetailsAndApprovals: true,
      }),
    );
  }
  assert.deepEqual(taskErrors, []);
  await context.close();
  assert.deepEqual(await f.db.select().from(stockMoves), beforeStock);
} finally {
  await browser.close();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await f.client.close();
}
