// Xem trước thanh mua dính đáy và các nút nổi ở trang sản phẩm (chỉ đọc; CSS_FROM thì áp thử CSS trong trình duyệt, không đổi web).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const pick = async t => { const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=${t}&per_page=3&stock_status=instock`)).json(); return (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink; };
const simple = await pick('simple'), variable = await pick('variable');
let css = ''; if (process.env.CSS_FROM) { const m = /<<<'CSS'\n([\s\S]*?)\nCSS;/.exec(readFileSync(process.env.CSS_FROM, 'utf8')); if (!m) { console.log('Không thấy khối CSS'); process.exit(1); } css = m[1]; }
const browser = await chromium.launch();
async function shot(page, name) { const b64 = (await page.screenshot({ type: 'jpeg', quality: 60 })).toString('base64'); console.log(`IMGSTART ${name}`); for (let i = 0; i < b64.length; i += 3000) console.log('IMG ' + name + ' ' + b64.slice(i, i + 3000)); console.log(`IMGEND ${name}`); }
async function run(tag, url, opts, y) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(3000);
  await page.evaluate(yy => scrollTo(0, yy), y); await page.waitForTimeout(1500);
  if (process.env.OUTLINE === '1') {
    const out = await page.evaluate(() => { const rows = []; for (const e of document.querySelectorAll('body *')) { const s = getComputedStyle(e); if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden') continue; const r = e.getBoundingClientRect(); if (r.width < 20 || r.height < 20) continue; rows.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).trim().split(/\s+/).slice(0, 4).join('.')} | ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} z=${s.zIndex}`); } const st = document.querySelector('.sticky-add-to-cart'); if (st) rows.push('STICKY ' + st.outerHTML.replace(/\s+/g, ' ').slice(0, 2500)); return rows; });
    for (const r of out) console.log(`FIX ${tag}| ${r}`);
  }
  await shot(page, 'truoc-' + tag);
  if (css) { await page.addStyleTag({ content: css }); await page.waitForTimeout(1200); await shot(page, 'sau-' + tag); }
  await ctx.close();
}
const M = { userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
await run('m-simple', simple, M, 1400);
if (variable) await run('m-var', variable, M, 1400);
await run('d-simple', simple, { viewport: { width: 1366, height: 800 } }, 0);
await browser.close();
