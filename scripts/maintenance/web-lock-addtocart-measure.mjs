// Đo nút "Thêm vào giỏ hàng" của web Lock bằng trình duyệt thật (điện thoại giả lập), chỉ thêm vào giỏ của phiên khách tạm, KHÔNG đặt đơn.
// Với mỗi loại sản phẩm (đơn giản, biến thể): bấm nút, ghi lại có tải lại cả trang không, request nào chậm, mất bao lâu đến khi giỏ cập nhật.
// LABEL=truoc|sau. Với LABEL=sau, nếu có addtocart-truoc.json thì in bảng so sánh.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const LABEL = process.env.LABEL || 'truoc';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const RUNS = Number(process.env.RUNS || 2);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const short = u => u.replace(SITE, '').replace(/[?&]cb=[^&]*/, '').slice(0, 90);

async function findProducts() {
  const out = {};
  for (const type of ['simple', 'variable']) {
    try {
      const r = await fetch(`${SITE}/wp-json/wc/store/v1/products?type=${type}&per_page=5&stock_status=instock`, { headers: { 'User-Agent': 'addtocart-measure' }, signal: AbortSignal.timeout(30_000) });
      const j = await r.json(); const p = (Array.isArray(j) ? j : []).find(x => x.permalink && x.is_purchasable !== false);
      if (p) out[type] = p.permalink;
    } catch { /* bỏ qua */ }
  }
  return out;
}

const products = await findProducts();
if (process.env.PRODUCT_SIMPLE) products.simple = process.env.PRODUCT_SIMPLE;
if (process.env.PRODUCT_VARIABLE) products.variable = process.env.PRODUCT_VARIABLE;
console.log('Sản phẩm đo:', Object.keys(products).map(k => `${k}=${short(products[k])}`).join(' | ') || 'không tìm thấy');

const browser = await chromium.launch();
const out = { label: LABEL, at: new Date().toISOString(), products: {} };
for (const [kind, url] of Object.entries(products)) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 412, height: 915 }, isMobile: true });
    const page = await ctx.newPage();
    const starts = new Map(); const reqs = []; let navs = 0; let t0 = 0;
    page.on('request', r => starts.set(r, Date.now()));
    page.on('requestfinished', r => { if (t0) reqs.push({ m: r.method(), u: short(r.url()) + (/admin-ajax|wc-ajax/.test(r.url()) ? ' [' + String(r.postData() || '').replace(/(nonce|security|_wpnonce)=[^&]*/gi, '$1=x').slice(0, 70) + ']' : ''), t: r.resourceType(), ms: Date.now() - (starts.get(r) || Date.now()), at: Date.now() - t0 }); });
    page.on('framenavigated', f => { if (t0 && f === page.mainFrame()) navs++; });
    const res = { kind, ok: false };
    try {
      await page.goto(`${url}${url.includes('?') ? '&' : '?'}cb=${LABEL}${Date.now()}${i}`, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForTimeout(4000);
      // sản phẩm biến thể: chọn tùy chọn đầu còn hàng ở mỗi ô chọn
      for (const sel of await page.$$('form.variations_form select')) {
        const v = await sel.evaluate(s => { const o = [...s.options].find(x => x.value); return o ? o.value : ''; });
        if (v) await sel.selectOption(v).catch(() => {});
      }
      await page.waitForTimeout(1500);
      const btn = page.locator('button.single_add_to_cart_button').first();
      if (!(await btn.count())) throw new Error('không thấy nút thêm vào giỏ');
      const disabled = await btn.evaluate(b => b.classList.contains('disabled') || b.disabled);
      if (disabled) throw new Error('nút đang bị khóa (cần chọn thêm tùy chọn)');
      t0 = Date.now();
      await btn.click({ timeout: 10_000 });
      // chờ giỏ cập nhật: có thông báo thêm thành công, hoặc số lượng giỏ đổi, hoặc trang đã tải lại
      let cartUpdatedMs = null;
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        const hit = await page.evaluate(() => !!document.querySelector('.woocommerce-message, .added_to_cart, .cart-popup-inner, .nav-dropdown .woocommerce-mini-cart-item, .mini_cart_item') || [...document.querySelectorAll('.cart-icon strong, .cart-contents .count, .header-cart-title')].some(e => /[1-9]/.test(e.textContent || ''))).catch(() => false);
        if (hit) { cartUpdatedMs = Date.now() - t0; break; }
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(3000);
      const slow = [...reqs].sort((a, b) => b.ms - a.ms).slice(0, 6).map(r => `${r.m} ${r.u} ${r.ms}ms`);
      const addReq = reqs.find(r => /add[_-]to[_-]cart|add_to_cart/i.test(r.u)) || reqs.find(r => r.m === 'POST');
      Object.assign(res, { ok: true, fullReload: navs > 0, navs, cartUpdatedMs, addRequestMs: addReq ? addReq.ms : null, addRequest: addReq ? `${addReq.m} ${addReq.u}` : null, requestsAfterClick: reqs.length, slowest: slow });
    } catch (e) { res.error = String(e.message || e).slice(0, 100); }
    runs.push(res); await ctx.close();
  }
  const good = runs.filter(r => r.ok);
  out.products[kind] = { url: short(url), runs: runs.length, okRuns: good.length, errors: runs.filter(r => r.error).map(r => r.error), fullReload: good.some(r => r.fullReload), cartUpdatedMsMedian: median(good.map(r => r.cartUpdatedMs).filter(Number.isFinite)), addRequestMsMedian: median(good.map(r => r.addRequestMs).filter(Number.isFinite)), addRequest: good[0]?.addRequest || null, requestsAfterClick: median(good.map(r => r.requestsAfterClick)), slowest: good[0]?.slowest || [] };
}
await browser.close();
writeFileSync(`addtocart-${LABEL}.json`, JSON.stringify(out, null, 2));
console.log(`=== ĐO THÊM VÀO GIỎ (${LABEL}) ===`);
for (const [k, p] of Object.entries(out.products)) {
  console.log(`${k}: ${p.okRuns}/${p.runs} lần đạt; tải lại cả trang=${p.fullReload}; giỏ cập nhật sau=${p.cartUpdatedMsMedian}ms; request thêm giỏ=${p.addRequest} ${p.addRequestMsMedian}ms; request sau khi bấm=${p.requestsAfterClick}`);
  console.log(`   chậm nhất: ${p.slowest.join(' | ')}${p.errors.length ? ' | lỗi: ' + p.errors.join('; ') : ''}`);
}
if (LABEL === 'sau' && existsSync('addtocart-truoc.json')) {
  const b = JSON.parse(readFileSync('addtocart-truoc.json', 'utf8'));
  console.log('=== SO SÁNH TRƯỚC → SAU ===');
  for (const k of Object.keys(out.products)) { const x = b.products[k], y = out.products[k]; if (x) console.log(`${k}: giỏ cập nhật ${x.cartUpdatedMsMedian} → ${y.cartUpdatedMsMedian}ms; tải lại cả trang ${x.fullReload} → ${y.fullReload}`); }
}

if (LABEL === 'sau') {
  const bad = Object.entries(out.products).filter(([, p]) => p.okRuns < p.runs || p.fullReload);
  if (!Object.keys(out.products).length || bad.length) { console.log(`KẾT LUẬN: CHƯA ĐẠT (${bad.map(([k]) => k).join(', ') || 'không có sản phẩm để đo'}): cần gỡ plugin`); process.exitCode = 4; }
  else console.log('KẾT LUẬN: ĐẠT (không tải lại cả trang, giỏ cập nhật)');
}
