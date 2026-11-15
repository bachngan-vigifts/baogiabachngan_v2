// Kiểm tra sau khi chặn dò file PHP: file PHP giả trả 404 nhanh (có dấu X-Lnl-Probe), trang thật và file PHP thật vẫn chạy. Chỉ đọc.
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const get = async (p, method = 'GET') => { const t = Date.now(); try { const r = await fetch(SITE + p, { method, redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) }); const body = await r.text(); return { s: r.status, ms: Date.now() - t, probe: r.headers.get('x-lnl-probe'), php: /Fatal error|Parse error|Warning:/i.test(body) }; } catch (e) { return { s: 0, ms: Date.now() - t, err: String(e.message).slice(0, 60) }; } };
let bad = 0; const expectProbe = process.env.EXPECT_PROBE === '1';
const n = Date.now();
for (const [p, want, m] of [[`/lnl-khong-co-${n}.php`, 'probe'], [`/wp-admin/images/lnl${n}.php`, 'probe'], [`/wp-content/lnl${n}.php`, 'probe'], ['/', 200], ['/gio-hang/', 200], ['/wp-login.php', 200], ['/wp-cron.php', 200], ['/wp-admin/admin-ajax.php', 400], ['/xmlrpc.php', 405, 'GET'], [`/san-pham-khong-co-${n}/`, 404]]) {
  const r = await get(p, m);
  let ok;
  if (want === 'probe') ok = r.s === 404 && (!expectProbe || r.probe === '1'); else ok = r.s === want || (want === 405 && [403, 405].includes(r.s)) || (want === 200 && [200, 302].includes(r.s));
  if (r.php) ok = false;
  if (!ok) bad++;
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${p.replace(String(n), 'X')}: ${r.s} ${r.ms}ms${r.probe ? ' [chặn sớm]' : ''}${r.php ? ' LỖI PHP' : ''}${r.err ? ' ' + r.err : ''}`);
}
if (bad) { console.log(`KHÔNG ĐẠT: ${bad} mục`); process.exitCode = 1; } else console.log('TẤT CẢ ĐẠT');
