// Chỉ đọc: tìm chuỗi wc_fragment_refresh trong HTML trang chủ/sản phẩm và in ngữ cảnh quanh nó (không có dữ liệu khách).
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
for (const path of ['/', '/danh-muc/binh-nuoc/']) {
  const t = await (await fetch(`${SITE}${path}?x=${Date.now()}`, { headers: { 'User-Agent': 'Mozilla/5.0 check' } })).text();
  const idx = []; let i = -1; while ((i = t.indexOf('wc_fragment_refresh', i + 1)) !== -1 && idx.length < 4) idx.push(i);
  console.log(`${path}: ${t.length} ký tự, số lần xuất hiện ≥ ${idx.length}`);
  for (const k of idx) console.log('   ...' + t.slice(Math.max(0, k - 160), k + 90).replace(/\s+/g, ' ') + '...');
  console.log('   có cart-fragments.js:', /cart-fragments(\.min)?\.js/.test(t), '| có mu-plugin inline lnl:', /lnl_/.test(t));
}
