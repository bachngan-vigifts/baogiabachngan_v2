// Mở trang chủ, danh mục, sản phẩm (mỗi trang 1 lần, điện thoại, khách) và in các lệnh admin-ajax / wc-ajax / wp-json mà trang tự gửi: tên action, thời gian, script gửi. Chỉ đọc.
import { chromium } from 'playwright';
const SITE = 'https://locknlockonline.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const pages = ['/', '/danh-muc/binh-nuoc/binh-nuoc-mang-di/binh-giu-nhiet/', '/san-pham/binh-giu-nhiet-locknlock-freeflow-lhc4466-lhc4467/'];
const b = await chromium.launch(); let bad = 0;
for (const path of pages) {
  const ctx = await b.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
  const out = []; const st = new Map();
  p.on('request', r => { if (/admin-ajax|wc-ajax|wp-json/.test(r.url()) && r.url().startsWith(SITE)) st.set(r, Date.now()); });
  p.on('requestfinished', async r => { if (!st.has(r)) return; const res = await r.response().catch(() => null); const body = r.postData() || ''; const act = (body.match(/(?:^|&)action=([^&]+)/) || r.url().match(/[?&](?:action|wc-ajax)=([^&]+)/) || [, r.url().replace(SITE, '').slice(0, 50)])[1]; const ini = (r.frame() && (await Promise.resolve(null))) || ''; out.push(`${Date.now() - st.get(r)}ms ${r.method()} ${res ? res.status() : '?'} ${r.url().includes('admin-ajax') ? 'admin-ajax' : r.url().includes('wc-ajax') ? 'wc-ajax' : 'wp-json'} action=${decodeURIComponent(act)} ${body.length > 0 ? '(body ' + body.length + 'B: ' + body.replace(/nonce=[^&]+/g, 'nonce=*').slice(0, 90) + ')' : ''}`); });
  const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
  await p.goto(SITE + path, { waitUntil: 'load', timeout: 90_000 }).catch(() => {});
  await p.evaluate(async () => { for (let y = 0; y <= 2400; y += 300) { scrollTo(0, y); await new Promise(r => setTimeout(r, 200)); } });
  await p.waitForTimeout(8000);
  if (path.includes('/san-pham/')) { const r = await p.evaluate(() => { const f = document.querySelector('form.variations_form'); if (!f || !window.jQuery) return 'không có form'; let vs = []; try { vs = JSON.parse(f.getAttribute('data-product_variations') || '[]'); } catch (e) {} const ok = (vs || []).filter(x => x.is_in_stock).slice(0, 2); for (const v of ok) for (const k in v.attributes) { const sel = f.querySelector('select[name="' + k + '"]'); if (sel && v.attributes[k]) jQuery(sel).val(v.attributes[k]).trigger('change'); } return 'đổi ' + ok.length + ' biến thể'; }); console.log('   ' + r); await p.waitForTimeout(8000); }
  const hasScript = await p.evaluate(() => !!document.getElementById('lnl-wdr-dedupe')).catch(() => false);
  const nW = out.filter(l => l.includes('wdr_ajax')).length;
  if (process.env.EXPECT_WDR_MAX && nW > Number(process.env.EXPECT_WDR_MAX)) { bad++; console.log(`KHÔNG ĐẠT: ${nW} lệnh wdr_ajax`); }
  if (errs.length) console.log('   Lỗi JS: ' + errs.join(' | '));
  if (process.env.EXPECT_WDR_MAX && errs.some(e => /lnl|ajaxTransport|Promise/i.test(e))) { bad++; console.log('KHÔNG ĐẠT: lỗi JS liên quan'); }
  console.log(`   script gộp lệnh có trên trang: ${hasScript}`);
  console.log(`\n== ${path}: ${out.length} lệnh`); for (const l of out) console.log('   ' + l);
  await ctx.close();
}
await b.close(); if (bad) process.exitCode = 1;
