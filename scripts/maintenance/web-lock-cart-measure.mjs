// Đo trang công khai của web Lock bằng trình duyệt thật (giỏ trống, không đặt đơn, không thêm vào giỏ).
// Mục tiêu: đếm lệnh làm mới giỏ hàng (get_refreshed_fragments), thư viện zxcvbn, dung lượng JS, lỗi console.
// LABEL=truoc|sau. Với LABEL=sau, nếu có measure-truoc.json thì in bảng so sánh.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const LABEL = process.env.LABEL || 'truoc';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const PAGES = [['home', '/'], ['product', '/san-pham/binh-giu-nhiet-locknlock-lhc6150ivy/'], ['cart', '/gio-hang/']];
const RUNS = 2;
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

const browser = await chromium.launch();
const out = { label: LABEL, at: new Date().toISOString(), pages: {} };
for (const [name, path] of PAGES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 412, height: 915 }, isMobile: true });
    const page = await ctx.newPage();
    const starts = new Map(); const done = []; const consoleErrors = []; let pageErrors = 0;
    page.on('request', r => starts.set(r, Date.now()));
    page.on('requestfinished', async r => {
      const t0 = starts.get(r) || Date.now(); let kb = 0;
      try { kb = ((await r.sizes()).responseBodySize || 0) / 1024; } catch {}
      done.push({ url: r.url(), type: r.resourceType(), ms: Date.now() - t0, kb });
    });
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().replace(SITE, '').slice(0, 120)); });
    page.on('pageerror', () => { pageErrors++; });
    const url = `${SITE}${path}?cb=${LABEL}${Date.now()}${i}`;
    let status = 0, nav = {};
    try {
      const resp = await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
      status = resp?.status() || 0;
      await page.waitForTimeout(7000); // đủ để bắt lệnh làm mới giỏ hàng bị hẹn 3 giây
      nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { ttfb: Math.round(n.responseStart), load: Math.round(n.loadEventEnd) } : {}; });
    } catch (e) { consoleErrors.push('goto: ' + String(e.message || e).slice(0, 80)); }
    const frag = done.filter(r => /wc-ajax=get_refreshed_fragments/.test(r.url));
    runs.push({
      status, ...nav,
      requests: done.length,
      jsKb: Math.round(done.filter(r => r.type === 'script').reduce((s, r) => s + r.kb, 0)),
      zxcvbn: done.some(r => /zxcvbn/i.test(r.url)),
      fragmentCalls: frag.length, fragmentMs: frag.map(r => r.ms),
      consoleErrors: consoleErrors.length, consoleSample: consoleErrors.slice(0, 3), pageErrors,
    });
    await ctx.close();
  }
  out.pages[name] = {
    status: runs.map(r => r.status),
    ttfbMedian: median(runs.map(r => r.ttfb).filter(Number.isFinite)), loadMedian: median(runs.map(r => r.load).filter(Number.isFinite)),
    jsKbMedian: median(runs.map(r => r.jsKb)), requestsMedian: median(runs.map(r => r.requests)),
    zxcvbnLoaded: runs.some(r => r.zxcvbn),
    fragmentCallsPerPage: median(runs.map(r => r.fragmentCalls)), fragmentMs: runs.flatMap(r => r.fragmentMs),
    consoleErrorsMax: Math.max(...runs.map(r => r.consoleErrors)), pageErrorsMax: Math.max(...runs.map(r => r.pageErrors)), consoleSample: runs.flatMap(r => r.consoleSample).slice(0, 4),
  };
}
await browser.close();
writeFileSync(`measure-${LABEL}.json`, JSON.stringify(out, null, 2));
console.log(`=== ĐO (${LABEL}) ===`);
for (const [n, p] of Object.entries(out.pages)) console.log(`${n}: http=${p.status} ttfb=${p.ttfbMedian}ms load=${p.loadMedian}ms js=${p.jsKbMedian}KB req=${p.requestsMedian} zxcvbn=${p.zxcvbnLoaded} lệnhGiỏ/trang=${p.fragmentCallsPerPage} (${p.fragmentMs.join('/')}ms) lỗiConsole=${p.consoleErrorsMax} lỗiJS=${p.pageErrorsMax}${p.consoleSample.length ? ' mẫu=' + JSON.stringify(p.consoleSample) : ''}`);

if (LABEL === 'sau' && existsSync('measure-truoc.json')) {
  const b = JSON.parse(readFileSync('measure-truoc.json', 'utf8'));
  console.log('=== SO SÁNH TRƯỚC → SAU ===');
  for (const n of Object.keys(out.pages)) {
    const x = b.pages[n], y = out.pages[n];
    console.log(`${n}: lệnhGiỏ/trang ${x.fragmentCallsPerPage} → ${y.fragmentCallsPerPage}; zxcvbn ${x.zxcvbnLoaded} → ${y.zxcvbnLoaded}; JS ${x.jsKbMedian} → ${y.jsKbMedian}KB; load ${x.loadMedian} → ${y.loadMedian}ms; lỗiConsole ${x.consoleErrorsMax} → ${y.consoleErrorsMax}; lỗiJS ${x.pageErrorsMax} → ${y.pageErrorsMax}`);
  }
}
