// Đo thời gian trả trang sản phẩm (chỉ đọc, khách ẩn danh): vài sản phẩm đơn giản và biến thể, mỗi trang 3 lần.
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
async function list(type) { const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=${type}&per_page=3&stock_status=instock`)).json(); return (Array.isArray(j) ? j : []).map(x => x.permalink).filter(Boolean); }
for (const type of ['simple', 'variable']) {
  for (const u of (await list(type)).slice(0, 2)) {
    const ts = [];
    for (let i = 0; i < 3; i++) { const t = Date.now(); const r = await fetch(u + (i === 0 ? '' : `?cb=${Date.now()}`), { headers: { 'User-Agent': UA } }); const ttfb = Date.now() - t; const body = await r.text(); ts.push(`${r.status} ttfb=${ttfb}ms tổng=${Date.now() - t}ms ${Math.round(body.length / 1024)}KB cache=${r.headers.get('x-litespeed-cache') || r.headers.get('cf-cache-status') || '-'}`); }
    console.log(type, u.replace(SITE, '').slice(0, 60)); for (const s of ts) console.log('   ' + s);
  }
}
