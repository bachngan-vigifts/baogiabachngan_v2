// Xem giỏ hàng mini trên điện thoại (chỉ đọc, giỏ khách tạm). MOCK=1: chèn thử khối voucher (HTML mẫu + CSS từ plugin) trong trình duyệt, không đổi web.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=20&stock_status=instock`)).json();
const prod = (Array.isArray(j) ? j : []).filter(x => x.permalink).sort((a, b) => Number(b.prices?.price || 0) - Number(a.prices?.price || 0))[0];
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(prod.permalink, { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(3000);
const added = page.waitForResponse(r => /wc-ajax=lnl_add_to_cart/.test(r.url()), { timeout: 45_000 }).catch(() => null);
await page.locator('form.cart .single_add_to_cart_button').first().click(); await added; await page.waitForTimeout(2500);
await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(500);
await page.locator('.header-cart-link:visible, a.header-cart-link').first().click({ noWaitAfter: true }).catch(e => console.log('Không mở được giỏ mini: ' + e.message.slice(0, 80)));
await page.waitForTimeout(2000);
const info = await page.evaluate(() => { const all = [...document.querySelectorAll('.widget_shopping_cart_content')]; const vis = all.filter(e => e.getBoundingClientRect().width > 50 && e.getBoundingClientRect().height > 50); return { all: all.length, vis: vis.length, hasBlock: !!document.querySelector('.lnl-mv'), rows: document.querySelectorAll('.lnl-mv-row').length, text: (document.querySelector('.lnl-mv') || {}).innerText || '' }; });
console.log('GIỎ MINI', JSON.stringify(info));
if (process.env.MOCK === '1') {
  const css = /<<<'CSS'\n([\s\S]*?)\nCSS;/.exec(readFileSync(process.env.CSS_FROM, 'utf8'))[1];
  await page.addStyleTag({ content: css });
  await page.evaluate(() => {
    const sub = Number(((document.querySelector('.widget_shopping_cart_content .woocommerce-mini-cart__total .amount') || {}).textContent || '0').replace(/[^\d]/g, ''));
    const fmt = n => n.toLocaleString('vi-VN') + '₫';
    const tiers = [[10000, 499000], [25000, 1000000], [75000, 3000000], [150000, 5000000]];
    const html = '<div class="lnl-mv"><div class="lnl-mv-head">Voucher Shop</div>' + tiers.map(([a, m]) => `<div class="lnl-mv-row${sub >= m ? ' is-ok' : ''}"><strong>Giảm ${fmt(a)}</strong><span>Đơn từ ${fmt(m)}</span><em>${sub >= m ? '✓ Đủ điều kiện' : 'Mua thêm ' + fmt(m - sub)}</em></div>`).join('') + '<div class="lnl-mv-note">Chọn mã ở trang Giỏ hàng hoặc Thanh toán.</div></div>';
    for (const c of document.querySelectorAll('.widget_shopping_cart_content')) { const b = c.querySelector('.woocommerce-mini-cart__buttons'); if (b) b.insertAdjacentHTML('afterend', html); }
  });
  await page.waitForTimeout(800);
}
const b64 = (await page.screenshot({ type: 'jpeg', quality: 65 })).toString('base64'); console.log('IMGSTART mini'); for (let i = 0; i < b64.length; i += 3000) console.log('IMG mini ' + b64.slice(i, i + 3000)); console.log('IMGEND mini');
if (process.env.EXPECT_BLOCK === '1' && !info.hasBlock) { console.log('KHÔNG ĐẠT: chưa thấy khối voucher trong giỏ mini'); process.exitCode = 1; }
await browser.close();
