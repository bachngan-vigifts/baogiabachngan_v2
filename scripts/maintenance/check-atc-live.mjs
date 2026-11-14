// Kiểm tra trang sản phẩm THẬT (không thêm tham số, như khách truy cập): có đoạn thêm giỏ mới chưa, đang qua cache nào. Chỉ đọc.
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const urls = [];
for (const type of ['simple', 'variable']) {
  try { const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=${type}&per_page=5&stock_status=instock`, { headers: { 'User-Agent': UA } })).json(); const p = (Array.isArray(j) ? j : []).find(x => x.permalink); if (p) urls.push([type, p.permalink]); } catch {}
}
urls.push(['fixed', `${SITE}/san-pham/binh-giu-nhiet-locknlock-lhc6150ivy/`]);
for (const [k, u] of urls) for (let i = 0; i < 2; i++) {
  const t0 = performance.now();
  const r = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow' }); const t = await r.text();
  const m = /__lnlAtc=\\?"?([\w-]+)/.exec(t);
  console.log(`${k} lần${i + 1}: http=${r.status} ${Math.round(performance.now() - t0)}ms cf=${r.headers.get('cf-cache-status') || '-'} age=${r.headers.get('age') || '-'} lscache=${r.headers.get('x-litespeed-cache') || '-'} atc=${m ? m[1] : 'KHONG-CO'} rocket=${/rocket-loader|data-cf-settings/i.test(t)} jsDelay=${/litespeed.*delay|data-no-defer|type="litespeed/i.test(t)} kb=${Math.round(t.length / 1024)}`);
}
