// CHẨN ĐOÁN CHỈ ĐỌC (khách, giỏ tạm, không đặt đơn): vì sao giỏ mini ở trang danh mục hiện 0 sau khi thêm giỏ.
// Ghi lại, ở từng trang: có script cart-fragments không, có vùng giỏ mini không, lệnh fragments, khoá sessionStorage (chỉ tên + độ dài), hash giỏ trong storage có khớp cookie không (chỉ so sánh), số hiển thị trên biểu tượng giỏ, cache Cloudflare.
import { chromium } from 'playwright';
const SITE = 'https://locknlockonline.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CATS = ['/danh-muc/binh-nuoc/binh-nuoc-mang-di/binh-giu-nhiet/', '/danh-muc/binh-nuoc/', '/'];
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink.replace(SITE, '');
const b = await chromium.launch();
async function state(p) {
  return p.evaluate(() => {
    const P = window.wc_cart_fragments_params || null;
    const ss = {}; try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); ss[k.replace(/[a-f0-9]{32}/, '<h>')] = (sessionStorage.getItem(k) || '').length; } } catch (e) {}
    const ck = Object.fromEntries(document.cookie.split(/;\s*/).filter(Boolean).map(c => [c.split('=')[0].replace(/[a-f0-9]{32}/, '<h>'), 1]));
    let match = '?'; try { const cookieHash = (document.cookie.match(/(?:^|; )woocommerce_cart_hash=([^;]*)/) || [])[1] || ''; const st = P ? sessionStorage.getItem(P.cart_hash_key) || '' : ''; match = P ? (st === cookieHash ? 'khớp' : `KHÁC (storage ${st ? 'có' : 'rỗng'}, cookie ${cookieHash ? 'có' : 'rỗng'})`) : 'không có params'; } catch (e) {}
    let fragKeys = []; try { if (P) fragKeys = Object.keys(JSON.parse(sessionStorage.getItem(P.fragment_name) || '{}')); } catch (e) {}
    const w = document.querySelectorAll('div.widget_shopping_cart_content');
    const items = [...w].map(x => x.querySelectorAll('.woocommerce-mini-cart-item, li.mini_cart_item').length);
    const labels = [...document.querySelectorAll('.cart-icon strong, [data-icon-label], .header-cart-link .cart-price, .cart-item .header-cart-title')].slice(0, 6).map(e => `${e.className || e.tagName}:${(e.textContent.trim() || e.getAttribute('data-icon-label') || '').slice(0, 20)}`);
    const scripts = [...document.scripts].map(s => s.src).filter(s => /cart-fragments|litespeed\/js/.test(s)).map(s => s.replace(location.origin, '').replace(/\?.*/, '').slice(-60));
    return { hasParams: !!P, fragScripts: scripts.filter(s => /cart-fragments/.test(s)).length, lsScripts: scripts.filter(s => /litespeed/.test(s)).length, widgets: w.length, items, labels, ss, cookies: Object.keys(ck), match, fragKeys: fragKeys.map(k => k.slice(0, 50)) };
  });
}
for (let r = 1; r <= Number(process.env.RUNS || 3); r++) {
  const ctx = await b.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
  const net = []; p.on('response', async res => { const u = res.url(); if (/wc-ajax=(get_refreshed_fragments|lnl_add_to_cart)/.test(u)) net.push(`${(u.match(/wc-ajax=(\w+)/) || [])[1]} ${res.status()} trên ${p.url().replace(SITE, '').slice(0, 40)}`); });
  p.on('requestfailed', q => { if (/wc-ajax/.test(q.url())) net.push(`HUỶ ${(q.url().match(/wc-ajax=(\w+)/) || [])[1]} ${q.failure()?.errorText}`); });
  const evs = []; await p.exposeFunction('__ev', e => evs.push(e));
  await p.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const $ = window.jQuery; if ($) $(document.body).on('wc_fragments_loaded wc_fragments_refreshed added_to_cart wc_fragment_refresh', e => window.__ev(e.type + '@' + location.pathname.slice(0, 30))); }); });
  console.log(`\n========== Lượt ${r}`);
  try {
    let res = await p.goto(SITE + simple, { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(5000);
    const btn = p.locator('form.cart .single_add_to_cart_button').first(); await btn.scrollIntoViewIfNeeded();
    const done = p.waitForResponse(x => /wc-ajax=lnl_add_to_cart/.test(x.url()), { timeout: 60000 }).catch(() => null); await btn.tap({ noWaitAfter: true }); await done; await p.waitForTimeout(3000);
    console.log(`Sản phẩm sau thêm giỏ: ${JSON.stringify(await state(p))}`);
    for (const path of CATS) {
      net.length = 0; evs.length = 0;
      res = await p.goto(SITE + path, { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(8000);
      const api = await p.evaluate(async () => (await (await fetch('/wp-json/wc/store/v1/cart', { credentials: 'same-origin' })).json()).items_count);
      console.log(`${path} cf=${res.headers()['cf-cache-status']} age=${res.headers()['age'] || '-'} | Store API=${api} | ${JSON.stringify(await state(p))}\n   mạng: ${net.join(' ; ') || 'không'} | sự kiện: ${evs.join(', ') || 'không'}`);
    }
  } catch (e) { console.log('LỖI ' + String(e.message).slice(0, 160)); }
  await ctx.close();
}
await b.close();
