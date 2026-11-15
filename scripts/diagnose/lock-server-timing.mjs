// CHẨN ĐOÁN CHỈ ĐỌC: tách thời gian mạng/Cloudflare, máy chủ web (file tĩnh không cache), khởi động WordPress (lệnh rỗng), và phép thử song song nhỏ để thấy hàng chờ PHP worker.
// Mỗi phép đo 3 lượt. Không đăng nhập, không gửi dữ liệu khách.
import { request } from 'node:https';
const HOST = 'locknlockonline.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
function hit(path, method = 'GET', body = null) {
  return new Promise(res => {
    const t0 = process.hrtime.bigint(); let tSock, tConn, tTls, tFirst;
    const ms = t => t ? Number(t - t0) / 1e6 : null;
    const req = request({ host: HOST, path, method, agent: false, headers: { 'User-Agent': UA, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}) }, timeout: 60000 }, r => {
      tFirst = process.hrtime.bigint(); r.resume(); r.on('end', () => res({ s: r.statusCode, dns_conn: Math.round(ms(tConn)), tls: Math.round(ms(tTls) - ms(tConn)), ttfb: Math.round(ms(tFirst) - ms(tTls)), total: Math.round(ms(process.hrtime.bigint())), cf: r.headers['cf-cache-status'] || '-' }));
    });
    req.on('socket', s => { s.on('lookup', () => {}); s.on('connect', () => { tConn = process.hrtime.bigint(); }); s.on('secureConnect', () => { tTls = process.hrtime.bigint(); }); });
    req.on('timeout', () => { req.destroy(); res({ s: 0, err: 'timeout' }); }); req.on('error', e => res({ s: 0, err: e.code }));
    if (body) req.write(body); req.end();
  });
}
const R = Number(process.env.RUNS || 3);
const tests = [
  ['File tĩnh qua Cloudflare (đã cache)', () => hit('/wp-content/themes/flatsome/style.css')],
  ['File tĩnh từ máy chủ gốc (không cache, không PHP)', () => hit('/wp-content/themes/flatsome/style.css?diag=' + Math.random().toString(36).slice(2))],
  ['Trang sản phẩm (cache)', () => hit('/san-pham/binh-giu-nhiet-locknlock-freeflow-lhc4466-lhc4467/')],
  ['PHP nhẹ nhất: 404 sớm (mu-plugin chặn dò)', () => hit('/diag-' + Math.random().toString(36).slice(2) + '.php')],
  ['Khởi động WordPress: admin-ajax action không tồn tại', () => hit('/wp-admin/admin-ajax.php', 'POST', 'action=lnl_diag_khong_ton_tai')],
  ['WooCommerce: wc-ajax get_refreshed_fragments (khách, giỏ rỗng)', () => hit('/?wc-ajax=get_refreshed_fragments', 'POST', 'time=1')],
  ['Store API giỏ (khách)', () => hit('/wp-json/wc/store/v1/cart')],
];
for (const [name, fn] of tests) {
  const rs = []; for (let i = 0; i < R; i++) { rs.push(await fn()); await new Promise(r => setTimeout(r, 1500)); }
  console.log(`${name}:\n   ${rs.map(r => r.err ? 'LỖI ' + r.err : `${r.s} kết nối ${r.dns_conn}ms tls ${r.tls}ms CHỜ ${r.ttfb}ms tổng ${r.total}ms cf=${r.cf}`).join('\n   ')}`);
}
// Song song: n lệnh rỗng cùng lúc; nếu thời gian chờ tăng theo n => xếp hàng (thiếu worker/CPU)
if (process.env.PARALLEL !== '0') for (const n of [1, 2, 4]) {
  const rounds = []; for (let i = 0; i < R; i++) { const rs = await Promise.all(Array.from({ length: n }, () => hit('/wp-admin/admin-ajax.php', 'POST', 'action=lnl_diag_khong_ton_tai'))); rounds.push(rs.map(r => r.ttfb).sort((a, b) => a - b)); await new Promise(r => setTimeout(r, 3000)); }
  console.log(`Song song ${n} lệnh rỗng — CHỜ từng lệnh (ms): ${rounds.map(r => '[' + r.join(', ') + ']').join(' ')}`);
}
