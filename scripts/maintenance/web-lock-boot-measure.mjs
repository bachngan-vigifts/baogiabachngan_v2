// Đo thời gian máy chủ khởi động WordPress (lệnh rỗng) và kiểm tra trang còn nạp Jetpack/Query Monitor không. Chỉ đọc, khách ẩn danh.
import { chromium } from 'playwright';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink;
const browser = await chromium.launch(); const ctx = await browser.newContext(); const p = await ctx.newPage();
const hits = []; p.on('request', r => { if (/jetpack|stats\.wp\.com|pixel\.wp\.com|query-monitor/i.test(r.url())) hits.push(r.url().slice(0, 90)); });
for (const u of [SITE + '/', simple]) { await p.goto(u, { waitUntil: 'load', timeout: 60_000 }); await p.waitForTimeout(3000); }
const inHtml = await p.evaluate(() => /jetpack|stats\.wp\.com/i.test(document.documentElement.innerHTML));
console.log(`Yêu cầu tới Jetpack/Query Monitor: ${hits.length}${hits.length ? ' (' + [...new Set(hits)].slice(0, 4).join(' , ') + ')' : ''}; mã trang còn nhắc Jetpack: ${inHtml}`);
const res = await p.evaluate(async () => { const out = {}; const list = [['lệnh rỗng admin-ajax', '/wp-admin/admin-ajax.php?action=lnl_khong_ton_tai', 'GET'], ['wp-json gốc', '/wp-json/', 'GET'], ['wc-ajax fragments', '/?wc-ajax=get_refreshed_fragments', 'POST']]; for (let k = 0; k < 6; k++) for (const [n, u, m] of list) { const t = performance.now(); const r = await fetch(u + (u.includes('?') ? '&' : '?') + '_=' + Date.now(), { method: m, credentials: 'same-origin' }); await r.text(); (out[n] = out[n] || []).push(Math.round(performance.now() - t)); } return out; });
for (const n in res) { const a = res[n].slice().sort((x, y) => x - y); console.log(`BOOT ${n}: giữa=${a[Math.floor(a.length / 2)]}ms nhanh nhất=${a[0]}ms chậm nhất=${a[a.length - 1]}ms (${res[n].join(', ')})`); }
if (process.env.EXPECT_NO_JETPACK === '1' && hits.length) { console.log('KHÔNG ĐẠT: trang vẫn nạp Jetpack'); process.exitCode = 1; }
await browser.close();
