// Mở trang chủ, danh mục, sản phẩm (mỗi trang 1 lần, điện thoại, khách) và in các lệnh admin-ajax / wc-ajax / wp-json mà trang tự gửi: tên action, thời gian, script gửi. Chỉ đọc.
import { chromium } from 'playwright';
const SITE = 'https://locknlockonline.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const pages = ['/', '/danh-muc/binh-nuoc/binh-nuoc-mang-di/binh-giu-nhiet/', '/san-pham/binh-giu-nhiet-locknlock-freeflow-lhc4466-lhc4467/'];
const b = await chromium.launch();
for (const path of pages) {
  const ctx = await b.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
  const out = []; const st = new Map();
  p.on('request', r => { if (/admin-ajax|wc-ajax|wp-json/.test(r.url()) && r.url().startsWith(SITE)) st.set(r, Date.now()); });
  p.on('requestfinished', async r => { if (!st.has(r)) return; const res = await r.response().catch(() => null); const body = r.postData() || ''; const act = (body.match(/(?:^|&)action=([^&]+)/) || r.url().match(/[?&](?:action|wc-ajax)=([^&]+)/) || [, r.url().replace(SITE, '').slice(0, 50)])[1]; const ini = (r.frame() && (await Promise.resolve(null))) || ''; out.push(`${Date.now() - st.get(r)}ms ${r.method()} ${res ? res.status() : '?'} ${r.url().includes('admin-ajax') ? 'admin-ajax' : r.url().includes('wc-ajax') ? 'wc-ajax' : 'wp-json'} action=${decodeURIComponent(act)} ${body.length > 0 ? '(body ' + body.length + 'B: ' + body.replace(/nonce=[^&]+/g, 'nonce=*').slice(0, 90) + ')' : ''}`); });
  await p.goto(SITE + path, { waitUntil: 'load', timeout: 90_000 }).catch(() => {});
  await p.evaluate(async () => { for (let y = 0; y <= 2400; y += 300) { scrollTo(0, y); await new Promise(r => setTimeout(r, 200)); } });
  await p.waitForTimeout(12000);
  console.log(`\n== ${path}: ${out.length} lệnh`); for (const l of out) console.log('   ' + l);
  await ctx.close();
}
await b.close();
