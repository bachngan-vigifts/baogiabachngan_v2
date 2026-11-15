// Thử kỹ nút giỏ hàng và nút Mua ngay trên điện thoại (giỏ khách tạm, không đặt đơn): mỗi nút 3 lần, in thời gian từng lệnh về máy chủ. Chỉ đọc.
import { chromium } from 'playwright';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CAT = SITE + '/danh-muc/binh-nuoc/binh-nuoc-mang-di/binh-giu-nhiet/';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink;
import { readFileSync, existsSync } from 'node:fs';
let INJ = ''; if (process.env.JS_FROM && existsSync(process.env.JS_FROM)) { const m = /<<<'JS'\n([\s\S]*?)\nJS;/.exec(readFileSync(process.env.JS_FROM, 'utf8')); if (m) INJ = m[1].replace('%%CHECKOUT%%', SITE + '/thanh-toan/'); }
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const browser = await chromium.launch();
const sum = {};
async function run(name, url, prep, act, doneRe, navRe) {
  if (ONLY.length && !ONLY.includes(name[0])) return;
  for (let k = 1; k <= 3; k++) {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
    try {
      await p.goto(url, { waitUntil: 'load', timeout: 60_000 }); await p.waitForTimeout(3500);
      await p.evaluate(() => { const c = document.querySelector('.mltv-popup__close'); if (c) c.click(); });
      if (INJ && navRe) await p.addScriptTag({ content: INJ });
      const el = await prep(p); await p.waitForTimeout(600);
      const log = []; const st = new Map(); let t0 = 0;
      p.on('request', r => st.set(r, Date.now()));
      const fin = async r => { const u = r.url(); if (!u.startsWith(SITE) || !['document', 'xhr', 'fetch'].includes(r.resourceType())) return; const resp = await r.response().catch(() => null); const s = st.get(r) || Date.now(); log.push(`+${s - t0}ms ${Date.now() - s}ms ${r.method()} ${resp ? resp.status() : '?'} ${u.replace(SITE, '').slice(0, 70)}${r.headers()['sec-purpose'] ? ' [tải trước]' : ''}`); };
      p.on('requestfinished', fin);
      const fb = p.evaluate(() => new Promise(res => { const t = performance.now(); const o = new MutationObserver(() => { if (document.querySelector('.loading, .lnl-tapped, #lnl-tap-bar.on, .blockUI, .processing')) { o.disconnect(); res(Math.round(performance.now() - t)); } }); o.observe(document.documentElement, { subtree: true, attributes: true, childList: true }); setTimeout(() => res(null), 8000); })).catch(() => null);
      const done = doneRe ? p.waitForResponse(r => doneRe.test(r.url()) && r.request().method() === 'POST' && !r.request().headers()['sec-purpose'], { timeout: 45_000 }).catch(() => null) : null;
      t0 = Date.now(); await act(p, el);
      let tDone = null, tNav = null, tLoad = null;
      if (done) { await done; tDone = Date.now() - t0; }
      if (navRe) { await p.waitForURL(navRe, { timeout: 60_000, waitUntil: 'commit' }).then(() => { tNav = Date.now() - t0; }).catch(() => {}); await p.waitForLoadState('load', { timeout: 60_000 }).then(() => { tLoad = Date.now() - t0; }).catch(() => {}); }
      const tFb = navRe ? null : await fb; await p.waitForTimeout(3000);
      const cart = await p.evaluate(async () => { try { return (await (await fetch('/wp-json/wc/store/v1/cart', { credentials: 'same-origin' })).json()).items_count; } catch (e) { return '?'; } });
      console.log(`\n== ${name} lần ${k}: ${tDone !== null ? 'giỏ cập nhật sau ' + tDone + 'ms; ' : ''}${tNav !== null ? 'thấy trang thanh toán sau ' + tNav + 'ms; tải xong ' + tLoad + 'ms; ' : (navRe ? 'KHÔNG tới trang thanh toán; ' : '')}${tFb !== null && tFb !== undefined ? 'nút đổi trạng thái sau ' + tFb + 'ms; ' : ''}món trong giỏ=${cart}; URL=${p.url().replace(SITE, '').slice(0, 70)}; thông báo trên trang=${JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.woocommerce-message, .woocommerce-error li, .woocommerce-info')].map(e => e.textContent.trim().slice(0, 50)).slice(0, 3)).catch(() => []))}`);
      if (process.env.EXPECT_DIRECT === '1' && navRe && (cart !== 1 || !/thanh-toan/.test(p.url()) || log.some(l => / POST 30\d /.test(l)))) { console.log('KHÔNG ĐẠT'); process.exitCode = 1; }
      for (const l of log) console.log('   ' + l);
      (sum[name] = sum[name] || []).push(navRe ? tNav : tDone);
    } catch (e) { console.log(`\n== ${name} lần ${k}: LỖI ${String(e.message).split('\n')[0].slice(0, 160)}`); (sum[name] = sum[name] || []).push(null); }
    await ctx.close();
  }
}
const scrollSticky = async p => { await p.evaluate(async () => { for (let y = 0; y <= 1400; y += 200) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } }); await p.waitForTimeout(1200); };
await run('1. Biểu tượng giỏ trên thẻ (trang danh mục)', CAT, async p => { const b = p.locator('.product-small.box a.product_type_simple.add_to_cart_button[href*="add-to-cart"]').first(); await b.scrollIntoViewIfNeeded(); return b; }, async (p, b) => b.tap({ noWaitAfter: true }), /wc-ajax=add_to_cart/, null);
await run('2. Thêm vào giỏ (trang sản phẩm, nút chính)', simple, async p => { const b = p.locator('form.cart .single_add_to_cart_button').first(); await b.scrollIntoViewIfNeeded(); return b; }, async (p, b) => b.tap({ noWaitAfter: true }), /wc-ajax=lnl_add_to_cart/, null);
await run('3. Thêm vào giỏ (thanh dính đáy)', simple, async p => { await scrollSticky(p); return p.locator('.sticky-add-to-cart--active .single_add_to_cart_button').first(); }, async (p, b) => b.tap({ noWaitAfter: true }), /wc-ajax=lnl_add_to_cart/, null);
await run('4. Mua ngay (trang sản phẩm, nút chính)', simple, async p => { const b = p.locator('form.cart button[name="ux-buy-now"]').first(); await b.scrollIntoViewIfNeeded(); return b; }, async (p, b) => b.tap({ noWaitAfter: true }), null, /thanh-toan/);
await run('5. Mua ngay (thanh dính đáy)', simple, async p => { await scrollSticky(p); return p.locator('.sticky-add-to-cart--active button[name="ux-buy-now"]').first(); }, async (p, b) => b.tap({ noWaitAfter: true }), null, /thanh-toan/);
console.log('\n== TÓM TẮT (ms)'); for (const k in sum) console.log(`   ${k}: ${sum[k].join(', ')}`);
// Mốc so sánh: máy chủ trả một lệnh AJAX rỗng mất bao lâu
const ctx = await browser.newContext({ userAgent: UA }); const p = await ctx.newPage(); await p.goto(simple, { waitUntil: 'load', timeout: 60_000 });
const base = await p.evaluate(async () => { const out = []; for (const u of ['/?wc-ajax=get_refreshed_fragments', '/?wc-ajax=get_refreshed_fragments', '/wp-json/wc/store/v1/cart', '/wp-json/', '/wp-admin/admin-ajax.php?action=lnl_khong_ton_tai', '/wp-content/themes/flatsome/style.css']) { const t = performance.now(); const r = await fetch(u, { method: u.includes('wc-ajax') ? 'POST' : 'GET', credentials: 'same-origin' }); await r.text(); out.push(`${Math.round(performance.now() - t)}ms ${r.status} ${u}`); } return out; });
console.log('\n== MỐC SO SÁNH'); for (const l of base) console.log('   ' + l);
await browser.close();
