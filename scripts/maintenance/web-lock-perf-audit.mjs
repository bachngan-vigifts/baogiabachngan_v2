// Đo tốc độ web Lock như một khách truy cập: trang chủ, danh mục, sản phẩm, tìm kiếm, giỏ hàng, thanh toán (không đặt đơn).
// Thêm: thời gian máy chủ (TTFB trừ thời gian kết nối), cache LiteSpeed, tài nguyên theo plugin, Store API giỏ hàng,
// PageSpeed Insights (lab + dữ liệu khách thật nếu có), và thông số máy chủ từ system_status (nếu có khoá REST).
// Không in thông tin khách hàng hay khoá.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SITE = 'https://locknlockonline.com';
const out = { at: new Date().toISOString(), runnerNote: 'Máy đo đặt tại Mỹ (GitHub Actions): thời gian mạng cao hơn khách ở Việt Nam; xem cột serverMs để biết thời gian máy chủ xử lý.' };
const ms = s => Math.round(s * 1000);
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

async function timed(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { redirect: 'manual', ...init, headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, br', ...(init.headers || {}) } });
  const tH = performance.now();
  const body = await res.arrayBuffer();
  const t1 = performance.now();
  const h = Object.fromEntries(['server', 'x-litespeed-cache', 'x-litespeed-cache-control', 'cf-cache-status', 'content-encoding', 'cache-control', 'x-qc-cache', 'x-turbo-charged-by', 'alt-svc', 'x-powered-by', 'location'].map(k => [k, res.headers.get(k)]).filter(([, v]) => v));
  return { status: res.status, headersMs: Math.round(tH - t0), totalMs: Math.round(t1 - t0), bytes: body.byteLength, headers: h, res, text: () => new TextDecoder().decode(body) };
}

// 1) Chọn trang mẫu qua Store API công khai.
const prods = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?per_page=10&stock_status=instock&type=simple&orderby=popularity`, { headers: { 'User-Agent': UA } })).json().catch(() => []);
const cats = await (await fetch(`${SITE}/wp-json/wc/store/v1/products/categories?per_page=100`, { headers: { 'User-Agent': UA } })).json().catch(() => []);
const product = Array.isArray(prods) ? prods.find(p => p.is_purchasable && p.is_in_stock) : null;
const cat = Array.isArray(cats) ? [...cats].sort((a, b) => b.count - a.count)[0] : null;
const pages = {
  home: SITE + '/',
  category: cat?.permalink || SITE + '/shop/',
  product: product?.permalink || SITE + '/shop/',
  search: SITE + '/?s=binh+giu+nhiet&post_type=product',
  cart: SITE + '/gio-hang/',
  checkout: SITE + '/thanh-toan/',
};
// Lấy đúng URL giỏ hàng/thanh toán từ trang chủ nếu khác.
try {
  const html = (await timed(SITE + '/')).text();
  const cartUrl = html.match(/"cart_url":"([^"]+)"/)?.[1]?.replace(/\\\//g, '/');
  const checkoutUrl = html.match(/"checkout_url":"([^"]+)"/)?.[1]?.replace(/\\\//g, '/');
  if (cartUrl) pages.cart = cartUrl.startsWith('http') ? cartUrl : SITE + cartUrl;
  if (checkoutUrl) pages.checkout = checkoutUrl.startsWith('http') ? checkoutUrl : SITE + checkoutUrl;
} catch {}
out.pages = pages;
out.sampleProduct = product ? { id: product.id, name: product.name, sku: product.sku } : null;

// 2) Đo HTTP thô: mạng (kết nối) và máy chủ. Lặp 5 lần mỗi trang; lần đầu có thể là cache miss.
const rtt = [];
for (let i = 0; i < 5; i++) { const t = await timed(SITE + '/wp-content/themes/flatsome/style.css'); rtt.push(t.headersMs); }
const baseRtt = Math.min(...rtt);
out.network = { staticFileHeadersMs: rtt, baseRttMs: baseRtt };
out.http = {};
for (const [name, url] of Object.entries(pages)) {
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const t = await timed(url + (i === 0 ? '' : ''));
    runs.push({ status: t.status, headersMs: t.headersMs, serverMs: Math.max(0, t.headersMs - baseRtt), totalMs: t.totalMs, kb: Math.round(t.bytes / 1024), cache: t.headers['x-litespeed-cache'] || t.headers['cf-cache-status'] || t.headers['x-qc-cache'] || '-' });
    if (i === 0) out.http[name] = { headers: t.headers };
  }
  const sorted = runs.map(r => r.serverMs).sort((a, b) => a - b);
  out.http[name] = { ...out.http[name], runs, serverMedianMs: sorted[2], serverFirstMs: runs[0].serverMs };
}
// Bỏ qua cache bằng chuỗi truy vấn ngẫu nhiên để đo thời gian PHP thật (LiteSpeed thường vẫn cache theo query; ghi lại header).
out.uncached = {};
for (const name of ['home', 'product', 'category']) {
  const runs = [];
  for (let i = 0; i < 3; i++) { const t = await timed(pages[name] + (pages[name].includes('?') ? '&' : '?') + 'nocache=' + Date.now() + i, { headers: { Cookie: 'woocommerce_items_in_cart=1' } }); runs.push({ serverMs: Math.max(0, t.headersMs - baseRtt), cache: t.headers['x-litespeed-cache'] || '-' }); }
  out.uncached[name] = runs;
}

// 3) Store API: khởi động WordPress + toàn bộ plugin, không cache — thước đo tốc độ PHP/DB.
async function storeApi() {
  const r = {};
  const t1 = await timed(`${SITE}/wp-json/wc/store/v1/products?per_page=1`); r.productsMs = Math.max(0, t1.headersMs - baseRtt);
  const t2 = await timed(`${SITE}/wp-json/wc/store/v1/cart`); r.cartGetMs = Math.max(0, t2.headersMs - baseRtt);
  const nonce = t2.res.headers.get('nonce'); const cookie = (t2.res.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  if (product && nonce) {
    const t3 = await timed(`${SITE}/wp-json/wc/store/v1/cart/add-item`, { method: 'POST', headers: { Nonce: nonce, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: product.id, quantity: 1 }) });
    r.addItemMs = Math.max(0, t3.headersMs - baseRtt); r.addItemStatus = t3.status;
  }
  const t4 = await timed(`${SITE}/?wc-ajax=get_refreshed_fragments`, { method: 'POST' }); r.wcFragmentsMs = Math.max(0, t4.headersMs - baseRtt); r.wcFragmentsStatus = t4.status;
  const t5 = await timed(`${SITE}/wp-admin/admin-ajax.php`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=heartbeat' }); r.adminAjaxMs = Math.max(0, t5.headersMs - baseRtt);
  return r;
}
out.backend = [await storeApi(), await storeApi(), await storeApi()];

// 4) Trình duyệt thật (mobile): tải trang, đo LCP/CLS/TBT xấp xỉ, đếm tài nguyên theo plugin, lỗi JS, request chậm.
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  window.__lcp = 0; window.__cls = 0; window.__tbt = 0;
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__tbt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
});
const owner = u => {
  try {
    const x = new URL(u);
    if (x.host !== new URL(SITE).host) return 'ngoài: ' + x.host;
    const m = x.pathname.match(/\/wp-content\/(plugins|themes)\/([^/]+)/); if (m) return `${m[1] === 'plugins' ? 'plugin' : 'theme'}: ${m[2]}`;
    if (x.pathname.includes('/wp-includes/')) return 'wp-core';
    if (x.pathname.includes('/wp-content/uploads/')) return 'uploads (ảnh/media)';
    if (x.pathname.includes('/wp-content/litespeed/')) return 'litespeed (css/js gộp)';
    return 'trang/API';
  } catch { return '?'; }
};
async function visit(name, url, page, action) {
  const reqs = []; const errors = [];
  const onRes = async res => { try { const req = res.request(); const t = req.timing(); const sizes = await req.sizes().catch(() => null); reqs.push({ url: req.url(), type: req.resourceType(), status: res.status(), ms: Math.round(t.responseEnd > 0 ? t.responseEnd : 0), bytes: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0 }); } catch {} };
  const onErr = e => errors.push(String(e.message || e).slice(0, 200));
  const onConsole = m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); };
  page.on('response', onRes); page.on('pageerror', onErr); page.on('console', onConsole);
  const t0 = Date.now();
  if (action) await action(); else await page.goto(url, { waitUntil: 'load', timeout: 90_000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(3000);
  const m = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { ttfb: n ? Math.round(n.responseStart) : null, domContentLoaded: n ? Math.round(n.domContentLoadedEventEnd) : null, load: n ? Math.round(n.loadEventEnd) : null, lcp: Math.round(window.__lcp), cls: +window.__cls.toFixed(3), tbt: Math.round(window.__tbt), domNodes: document.getElementsByTagName('*').length }; });
  page.off('response', onRes); page.off('pageerror', onErr); page.off('console', onConsole);
  const byOwner = {};
  for (const r of reqs) { const o = owner(r.url); byOwner[o] ??= { requests: 0, kb: 0, js: 0, css: 0 }; byOwner[o].requests++; byOwner[o].kb += r.bytes / 1024; if (r.type === 'script') byOwner[o].js++; if (r.type === 'stylesheet') byOwner[o].css++; }
  for (const o of Object.values(byOwner)) o.kb = Math.round(o.kb);
  const total = { requests: reqs.length, kb: Math.round(reqs.reduce((s, r) => s + r.bytes, 0) / 1024), jsKb: Math.round(reqs.filter(r => r.type === 'script').reduce((s, r) => s + r.bytes, 0) / 1024), cssKb: Math.round(reqs.filter(r => r.type === 'stylesheet').reduce((s, r) => s + r.bytes, 0) / 1024), imgKb: Math.round(reqs.filter(r => r.type === 'image').reduce((s, r) => s + r.bytes, 0) / 1024) };
  const slow = reqs.filter(r => r.ms > 800).sort((a, b) => b.ms - a.ms).slice(0, 12).map(r => ({ ms: r.ms, kb: Math.round(r.bytes / 1024), type: r.type, owner: owner(r.url), url: r.url.replace(/[?#].*$/, '').slice(0, 140) }));
  const ajax = reqs.filter(r => /admin-ajax|wc-ajax|wp-json/.test(r.url)).map(r => ({ ms: r.ms, status: r.status, url: r.url.replace(SITE, '').replace(/([?&](nonce|_wpnonce|key)=)[^&]+/g, '$1…').slice(0, 140) }));
  const shot = `perf-${name}.png`; await page.screenshot({ path: shot, fullPage: false });
  return { name, url: page.url(), wallLoadMs: loadMs, ...m, total, byOwner: Object.fromEntries(Object.entries(byOwner).sort((a, b) => b[1].kb - a[1].kb)), slow, ajax, errors: [...new Set(errors)].slice(0, 15) };
}
out.browser = [];
const page = await ctx.newPage();
for (const name of ['home', 'category', 'product', 'search']) out.browser.push(await visit(name, pages[name], page));
// Lần 2 trang chủ (đã có cache trình duyệt) để xem tải lặp.
out.browser.push({ ...(await visit('home-repeat', pages.home, page)), note: 'lần 2, có cache trình duyệt' });
// Luồng giỏ hàng: vào sản phẩm, bấm Thêm vào giỏ, đo thời gian tới khi giỏ cập nhật, rồi mở giỏ và trang thanh toán.
out.cartFlow = {};
try {
  await page.goto(pages.product, { waitUntil: 'load', timeout: 90_000 });
  const btn = page.locator('button.single_add_to_cart_button, button[name="add-to-cart"]').first();
  if (await btn.count()) {
    const t0 = Date.now();
    const waitResp = page.waitForResponse(r => /add_to_cart|add-to-cart|wc-ajax|admin-ajax|cart\/add-item/.test(r.url()) || r.request().isNavigationRequest(), { timeout: 60_000 }).catch(() => null);
    await btn.click();
    const resp = await waitResp;
    await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
    out.cartFlow.addToCartMs = Date.now() - t0; out.cartFlow.addToCartVia = resp ? resp.url().replace(SITE, '').replace(/[?#].*$/, '') : 'không thấy phản hồi';
  } else out.cartFlow.addToCartMs = 'không thấy nút Thêm vào giỏ';
} catch (e) { out.cartFlow.error = String(e.message || e).slice(0, 200); }
out.browser.push(await visit('cart', pages.cart, page));
out.browser.push(await visit('checkout', pages.checkout, page));
out.cartFlow.checkoutHasBlocks = await page.locator('.wp-block-woocommerce-checkout, .wc-block-checkout').count().then(n => n > 0).catch(() => null);
out.cartFlow.checkoutFields = await page.locator('form.checkout input, form.checkout select, .wc-block-checkout input, .wc-block-checkout select').count().catch(() => null);
out.cartFlow.paymentMethods = await page.locator('input[name="payment_method"], .wc-block-components-radio-control__input').evaluateAll(xs => xs.map(x => x.value)).catch(() => []);
// Đổi tỉnh/huyện có gọi AJAX chậm không: ghi các request AJAX trên trang thanh toán (đã có ở mục ajax).
await browser.close();

// 5) PageSpeed Insights (Google), mobile + desktop, trang chủ và sản phẩm. Có dữ liệu khách thật (CrUX) nếu đủ lượt truy cập.
out.pagespeed = {};
for (const [name, url] of [['home', pages.home], ['product', pages.product], ['category', pages.category]]) {
  for (const strategy of ['mobile', 'desktop']) {
    try {
      const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance`;
      const j = await (await fetch(api, { signal: AbortSignal.timeout(120_000) })).json();
      const a = j.lighthouseResult?.audits || {};
      const field = j.loadingExperience?.metrics || {}; const origin = j.originLoadingExperience?.metrics || {};
      const f = m => m ? { p75: m.percentile, category: m.category } : null;
      out.pagespeed[`${name}-${strategy}`] = j.error ? { error: j.error.message?.slice(0, 200) } : {
        score: Math.round((j.lighthouseResult?.categories?.performance?.score ?? 0) * 100),
        lab: { FCP: a['first-contentful-paint']?.displayValue, LCP: a['largest-contentful-paint']?.displayValue, TBT: a['total-blocking-time']?.displayValue, CLS: a['cumulative-layout-shift']?.displayValue, SI: a['speed-index']?.displayValue, TTFB: a['server-response-time']?.displayValue },
        fieldUrl: { LCP: f(field.LARGEST_CONTENTFUL_PAINT_MS), INP: f(field.INTERACTION_TO_NEXT_PAINT), CLS: f(field.CUMULATIVE_LAYOUT_SHIFT_SCORE), TTFB: f(field.EXPERIMENTAL_TIME_TO_FIRST_BYTE), overall: j.loadingExperience?.overall_category },
        fieldOrigin: { LCP: f(origin.LARGEST_CONTENTFUL_PAINT_MS), INP: f(origin.INTERACTION_TO_NEXT_PAINT), CLS: f(origin.CUMULATIVE_LAYOUT_SHIFT_SCORE), TTFB: f(origin.EXPERIMENTAL_TIME_TO_FIRST_BYTE), overall: j.originLoadingExperience?.overall_category },
        opportunities: Object.values(a).filter(x => x.details?.type === 'opportunity' && (x.details.overallSavingsMs || 0) > 150).sort((x, y) => y.details.overallSavingsMs - x.details.overallSavingsMs).slice(0, 8).map(x => `${x.title}: tiết kiệm ~${Math.round(x.details.overallSavingsMs)}ms`),
        thirdParty: (a['third-party-summary']?.details?.items || []).slice(0, 8).map(x => `${x.entity?.text || x.entity}: chặn ${Math.round(x.blockingTime)}ms, ${Math.round((x.transferSize || 0) / 1024)}KB`),
        bootup: (a['bootup-time']?.details?.items || []).slice(0, 8).map(x => `${String(x.url).replace(/[?#].*$/, '').slice(-90)}: ${Math.round(x.total)}ms`),
        mainThread: (a['mainthread-work-breakdown']?.details?.items || []).slice(0, 5).map(x => `${x.groupLabel}: ${Math.round(x.duration)}ms`),
        domSize: a['dom-size']?.displayValue, totalBytes: a['total-byte-weight']?.displayValue,
      };
    } catch (e) { out.pagespeed[`${name}-${strategy}`] = { error: String(e.message || e).slice(0, 200) }; }
  }
}

