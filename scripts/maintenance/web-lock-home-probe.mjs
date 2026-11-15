// Đọc (chỉ đọc) popup trang chủ và các hàng thẻ sản phẩm còn lệch nút trên điện thoại.
import { chromium } from 'playwright';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch();
const m = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const p = await m.newPage();
const t0 = Date.now(); let seen = null;
await p.goto(SITE + '/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
for (let i = 0; i < 60 && !seen; i++) { if (await p.evaluate(() => !!document.querySelector('.mfp-wrap.mfp-ready, .mfp-wrap'))) seen = Date.now() - t0; else await p.waitForTimeout(250); }
console.log('POPUP hiện sau ' + seen + 'ms kể từ lúc mở trang');
for (const l of await p.evaluate(() => { const out = []; const w = document.querySelector('.mfp-wrap'); if (w) { out.push('mfp-wrap class=' + w.className); const c = w.querySelector('.mfp-content'); if (c) out.push('nội dung: ' + [...c.children].map(k => k.tagName.toLowerCase() + '#' + k.id + '.' + String(k.className).slice(0, 80)).join(' ; ') + ' | ' + c.innerHTML.replace(/\s+/g, ' ').slice(0, 500)); }
  for (const s of document.scripts) { const t = s.textContent || ''; if (/lightbox|magnificPopup|mfp|popup/i.test(t) && t.length < 6000 && !/lnl-|claw/i.test(s.id || '')) out.push('SCRIPT(' + t.length + ') ' + t.replace(/\s+/g, ' ').slice(0, 1400)); }
  out.push('COOKIE ' + document.cookie.split(';').map(x => x.trim().split('=')[0]).join(','));
  return out; })) console.log('PP| ' + l);
await p.keyboard.press('Escape').catch(() => {}); await p.evaluate(() => { const c = document.querySelector('.mfp-close'); if (c) c.click(); }); await p.waitForTimeout(600);
console.log('COOKIE sau khi đóng: ' + await p.evaluate(() => document.cookie.split(';').map(x => x.trim().split('=')[0]).join(',')));
await p.evaluate(async () => { for (let y = 0; y < 13000; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); }); await p.waitForTimeout(1500);
for (const l of await p.evaluate(() => { const out = []; const rows = {}; for (const b of document.querySelectorAll('.product-small.box .add-to-cart-button')) { const r = b.getBoundingClientRect(); if (!r.width) continue; const col = b.closest('.col'); const key = Math.round((col.getBoundingClientRect().top + scrollY) / 10); (rows[key] = rows[key] || []).push(b); }
  for (const k in rows) { const tops = rows[k].map(b => Math.round(b.getBoundingClientRect().top + scrollY)); if (rows[k].length < 2 || Math.max(...tops) - Math.min(...tops) <= 3) continue; out.push('HÀNG y≈' + k * 10 + ' nút ở ' + tops.join(',') + ' | cha=' + String(rows[k][0].closest('.col').parentElement.className).slice(0, 60));
    for (const b of rows[k].slice(0, 4)) { const bt = b.closest('.box-text'); out.push('   thẻ: ' + [...bt.children].map(c => (c.className ? String(c.className).split(' ')[0] : c.tagName.toLowerCase()) + ':' + Math.round(c.getBoundingClientRect().height) + (c.getAttribute('style') ? '[' + c.getAttribute('style').slice(0, 22) + ']' : '')).join(' | ') + ' || box-text=' + Math.round(bt.getBoundingClientRect().height) + ' ' + (bt.getAttribute('style') || '').slice(0, 24) + ' || giá: ' + [...bt.querySelectorAll('.price-wrapper > *')].map(c => (String(c.className).split(' ')[0] || c.tagName.toLowerCase()) + ':' + Math.round(c.getBoundingClientRect().height)).join(',')); } }
  return out; })) console.log('TH| ' + l);
await browser.close();
