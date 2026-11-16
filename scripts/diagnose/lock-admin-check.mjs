// CHẨN ĐOÁN CHỈ ĐỌC: trang quản trị có mở được không (không đăng nhập). Ghi chuỗi chuyển hướng, mã trạng thái, header cache, đoạn đầu nội dung lỗi.
const SITE = 'https://locknlockonline.com', UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
for (const path of ['/wp-admin/', '/wp-admin/index.php', '/wp-login.php', '/wp-admin/admin-ajax.php', '/wp-admin/plugins.php', '/wp-login.php?action=lostpassword']) {
  let url = SITE + path; const chain = [];
  for (let i = 0; i < 8; i++) {
    const t = Date.now(); let r; try { r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) }); } catch (e) { chain.push(`LỖI ${e.message}`); break; }
    const body = await r.text(); const h = r.headers;
    chain.push(`${r.status} ${Date.now() - t}ms cf=${h.get('cf-cache-status') || '-'} cc=${(h.get('cache-control') || '-').slice(0, 40)} ${h.get('location') ? '-> ' + h.get('location').replace(SITE, '').replace(/([?&](?:_wpnonce|rm_token|rm_key|key)=)[^&]+/g, '$1*').slice(0, 90) : ''}${r.status >= 400 || /error|lỗi|critical|nghiêm trọng/i.test(body.slice(0, 3000)) && r.status !== 302 ? ' NỘI DUNG: ' + body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220) : ''}`);
    const loc = h.get('location'); if (!loc || r.status < 300 || r.status >= 400) { if (r.status === 200) chain.push(`(trang ${body.length}B, có form đăng nhập: ${/name="log"|user_login/.test(body)}, có loginform: ${/loginform/.test(body)})`); break; }
    url = new URL(loc, url).href;
  }
  console.log(`${path}\n   ${chain.join('\n   ')}`);
}
