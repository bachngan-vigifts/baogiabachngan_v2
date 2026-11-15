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
  let shown = 0;
  for (const k in rows) { const tops = rows[k].map(b => Math.round(b.getBoundingClientRect().top + scrollY)); const mx = Math.max(...tops), mn = Math.min(...tops); if (rows[k].length < 2 || mx - mn <= 3 || shown >= 2) continue; shown++;
    const pick = [rows[k][tops.indexOf(mn)], rows[k][tops.indexOf(mx)]];
    for (const b of pick) { const bt = b.closest('.box-text'), box = bt.parentElement, ci = box.parentElement, col = ci.parentElement; const Y = e => Math.round((e.getBoundingClientRect().top + scrollY) * 10) / 10; const cs = getComputedStyle(bt);
      out.push(`THẺ nút y=${Y(b)} | col y=${Y(col)} pt=${getComputedStyle(col).paddingTop} cls=${String(col.className).slice(0, 90)}`);
      out.push(`   col-inner y=${Y(ci)} con=${[...ci.children].map(c => c.tagName.toLowerCase() + '.' + String(c.className).split(' ')[0] + '@' + Y(c) + ':' + Math.round(c.getBoundingClientRect().height)).join(' ')}`);
      out.push(`   box y=${Y(box)} con=${[...box.children].map(c => String(c.className).split(' ')[0] + '@' + Y(c) + ':' + c.getBoundingClientRect().height.toFixed(1)).join(' ')}`);
      out.push(`   box-text h=${bt.getBoundingClientRect().height.toFixed(1)} style="${bt.getAttribute('style')}" pad=${cs.paddingTop}/${cs.paddingBottom} sizing=${cs.boxSizing} display=${cs.display} wrap=${cs.flexWrap} dir=${cs.flexDirection} align=${cs.alignContent}/${cs.alignItems} gap=${cs.rowGap}`);
      for (const c of bt.children) { const s = getComputedStyle(c); out.push(`      ${(String(c.className).split(' ')[0] || c.tagName.toLowerCase()).padEnd(26)} y=${Y(c)} h=${c.getBoundingClientRect().height.toFixed(1)} m=${s.marginTop}/${s.marginBottom} p=${s.paddingTop}/${s.paddingBottom} pos=${s.position} disp=${s.display} flex=${s.flex}`); } } }
  return out; })) console.log('TH| ' + l);
await browser.close();
