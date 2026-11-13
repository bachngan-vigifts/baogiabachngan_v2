/** Local Chromium + real CRM router/PGlite + website giả (không gọi mạng thật, không dữ liệu production). */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';
import { fakeWeb } from '../../tests/helpers/fake-web.ts';
import { products } from '../../src/modules/catalog/schema.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { eq } from 'drizzle-orm';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'), chromium = pw.chromium ?? pw.default.chromium;
const f = await setup(), web = fakeWeb(); f.env.externalFetch = web.fetcher; f.env.productImages = f.files; // kho ảnh giả (memoryFileStore có publicUrl)
const root = fileURLToPath(new URL('../../trial-ui/', import.meta.url)), shots = process.env.SHOTS || '/tmp/quick-create-shots';
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
    res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.png') ? 'image/png' : 'text/html');
    res.end(data);
  } catch (e) { res.writeHead(500).end(e.message); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
async function open(width, height, hash) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(({ token, user }) => { localStorage.setItem('bn-api-region-manual-off', '1'); localStorage.setItem('bn-v2-session', token); localStorage.setItem('bn-v2-session-profile', JSON.stringify({ session: token, user })); }, { token, user });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/' + hash);
  return { page, errors, context };
}
const noOverflow = async page => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'không tràn ngang');
try {
  // 1) Sản phẩm từ link (quản lý sản phẩm dùng trên máy tính / tablet).
  for (const [width, height] of [[1280, 940], [1024, 940], [390, 844]]) {
    const { page, errors, context } = await open(width, height, '#/products');
    await page.locator('#new-product').waitFor({ state: 'visible' }); // điện thoại cũng phải thấy nút ＋ Thêm sản phẩm
    await page.locator('#new-product').click();
    const dialog = page.getByRole('dialog', { name: 'Thêm sản phẩm', exact: true }); await dialog.waitFor();
    await dialog.locator('[name="sourceUrl"]').fill('https://ld.example.vn/sp/binh-1.html');
    await dialog.getByRole('button', { name: 'Lấy thông tin' }).click();
    await dialog.locator('[data-image-preview] img').waitFor();
    assert.equal(await dialog.locator('[name="sku"]').inputValue(), 'KS-1');
    assert.equal(await dialog.locator('[name="name"]').inputValue(), 'Bình giữ nhiệt 500ml Shop KS-1');
    assert.equal(await dialog.locator('[name="brand"]').inputValue(), 'Shop');
    assert.equal(await dialog.locator('[name="unit"]').inputValue(), 'cái');
    assert.equal(await dialog.locator('[name="price:retail-vat"]').inputValue(), '450000');
    assert.equal(await dialog.locator('[name="price:retail"]').inputValue(), String(Math.round(450000 / 1.08)));
    assert.match(await dialog.locator('[data-link-status]').textContent(), /Giá web/);
    await noOverflow(page);
    await page.screenshot({ path: `${shots}/product-${width}.png` });
    if (width === 390) for (const name of ['Lấy thông tin', 'Lưu sản phẩm']) assert.ok(await dialog.getByRole('button', { name, exact: true }).isVisible(), 'điện thoại thấy nút ' + name);
    if (width === 390) { // lưu thật từ điện thoại (đổi mã vì KS-1 đã tạo ở khổ máy tính)
      await dialog.locator('[name="sku"]').fill('KS-1-M'); await dialog.getByRole('button', { name: 'Lưu sản phẩm', exact: true }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => { throw Error('Điện thoại không lưu được: ' + await dialog.locator('[data-err]').textContent()); });
      assert.equal((await f.db.select().from(products).where(eq(products.sku, 'KS-1-M'))).length, 1, 'điện thoại đã tạo sản phẩm');
    }
    if (width === 1280) {
      await dialog.getByRole('button', { name: 'Lưu sản phẩm', exact: true }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(async e => { throw Error('Không lưu được: ' + await dialog.locator('[data-err]').textContent()); });
      const [p] = await f.db.select().from(products).where(eq(products.sku, 'KS-1'));
      assert.ok(p, 'đã tạo sản phẩm'); assert.equal(p.approvalStatus, 'approved'); assert.match(p.imageUrl, /^https?:\/\//, 'ảnh lưu qua kho ảnh CRM');
    }
    assert.deepEqual(errors, []); await context.close();
  }
  // Link bị chặn: báo lỗi trong hộp, không đóng hộp.
  { const { page, errors, context } = await open(1280, 940, '#/products');
    await page.locator('#new-product').click(); const dialog = page.getByRole('dialog', { name: 'Thêm sản phẩm', exact: true });
    await dialog.locator('[name="sourceUrl"]').fill('https://private.example.vn/a'); await dialog.getByRole('button', { name: 'Lấy thông tin' }).click();
    await page.waitForFunction(() => /nội bộ/.test(document.querySelector('[data-link-status]')?.textContent || ''));
    assert.deepEqual(errors, []); await context.close(); }
  // 2) Khách hàng từ MST – máy tính và điện thoại.
  for (const [width, height, mst] of [[1280, 940, 'https://masothue.com/0101243150-cong-ty-co-phan-mau'], [390, 844, '0101243150-001']]) {
    const { page, errors, context } = await open(width, height, '#/customers');
    await page.locator('#new-customer').click();
    const dialog = page.locator('#customer-dialog'); await dialog.waitFor();
    assert.equal(await page.locator('#customer-tax-lookup').isVisible(), true);
    await page.locator('#customer-tax-input').fill(mst); await page.locator('#customer-tax-fetch').click();
    await page.waitForFunction(() => /Tổng cục Thuế/.test(document.querySelector('#customer-tax-status')?.textContent || ''));
    const form = page.locator('#customer-form');
    assert.equal(await form.locator('[name="name"]').inputValue(), 'CÔNG TY CỔ PHẦN MẪU');
    assert.equal(await form.locator('[name="taxCode"]').inputValue(), mst.includes('-001') ? '0101243150-001' : '0101243150');
    assert.equal(await form.locator('[name="address"]').inputValue(), 'Số 1 Duy Tân, Cầu Giấy, Hà Nội');
    await noOverflow(page);
    await page.screenshot({ path: `${shots}/customer-${width}.png` });
    // Form nhập theo 3 bước: Công ty → Người liên hệ → Kiểm tra và lưu.
    const nextStep = dialog.getByRole('button', { name: 'Tiếp tục', exact: true });
    await form.locator('[name="customerCode"]').fill('KH-' + width); await form.locator('[name="phone"]').fill(width === 390 ? '0901112223' : '0903334445'); await nextStep.click();
    await dialog.getByLabel('Tên người liên hệ', { exact: true }).first().fill('Chị Lan'); await nextStep.click();
    await page.locator('#save-customer').click();
    await dialog.waitFor({ state: 'hidden' });
    const saved = await f.db.select().from(customers).where(eq(customers.taxCode, mst.includes('-001') ? '0101243150-001' : '0101243150'));
    assert.equal(saved.length, 1, 'đã tạo đúng 1 khách');
    assert.deepEqual(errors, []); await context.close();
  }
  // Khách đang sửa: không hiện ô tra MST.
  { const [c] = await f.db.select().from(customers).limit(1); const { page, errors, context } = await open(1280, 940, '#/customers/' + encodeURIComponent(c.id));
    await page.waitForTimeout(800); assert.deepEqual(errors, []); await context.close(); }
  console.log('OK quick-create-from-link · ảnh:', shots, '· gọi website giả:', web.calls.filter(c => !c.startsWith('cloudflare')).length);
} finally { await browser.close(); server.close(); }
