// Đo chạm vào sản phẩm trên điện thoại (chỉ đọc).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink;
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
for (const path of ['/', '/shop/', '/cua-hang/']) {
  const resp = await page.goto(SITE + path + `?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60_000 }).catch(() => null);
  if (!resp || resp.status() !== 200) { console.log('Bỏ qua ' + path + ' ' + (resp && resp.status())); continue; }
  await page.waitForTimeout(3000);
  const cards = page.locator('.product-small .name a:visible, .product-small .box-image a:visible').first();
  if (!(await cards.count())) { console.log('Không thấy thẻ sản phẩm ở ' + path); continue; }
  const info = await cards.evaluate(e => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { href: e.getAttribute('href'), cls: e.className, top: top ? top.tagName + '.' + String(top.className).slice(0, 60) : null, vis: r.width + 'x' + r.height }; });
  console.log('THẺ', path, JSON.stringify(info));
  await cards.scrollIntoViewIfNeeded();
  const t0 = Date.now(); let nav = null;
  page.once('framenavigated', f => { nav = Date.now() - t0; });
  await cards.tap({ timeout: 10000, noWaitAfter: true });
  await page.waitForTimeout(1200);
  const u1 = page.url().replace(SITE, ''); console.log('Sau 1,2s từ lần chạm 1: ' + u1 + ' | điều hướng bắt đầu: ' + nav);
  await page.waitForURL(/san-pham|product/, { timeout: 30000, waitUntil: 'commit' }).catch(() => console.log('Không chuyển sau 30s'));
  console.log('Chuyển trang sau ' + (Date.now() - t0) + 'ms tới ' + page.url().replace(SITE, ''));
  break;
}
await browser.close();
