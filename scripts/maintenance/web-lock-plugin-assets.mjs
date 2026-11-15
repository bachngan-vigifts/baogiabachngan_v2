// Đo tài nguyên mỗi plugin nạp ở trang chủ, sản phẩm, giỏ hàng, thanh toán (điện thoại, khách tạm, không đặt đơn). Chỉ đọc.
import { chromium } from 'playwright';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink;
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
async function measure(name, url) {
  const stat = {}; const on = r => { const u = r.url(); const m = /\/wp-content\/(plugins|themes|mu-plugins)\/([^/]+)\//.exec(u); const key = m ? m[1] + '/' + m[2] : (/locknlockonline\.com/.test(u) ? 'wp-core/khác' : new URL(u).hostname); r.body().then(b => { stat[key] = stat[key] || { n: 0, kb: 0 }; stat[key].n++; stat[key].kb += b.length / 1024; }).catch(() => { stat[key] = stat[key] || { n: 0, kb: 0 }; stat[key].n++; }); };
  page.on('response', on); await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(3500); page.off('response', on);
  const rows = Object.entries(stat).sort((a, b) => b[1].kb - a[1].kb).slice(0, 22);
  console.log(`== ${name} ${url.replace(SITE, '')}`); for (const [k, v] of rows) console.log(`  ${k.padEnd(52)} ${String(v.n).padStart(3)} yc  ${Math.round(v.kb)} KB`);
}
await measure('TRANG CHỦ', SITE + '/');
await measure('SẢN PHẨM', simple);
const added = page.waitForResponse(r => /wc-ajax=lnl_add_to_cart/.test(r.url()), { timeout: 45_000 }).catch(() => null);
await page.locator('button.single_add_to_cart_button').first().click(); await added; await page.waitForTimeout(2000);
await measure('GIỎ HÀNG', SITE + '/gio-hang/');
await measure('THANH TOÁN', SITE + '/thanh-toan/');
await browser.close();
