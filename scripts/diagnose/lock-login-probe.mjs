// KIỂM TRA luồng đăng nhập (không dùng tài khoản thật): mở wp-login.php, gửi tên đăng nhập KHÔNG TỒN TẠI, mong nhận thông báo lỗi sai tài khoản (nghĩa là máy chủ xử lý đăng nhập bình thường, không quay vòng).
// Cũng kiểm tra cookie thử (wordpress_test_cookie) được đặt. 3 lượt.
import { chromium } from 'playwright';
const SITE = 'https://locknlockonline.com';
const b = await chromium.launch();
for (let r = 1; r <= 3; r++) {
  const ctx = await b.newContext(); const p = await ctx.newPage();
  try {
    const t0 = Date.now(); await p.goto(SITE + '/wp-login.php', { waitUntil: 'load', timeout: 90000 }); const tLoad = Date.now() - t0;
    const cookies1 = (await ctx.cookies()).map(c => c.name.replace(/[a-f0-9]{32}/, '<h>'));
    await p.fill('#user_login', 'lnl-kiemtra-khong-ton-tai-' + r); await p.fill('#user_pass', 'sai-mat-khau-kiem-tra');
    const t1 = Date.now(); await Promise.all([p.waitForLoadState('load', { timeout: 90000 }).catch(() => {}), p.click('#wp-submit')]); await p.waitForTimeout(1500);
    const err = await p.evaluate(() => (document.querySelector('#login_error') || {}).innerText || '').catch(() => '');
    const fields = await p.evaluate(() => ({ user: (document.querySelector('#user_login') || {}).value || '', hasForm: !!document.querySelector('#loginform') }));
    console.log(`Lượt ${r}: mở trang ${tLoad}ms; gửi đăng nhập ${Date.now() - t1}ms; URL ${p.url().replace(SITE, '').replace(/([?&](?:_wpnonce|key)=)[^&]+/g, '$1*')}; thông báo lỗi: "${err.replace(/\s+/g, ' ').trim().slice(0, 140)}"; ô tên còn giữ: ${fields.user ? 'có' : 'KHÔNG'}; cookie trước khi gửi: ${cookies1.join(',') || 'không có'}`);
  } catch (e) { console.log(`Lượt ${r} LỖI ${String(e.message).slice(0, 150)}`); }
  await ctx.close();
}
await b.close();
