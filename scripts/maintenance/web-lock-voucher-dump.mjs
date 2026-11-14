// Đọc cấu trúc phần Voucher Shop trên trang giỏ hàng (chỉ đọc, giỏ khách tạm).
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
await page.locator('button.single_add_to_cart_button').first().click(); await added; await page.waitForTimeout(2000);
await page.goto(`${SITE}/thanh-toan/?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(6000);
await page.goto(`${SITE}/gio-hang/?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(5000);
const out = await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')].filter(e => /voucher/i.test(e.className?.toString?.() || '') || /voucher/i.test(e.id || ''));
  const roots = els.filter(e => !els.some(o => o !== e && o.contains(e))).slice(0, 4);
  const scripts = [...document.scripts].filter(s => /voucher|LNL\d+K/i.test(s.textContent || '') || /voucher/i.test(s.src)).map(s => (s.src || 'inline') + ' ' + (s.textContent || '').length);
  return { roots: roots.map(e => e.outerHTML.slice(0, 3500)), scripts, count: els.length };
});
console.log('VOUCHER_DUMP', JSON.stringify(out, null, 1));
const link = await page.evaluate(() => [...document.querySelectorAll('link[href*=voucher],script[src*=voucher]')].map(e => e.href || e.src));
console.log('ASSETS', JSON.stringify(link));
await browser.close();
