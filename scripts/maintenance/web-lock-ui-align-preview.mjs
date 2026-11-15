// Xem trước căn thẻ sản phẩm (điện thoại) và nút nổi trên máy tính. Chỉ đọc; CSS_FROM thì áp thử trong trình duyệt, không đổi web. LIVE=1: chỉ chụp web thật.
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink;
let css = ''; if (process.env.CSS_FROM && existsSync(process.env.CSS_FROM)) { const m = /<<<'CSS'\n([\s\S]*?)\nCSS;/.exec(readFileSync(process.env.CSS_FROM, 'utf8')); if (m) css = m[1]; }
const browser = await chromium.launch();
async function shot(page, name, clip) { const b64 = (await page.screenshot({ type: 'jpeg', quality: 60, ...(clip ? { fullPage: true, clip } : {}) })).toString('base64'); console.log('IMGSTART ' + name); for (let i = 0; i < b64.length; i += 3000) console.log('IMG ' + name + ' ' + b64.slice(i, i + 3000)); console.log('IMGEND ' + name); }
const m = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const p = await m.newPage();
await p.goto(SITE + '/', { waitUntil: 'load', timeout: 60_000 }); await p.waitForTimeout(2500);
await p.keyboard.press('Escape').catch(() => {}); await p.evaluate(() => { const c = document.querySelector('.mfp-close'); if (c) c.click(); }); await p.waitForTimeout(600);
await p.evaluate(async () => { for (let y = 0; y < 6000; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } scrollTo(0, 0); }); await p.waitForTimeout(1500);
const stat = () => p.evaluate(() => { const rows = {}; for (const b of document.querySelectorAll('.product-small.box .add-to-cart-button')) { const r = b.getBoundingClientRect(); if (!r.width) continue; const col = b.closest('.col'); const key = Math.round((col.getBoundingClientRect().top + scrollY) / 10); (rows[key] = rows[key] || []).push(Math.round(r.top + scrollY)); } let bad = 0, n = 0; for (const k in rows) { if (rows[k].length < 2) continue; n++; if (Math.max(...rows[k]) - Math.min(...rows[k]) > 3) bad++; } return `hàng thẻ có nút lệch nhau: ${bad}/${n}`; });
console.log('TRƯỚC ' + await stat());
const A = { x: 0, y: 1280, width: 390, height: 520 }, B = { x: 0, y: 3900, width: 390, height: 900 };
await shot(p, 'a-truoc', A); await shot(p, 'b-truoc', B);
if (css) { await p.addStyleTag({ content: css }); await p.waitForTimeout(1200); console.log('SAU ' + await stat()); await shot(p, 'a-sau', A); await shot(p, 'b-sau', B); console.log('Tràn ngang: ' + await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)); }
await m.close();
const d = await browser.newContext({ viewport: { width: 1366, height: 800 } }); const q = await d.newPage();
await q.goto(simple, { waitUntil: 'load', timeout: 60_000 }); await q.waitForTimeout(3000);
await shot(q, 'd-truoc'); if (css) { await q.addStyleTag({ content: css }); await q.waitForTimeout(800); await shot(q, 'd-sau'); }
await browser.close();
