// CHẨN ĐOÁN CHỈ ĐỌC: giả thuyết "trình duyệt tự giữ HTML 31 ngày" làm giỏ mini hiện 0.
// Khách mới: xem trang danh mục -> thêm giỏ ở trang sản phẩm -> quay lại trang danh mục (bấm link như khách thật). Ghi: trang lấy từ bộ nhớ trình duyệt hay máy chủ, số trên biểu tượng giỏ.
// Kèm: header Cache-Control khi qua Cloudflare cache (HIT) và khi đi thẳng máy chủ (có cookie giỏ -> DYNAMIC).
import { chromium } from 'playwright';
const SITE = 'https://locknlockonline.com', CAT = '/danh-muc/binh-nuoc/binh-nuoc-mang-di/binh-giu-nhiet/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink.replace(SITE, '');
for (const [name, h] of [['Khách (qua Cloudflare)', {}], ['Có cookie giỏ (đi thẳng máy chủ)', { Cookie: 'woocommerce_items_in_cart=1' }]]) { const r = await fetch(SITE + CAT, { headers: { 'User-Agent': UA, ...h } }); await r.text(); console.log(`${name}: cf=${r.headers.get('cf-cache-status')} cache-control="${r.headers.get('cache-control')}" expires="${r.headers.get('expires') || '-'}" x-litespeed-cache-control="${r.headers.get('x-litespeed-cache-control') || '-'}"`); }
const b = await chromium.launch();
const label = p => p.evaluate(() => { const e = document.querySelector('.header-cart-link .icon-shopping-basket'); return e ? (e.getAttribute('data-icon-label') ?? e.textContent.trim()) : '?'; });
for (let r = 1; r <= 3; r++) {
  const ctx = await b.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p); await cdp.send('Network.enable'); const src = {};
  cdp.on('Network.responseReceived', e => { if (e.type === 'Document') src[e.response.url.replace(SITE, '')] = e.response.fromDiskCache ? 'BỘ NHỚ TRÌNH DUYỆT' : (e.response.fromPrefetchCache ? 'tải trước' : `máy chủ cf=${e.response.headers['cf-cache-status'] || e.response.headers['CF-Cache-Status'] || '?'}`); });
  try {
    await p.goto(SITE + CAT, { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(3000); const a = await label(p);
    await p.goto(SITE + simple, { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(3000);
    const btn = p.locator('form.cart .single_add_to_cart_button').first(); await btn.scrollIntoViewIfNeeded();
    const done = p.waitForResponse(x => /wc-ajax=lnl_add_to_cart/.test(x.url()), { timeout: 60000 }).catch(() => null); await btn.tap({ noWaitAfter: true }); await done; await p.waitForTimeout(2500);
    const bl = await label(p);
    // quay lại trang danh mục bằng cách bấm link như khách (điều hướng thường, không ép tải lại)
    for (const k of Object.keys(src)) delete src[k];
    await p.evaluate(u => { const a = document.createElement('a'); a.href = u; document.body.appendChild(a); a.click(); }, SITE + CAT); await p.waitForLoadState('load'); await p.waitForTimeout(6000);
    const c = await label(p); const from = src[CAT] || JSON.stringify(src);
    const api = await p.evaluate(async () => (await (await fetch('/wp-json/wc/store/v1/cart', { credentials: 'same-origin' })).json()).items_count);
    console.log(`Lượt ${r}: danh mục lần đầu=${a}; sản phẩm sau thêm=${bl}; quay lại danh mục=${c} (trang lấy từ: ${from}); Store API=${api}`);
  } catch (e) { console.log(`Lượt ${r} LỖI ${String(e.message).slice(0, 150)}`); }
  await ctx.close();
}
await b.close();
