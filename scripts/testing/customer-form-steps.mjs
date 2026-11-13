/** Form Thêm / Sửa khách hàng theo 3 bước trên app thật (router + PGlite giả, website giả cho tra MST; không dữ liệu production). */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';
import { fakeWeb } from '../../tests/helpers/fake-web.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { eq } from 'drizzle-orm';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'), chromium = pw.chromium ?? pw.default.chromium;
const f = await setup(), web = fakeWeb(); f.env.externalFetch = web.fetcher;
const root = fileURLToPath(new URL('../../trial-ui/', import.meta.url)), shots = process.env.SHOTS || '/tmp/customer-form-steps';
await mkdir(shots, { recursive: true });
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
    res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.jpg') ? 'image/jpeg' : 'text/html'); res.end(data);
  } catch (e) { res.writeHead(404).end(e.message); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
async function open(width, height, hash) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(({ token, user }) => { localStorage.setItem('bn-api-region-manual-off', '1'); localStorage.setItem('bn-v2-session', token); localStorage.setItem('bn-v2-session-profile', JSON.stringify({ session: token, user })); }, { token, user });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/' + hash); await page.waitForLoadState('networkidle').catch(() => {});
  return { page, errors, context };
}
const vis = (page, name) => page.locator(`#customer-form [name="${name}"]`).isVisible();
const noOverflow = async page => assert.ok(await page.evaluate(() => { const d = document.querySelector('#customer-dialog'), r = d.getBoundingClientRect(); return document.documentElement.scrollWidth <= innerWidth + 1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }), 'form nằm gọn trong màn hình');
try {
  for (const [width, height, mst, tag] of [[1366, 768, '0101243150', 'desktop'], [390, 844, '0101243150-001', 'mobile']]) {
    const { page, errors, context } = await open(width, height, '#/customers');
    await page.locator('#new-customer').click();
    const dialog = page.locator('#customer-dialog'); await dialog.waitFor();
    const next = dialog.getByRole('button', { name: 'Tiếp tục', exact: true }), back = dialog.getByRole('button', { name: 'Quay lại', exact: true }), save = page.locator('#save-customer'), err = page.locator('#customer-error');
    // Bước 1: chỉ thấy ô công ty; chưa thấy người liên hệ, điều khoản, nút Lưu.
    for (const k of ['taxCode', 'name', 'address', 'phone', 'email']) assert.equal(await vis(page, k), true, 'bước 1 thấy ' + k);
    for (const k of ['depositRate', 'creditLimit', 'establishedDate']) assert.equal(await vis(page, k), false, 'bước 1 chưa thấy ' + k);
    assert.equal(await dialog.locator('.customer-contact-directory').isVisible(), false); assert.equal(await save.isVisible(), false); assert.equal(await back.isVisible(), false);
    assert.match(await dialog.locator('label', { has: page.locator('[name="phone"]') }).innerText(), /Điện thoại công ty \(không bắt buộc\)/);
    await next.click(); assert.match(await err.innerText(), /Nhập đủ các ô có dấu \*/); assert.equal(await page.evaluate(() => document.querySelector('#customer-dialog').dataset.customerStep), '1');
    await page.locator('#customer-tax-input').fill(mst); await page.locator('#customer-tax-fetch').click();
    await page.waitForFunction(() => /Tổng cục Thuế/.test(document.querySelector('#customer-tax-status')?.textContent || ''));
    assert.equal(await page.locator('#customer-form [name="name"]').inputValue(), 'CÔNG TY CỔ PHẦN MẪU');
    await dialog.getByRole('button', { name: /Ngày thành lập, nhóm khách, mã khách/ }).click(); assert.equal(await vis(page, 'establishedDate'), true, 'mở được phần không bắt buộc');
    await noOverflow(page); await page.screenshot({ path: `${shots}/${tag}-1.png` });
    // Bước 2: chỉ người liên hệ; không nhập tên thì không qua được.
    await next.click(); assert.equal(await page.evaluate(() => document.querySelector('#customer-dialog').dataset.customerStep), '2');
    assert.equal(await dialog.locator('.customer-contact-directory').isVisible(), true); assert.equal(await vis(page, 'phone'), false, 'bước 2 không còn ô điện thoại công ty');
    assert.match(await dialog.locator('.customer-step-title:visible').innerText(), /Người liên hệ của CÔNG TY CỔ PHẦN MẪU/);
    await next.click(); assert.match(await err.innerText(), /Nhập đủ các ô có dấu \*/);
    await dialog.getByLabel('Tên người liên hệ', { exact: true }).first().fill('Chị Lan'); await dialog.getByLabel('Điện thoại liên hệ', { exact: true }).first().fill(tag === 'desktop' ? '0903334445' : '0901112223');
    await noOverflow(page); await page.screenshot({ path: `${shots}/${tag}-2.png` });
    // Bước 3: thẻ xem lại + nút Lưu; SĐT công ty để trống vẫn lưu được.
    await next.click(); assert.equal(await save.isVisible(), true); assert.equal(await next.isVisible(), false);
    const sum = await dialog.locator('.customer-step-summary').innerText();
    assert.match(sum, /CÔNG TY CỔ PHẦN MẪU/); assert.match(sum, /Chị Lan/); assert.match(sum, /ĐT công ty: —/); assert.doesNotMatch(sum, /chưa nhập/);
    assert.equal(await vis(page, 'depositRate'), false); await dialog.getByRole('button', { name: /Điều khoản bán hàng/ }).click(); assert.equal(await vis(page, 'depositRate'), true);
    await noOverflow(page); await page.screenshot({ path: `${shots}/${tag}-3.png` });
    await back.click(); assert.equal(await dialog.getByLabel('Tên người liên hệ', { exact: true }).first().inputValue(), 'Chị Lan', 'quay lại không mất dữ liệu'); await next.click();
    await save.click(); await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => { throw Error('Không lưu được: ' + await err.innerText()); });
    const [c] = await f.db.select().from(customers).where(eq(customers.taxCode, mst));
    assert.ok(c, 'đã tạo khách'); assert.equal(c.phone ?? '', '', 'không cần điện thoại công ty'); assert.equal(c.contact, 'Chị Lan'); assert.equal(c.address, 'Số 1 Duy Tân, Cầu Giấy, Hà Nội');
    assert.deepEqual(errors, []); await context.close();
  }
  // Sửa khách: mở ở bước 1 với dữ liệu cũ, đi tới bước 3, lưu được; mở lại form Thêm thì quay về bước 1 trống.
  { const [c] = await f.db.select().from(customers).where(eq(customers.taxCode, '0101243150'));
    const { page, errors, context } = await open(1366, 768, '#/customers/' + encodeURIComponent(c.id));
    await page.getByRole('button', { name: /^Sửa/ }).first().click();
    const dialog = page.locator('#customer-dialog'); await dialog.waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('#customer-dialog').dataset.customerStep), '1');
    assert.equal(await page.locator('#customer-tax-lookup').isVisible(), false, 'sửa khách không hiện ô tra MST');
    await page.locator('#customer-form [name="phone"]').fill('02433338888');
    await dialog.locator('.customer-step').nth(2).click(); // bấm thẳng bước 3
    assert.match(await dialog.locator('.customer-step-summary').innerText(), /ĐT công ty: 02433338888/); assert.match(await dialog.locator('.customer-step-summary').innerText(), /Chị Lan/);
    await page.locator('#save-customer').click(); await dialog.waitFor({ state: 'hidden', timeout: 10000 });
    const [after] = await f.db.select().from(customers).where(eq(customers.id, c.id)); assert.equal(after.phone, '02433338888'); assert.equal(after.contact, 'Chị Lan');
    await page.goto(origin + '/#/customers'); await page.locator('#new-customer').click(); await dialog.waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('#customer-dialog').dataset.customerStep), '1'); assert.equal(await page.locator('#customer-form [name="name"]').inputValue(), '');
    assert.equal(await page.locator('#save-customer').isVisible(), false);
    assert.deepEqual(errors, []); await context.close(); }
  console.log('OK customer-form-steps · ảnh:', shots);
} finally { await browser.close(); server.close(); }
