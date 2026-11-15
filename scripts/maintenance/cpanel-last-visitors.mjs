// Tổng hợp ~1000 lượt truy cập gần nhất của web Lock (cPanel API2 Stats::lastvisitors) để tìm nguồn ngốn CPU: bot, URL không cache được. Chỉ đọc. IP chỉ in 2 khối đầu.
const rawBase = (process.env.CPANEL_BASE_URL || '').trim(), user = (process.env.CPANEL_USERNAME || '').trim(), token = (process.env.CPANEL_API_TOKEN || '').trim();
if (!rawBase || !user || !token) throw new Error('Thiếu biến môi trường');
const b = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`); if (!b.port) b.port = '2083';
const secrets = [token, user, b.hostname, b.host].filter(s => s && s.length >= 3);
const redact = t => { let o = String(t); for (const s of secrets) o = o.split(s).join('<che>'); return o; };
const DOMAIN = process.env.DOMAIN || 'locknlockonline.com';
const u = new URL(`${b.origin}/json-api/cpanel`); for (const [k, v] of Object.entries({ cpanel_jsonapi_module: 'Stats', cpanel_jsonapi_func: 'lastvisitors', cpanel_jsonapi_apiversion: 2, domain: DOMAIN })) u.searchParams.set(k, v);
const r = await fetch(u, { headers: { Authorization: `cpanel ${user}:${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
const j = await r.json().catch(() => null);
const rows = j?.cpanelresult?.data || [];
console.log(`Số lượt đọc được: ${rows.length}; lỗi: ${redact(j?.cpanelresult?.error || '-')}`);
if (rows[0]) console.log('Các trường: ' + Object.keys(rows[0]).join(', '));
const top = (m, n = 15) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const combo = new Map(), ua = new Map(), ip = new Map(), kind = new Map(), path = new Map(), code = new Map(); let t0 = null, t1 = null;
for (const x of rows) {
  const url = String(x.path || x.url || x.request || ''); const agent = String(x.agent || x.useragent || '');
  const tm = String(x.timestamp || x.time || ''); if (!t0) t0 = tm; t1 = tm;
  inc(ua, agent.replace(/\d+(\.\d+)+/g, 'x').slice(0, 90));
  inc(ip, String(x.ip || '').split(/[.:]/).slice(0, 2).join('.') + '.*');
  inc(code, String(x.code || x.status || '?'));
  const k = /add-to-cart=/.test(url) ? 'add-to-cart trong URL' : /wc-ajax=/.test(url) ? 'wc-ajax=' + (url.match(/wc-ajax=([\w-]+)/) || [])[1] : /admin-ajax/.test(url) ? 'admin-ajax' : /wp-json/.test(url) ? 'wp-json' : /wp-cron/.test(url) ? 'wp-cron' : /[?&](filter_|orderby=|min_price|max_price|query_type|s=|product_tag)/.test(url) ? 'lọc/sắp xếp/tìm (không cache)' : /\.(css|js|png|jpe?g|webp|gif|svg|woff2?|ico)(\?|$)/i.test(url) ? 'file tĩnh' : /\?/.test(url) ? 'trang có tham số khác' : 'trang thường';
  inc(combo, `${String(x.ip || '').split(/[.:]/).slice(0, 2).join('.')}.* | ${agent.slice(0, 40)} | ${k}`);
  inc(kind, k); if (!/file tĩnh/.test(k)) inc(path, url.replace(/^(GET|POST|HEAD) /, m => m).slice(0, 100));
}
console.log(`Khoảng thời gian: ${t0} → ${t1}`);
for (const [t, m] of [['LOẠI YÊU CẦU', kind], ['MÃ TRẢ VỀ', code], ['TRÌNH DUYỆT/BOT', ua], ['DẢI IP', ip], ['DẢI IP + TRÌNH DUYỆT + LOẠI', combo], ['URL ĐỘNG NHIỀU NHẤT', path]]) { console.log(`\n== ${t}`); for (const [k, v] of top(m)) console.log(`   ${v}  ${redact(k)}`); }
// Đường dẫn của các lượt không có tên trình duyệt (thường là bot/công cụ)
const noua = new Map(); for (const x of rows) if (!x.agent || x.agent === '-') inc(noua, `${x.code} ${String(x.path || '').slice(0, 90)}`);
console.log('\n== LƯỢT KHÔNG CÓ TÊN TRÌNH DUYỆT'); for (const [k, v] of top(noua, 12)) console.log(`   ${v}  ${redact(k)}`);
console.log('Mẫu thời gian: ' + rows.slice(0, 2).concat(rows.slice(-2)).map(x => x.timestamp || x.line).join(' | '));
// Trang có tham số quảng cáo Google có được lấy từ cache không (mỗi lượt bấm quảng cáo có mã khác nhau)
const SITE = 'https://' + DOMAIN;
for (const q of ['', '', '?gad_source=1&gad_campaignid=' + Date.now(), '?gbraid=TEST' + Date.now(), '?srsltid=TEST' + Date.now(), '?ttclid=TEST' + Date.now(), '?gclid=TEST' + Date.now(), '?abc=' + Date.now()]) {
  const t = Date.now(); const res = await fetch(SITE + '/danh-muc/binh-nuoc/binh-nuoc-mang-di/binh-giu-nhiet/' + q, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' }, signal: AbortSignal.timeout(60_000) }).catch(e => null);
  if (res) await res.text();
  console.log(`CACHE ${q.slice(0, 30) || '(không tham số)'}: ${res ? res.status : 'lỗi'} ${Date.now() - t}ms litespeed=${res?.headers.get('x-litespeed-cache') || '-'} cf=${res?.headers.get('cf-cache-status') || '-'}`);
}
