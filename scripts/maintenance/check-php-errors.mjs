// Chỉ đọc: tìm thông báo lỗi/cảnh báo PHP hiện trong HTML các trang công khai (sau khi đổi phiên bản PHP) và báo phiên bản qua header nếu có.
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const pages = ['/', '/danh-muc/binh-nuoc/', '/gio-hang/', '/thanh-toan/', '/wp-json/wc/store/v1/products?per_page=1', '/?wc-ajax=get_refreshed_fragments'];
try { const j = await (await fetch(`${SITE}/wp-json/wc/store/v1/products?type=variable&per_page=1&stock_status=instock`)).json(); if (j[0]?.permalink) pages.push(new URL(j[0].permalink).pathname); } catch {}
const bad = /(Fatal error|Parse error|Deprecated|Warning|Notice|Uncaught)\s*:/i;
for (const p of pages) {
  const t0 = performance.now();
  const r = await fetch(`${SITE}${p}${p.includes('?') ? '&' : '?'}php=${Date.now()}`, { method: p.includes('wc-ajax') ? 'POST' : 'GET', headers: { 'User-Agent': 'Mozilla/5.0 check' }, redirect: 'follow' });
  const t = await r.text(); const m = bad.exec(t);
  console.log(`${p.slice(0, 50)}: http=${r.status} ${Math.round(performance.now() - t0)}ms x-powered-by=${r.headers.get('x-powered-by') || '-'} lỗiPHP=${m ? 'CÓ: ' + t.slice(Math.max(0, m.index - 30), m.index + 110).replace(/\s+/g, ' ').replace(/\/home\/[^ ]*/g, '<đường dẫn>') : 'không'}`);
}
