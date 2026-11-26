/**
 * Rà giao diện đợt 1: bảng sản phẩm báo giá vừa khung ở 1366/1440 (tên dài xuống dòng, cột số không cắt,
 * thấy cột Thành tiền không cuộn ngang); điện thoại: ô nhập ≥16px, vùng bấm chính ≥44px (báo giá, công việc).
 * Chỉ dùng fixture cục bộ (PGlite). Không gọi CRM thật, Sapo, GHN hay production.
 * Chạy: node --import tsx scripts/testing/quote-line-fit.mjs  (PLAYWRIGHT_MODULE, CHROMIUM_PATH nếu cần)
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const f = await setupEarly(), root = fileURLToPath(new URL('../../trial-ui/', import.meta.url));
const ok = r => { assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r.data)); return r.data; };
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/api/staff/')) {
      const path = u.pathname.slice('/api/staff'.length) + u.search, chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const token = req.headers.authorization?.replace(/^Bearer /, ''), r = await f.call(path, token ? '__Host-bn-session=' + token : '', req.method, body);
      res.writeHead(r.status, {'content-type': 'application/json'}).end(JSON.stringify(r.data)); return;
    }
    const path = u.pathname === '/' ? '/index.html' : u.pathname;
    let data = await readFile(root + path);
    if (path.endsWith('.html')) data = Buffer.from(data.toString().replace('<head>', '<head><meta name="bn-api" content="/api/staff">'));
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript;charset=utf-8' : path.endsWith('.css') ? 'text/css' : 'text/html;charset=utf-8');
    res.end(data);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox']} : {});
const out = process.env.OUT_DIR || '/workspace/scratch/quote-line-fit'; await mkdir(out, {recursive: true});

const LONG = 'Bộ quà tặng cao cấp bình giữ nhiệt inox 304 Lock&Lock Energetic One-Touch Tumbler 550ml kèm hộp quà khắc logo doanh nghiệp theo yêu cầu – màu xanh navy phiên bản Tết 2027';
const LONG2 = 'SUPERLONGWORDWITHOUTSPACES_BINHGIUNHIET_LOCKANDLOCK_ENERGETIC_TUMBLER_550ML_NAVY_2027';
const quote = ok(await f.call('/quotes', f.cookies.mgr, 'POST', {type: 'B2B', quoteNo: 'BG-FIT-1', date: '2026-11-26', customer: 'Khách kiểm thử', vat: 8, rows: [
  {sku: 'FIT-1', name: LONG, unit: 'bộ quà tặng', qty: 1200, price: 12345000, printFee: 15000},
  {sku: 'FIT-2', name: LONG2, unit: 'cái', qty: 3, price: 1234567890},
  {sku: 'FIT-3', name: 'Bình giữ nhiệt 500ml', unit: 'cái', qty: 10, price: 185000},
]}));

async function session(width, height, mobile) {
  const context = await browser.newContext({viewport: {width, height}, locale: 'vi-VN', ...(mobile ? {isMobile: true, hasTouch: true} : {})});
  await context.route('**/*', r => r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
  const user = ok(await f.call('/me', f.cookies.mgr)).user;
  await context.addInitScript(({token, user}) => { localStorage.setItem('bn-v2-session', token); localStorage.setItem('bn-v2-session-profile', JSON.stringify({session: token, user})); }, {token: f.cookies.mgr.split('=')[1], user});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return {context, page, errors};
}
const openQuote = async page => {
  await page.goto(origin + '/#/quotes/' + quote.id);
  await page.waitForFunction(() => document.querySelectorAll('#line-list tr[data-i]').length === 3);
  await page.waitForTimeout(300);
};
const results = [];
try {
  for (const [width, height] of [[1366, 768], [1440, 900]]) {
    const s = await session(width, height, false), {page} = s;
    await openQuote(page);
    const m = await page.evaluate(() => {
      const wrap = document.querySelector('#quote-form .lines-wrap'), wr = wrap.getBoundingClientRect();
      const vis = e => e.getClientRects().length > 0;
      return {
        hScroll: wrap.scrollWidth - wrap.clientWidth,
        totalsInside: [...document.querySelectorAll('#line-list .line-total')].every(e => e.getBoundingClientRect().right <= wr.right + 1),
        clippedNumbers: [...document.querySelectorAll('#line-list :is(.num-input, input[data-k="unit"], .col-after, .line-total)')].filter(vis).filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.value || e.textContent),
        names: [...document.querySelectorAll('#line-list .name-input')].map(e => ({tag: e.tagName, full: e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 2})),
      };
    });
    await page.locator('#line-list').scrollIntoViewIfNeeded(); await page.screenshot({path: `${out}/quote-lines-${width}.png`});
    assert.equal(m.hScroll, 0, `Bảng sản phẩm không được cuộn ngang ở ${width}`);
    assert.ok(m.totalsInside, `Thấy đủ cột Thành tiền ở ${width}`);
    assert.deepEqual(m.clippedNumbers, [], `Cột số/ĐVT không bị cắt ở ${width}`);
    assert.ok(m.names.every(n => n.tag === 'TEXTAREA' && n.full), `Tên sản phẩm dài hiện đủ ở ${width}: ${JSON.stringify(m.names)}`);
    // Enter trong ô tên vẫn chuyển xuống dòng dưới, không chèn xuống dòng vào tên.
    const name = page.locator('#line-list tr[data-i="0"] .name-input');
    await name.focus(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
    assert.equal(await name.inputValue(), LONG);
    assert.equal(await page.evaluate(() => document.activeElement?.closest('tr')?.dataset.i), '1');
    assert.equal(s.errors.length, 0, JSON.stringify(s.errors));
    results.push({width, ...m}); await s.context.close();
  }
  {
    const s = await session(390, 844, true), {page} = s;
    await openQuote(page);
    const m = await page.evaluate(() => {
      const vis = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
      const view = document.querySelector('#view-editor');
      const small = sel => [...view.querySelectorAll(sel)].filter(vis).filter(e => e.getBoundingClientRect().height < 44).map(e => (e.id || e.textContent.trim()) + ' ' + Math.round(e.getBoundingClientRect().height));
      return {
        smallFonts: [...view.querySelectorAll('input:not([type=hidden],[type=checkbox],[type=radio],[type=file]),select,textarea')].filter(vis).filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.getAttribute('aria-label') || e.name || e.dataset.k),
        smallTargets: small(".quote-actions .btn, [data-quote-panel='products'] > .card-title-row .btn, #line-list .link-btn, #line-list [data-mobile-line-toggle], #line-list [data-del], #shipping-card > summary"),
        clippedMoney: [...document.querySelectorAll('#line-list .num-input')].filter(vis).filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.value),
        pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    await page.screenshot({path: `${out}/quote-390.png`, fullPage: true});
    assert.deepEqual(m.smallFonts, [], 'Ô nhập trên điện thoại phải ≥16px');
    assert.deepEqual(m.smallTargets, [], 'Vùng bấm chính trên điện thoại phải ≥44px');
    assert.deepEqual(m.clippedMoney, [], 'Số tiền trong ô nhập không bị cắt');
    assert.equal(m.pageScroll, 0);
    await page.goto(origin + '/#/tasks');
    const trigger = page.locator('#view-tasks .crm-filter-trigger').first();
    await trigger.waitFor(); await trigger.click();
    const seg = await page.evaluate(() => [...document.querySelectorAll('#view-tasks :is(.task-seg, .task-group-by) button')].filter(e => e.getClientRects().length).map(e => Math.round(e.getBoundingClientRect().height)));
    assert.ok(seg.length >= 2 && seg.every(h => h >= 44), 'Nút chọn trên trang Công việc ≥44px: ' + seg);
    assert.equal(s.errors.length, 0, JSON.stringify(s.errors));
    results.push({width: 390, ...m, taskButtons: seg}); await s.context.close();
  }
  console.log(JSON.stringify(results));
} finally { await browser.close(); await new Promise(r => server.close(r)); }
