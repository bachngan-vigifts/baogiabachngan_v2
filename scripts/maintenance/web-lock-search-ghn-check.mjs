// Kiểm tra (khách, giỏ tạm, không đặt đơn): (1) ô tìm kiếm gợi ý: gõ "binh giu" từng chữ, đếm lệnh gửi máy chủ và số gợi ý hiện ra. (2) danh sách tỉnh/huyện/xã GHN ở thanh toán: bắt lệnh trang gửi, gửi lại 2 lần, xem thời gian, cache và nội dung có giống nhau.
// EXPECT=1: không đạt nếu tìm kiếm gửi > 3 lệnh hoặc không có gợi ý; hoặc GHN lần 2 không trúng cache / nội dung khác.
import { chromium } from 'playwright';
const SITE = 'https://locknlockonline.com', EXPECT = process.env.EXPECT === '1';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const b = await chromium.launch(); let bad = 0;
for (let r = 1; r <= Number(process.env.RUNS || 2); r++) {
  const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', viewport: { width: 1366, height: 900 } }); const p = await ctx.newPage();
  const sreq = []; p.on('request', q => { if (/flatsome_ajax_search_products/.test(q.url() + (q.postData() || ''))) sreq.push(Date.now()); });
  const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 100)));
  try {
    await p.goto(SITE + '/', { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(4000);
    const inp = p.locator('input.search-field:visible, input[name="s"]:visible').first();
    await inp.click(); for (const ch of 'binh giu') { await p.keyboard.type(ch); await p.waitForTimeout(140); }
    await p.waitForTimeout(6000);
    const sug = await p.evaluate(() => document.querySelectorAll('.autocomplete-suggestion').length);
    console.log(`Tìm kiếm lượt ${r}: gõ 8 ký tự -> ${sreq.length} lệnh gửi máy chủ, ${sug} gợi ý hiện ra; lỗi JS: ${errs.join(' | ') || 'không'}`);
    if (EXPECT && (sreq.length > 3 || sug === 0)) { bad++; console.log('  KHÔNG ĐẠT'); }
  } catch (e) { console.log(`Tìm kiếm lượt ${r} LỖI ${String(e.message).slice(0, 120)}`); if (EXPECT) bad++; }
  await ctx.close();
}
// GHN
const ctx = await b.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
const ghn = []; p.on('request', q => { const d = q.postData() || ''; const u = q.url(); if (/lnl_ghn_checkout_(provinces|districts|wards)/.test(u + d)) ghn.push({ u, d, m: q.method() }); });
try {
  const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
  const simple = j.find(x => x.permalink).permalink;
  await p.goto(simple, { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(3000);
  const btn = p.locator('form.cart .single_add_to_cart_button').first(); await btn.scrollIntoViewIfNeeded();
  const d = p.waitForResponse(x => /wc-ajax=lnl_add_to_cart/.test(x.url()), { timeout: 60000 }).catch(() => null); await btn.tap({ noWaitAfter: true }); await d; await p.waitForTimeout(1500);
  await p.goto(SITE + '/thanh-toan/', { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(6000);
  if (!ghn.some(g => /districts/.test(g.u + g.d))) { await p.evaluate(() => { for (const s of document.querySelectorAll('form.checkout select')) { if (/state|province|city|tinh/i.test(s.name + s.id) && s.options.length > 1) { s.value = s.options[1].value; if (window.jQuery) jQuery(s).trigger('change'); else s.dispatchEvent(new Event('change', { bubbles: true })); break; } } }); await p.waitForTimeout(6000); }
  console.log(`GHN: trang gửi ${ghn.length} lệnh (${[...new Set(ghn.map(g => (g.u + g.d).match(/lnl_ghn_checkout_\w+/)[0]))].join(', ')})`);
  for (const g of ghn.slice(0, 2)) {
    const name = (g.u + g.d).match(/lnl_ghn_checkout_\w+/)[0]; const out = [];
    for (let i = 0; i < 2; i++) { const t = Date.now(); const r = await p.evaluate(async ({ u, d, m }) => { const res = await fetch(u, { method: m, body: m === 'POST' ? d : undefined, credentials: 'same-origin', headers: m === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' } : {} }); const t = await res.text(); let h = 0; for (let k = 0; k < t.length; k++) h = (h * 31 + t.charCodeAt(k)) | 0; return { s: res.status, c: res.headers.get('x-lnl-ghn-cache') || '-', len: t.length, h }; }, g); out.push({ ...r, ms: Date.now() - t }); }
    console.log(`  ${name}: lần 1 ${out[0].s} ${out[0].ms}ms cache=${out[0].c} ${out[0].len}B; lần 2 ${out[1].s} ${out[1].ms}ms cache=${out[1].c} ${out[1].len}B; nội dung ${out[0].h === out[1].h ? 'GIỐNG' : 'KHÁC'}`);
    if (EXPECT && (out[1].c !== 'hit' || out[0].h !== out[1].h || out[1].s !== 200)) { bad++; console.log('  KHÔNG ĐẠT'); }
  }
  if (!ghn.length) console.log('  (trang thanh toán không gửi lệnh GHN nào trong lượt thử)');
} catch (e) { console.log('GHN LỖI ' + String(e.message).slice(0, 150)); if (EXPECT) bad++; }
await ctx.close(); await b.close();
if (bad) { console.log(`KHÔNG ĐẠT: ${bad}`); process.exitCode = 1; } else console.log('TẤT CẢ ĐẠT');
