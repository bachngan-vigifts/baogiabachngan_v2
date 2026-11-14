// Liệt kê các trường ở trang thanh toán web Lock (giỏ có 1 sản phẩm, phiên khách tạm, điện thoại giả lập). Chỉ đọc, không điền gì, không đặt đơn.
import { chromium } from 'playwright';
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink;
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 412, height: 915 }, isMobile: true });
const page = await ctx.newPage();
await page.goto(simple + `?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(3000);
await page.locator('button.single_add_to_cart_button').first().click(); await page.waitForTimeout(5000);
await page.goto(`${SITE}/thanh-toan/?cb=${Date.now()}`, { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(6000);
const rows = await page.evaluate(() => {
  const form = document.querySelector('form.checkout, form.woocommerce-checkout'); if (!form) return null;
  const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const out = [];
  for (const e of form.querySelectorAll('input, select, textarea')) {
    if (['submit', 'button'].includes(e.type)) continue;
    const row = e.closest('.form-row, p, .woocommerce-input-wrapper, div');
    const lab = (form.querySelector(`label[for="${e.id}"]`)?.textContent || e.placeholder || '').replace(/\s+/g, ' ').replace(/\*|\(tùy chọn\)|\(optional\)/gi, '').trim().slice(0, 40);
    const section = e.closest('.woocommerce-shipping-fields') ? 'giao hàng' : e.closest('.woocommerce-billing-fields') ? 'thanh toán' : e.closest('.woocommerce-additional-fields') ? 'ghi chú' : e.closest('#payment') ? 'cổng thanh toán' : 'khác';
    out.push({ name: e.name || e.id, type: e.tagName.toLowerCase() === 'input' ? e.type : e.tagName.toLowerCase(), label: lab, required: !!(e.required || row?.classList.contains('validate-required')), visible: vis(e), section });
  }
  return out;
});
await browser.close();
if (!rows) { console.log('Không thấy biểu mẫu thanh toán'); process.exit(1); }
console.log(`TỔNG ${rows.length} trường; đang hiện ${rows.filter(r => r.visible).length}; ẩn ${rows.filter(r => !r.visible).length}`);
for (const sec of ['thanh toán', 'giao hàng', 'ghi chú', 'cổng thanh toán', 'khác']) {
  const rs = rows.filter(r => r.section === sec); if (!rs.length) continue;
  console.log(`## ${sec} (${rs.length})`);
  for (const r of rs) console.log(`F| ${r.visible ? 'HIỆN' : 'ẨN '} | ${r.required ? 'BẮT BUỘC' : 'tùy chọn'} | ${r.name} | ${r.type} | ${r.label}`);
}
