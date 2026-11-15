// Làm nóng cache LiteSpeed của web Lock: gọi lần lượt trang chủ, danh mục, sản phẩm (khách ẩn danh, chỉ đọc, nhẹ nhàng: 2 luồng, có nghỉ).
const SITE = (process.env.HEALTH_BASE || 'https://locknlockonline.com').replace(/\/+$/, '');
const MAX = Number(process.env.MAX_URLS || 600), CONC = 2, PAUSE = 150;
const UAS = { mobile: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' };
const get = async (u, ua = UAS.desktop) => fetch(u, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(60_000) });
const locs = t => [...t.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
const urls = new Set([SITE + '/']);
let indexes = [];
for (const p of ['/sitemap_index.xml', '/wp-sitemap.xml']) { try { const r = await get(SITE + p); if (r.ok) { indexes = locs(await r.text()); if (indexes.length) { console.log('Sơ đồ trang:', p, indexes.length, 'tệp'); break; } } } catch {} }
for (const ix of indexes) {
  if (!/product|page|cat|shop|post/i.test(ix)) continue;
  try { const r = await get(ix); if (r.ok) for (const u of locs(await r.text())) { if (u.startsWith(SITE) && !/\.(jpe?g|png|webp|gif)$/i.test(u)) urls.add(u); } } catch {}
}
const list = [...urls].slice(0, MAX); console.log('Số trang sẽ gọi:', list.length, '(tối đa', MAX + ')');
const stat = { HIT: 0, MISS: 0, other: 0, err: 0 }; let slow = 0, i = 0;
async function worker() {
  while (i < list.length) {
    const u = list[i++]; const ua = (i % 2) ? UAS.mobile : UAS.desktop; const t = Date.now();
    try { const r = await get(u, ua); await r.arrayBuffer(); const c = (r.headers.get('x-litespeed-cache') || '').toUpperCase(); if (c.includes('HIT')) stat.HIT++; else if (c.includes('MISS')) stat.MISS++; else stat.other++; if (Date.now() - t > 5000) slow++; } catch { stat.err++; }
    await new Promise(r => setTimeout(r, PAUSE));
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log('KẾT QUẢ làm nóng:', JSON.stringify(stat), 'trang chậm >5s:', slow);
