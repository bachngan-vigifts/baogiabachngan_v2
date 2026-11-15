// Đọc cấu trúc khối giá và thẻ sản phẩm (chỉ đọc). CSS_FROM: áp thử CSS trong trình duyệt và chụp trước/sau, không đổi web.
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const v = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=variable&per_page=3&stock_status=instock`)).json();
const variable = (Array.isArray(v) ? v : []).find(x => x.permalink)?.permalink;
let css = ''; if (process.env.CSS_FROM && existsSync(process.env.CSS_FROM)) { const m = /<<<'CSS'\n([\s\S]*?)\nCSS;/.exec(readFileSync(process.env.CSS_FROM, 'utf8')); if (m) css = m[1]; }
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
async function shot(name, clip) { const b64 = (await page.screenshot({ type: 'jpeg', quality: 65, fullPage: true, clip })).toString('base64'); console.log('IMGSTART ' + name); for (let i = 0; i < b64.length; i += 3000) console.log('IMG ' + name + ' ' + b64.slice(i, i + 3000)); console.log('IMGEND ' + name); }
const desc = () => page.evaluate(() => { const out = []; const cs = (e) => { const s = getComputedStyle(e); return `display=${s.display} dir=${s.flexDirection} wrap=${s.flexWrap} order=${s.order} float=${s.float}`; };
  const p = document.querySelector('.product-main .price-wrapper .price, .product-info .price'); if (p) { out.push('GIÁ TRANG SP: ' + p.outerHTML.replace(/\s+/g, ' ').slice(0, 700)); out.push('  cha: ' + p.parentElement.className + ' | ' + cs(p)); for (const k of p.children) out.push('  con <' + k.tagName.toLowerCase() + ' class="' + k.className + '"> ' + cs(k) + ' text=' + k.textContent.trim().slice(0, 30)); }
  return out; });
await page.goto(variable, { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(2500);
for (const l of await desc()) console.log('DOM| ' + l);
const box = await page.evaluate(() => { const p = document.querySelector('.product-main .price-wrapper, .product-info .price-wrapper'); const r = p.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y + scrollY - 20), width: 390, height: r.height + 40 }; });
await shot('gia-truoc', box);
if (css) { await page.addStyleTag({ content: css }); await page.waitForTimeout(600); await shot('gia-sau', box); }
// Trang chủ: thẻ sản phẩm
await page.goto(SITE + '/', { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(2500);
await page.evaluate(() => { for (const e of document.querySelectorAll('.mfp-close, .mfp-bg')) e.click && e.click(); });
await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(800);
const cards = await page.evaluate(() => { const out = []; const cs = (e) => { const s = getComputedStyle(e); return `display=${s.display} dir=${s.flexDirection} h=${Math.round(e.getBoundingClientRect().height)}`; };
  const all = [...document.querySelectorAll('.product-small.col')]; const withRange = all.find(c => /–|-/.test((c.querySelector('.price') || {}).textContent || '') && c.querySelectorAll('.price .amount').length >= 2 && !c.querySelector('.price del')) || all[0];
  if (withRange) { out.push('THẺ: ' + withRange.outerHTML.replace(/\s+/g, ' ').replace(/data-srcset="[^"]*"|srcset="[^"]*"|sizes="[^"]*"|src="data:[^"]*"/g, '').slice(0, 2600)); let e = withRange.querySelector('.price'); for (let i = 0; e && i < 6 && e !== withRange.parentElement; i++, e = e.parentElement) out.push('  ' + e.tagName.toLowerCase() + '.' + String(e.className).split(' ').slice(0, 4).join('.') + ' | ' + cs(e)); const p = withRange.querySelector('.price'); if (p) for (const k of p.children) { const s = getComputedStyle(k); out.push('  giá-con <' + k.tagName.toLowerCase() + ' class="' + k.className + '"> display=' + s.display + ' order=' + s.order + ' text=' + k.textContent.trim().slice(0, 24)); } }
  const row = withRange && withRange.closest('.row, .slider, .flickity-slider'); if (row) out.push('  hàng: ' + row.tagName.toLowerCase() + '.' + String(row.className).split(' ').slice(0, 6).join('.') + ' | ' + cs(row));
  const r = withRange ? withRange.getBoundingClientRect() : null; out.push('VỊ TRÍ ' + (r ? Math.round(r.y + scrollY) : -1)); return out; });
for (const l of cards) console.log('DOM| ' + l);
const y = Number((cards.find(l => l.startsWith('VỊ TRÍ')) || 'VỊ TRÍ 0').split(' ').pop()) || 0;
await shot('the-truoc', { x: 0, y: Math.max(0, y - 30), width: 390, height: 520 });
if (css) { await page.addStyleTag({ content: css }); await page.waitForTimeout(800); await shot('the-sau', { x: 0, y: Math.max(0, y - 30), width: 390, height: 520 }); const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); console.log('Tràn ngang: ' + over); }
await browser.close();
