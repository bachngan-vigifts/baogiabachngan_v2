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
for (let k = 1; k <= 3; k++) {
  const resp = page.waitForResponse(r => /lnl_get_vouchers/.test(r.url()), { timeout: 30_000 }).catch(() => null);
  const t0 = Date.now(); await page.locator('[data-lnl-voucher-open]').first().click(); const r = await resp; const ms = Date.now() - t0;
  const txt = r ? await r.text().catch(() => '') : '';
  console.log(`LẦN ${k}: mở Voucher Shop -> danh sách về sau ${ms}ms, mã ${r ? r.status() : 'không có'}, ${txt.length} byte`);
  if (k === 1) console.log('DỮ LIỆU ' + txt.slice(0, 1500));
  await page.waitForTimeout(800); await page.locator('.lnl-voucher-modal.is-open [data-lnl-voucher-close]').last().click().catch(() => {}); await page.waitForTimeout(500);
  await page.evaluate(() => window.jQuery && jQuery(document.body).trigger('updated_cart_totals'));
}
const t1 = Date.now(); const fr = await page.evaluate(async () => { const t = performance.now(); const r = await fetch('/?wc-ajax=get_refreshed_fragments', { method: 'POST', credentials: 'same-origin' }); await r.text(); return Math.round(performance.now() - t); });
console.log('So sánh: get_refreshed_fragments ' + fr + 'ms');
await browser.close();
