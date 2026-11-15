// Đọc (chỉ đọc) popup trang chủ và các hàng thẻ sản phẩm còn lệch nút trên điện thoại.
import { chromium } from 'playwright';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch();
const m = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const p = await m.newPage();
const t0 = Date.now();
await p.goto(SITE + '/', { waitUntil: 'load', timeout: 60_000 });
const find = () => p.evaluate(() => { const out = []; for (const e of document.querySelectorAll('body *')) { const s = getComputedStyle(e); if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue; const r = e.getBoundingClientRect(); if (r.width * r.height < 0.35 * innerWidth * innerHeight) continue; out.push(e.tagName.toLowerCase() + '#' + e.id + '.' + String(e.className).slice(0, 80) + ' z=' + s.zIndex + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' || ' + e.outerHTML.replace(/\s+/g, ' ').replace(/srcset="[^"]*"/g, '').slice(0, 700)); } return out; });
let found = [], at = null;
for (let i = 0; i < 80 && !found.length; i++) { found = await find(); if (found.length) at = Date.now() - t0; else { if (i === 20) await p.evaluate(() => scrollTo(0, 300)); await p.waitForTimeout(250); } }
console.log('POPUP hiện sau ' + at + 'ms kể từ lúc mở trang');
for (const l of found) console.log('PP| ' + l);
const ids = await p.evaluate(() => { const out = []; for (const e of document.querySelectorAll('body *')) { const s = getComputedStyle(e); if (s.position === 'fixed' && e.getBoundingClientRect().width * e.getBoundingClientRect().height >= 0.35 * innerWidth * innerHeight && s.display !== 'none') { if (e.id) out.push(e.id); for (const c of String(e.className).split(/\s+/)) if (c.length > 4) out.push(c); } } return out.slice(0, 8); });
for (const l of await p.evaluate((ids) => { const out = []; for (const s of document.scripts) { const t = s.textContent || ''; if (t.length < 20000 && ids.some(i => t.includes(i))) out.push('SCRIPT id=' + s.id + ' (' + t.length + ') ' + t.replace(/\s+/g, ' ').slice(0, 2500)); } out.push('localStorage: ' + Object.keys(localStorage).join(',')); out.push('sessionStorage: ' + Object.keys(sessionStorage).join(',')); out.push('cookie: ' + document.cookie.split(';').map(x => x.trim().split('=')[0]).join(',')); return out; }, ids)) console.log('PP| ' + l);
await p.evaluate(async () => { for (let y = 0; y < 13000; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); }); await p.waitForTimeout(1500);
for (const l of await p.evaluate(() => { const out = []; const rows = {}; for (const b of document.querySelectorAll('.product-small.box .add-to-cart-button')) { const r = b.getBoundingClientRect(); if (!r.width) continue; const col = b.closest('.col'); const key = Math.round((col.getBoundingClientRect().top + scrollY) / 10); (rows[key] = rows[key] || []).push(b); }
  for (const k in rows) { const tops = rows[k].map(b => Math.round(b.getBoundingClientRect().top + scrollY)); if (rows[k].length < 2 || Math.max(...tops) - Math.min(...tops) <= 3) continue; out.push('HÀNG y≈' + k * 10 + ' nút ở ' + tops.join(',') + ' | cha=' + String(rows[k][0].closest('.col').parentElement.className).slice(0, 60));
    for (const b of rows[k].slice(0, 4)) { const bt = b.closest('.box-text'); out.push('   thẻ: ' + [...bt.children].map(c => (c.className ? String(c.className).split(' ')[0] : c.tagName.toLowerCase()) + ':' + Math.round(c.getBoundingClientRect().height) + (c.getAttribute('style') ? '[' + c.getAttribute('style').slice(0, 22) + ']' : '')).join(' | ') + ' || box-text=' + Math.round(bt.getBoundingClientRect().height) + ' ' + (bt.getAttribute('style') || '').slice(0, 24) + ' || giá: ' + [...bt.querySelectorAll('.price-wrapper > *')].map(c => (String(c.className).split(' ')[0] || c.tagName.toLowerCase()) + ':' + Math.round(c.getBoundingClientRect().height)).join(',')); } }
  return out; })) console.log('TH| ' + l);
await browser.close();
