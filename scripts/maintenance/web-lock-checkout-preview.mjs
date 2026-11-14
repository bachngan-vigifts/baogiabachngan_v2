// Xem trước giao diện thanh toán điện thoại của web Lock: chụp ảnh trang thật (giỏ có 1 sản phẩm, phiên khách tạm) rồi, nếu có CSS_FROM,
// áp thử CSS ngay trong trình duyệt (KHÔNG đổi gì trên web) và chụp ảnh sau. OUTLINE=1 in cấu trúc các khối chính. Không đặt đơn.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink;
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(simple + `?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(3000);
const added = page.waitForResponse(r => /wc-ajax=lnl_add_to_cart/.test(r.url()), { timeout: 45_000 }).catch(() => null);
await page.locator('button.single_add_to_cart_button').first().click(); await added; await page.waitForTimeout(2000);
await page.goto(`${SITE}/thanh-toan/?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(6000);

async function shot(name) {
  const buf = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 55 });
  const b64 = buf.toString('base64'); const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  console.log(`IMGSTART ${name} ${size.join('x')} ${b64.length}`);
  for (let i = 0; i < b64.length; i += 3000) console.log('IMG ' + name + ' ' + b64.slice(i, i + 3000));
  console.log(`IMGEND ${name}`);
}
if (process.env.OUTLINE === '1') {
  const out = await page.evaluate(() => {
    const sels = ['body', 'form.checkout', '#customer_details', '.col-1', '.col-2', '#order_review_heading', '#order_review', '.woocommerce-checkout-review-order-table', '#payment', '.wc_payment_methods', 'li.wc_payment_method', '.place-order', '#place_order', '.woocommerce-billing-fields', '.woocommerce-billing-fields__field-wrapper', '.woocommerce-shipping-fields', '.woocommerce-additional-fields', '.form-row', '.woocommerce-terms-and-conditions-wrapper', '.checkout-sidebar', '.cart-sidebar', '#ship-to-different-address', '.large-7', '.large-5', '.checkout-breadcrumbs', '.page-title'];
    const rows = [];
    for (const s of sels) { const els = [...document.querySelectorAll(s)]; if (!els.length) continue; const e = els[0]; const r = e.getBoundingClientRect(); rows.push(`${s} x${els.length} | <${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''} class="${String(e.className).slice(0, 110)}"> | ${Math.round(r.width)}x${Math.round(r.height)} @y${Math.round(r.top + scrollY)}`); }
    const pb = document.querySelector('#place_order'); const chain = []; for (let e = pb; e && e !== document.body; e = e.parentElement) chain.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).split(' ').filter(Boolean).slice(0, 3).join('.')}`); rows.push('Chuỗi cha của nút Đặt hàng: ' + chain.join(' < '));
    const rowsLbl = [...document.querySelectorAll('form.checkout .form-row')].map(e => `${e.id || '-'}:${String(e.className).split(' ').filter(x => /form-row-|validate|address-field|update_totals/.test(x)).join('.')}`); rows.push('form-row: ' + rowsLbl.join(' ; ').slice(0, 900));
    return rows;
  });
  for (const r of out) console.log('DOM| ' + r);
}
if (process.env.OUTLINE === '1') {
  const o2 = await page.evaluate(() => {
    const lines = [];
    const cbs = [...document.querySelectorAll('form.checkout input[type=checkbox]')];
    for (const c of cbs) { const chain = []; for (let e = c; e && e.id !== 'customer_details' && e.tagName !== 'FORM'; e = e.parentElement) chain.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '')); lines.push('CB ' + (c.name || c.id) + ' :: ' + chain.join(' < ')); }
    const cd = document.querySelector('#customer_details'); if (cd) { const walk = (e, d) => { if (d > 3) return; for (const k of e.children) { lines.push('TREE ' + ' '.repeat(d * 2) + k.tagName.toLowerCase() + (k.id ? '#' + k.id : '') + '.' + String(k.className).trim().split(/\s+/).slice(0, 3).join('.') + ' h=' + Math.round(k.getBoundingClientRect().height)); walk(k, d + 1); } }; walk(cd, 0); }
    return lines;
  });
  for (const r of o2) console.log('DOM2| ' + r);
}
await shot('truoc');
if (process.env.CSS_FROM) {
  let css = ''; for (const f of process.env.CSS_FROM.split(',')) { const src = readFileSync(f, 'utf8'); const m = /<<<'CSS'\n([\s\S]*?)\nCSS;/.exec(src); if (!m) { console.log('Không thấy khối CSS ' + f); process.exit(1); } css += m[1] + '\n'; }
  await page.addStyleTag({ content: css }); await page.waitForTimeout(1500);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); console.log('Tràn ngang sau khi áp CSS: ' + over);
  await shot('sau');
}
await browser.close();
