// Đo trang giỏ hàng và thanh toán của web Lock khi giỏ CÓ 1 sản phẩm (phiên khách tạm, điện thoại giả lập). KHÔNG đặt đơn, không điền thông tin.
import { chromium } from 'playwright';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const RUNS = Number(process.env.RUNS || 2);
const short = u => u.replace(SITE, '').replace(/[?&]cb=[^&]*/, '').slice(0, 80);
let simple = null;
try { const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json(); simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink; } catch {}
if (!simple) { console.log('Không tìm thấy sản phẩm'); process.exit(1); }
const browser = await chromium.launch();
let bad = false;
for (let i = 0; i < RUNS; i++) {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 412, height: 915 }, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(simple + `?cb=${Date.now()}${i}`, { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(3000);
  await page.locator('button.single_add_to_cart_button').first().click(); await page.waitForTimeout(5000);
  for (const [name, path] of [['cart', '/gio-hang/'], ['checkout', '/thanh-toan/']]) {
    const starts = new Map(), done = [], errs = [];
    page.on('request', r => starts.set(r, Date.now()));
    const onFin = async r => { let kb = 0; try { kb = ((await r.sizes()).responseBodySize || 0) / 1024; } catch {} done.push({ m: r.method(), u: short(r.url()) + (/admin-ajax|wc-ajax/.test(r.url()) ? ' [' + String(r.postData() || '').replace(/(nonce|security|_wpnonce)=[^&]*/gi, '$1=x').slice(0, 60) + ']' : ''), t: r.resourceType(), ms: Date.now() - (starts.get(r) || Date.now()), kb }); };
    page.on('requestfinished', onFin); page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); });
    const t0 = Date.now(); let status = 0;
    try { const resp = await page.goto(`${SITE}${path}?cb=${Date.now()}${i}`, { waitUntil: 'load', timeout: 60_000 }); status = resp?.status() || 0; } catch (e) { errs.push('goto ' + String(e.message).slice(0, 60)); }
    const loadMs = Date.now() - t0; await page.waitForTimeout(8000);
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd) } : {}; }).catch(() => ({}));
    const zx = done.some(r => /zxcvbn/i.test(r.u));
    if (process.env.EXPECT_NO_ZXCVBN === '1' && name === 'checkout' && (zx || status !== 200)) bad = true;
    const ajax = done.filter(r => /wc-ajax|admin-ajax/.test(r.u));
    console.log(`[lần${i + 1}] ${name}: http=${status} ttfb=${nav.ttfb}ms dcl=${nav.dcl}ms load=${loadMs}ms req=${done.length} js=${Math.round(done.filter(r => r.t === 'script').reduce((s, r) => s + r.kb, 0))}KB zxcvbn=${zx} lỗiConsole=${errs.length}${errs[0] ? ' mẫu=' + errs[0] : ''}`);
    console.log(`   gọi ajax: ${ajax.map(r => `${r.m} ${r.u} ${r.ms}ms`).join(' | ') || 'không'}`);
    console.log(`   chậm nhất: ${[...done].sort((a, b) => b.ms - a.ms).slice(0, 4).map(r => `${r.m} ${r.u} ${r.ms}ms`).join(' | ')}`);
    page.off('requestfinished', onFin);
  }
  await ctx.close();
}
await browser.close();

if (process.env.EXPECT_NO_ZXCVBN === '1') { console.log(bad ? 'KẾT LUẬN: CHƯA ĐẠT (thanh toán vẫn tải zxcvbn hoặc lỗi): cần gỡ' : 'KẾT LUẬN: ĐẠT (thanh toán không tải zxcvbn)'); if (bad) process.exitCode = 4; }
