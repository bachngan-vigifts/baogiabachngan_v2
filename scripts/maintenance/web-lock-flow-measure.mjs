// Đo luồng mua hàng trên điện thoại (giỏ khách tạm, không đặt đơn): thêm giỏ, mua ngay, giỏ hàng, thanh toán. In từng lệnh gọi về máy chủ, thời gian, và lệnh trùng. Chỉ đọc.
import { chromium } from 'playwright';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink;
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
let log = [], t0 = Date.now(); const started = new Map();
page.on('request', r => started.set(r, Date.now()));
const done = (r, st) => { const u = r.url(); const type = r.resourceType(); if (!['document', 'xhr', 'fetch'].includes(type)) return; const own = u.startsWith(SITE); const s = started.get(r) || Date.now(); log.push({ at: s - t0, ms: Date.now() - s, m: r.method(), st, own, key: own ? u.replace(SITE, '').replace(/([?&])(cb|_|t|ver|random|nocache)=[^&]*/g, '$1').replace(/[?&]+$/, '').slice(0, 90) : new URL(u).hostname, type }); };
page.on('requestfinished', async r => { const resp = await r.response().catch(() => null); done(r, resp ? resp.status() : 0); });
page.on('requestfailed', r => done(r, 'lỗi'));
function phase(name) { console.log(`\n== ${name}`); log = []; t0 = Date.now(); }
function report() {
  const own = log.filter(x => x.own).sort((a, b) => a.at - b.at);
  for (const x of own) console.log(`  +${String(x.at).padStart(5)}ms  ${String(x.ms).padStart(5)}ms  ${x.m} ${x.st} ${x.key}${x.ms >= 1500 ? '   <-- CHẬM' : ''}`);
  const cnt = {}; for (const x of own) { const k = x.m + ' ' + x.key; cnt[k] = (cnt[k] || 0) + 1; }
  const dup = Object.entries(cnt).filter(([, n]) => n > 1); console.log('  TRÙNG: ' + (dup.length ? dup.map(([k, n]) => `${k} x${n}`).join(' | ') : 'không có'));
  const ext = {}; for (const x of log.filter(x => !x.own)) ext[x.key] = (ext[x.key] || 0) + 1; console.log('  Bên ngoài: ' + (Object.entries(ext).map(([k, n]) => `${k} x${n}`).join(', ') || 'không'));
}
phase('MỞ TRANG SẢN PHẨM'); await page.goto(simple, { waitUntil: 'load', timeout: 60_000 }); console.log('  tải xong sau ' + (Date.now() - t0) + 'ms'); await page.waitForTimeout(5000); report();
phase('BẤM THÊM VÀO GIỎ (form chính)');
{ const r = page.waitForResponse(x => /wc-ajax=lnl_add_to_cart/.test(x.url()), { timeout: 45_000 }).catch(() => null); await page.locator('form.cart .single_add_to_cart_button').first().click(); await r; console.log('  giỏ cập nhật sau ' + (Date.now() - t0) + 'ms'); await page.waitForTimeout(5000); report(); }
await page.goto(simple, { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(4000);
phase('BẤM MUA NGAY (form chính)');
{ await page.locator('form.cart button[name="ux-buy-now"]').first().click({ noWaitAfter: true }); await page.waitForURL(/thanh-toan/, { timeout: 60_000, waitUntil: 'commit' }).catch(() => console.log('  không tới thanh toán trong 60s')); console.log('  tới trang thanh toán sau ' + (Date.now() - t0) + 'ms'); await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {}); console.log('  tải xong sau ' + (Date.now() - t0) + 'ms'); await page.waitForTimeout(8000); report(); }
phase('ĐỔI PHƯƠNG THỨC THANH TOÁN');
{ const other = page.locator('input[name=payment_method]:not(:checked)').first(); if (await other.count()) { const r = page.waitForResponse(x => /update_order_review/.test(x.url()), { timeout: 20_000 }).catch(() => null); await other.check({ force: true }).catch(() => {}); await r; console.log('  xong sau ' + (Date.now() - t0) + 'ms'); await page.waitForTimeout(4000); } report(); }
phase('MỞ TRANG GIỎ HÀNG'); await page.goto(SITE + '/gio-hang/', { waitUntil: 'load', timeout: 60_000 }); console.log('  tải xong sau ' + (Date.now() - t0) + 'ms'); await page.waitForTimeout(6000); report();
phase('MỞ LẠI TRANG THANH TOÁN'); await page.goto(SITE + '/thanh-toan/', { waitUntil: 'load', timeout: 60_000 }); console.log('  tải xong sau ' + (Date.now() - t0) + 'ms'); await page.waitForTimeout(8000); report();
await browser.close();
