// CHẨN ĐOÁN CHỈ ĐỌC: ghi mọi request của trang sản phẩm biến thể trên điện thoại giả lập (khách, giỏ tạm, không đặt đơn).
// Pha: mở trang -> chọn biến thể -> đổi số lượng -> bấm Thêm vào giỏ (luồng A) hoặc Mua ngay (luồng B) -> chờ giao diện ổn định.
// Ghi: endpoint, action, method, script khởi tạo (CDP initiator), thời điểm, thời gian chờ (TTFB) tách DNS/kết nối/TLS/chờ máy chủ.
// Che: nonce, cookie, mã khách, client id, dữ liệu người dùng. Không in body đầy đủ; chỉ khóa và giá trị kỹ thuật.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const SITE = 'https://locknlockonline.com', HOST = 'locknlockonline.com';
const PRODUCT = process.env.PRODUCT || '/san-pham/binh-giu-nhiet-locknlock-freeflow-lhc4466-lhc4467/';
const RUNS = Number(process.env.RUNS || 3);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const h8 = s => createHash('sha256').update(String(s)).digest('hex').slice(0, 8);
const SAFE_KEYS = new Set(['action', 'method', 'product_id', 'variation_id', 'quantity', 'add-to-cart', 'lnl_buy', 'wc-ajax', 'payment_method', 'shipping_method[0]', 'has_full_address', 'time', 'en', 'ev', 'tid', 'v']);
function redactBody(body) {
  if (!body) return '';
  if (body.length > 4000) return `(${body.length}B)`;
  try { const p = new URLSearchParams(body); const out = []; for (const [k, v] of p) out.push(SAFE_KEYS.has(k) || /^attribute_/.test(k) ? `${k}=${v.slice(0, 40)}` : `${k}=*`); return out.join('&').slice(0, 260); } catch { return `(${body.length}B)`; }
}
function classify(u) {
  const url = new URL(u);
  if (url.hostname === HOST || url.hostname.endsWith('.' + HOST)) {
    if (url.pathname.startsWith('/cdn-cgi/')) return 'cloudflare';
    if (/\.(css|js|png|jpe?g|webp|gif|svg|woff2?|ico|avif)$/i.test(url.pathname)) return 'tĩnh';
    if (url.searchParams.get('wc-ajax')) return 'WP wc-ajax';
    if (url.pathname.includes('admin-ajax')) return 'WP admin-ajax';
    if (url.pathname.startsWith('/wp-json')) return 'WP REST';
    return 'WP trang';
  }
  return 'NGOÀI ' + url.hostname;
}
function ident(u, body) {
  const url = new URL(u); let a = url.searchParams.get('wc-ajax') || url.searchParams.get('action') || '';
  if (!a && body) { try { const p = new URLSearchParams(body); a = p.get('action') || ''; if (p.get('method')) a += ':' + p.get('method'); } catch {} }
  if (url.hostname === HOST) return (url.pathname.replace(/\/san-pham\/[^/]+/, '/san-pham/X') + (a ? ' [' + a + ']' : '')).slice(0, 110);
  const ev = url.searchParams.get('en') || url.searchParams.get('ev') || '';
  return (url.hostname + url.pathname).slice(0, 70) + (ev ? ' ev=' + ev : '');
}
function events(u, body) { // tên sự kiện GA4 / Meta / Google Ads (không in id khách)
  const url = new URL(u); const out = [];
  if (/\/g\/collect/.test(url.pathname) || /google-analytics|analytics\.google/.test(url.hostname)) {
    const tid = url.searchParams.get('tid') || '';
    const lines = [url.search, ...(body || '').split('\n')];
    for (const l of lines) { const m = /(?:^|[?&])en=([^&]+)/.exec(l); if (m) out.push(`GA4 ${tid} ${decodeURIComponent(m[1])}`); }
  } else if (/facebook\.com$/.test(url.hostname) && url.pathname === '/tr/') { out.push(`META ${url.searchParams.get('id') || ''} ${url.searchParams.get('ev') || ''}`); }
  else if (/googleadservices|doubleclick|google\.com/.test(url.hostname) && /conversion|pagead|ccm/.test(url.pathname)) { const m = /\/(AW-)?(\d{6,})/.exec(url.pathname); out.push(`ADS ${m ? 'AW-' + m[2] : ''} ${url.pathname.split('/').slice(0, 3).join('/')}`); }
  return out;
}

