// Chụp ảnh giao diện các trang chính của web Lock (điện thoại 390px và máy tính 1366px) để rà giao diện. Chỉ đọc, giỏ khách tạm, không đặt đơn.
import { chromium } from 'playwright';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink;
const v = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=variable&per_page=3&stock_status=instock`)).json();
const variable = (Array.isArray(v) ? v : []).find(x => x.permalink)?.permalink;
const browser = await chromium.launch();
async function shot(page, name, maxH) {
  const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight, innerWidth]);
  const h = Math.min(size[1], maxH);
  const buf = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: true, clip: { x: 0, y: 0, width: size[2], height: h } });
  const b64 = buf.toString('base64');
  console.log(`IMGSTART ${name} ${size[2]}x${h} trang=${size[0]}x${size[1]} tràn=${size[0] > size[2] + 1}`);
  for (let i = 0; i < b64.length; i += 3000) console.log('IMG ' + name + ' ' + b64.slice(i, i + 3000));
  console.log(`IMGEND ${name}`);
}
async function go(page, url) { await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => {}); await page.evaluate(async () => { for (let y = 0; y < Math.min(document.body.scrollHeight, 6000); y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } scrollTo(0, 0); }); await page.waitForTimeout(2500); }
// Mobile
const m = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const p = await m.newPage();
await go(p, SITE + '/'); await shot(p, 'm-home', 5200);
const cat = await p.evaluate(() => { const a = [...document.querySelectorAll('a[href*="/danh-muc"], a[href*="product-category"]')].map(x => x.href); return a[0] || null; });
console.log('DANH MỤC', cat);
if (cat) { await go(p, cat); await shot(p, 'm-cat', 3200); }
if (variable) { await go(p, variable); await shot(p, 'm-var', 4200); }
await go(p, simple); await shot(p, 'm-prod', 4200);
const added = p.waitForResponse(r => /wc-ajax=lnl_add_to_cart/.test(r.url()), { timeout: 45_000 }).catch(() => null);
await p.locator('button.single_add_to_cart_button').first().click(); await added; await p.waitForTimeout(2000);
await go(p, SITE + '/gio-hang/'); await shot(p, 'm-cart', 3600);
await go(p, SITE + '/thanh-toan/'); await shot(p, 'm-checkout', 3200);
await m.close();
// Desktop
const d = await browser.newContext({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 1 });
const q = await d.newPage();
await go(q, SITE + '/'); await shot(q, 'd-home', 3000);
await go(q, simple); await shot(q, 'd-prod', 2200);
await browser.close();
