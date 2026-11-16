// Tắt/bật tạm object cache (Redis) của web Lock bằng cách ĐỔI TÊN đúng 1 file: <docroot>/wp-content/object-cache.php <-> object-cache.php.off.
// MODE=off: đổi object-cache.php -> object-cache.php.off (WordPress thôi dùng Redis). MODE=on: đổi ngược lại. MODE=check: chỉ xem.
// Sau khi đổi: kiểm tra trang chủ/sản phẩm/giỏ/đăng nhập; lỗi thì tự đổi lại. Không in token/tên đăng nhập/máy chủ.
const MODE = ['off', 'on'].includes(process.env.MODE) ? process.env.MODE : 'check';
const rawBase = (process.env.CPANEL_BASE_URL || '').trim(), user = (process.env.CPANEL_USERNAME || '').trim(), token = (process.env.CPANEL_API_TOKEN || '').trim();
const docroot = (process.env.LOCKNLOCK_DOCROOT || '').trim().replace(/\/+$/, '');
if (!rawBase || !user || !token || !docroot.startsWith('/') || docroot.includes('..')) throw new Error('Thiếu/không hợp lệ biến môi trường');
const b = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`); if (!b.port) b.port = '2083';
const H = { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json' }, DIR = `${docroot}/wp-content`, SITE = 'https://locknlockonline.com';
const list = async () => { const u = new URL(`${b.origin}/execute/Fileman/list_files`); u.searchParams.set('dir', DIR); u.searchParams.set('showdotfiles', '1'); u.searchParams.set('include_mime', '0'); const j = await (await fetch(u, { headers: H })).json(); return (j.data || []).map(f => f.file); };
async function rename(from, to) {
  const u = new URL(`${b.origin}/json-api/cpanel`);
  for (const [k, v] of Object.entries({ cpanel_jsonapi_user: user, cpanel_jsonapi_apiversion: 2, cpanel_jsonapi_module: 'Fileman', cpanel_jsonapi_func: 'fileop', op: 'rename', sourcefiles: `${DIR}/${from}`, destfiles: `${DIR}/${to}`, doubledecode: 0 })) u.searchParams.set(k, String(v));
  const j = await (await fetch(u, { headers: H, signal: AbortSignal.timeout(60000) })).json().catch(() => null); return j?.cpanelresult?.event?.result === 1;
}
async function health() {
  const out = {}; const bad = /Fatal error|critical error|Parse error|There has been a critical/i;
  for (const [n, p] of [['home', '/'], ['product', '/san-pham/binh-giu-nhiet-locknlock-freeflow-lhc4466-lhc4467/'], ['cart', '/gio-hang/'], ['login', '/wp-login.php']]) { const t = Date.now(); try { const r = await fetch(`${SITE}${p}${p.includes('?') ? '&' : '?'}hc=${Date.now()}`, { headers: { 'User-Agent': 'objcache-health' }, signal: AbortSignal.timeout(45000) }); const x = await r.text(); out[n] = { s: r.status, ms: Date.now() - t, php: bad.test(x), ...(n === 'login' ? { form: /loginform/.test(x) } : {}) }; } catch { out[n] = { s: 0, ms: Date.now() - t }; } }
  out.ok = Object.values(out).every(v => v.s === 200 && !v.php) && out.login.form; return out;
}
const before = await list(); const has = before.includes('object-cache.php'), hasOff = before.includes('object-cache.php.off');
console.log(`Trước: object-cache.php=${has}, object-cache.php.off=${hasOff}`);
if (MODE === 'check') { console.log(JSON.stringify(await health())); process.exit(0); }
const [from, to] = MODE === 'off' ? ['object-cache.php', 'object-cache.php.off'] : ['object-cache.php.off', 'object-cache.php'];
if (!before.includes(from)) { console.log(`Không có ${from}, không làm gì.`); process.exit(0); }
if (before.includes(to)) { console.log(`DỪNG: ${to} đã tồn tại, không ghi đè.`); process.exit(3); }
const h0 = await health(); console.log('Web trước: ' + JSON.stringify(h0));
const ok = await rename(from, to); const after = await list(); console.log(`Đổi tên ${from} -> ${to}: ${ok && after.includes(to) && !after.includes(from) ? 'đạt' : 'LỖI'}`);
await new Promise(r => setTimeout(r, 3000));
const h1 = await health(); console.log('Web sau: ' + JSON.stringify(h1));
if (!h1.ok) { const back = await rename(to, from); console.log(`KHÔNG ĐẠT -> đổi lại: ${back ? 'đạt' : 'LỖI'}`); process.exit(1); }
console.log('KẾT QUẢ: ĐẠT');