function safeUrl(u) { try { const x = new URL(u); const q = []; for (const [k, v] of x.searchParams) q.push(SAFE_KEYS.has(k) || /^attribute_/.test(k) ? `${k}=${v.slice(0, 30)}` : `${k}=*`); return x.origin + x.pathname + (q.length ? '?' + q.join('&') : ''); } catch { return '?'; } }
const browser = await chromium.launch();
const all = [];
async function session(flow, run, strip) {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  // strip=true: bỏ đoạn gộp lệnh lnl-wdr-dedupe khỏi HTML CHỈ trong trình duyệt thử, để thấy hành vi gốc của Woo Discount Rules. Không đổi gì trên máy chủ.
  if (strip) await page.route(u => u.href.startsWith(SITE + PRODUCT), async route => { const r = await route.fetch(); let t = await r.text(); const had = t.includes('id="lnl-wdr-dedupe"'); t = t.replace(/<script id="lnl-wdr-dedupe">[\s\S]*?<\/script>/, ''); await route.fulfill({ response: r, body: t, headers: Object.fromEntries(Object.entries({ ...r.headers(), 'x-diag-stripped': String(had) }).filter(([k]) => !/^(content-encoding|content-length|transfer-encoding)$/i.test(k))) }); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Performance.enable');
  const reqs = new Map(); let phase = 'mở trang'; const T0 = Date.now(); const startedAt = new Date().toISOString(); let wall0 = null;
  cdp.on('Network.requestWillBeSent', e => {
    if (e.request.url.startsWith('data:')) return;
    if (wall0 === null) wall0 = e.timestamp;
    const st = (e.initiator && e.initiator.stack && e.initiator.stack.callFrames) || [];
    let parent = e.initiator && e.initiator.stack; const frames = [...st];
    while (frames.length < 6 && parent && parent.parent) { parent = parent.parent; frames.push(...(parent.callFrames || [])); }
    const ini = frames.filter(f => !/jquery(\.min)?\.js/i.test(f.url)).slice(0, 3).map(f => `${(f.functionName || '(ẩn danh)').slice(0, 30)}@${f.url.replace(SITE, '').replace(/\?.*/, '').split('/').slice(-3).join('/')}:${f.lineNumber + 1}`);
    const jq = frames.some(f => /jquery/i.test(f.url));
    reqs.set(e.requestId, { id: e.requestId, flow, run, phase, method: e.request.method, url: safeUrl(e.request.url), cls: classify(e.request.url), what: ident(e.request.url, e.request.postData), body: redactBody(e.request.postData), bodyHash: e.request.postData ? h8(e.request.postData) : '', t: Math.round((e.timestamp - wall0) * 1000), ts: e.wallTime, ini: (e.initiator.type === 'parser' ? 'HTML:' + String(e.initiator.url || '').replace(SITE, '').slice(0, 50) : ini.join(' < ') || e.initiator.type) + (jq ? ' (qua jQuery)' : ''), redirect: e.redirectResponse ? e.redirectResponse.status : '', ev: events(e.request.url, e.request.postData) });
  });
  cdp.on('Network.responseReceived', e => { const r = reqs.get(e.requestId); if (!r) return; r.status = e.response.status; const tm = e.response.timing; if (tm) { r.dns = Math.max(0, Math.round(tm.dnsEnd - tm.dnsStart)); r.conn = Math.max(0, Math.round(tm.connectEnd - tm.connectStart)); r.tls = Math.max(0, Math.round(tm.sslEnd - tm.sslStart)); r.wait = Math.round(tm.receiveHeadersEnd - tm.sendEnd); r.queue = Math.round(tm.sendStart >= 0 ? tm.sendStart : 0); } const hd = e.response.headers || {}; r.cf = hd['cf-cache-status'] || hd['CF-Cache-Status'] || ''; r.ls = hd['x-litespeed-cache'] || ''; r.proto = e.response.protocol; });
  cdp.on('Network.loadingFinished', e => { const r = reqs.get(e.requestId); if (r) { r.end = Math.round((e.timestamp - wall0) * 1000); r.size = e.encodedDataLength; } });
  cdp.on('Network.loadingFailed', e => { const r = reqs.get(e.requestId); if (r) { r.fail = e.errorText + (e.canceled ? ' (huỷ)' : ''); r.end = Math.round((e.timestamp - wall0) * 1000); } });
  const bodies = {}; // so sánh phản hồi wdr: chỉ băm + độ dài
  page.on('response', async res => { try { const rq = res.request(); const pd = rq.postData() || ''; if (/wdr_ajax/.test(pd)) { const t = await res.text(); (bodies[rq.url() + '|' + h8(pd)] ||= []).push({ len: t.length, h: h8(t), vid: (/product_id=(\d+)/.exec(pd) || [])[1] }); } } catch {} });
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  const mark = {}; const setPhase = p => { phase = p; mark[p] = Date.now() - T0; };
  const settle = async (ms = 6000) => { let last = Date.now(); const on = () => { last = Date.now(); }; page.on('request', on); const stop = Date.now() + 45000; while (Date.now() - last < ms && Date.now() < stop) await page.waitForTimeout(250); page.off('request', on); };
  try {
    await page.goto(SITE + PRODUCT, { waitUntil: 'load', timeout: 90000 }); mark['tải xong'] = Date.now() - T0;
    await page.evaluate(() => { const c = document.querySelector('.mltv-popup__close'); if (c) c.click(); });
    await settle(5000);
    // jQuery listeners trên form biến thể / nút: nguồn gốc (đoạn đầu hàm), không chạy gì
    const listeners = await page.evaluate(() => {
      const $ = window.jQuery; if (!$ || !$._data) return ['không có jQuery._data'];
      const out = []; const targets = [['form.variations_form', document.querySelector('form.variations_form')], ['form.cart', document.querySelector('form.cart')], ['document.body', document.body], ['document', document]];
      for (const [n, el] of targets) { if (!el) continue; const ev = $._data(el, 'events') || {}; for (const k of Object.keys(ev)) { if (!/variation|found|show_|reset|check|change|submit|click|added_to_cart|update|wc_|quantity|input/i.test(k)) continue; for (const h of ev[k]) out.push(`${n} ${k}${h.namespace ? '.' + h.namespace : ''}${h.selector ? ' [' + h.selector + ']' : ''}: ${String(h.handler).replace(/\s+/g, ' ').slice(0, 110)}`); } }
      return out;
    });
    const form = page.locator('form.variations_form').first(); const isVar = await form.count();
    setPhase('chọn biến thể');
    if (isVar) {
      await page.evaluate(() => { const f = document.querySelector('form.variations_form'); let vs = []; try { vs = JSON.parse(f.getAttribute('data-product_variations') || '[]'); } catch {} const v = vs.find(x => x.is_in_stock && x.is_purchasable); if (!v) return; for (const k in v.attributes) { const s = f.querySelector('select[name="' + k + '"]'); if (s && v.attributes[k]) jQuery(s).val(v.attributes[k]).trigger('change'); } });
      await page.waitForFunction(() => +(document.querySelector('form.variations_form input[name="variation_id"]') || {}).value > 0, null, { timeout: 15000 }).catch(() => {});
    }
    await settle(5000);
    setPhase('đổi số lượng');
    await page.evaluate(() => { const q = document.querySelector('form.cart input.qty'); if (q) { q.value = '2'; q.dispatchEvent(new Event('input', { bubbles: true })); q.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(q).trigger('change'); } });
    await settle(5000);
    setPhase(flow === 'A' ? 'bấm thêm giỏ' : 'bấm mua ngay');
    const btn = flow === 'A' ? page.locator('form.cart .single_add_to_cart_button').first() : page.locator('form.cart button[name="ux-buy-now"]').first();
    await btn.scrollIntoViewIfNeeded(); const tClick = Date.now(); await btn.tap({ noWaitAfter: true });
    if (flow === 'B') await page.waitForURL(/thanh-toan/, { timeout: 60000, waitUntil: 'commit' }).catch(() => {});
    await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
    await settle(6000); mark['ổn định sau bấm (ms)'] = Date.now() - tClick - 6000;
    const cart = await page.evaluate(async () => { try { const j = await (await fetch('/wp-json/wc/store/v1/cart', { credentials: 'same-origin' })).json(); return { n: j.items_count, items: (j.items || []).map(i => ({ q: i.quantity, line: i.totals && i.totals.line_total, unit: i.prices && i.prices.price })), total: j.totals && j.totals.total_price }; } catch (e) { return '?'; } });
    const domPrice = await page.evaluate(() => { const el = document.querySelector('.order-total .amount, .woocommerce-checkout-review-order-table .order-total bdi'); return el ? el.textContent.trim() : ''; });
    const perf = await cdp.send('Performance.getMetrics'); const pm = Object.fromEntries(perf.metrics.map(m => [m.name, m.value]));
    const res = await page.evaluate(() => { const by = {}; for (const e of performance.getEntriesByType('resource')) { let h; try { h = new URL(e.name).hostname; } catch { h = '?'; } const o = by[h] ||= { n: 0, kb: 0 }; o.n++; o.kb += (e.transferSize || 0) / 1024; } return by; });
    all.push({ flow: flow + (strip ? '' : '+gộp'), run, startedAt, endedAt: new Date().toISOString(), mark, listeners, list: [...reqs.values()], bodies, errs, cart, domPrice, url: page.url().replace(SITE, '').replace(/\?.*/, ''), script: { ScriptDuration: pm.ScriptDuration, TaskDuration: pm.TaskDuration, LayoutDuration: pm.LayoutDuration, JSHeapUsedMB: Math.round(pm.JSHeapUsedSize / 1048576) }, res });
  } catch (e) { all.push({ flow: flow + (strip ? '' : '+gộp'), run, error: String(e.message).slice(0, 200), list: [...reqs.values()] }); }
  await ctx.close();
}
for (let r = 1; r <= RUNS; r++) { await session('A', r, true); await session('B', r, true); await session('A', r, false); }
await browser.close();
writeFileSync('trace.json', JSON.stringify(all));
console.log('ghi trace.json: ' + all.length + ' phiên');
