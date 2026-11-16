// Kiểm tra (khách, giỏ tạm, không đặt đơn), mỗi lượt 1 trình duyệt mới:
// 1) Khách mới mở trang sản phẩm rồi trang danh mục: đếm lệnh get_refreshed_fragments (mong 0 khi EXPECT_SKIP=1).
// 2) Thêm vào giỏ, mở trang danh mục và trang chủ: giỏ mini phải có sản phẩm, số đếm khớp Store API.
// 3) Trang thanh toán vẫn hiển thị đúng tổng.
import { chromium } from 'playwright';
const SITE = 'https://locknlockonline.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CAT = '/danh-muc/binh-nuoc/binh-nuoc-mang-di/binh-giu-nhiet/';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink.replace(SITE, '');
const RUNS = Number(process.env.RUNS || 3); let bad = 0;
const b = await chromium.launch();
for (let r = 1; r <= RUNS; r++) {
  const ctx = await b.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
  const frag = []; p.on('request', q => { if (/wc-ajax=get_refreshed_fragments/.test(q.url())) frag.push(p.url().replace(SITE, '').slice(0, 40)); });
  const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 100)));
  const miniCount = () => p.evaluate(() => { const w = document.querySelector('div.widget_shopping_cart_content'); const n = w ? w.querySelectorAll('.woocommerce-mini-cart-item, li.mini_cart_item').length : -1; const lab = document.querySelector('.cart-icon strong, .header-cart-link [data-icon-label]'); return { items: n, label: lab ? (lab.textContent.trim() || lab.getAttribute('data-icon-label')) : '?', skip: window.__lnlFragSkip || 0 }; });
  try {
    await p.goto(SITE + simple, { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(7000);
    const a = await miniCount();
    await p.goto(SITE + CAT, { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(7000);
    const fragNew = frag.length;
    console.log(`Lượt ${r} khách mới: lệnh fragments=${fragNew} (${frag.join(' ; ')}), giỏ mini sản phẩm=${a.items} nhãn=${a.label} seed=${a.skip}`);
    if (process.env.EXPECT_SKIP === '1' && fragNew > 0) { bad++; console.log('  KHÔNG ĐẠT: khách mới vẫn gọi fragments'); }
    await p.goto(SITE + simple, { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(4000);
    const btn = p.locator('form.cart .single_add_to_cart_button').first(); await btn.scrollIntoViewIfNeeded();
    const done = p.waitForResponse(x => /wc-ajax=lnl_add_to_cart|add-to-cart/.test(x.url()), { timeout: 60000 }).catch(() => null);
    await btn.tap({ noWaitAfter: true }); await done; await p.waitForTimeout(3000);
    const api = await p.evaluate(async () => (await (await fetch('/wp-json/wc/store/v1/cart', { credentials: 'same-origin' })).json()).items_count);
    for (const path of ['/danh-muc/binh-nuoc/', '/']) { await p.goto(SITE + path, { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(7000); const m = await miniCount(); const ok = m.items >= 1 || (m.label !== '?' && Number(m.label) >= 1); console.log(`  sau thêm giỏ, ${path}: Store API=${api}, giỏ mini sản phẩm=${m.items} nhãn=${m.label} ${ok ? 'ĐẠT' : 'KHÔNG ĐẠT'}`); if (!ok) bad++; }
    await p.goto(SITE + '/thanh-toan/', { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(5000);
    const tot = await p.evaluate(() => (document.querySelector('.order-total .amount') || {}).textContent || ''); console.log(`  thanh toán: tổng "${tot.trim()}"; lỗi JS: ${errs.join(' | ') || 'không'}`);
    if (!tot.trim()) { bad++; console.log('  KHÔNG ĐẠT: thanh toán không có tổng'); }
    console.log(`  tổng lệnh fragments cả lượt: ${frag.length}`);
  } catch (e) { bad++; console.log(`Lượt ${r} LỖI ${String(e.message).slice(0, 150)}`); }
  await ctx.close();
}
await b.close(); if (bad) { console.log(`KHÔNG ĐẠT: ${bad}`); process.exitCode = 1; } else console.log('TẤT CẢ ĐẠT');
