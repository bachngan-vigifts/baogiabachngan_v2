/** Nhắc nghỉ Madam Sen trên app thật (router + PGlite giả, không dữ liệu production), ngưỡng thời gian rút ngắn để chạy nhanh. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tests/helpers/pos-fixture.ts';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'), chromium = pw.chromium ?? pw.default.chromium;
const f = await setup(), root = fileURLToPath(new URL('../../trial-ui/', import.meta.url)), shots = process.env.SHOTS || '/tmp/break-reminder-shots';
await mkdir(shots, { recursive: true });
const user = (await f.call('/me', f.mgr)).data.user, token = f.mgr.split('=')[1];
const types = { js: 'text/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', mp3: 'audio/mpeg', html: 'text/html' };
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
    let data = await readFile(root + (url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (url.pathname === '/' || url.pathname === '/index.html') data = Buffer.from(data.toString().replace('<head>', '<head><meta name="bn-api" content="/api/staff">'));
    res.setHeader('content-type', types[url.pathname.split('.').pop()] || 'text/html'); res.end(data);
  } catch (e) { res.writeHead(404).end(e.message); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const FAST = { idleMs: 60000, firstMs: 3000, secondMs: 11000, restMs: 3000, snoozeMs: 3000, throttleMs: 250 };
async function open(width, height, hash, config = FAST, scale = 1) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(({ token, user, config }) => { localStorage.setItem('bn-api-region-manual-off', '1'); localStorage.setItem('bn-v2-session', token); localStorage.setItem('bn-v2-session-profile', JSON.stringify({ session: token, user })); window.__bnBreakConfig = config; }, { token, user, config });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/' + hash); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400);
  return { page, errors, context };
}
// "Thao tác" = bấm vào vùng trống của trang (hoặc phím Shift khi có popup khác đang mở).
const act = async (page, ms, key = false) => { const end = Date.now() + ms; while (Date.now() < end) { if (key) await page.keyboard.press('Shift'); else await page.mouse.click(5, 5); await page.waitForTimeout(350); } };
const popup = page => page.locator('dialog.break-dialog[open]');
const fits = async page => assert.ok(await page.evaluate(() => { const r = document.querySelector('dialog.break-dialog').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1; }), 'popup nằm gọn trong màn hình');
try {
  // 1) Máy tính: đang nhập form khách hàng → popup 1 giờ (không nút đóng, Esc không tắt, tự đóng) → dữ liệu form còn nguyên → popup 2 giờ → Thở nhẹ 2 phút → tính lại.
  { const { page, errors, context } = await open(1366, 768, '#/customers', FAST, 2);
    await page.locator('#new-customer').click(); await page.locator('#customer-dialog').waitFor();
    await page.locator('#customer-form [name="name"]').fill('Công ty đang nhập dở');
    await act(page, 3600, true);
    await popup(page).waitFor({ timeout: 4000 });
    assert.match(await popup(page).innerText(), /làm việc liên tục 1 giờ/i); assert.match(await popup(page).innerText(), /Uống một ngụm nước/);
    assert.equal(await popup(page).locator('button:not([data-break-snooze])').count(), 0, 'popup 1 giờ không có nút tắt');
    assert.equal(await popup(page).locator('[data-break-snooze]').count(), 1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200); assert.equal(await popup(page).count(), 1, 'Esc không tắt được');
    assert.ok(await page.evaluate(() => { const i = document.querySelector('.break-sen'); return i.complete && i.naturalWidth > 0; }), 'ảnh Madam Sen đã tải');
    await fits(page); await page.screenshot({ path: `${shots}/1h-desktop.png` });
    await popup(page).waitFor({ state: 'detached', timeout: 5000 });
    assert.equal(await page.locator('#customer-form [name="name"]').inputValue(), 'Công ty đang nhập dở', 'nội dung đang nhập được giữ nguyên');
    assert.equal(await page.locator('#customer-dialog').evaluate(d => d.open), true, 'form đang mở vẫn mở');
    await act(page, 5200, true);
    await popup(page).waitFor({ timeout: 4000 });
    assert.match(await popup(page).innerText(), /làm việc liên tục 2 giờ/i);
    assert.equal(await popup(page).locator('[data-break-mode]').count(), 2);
    await fits(page); await page.screenshot({ path: `${shots}/2h-desktop.png` });
    await popup(page).locator('[data-break-mode="gentle"]').click();
    const frame = page.frameLocator('dialog.break-dialog iframe');
    await frame.locator('[data-g="duration-120"][aria-pressed="true"]').waitFor({ timeout: 8000 });
    assert.equal(await frame.locator('#gentle-panel').isVisible(), true);
    assert.ok(await page.locator('dialog.break-dialog iframe').evaluate(i => i.getBoundingClientRect().height) > 450, 'bài tập chiếm phần lớn khung');
    await fits(page); await page.screenshot({ path: `${shots}/2h-exercise-desktop.png` });
    assert.equal(await popup(page).locator('[data-break-done]').isVisible(), false, 'chưa hết 2 phút thì chưa có nút quay lại');
    await popup(page).locator('[data-break-done]').waitFor({ state: 'visible', timeout: 6000 });
    await popup(page).locator('[data-break-done]').click(); await popup(page).waitFor({ state: 'detached' });
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('bn-break-v1')));
    assert.ok(Date.now() - st.start < 3000 && st.first === false, 'sau bài thở tính lại từ 0');
    assert.equal(await page.locator('#customer-form [name="name"]').inputValue(), 'Công ty đang nhập dở');
    assert.deepEqual(errors, []); await context.close(); }
  // 2) Hoãn 5 phút: bấm hoãn → đóng; hết thời gian hoãn → hiện lại, không còn nút hoãn.
  { const { page, errors, context } = await open(1366, 768, '#/customers');
    await act(page, 3600); await popup(page).waitFor({ timeout: 4000 });
    await popup(page).locator('[data-break-snooze]').click(); await popup(page).waitFor({ state: 'detached' });
    await act(page, 1500); assert.equal(await popup(page).count(), 0, 'đang hoãn thì không hiện');
    await act(page, 2400); await popup(page).waitFor({ timeout: 4000 });
    assert.equal(await popup(page).locator('[data-break-snooze]').count(), 0, 'chỉ hoãn được 1 lần');
    assert.deepEqual(errors, []); await context.close(); }
  // 3) Wim Hof: mở đúng bài Wim Hof, chọn sẵn 2 phút, vẫn phải đọc hướng dẫn an toàn mới bắt đầu được.
  { const { page, errors, context } = await open(1366, 768, '#/customers', { ...FAST, firstMs: 1000, secondMs: 2500 });
    await act(page, 3200); await popup(page).waitFor({ timeout: 4000 });
    if (!/2 giờ/.test(await popup(page).innerText())) { await popup(page).waitFor({ state: 'detached', timeout: 5000 }); await act(page, 2500); await popup(page).waitFor({ timeout: 4000 }); }
    await popup(page).locator('[data-break-mode="wim"]').click();
    const frame = page.frameLocator('dialog.break-dialog iframe');
    await frame.locator('[data-b="duration-120"][aria-pressed="true"]').waitFor({ timeout: 8000 });
    assert.equal(await frame.locator('#wim-panel').isVisible(), true); assert.equal(await frame.locator('#gentle-panel').isVisible(), false);
    await frame.locator('[data-b="start"]').click();
    assert.equal(await frame.locator('[data-b="guide"]').evaluate(d => d.open), true, 'Wim Hof bắt đọc hướng dẫn an toàn trước');
    assert.deepEqual(errors, []); await context.close(); }
  // 4) POS: chỉ nhắc nhẹ, không khoá màn hình.
  { const { page, errors, context } = await open(1366, 768, '#/pos');
    await act(page, 3800); await page.locator('.break-nudge').waitFor({ timeout: 4000 });
    assert.equal(await popup(page).count(), 0, 'POS không hiện popup khoá');
    assert.match(await page.locator('.break-nudge').innerText(), /bán hàng liên tục 1 giờ/);
    await page.screenshot({ path: `${shots}/pos-nudge.png` });
    await page.locator('.break-nudge [data-break-x]').click(); assert.equal(await page.locator('.break-nudge').count(), 0);
    assert.deepEqual(errors, []); await context.close(); }
  // 5) Nghỉ đủ ngưỡng thì tính lại: thao tác 2 giây, nghỉ 2,5 giây (ngưỡng 2 giây), thao tác tiếp 2 giây → chưa đủ "1 giờ" → không nhắc.
  { const { page, errors, context } = await open(1366, 768, '#/customers', { ...FAST, idleMs: 2000 });
    await act(page, 2000); await page.waitForTimeout(2500); await act(page, 2200);
    assert.equal(await popup(page).count(), 0, 'đã nghỉ thì không nhắc');
    assert.deepEqual(errors, []); await context.close(); }
  // 6) Hai tab: popup chỉ hiện ở một tab.
  { const { page, errors, context } = await open(1366, 768, '#/customers');
    const other = await context.newPage(); await other.goto(origin + '/#/quotes'); await other.waitForLoadState('networkidle').catch(() => {});
    await act(page, 3600); await popup(page).waitFor({ timeout: 4000 });
    await other.bringToFront(); await other.mouse.click(5, 5); await other.waitForTimeout(2300); await other.mouse.click(5, 5); await other.waitForTimeout(300);
    assert.equal(await popup(other).count(), 0, 'tab thứ hai không hiện trùng');
    assert.deepEqual(errors, []); await context.close(); }
  // 7) Điện thoại 390px: popup gọn trong màn hình, đủ nút.
  { const { page, errors, context } = await open(390, 844, '#/customers', { ...FAST, firstMs: 1000, secondMs: 2500, restMs: 2500 }, 2);
    await act(page, 1500); await popup(page).waitFor({ timeout: 4000 }); await fits(page); await page.screenshot({ path: `${shots}/1h-mobile.png` });
    await popup(page).waitFor({ state: 'detached', timeout: 5000 }); await act(page, 1500); await popup(page).waitFor({ timeout: 4000 });
    assert.equal(await popup(page).locator('[data-break-mode]').evaluateAll(b => b.every(x => x.offsetParent)), true, 'điện thoại thấy đủ 2 bài');
    await fits(page); await page.screenshot({ path: `${shots}/2h-mobile.png` });
    await popup(page).locator('[data-break-mode="gentle"]').click();
    await page.frameLocator('dialog.break-dialog iframe').locator('[data-g="duration-120"][aria-pressed="true"]').waitFor({ timeout: 8000 });
    await fits(page); await page.screenshot({ path: `${shots}/2h-exercise-mobile.png` });
    assert.deepEqual(errors, []); await context.close(); }
  console.log('OK break-reminder · 7 kịch bản · ảnh:', shots);
} finally { await browser.close(); server.close(); }
