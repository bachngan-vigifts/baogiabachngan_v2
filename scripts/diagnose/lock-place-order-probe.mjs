// CHẨN ĐOÁN nút "Đặt hàng": KHÔNG tạo đơn. Khách tạm thêm 1 sản phẩm, điền dữ liệu giả để qua kiểm tra của trình duyệt, bấm Đặt hàng.
// Trước khi lệnh tới máy chủ, trình duyệt thử SỬA lệnh: xoá họ tên + SĐT và đổi phương thức thanh toán thành không tồn tại.
// WooCommerce chạy xử lý đặt hàng tới bước kiểm tra rồi trả lỗi (thiếu thông tin + phương thức thanh toán sai) => không tạo đơn. Đo thời gian lệnh wc-ajax=checkout.
import { chromium } from 'playwright';
const SITE = 'https://locknlockonline.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=simple&per_page=5&stock_status=instock`)).json();
const simple = (Array.isArray(j) ? j : []).find(x => x.permalink)?.permalink.replace(SITE, '');
const b = await chromium.launch(); const sum = [];
for (let r = 1; r <= Number(process.env.RUNS || 3); r++) {
  const ctx = await b.newContext({ userAgent: UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
  let sent = 0;
  await p.route(/wc-ajax=checkout(&|$)/, async route => { const q = new URLSearchParams(route.request().postData() || ''); for (const k of [...q.keys()]) if (/^(billing|shipping)_(first_name|last_name|phone|email)$/.test(k)) q.set(k, ''); q.set('payment_method', 'lnl_khong_ton_tai'); sent++; return route.continue({ postData: q.toString() }); });
  const log = []; const st = new Map(); let t0 = 0;
  p.on('request', q => { if (q.url().startsWith(SITE) && ['xhr', 'fetch', 'document'].includes(q.resourceType())) st.set(q, Date.now()); });
  p.on('requestfinished', async q => { if (!st.has(q) || !t0) return; const res = await q.response().catch(() => null); const a = (q.url().match(/wc-ajax=(\w+)/) || [, q.url().replace(SITE, '').slice(0, 40)])[1]; let extra = ''; if (/wc-ajax=checkout/.test(q.url())) { try { const jj = await res.json(); if (jj.result !== 'failure') { console.log('!!! KẾT QUẢ BẤT THƯỜNG: ' + jj.result); process.exitCode = 1; } extra = ` result=${jj.result} lỗi=${(jj.messages || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}`; } catch {} } log.push(`+${st.get(q) - t0}ms chờ ${Date.now() - st.get(q)}ms ${q.method()} ${res ? res.status() : '?'} ${a}${extra}`); });
  try {
    await p.goto(SITE + simple, { waitUntil: 'load', timeout: 90000 }); await p.waitForTimeout(3000);
    const btn = p.locator('form.cart .single_add_to_cart_button').first(); await btn.scrollIntoViewIfNeeded();
    const d = p.waitForResponse(x => /wc-ajax=lnl_add_to_cart/.test(x.url()), { timeout: 60000 }).catch(() => null); await btn.tap({ noWaitAfter: true }); await d; await p.waitForTimeout(1500);
    await p.goto(SITE + '/thanh-toan/', { waitUntil: 'load', timeout: 90000 });
    await p.waitForFunction(() => !document.querySelector('.blockUI'), null, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(4000);
    // điền dữ liệu giả để qua kiểm tra của trình duyệt (dữ liệu này sẽ bị xoá trước khi gửi)
    const filled = await p.evaluate(() => { const out = []; for (const el of document.querySelectorAll('form.checkout input, form.checkout select, form.checkout textarea')) { if (el.type === 'hidden' || el.disabled || el.offsetParent === null) continue; const req = el.required || (el.closest('.validate-required')); if (!req) continue; if (el.tagName === 'SELECT') { if (!el.value) { const o = [...el.options].find(o => o.value); if (o) { el.value = o.value; if (window.jQuery) jQuery(el).trigger('change'); out.push(el.name + '=chọn'); } } } else if (el.type === 'checkbox') { if (!el.checked) { el.click(); out.push(el.name + '=tick'); } } else if (!el.value) { el.value = el.type === 'tel' || /phone/.test(el.name) ? '0900000000' : el.type === 'email' || /email/.test(el.name) ? 'kiemtra@example.com' : 'Kiem tra'; el.dispatchEvent(new Event('change', { bubbles: true })); out.push(el.name); } } return out; });
    console.log(`   điền giả: ${filled.join(', ')}`);
    await p.waitForTimeout(3000); await p.waitForFunction(() => !document.querySelector('.blockUI'), null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(1500);
    const place = p.locator('#place_order'); await place.scrollIntoViewIfNeeded();
    t0 = Date.now(); await place.tap({ noWaitAfter: true });
    let tFeedback = null; await p.waitForFunction(() => document.querySelector('.blockUI, .processing, #place_order.loading'), null, { timeout: 5000 }).then(() => { tFeedback = Date.now() - t0; }).catch(() => {});
    let tErr = null; await p.waitForFunction(() => document.querySelector('.woocommerce-error, .woocommerce-NoticeGroup-checkout, #lnl-err-popup.show, #lnl-err-popup[open], #lnl-err-popup:not([hidden])'), null, { timeout: 60000 }).then(() => { tErr = Date.now() - t0; }).catch(() => {});
    await p.waitForFunction(() => !document.querySelector('.blockUI'), null, { timeout: 60000 }).catch(() => {}); const tUnblock = Date.now() - t0;
    await p.waitForTimeout(3000);
    const url = p.url().replace(SITE, '');
    console.log(`\nLượt ${r}: lệnh checkout gửi=${sent}; phản hồi thị giác ${tFeedback ?? '?'}ms; hiện lỗi sau ${tErr ?? 'KHÔNG THẤY'}ms; hết khoá form sau ${tUnblock}ms; URL ${url}${/order-received|dat-hang-thanh-cong/.test(url) ? ' !!! ĐÃ TẠO ĐƠN' : ''}`);
    for (const l of log) console.log('   ' + l);
    const ck = log.find(l => / checkout /.test(l + ' ')) || log.find(l => /checkout/.test(l)); sum.push(ck ? Number((/chờ (\d+)ms/.exec(ck) || [])[1]) : null);
  } catch (e) { console.log(`Lượt ${r} LỖI ${String(e.message).slice(0, 150)}`); }
  await ctx.close();
}
console.log(`\nTÓM TẮT chờ máy chủ lệnh checkout (ms): ${sum.join(', ')}`);
if (process.env.EXPECT_OK === '1' && sum.some(x => !x)) { console.log('KHÔNG ĐẠT: có lượt không nhận được phản hồi đặt hàng'); process.exitCode = 1; }
await b.close();