// 6) Thông số máy chủ qua REST system_status (cần khoá; chỉ lấy số liệu kỹ thuật).
if (process.env.WC_CONSUMER_KEY) {
  try {
    const auth = 'Basic ' + Buffer.from(`${process.env.WC_CONSUMER_KEY}:${process.env.WC_CONSUMER_SECRET}`).toString('base64');
    const base = (process.env.WC_BASE_URL || SITE).replace(/\/+$/, '').replace(/\/wp-json.*$/, '');
    const t = performance.now();
    const s = await (await fetch(base + '/wp-json/wc/v3/system_status', { headers: { Authorization: auth, 'User-Agent': UA } })).json();
    const e = s.environment || {}, d = s.database || {};
    const tables = Object.entries({ ...(d.database_tables?.woocommerce || {}), ...(d.database_tables?.other || {}) }).map(([n, v]) => ({ n, mb: +(Number(v.data) + Number(v.index)).toFixed(1) })).sort((a, b) => b.mb - a.mb).slice(0, 12);
    out.server = {
      systemStatusMs: Math.round(performance.now() - t),
      serverInfo: e.server_info, php: e.php_version, phpMemoryLimit: e.php_max_input_vars ? undefined : undefined,
      wpMemoryLimit: Math.round((e.wp_memory_limit || 0) / 1048576) + 'MB', phpPostMax: Math.round((e.php_post_max_size || 0) / 1048576) + 'MB', maxExecution: e.php_max_execution_time, maxInputVars: e.php_max_input_vars,
      mysql: e.mysql_version_string || e.mysql_version, wpCron: e.wp_cron, externalObjectCache: e.external_object_cache, curl: e.curl_version, gzip: e.gzip_enabled, mbstring: e.mbstring_enabled,
      remotePost: e.remote_post_successful, remoteGet: e.remote_get_successful, hposEnabled: s.settings?.HPOS_enabled ?? s.settings?.hpos_enabled, hposSync: s.settings?.HPOS_sync_enabled,
      dbSizeMB: d.database_size ? { data: Math.round(d.database_size.data), index: Math.round(d.database_size.index) } : null, dbPrefix: d.database_prefix, biggestTables: tables,
      dropins: (s.dropins_mu_plugins?.dropins || []).map(x => x.plugin || x.name), muPlugins: (s.dropins_mu_plugins?.mu_plugins || []).map(x => x.name),
      inactivePlugins: (s.inactive_plugins || []).map(p => `${p.name} ${p.version}`), activePluginCount: (s.active_plugins || []).length,
      outdatedPlugins: (s.active_plugins || []).filter(p => p.version_latest && p.version_latest !== p.version).map(p => `${p.name} ${p.version} → ${p.version_latest}`),
      pluginsNetworkActivated: undefined, theme: s.theme ? { name: s.theme.name, version: s.theme.version, latest: s.theme.version_latest, overrides: (s.theme.overrides || []).length, outdatedTemplates: s.theme.has_outdated_templates } : null,
      wcLogs: s.logging?.logs ? Object.keys(s.logging.logs).length : undefined,
      postTypeCounts: (s.post_type_counts || []).map(x => `${x.type}:${x.count}`),
    };
  } catch (e) { out.server = { error: String(e.message || e).slice(0, 200) }; }
}

writeFileSync('web-lock-perf.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
