// Xem trước thanh mua dính đáy và các nút nổi ở trang sản phẩm (chỉ đọc; CSS_FROM thì áp thử CSS trong trình duyệt, không đổi web).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const pick = async t => { const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=${t}&per_page=3&stock_status=instock`)).json(); return (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink; };
const simple = await pick('simple'), variable = await pick('variable');
let css = ''; if (process.env.CSS_FROM) { const m = /<<<'CSS'\n([\s\S]*?)\nCSS;/.exec(readFileSync(process.env.CSS_FROM, 'utf8')); if (!m) { console.log('Không thấy khối CSS'); process.exit(1); } css = m[1]; }
let js = ''; if (process.env.CSS_FROM) { const m = /<<<'JS'\n([\s\S]*?)\nJS;/.exec(readFileSync(process.env.CSS_FROM, 'utf8')); if (m) js = m[1]; }
const browser = await chromium.launch();
async function shot(page, name) { const b64 = (await page.screenshot({ type: 'jpeg', quality: 60 })).toString('base64'); console.log(`IMGSTART ${name}`); for (let i = 0; i < b64.length; i += 3000) console.log('IMG ' + name + ' ' + b64.slice(i, i + 3000)); console.log(`IMGEND ${name}`); }
async function run(tag, url, opts, y) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(3000);
  await page.evaluate(async yy => { for (let k = 0; k <= yy; k += 200) { scrollTo(0, k); await new Promise(r => setTimeout(r, 120)); } }, y); await page.waitForTimeout(1500);
  if (process.env.OUTLINE === '1') { const st = await page.evaluate(() => [...document.querySelectorAll('.sticky-add-to-cart-wrapper, .sticky-add-to-cart')].map(e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return e.className + ' | pos=' + c.position + ' ' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' children=' + [...e.querySelectorAll('form.cart > *, .sticky-add-to-cart__product > *')].map(k => k.tagName.toLowerCase() + '.' + String(k.className).split(' ').slice(0, 3).join('.') + (k.name ? '[' + k.name + ']' : '')).join(' ; ').slice(0, 900); })); for (const r of st) console.log(`STK ${tag}| ${r}`); console.log(`FORMS ${tag}| ` + await page.evaluate(() => document.querySelectorAll('form.cart').length)); }
  if (process.env.OUTLINE === '1') {
    const out = await page.evaluate(() => { const rows = []; for (const e of document.querySelectorAll('body *')) { const s = getComputedStyle(e); if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden') continue; const r = e.getBoundingClientRect(); if (r.width < 20 || r.height < 20) continue; rows.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).trim().split(/\s+/).slice(0, 4).join('.')} | ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} z=${s.zIndex}`); } const st = document.querySelector('.sticky-add-to-cart'); if (st)  return rows; });
    for (const r of out) console.log(`FIX ${tag}| ${r}`);
  }
  await shot(page, 'truoc-' + tag);
  if (css) { await page.addStyleTag({ content: css }); await page.waitForTimeout(1200); await shot(page, 'sau-' + tag); }
  if (js && tag === 'm-simple') {
    await page.addScriptTag({ content: js }); const u0 = page.url(); let navs = 0; page.on('framenavigated', f => { if (f === page.mainFrame()) navs++; });
    const resp = page.waitForResponse(r => /wc-ajax=lnl_add_to_cart/.test(r.url()), { timeout: 25_000 }).catch(() => null);
    const t0 = Date.now(); await page.locator('.sticky-add-to-cart--active .single_add_to_cart_button').click({ noWaitAfter: true }); const r = await resp; await page.waitForTimeout(2000);
    const body = r ? await r.json().catch(() => null) : null;
    console.log(`THỬ NÚT THANH DÍNH: yêu cầu AJAX=${r ? r.status() : 'không có'} sau ${Date.now() - t0}ms; success=${body && body.success}; tải lại trang=${navs > 0 || page.url() !== u0}; số trong giỏ=` + await page.evaluate(() => (document.querySelector('.cart-icon strong, .header-cart-link .cart-icon strong, [data-icon-label]') || {}).textContent || (document.querySelector('[data-icon-label]') || { getAttribute() {} }).getAttribute('data-icon-label')));
  }
  await ctx.close();
}
const M = { userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
await run('m-simple', simple, M, 1400);
if (variable) await run('m-var', variable, M, 1400);
await run('d-simple', simple, { viewport: { width: 1366, height: 800 } }, 0);
await browser.close();
