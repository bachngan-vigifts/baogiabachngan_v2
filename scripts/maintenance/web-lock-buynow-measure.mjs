// Đo nút Mua ngay trên trang sản phẩm (giỏ khách tạm, không đặt đơn): in mã nút, các yêu cầu mạng và thời gian đến trang thanh toán.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink;
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(simple + `?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(3000);
const added = page.waitForResponse(r => /wc-ajax=lnl_add_to_cart/.test(r.url()), { timeout: 45_000 }).catch(() => null);
const reqs = []; const t0 = { v: 0 };
page.on('response', async r => { if (r.request().isNavigationRequest() || /wc-ajax/.test(r.url())) {} ; const u = r.url(); if (/locknlockonline\.com/.test(u) && !/\.(png|jpe?g|webp|svg|woff2?|ico|css)(\?|$)/i.test(u)) reqs.push(`${Math.round(Date.now() - t0.v)}ms ${r.request().method()} ${r.status()} ${u.replace(SITE, '').slice(0, 110)}`); });
const info = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,a,input[type=submit]')].filter(e => /mua ngay|buy now/i.test((e.textContent || '') + (e.value || '')));
  return b.slice(0, 3).map(e => e.outerHTML.slice(0, 600) + ' | form=' + (e.closest('form') ? e.closest('form').getAttribute('class') : 'none'));
});
console.log('NUT', JSON.stringify(info, null, 1));
const btn = page.locator('button,a,input[type=submit]').filter({ hasText: /mua ngay/i }).first();
if (!(await btn.count())) { console.log('Không thấy nút Mua ngay'); await browser.close(); process.exit(0); }
t0.v = Date.now();
await btn.click({ timeout: 10000, noWaitAfter: true });
await page.waitForURL(/thanh-toan|checkout|gio-hang/, { timeout: 60000, waitUntil: 'commit' }).catch(() => { console.log('Không chuyển trang trong 60s'); process.exitCode = 1; });
const tNav = Date.now() - t0.v; console.log('Đến URL ' + page.url().replace(SITE, '') + ' sau ' + tNav + 'ms');
await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {}); console.log('Tải xong sau ' + (Date.now() - t0.v) + 'ms');
await page.waitForTimeout(3000);
console.log('MẠNG:\n' + reqs.join('\n'));
await browser.close();
