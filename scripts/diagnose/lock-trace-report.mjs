// In báo cáo từ trace.json (đã che). Không có dữ liệu khách.
import { readFileSync } from 'node:fs';
const all = JSON.parse(readFileSync(process.argv[2] || 'trace.json', 'utf8'));
const med = a => { const b = a.filter(x => typeof x === 'number').sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : '-'; };
const rng = a => { const b = a.filter(x => typeof x === 'number'); return b.length ? `${Math.min(...b)}–${Math.max(...b)}` : '-'; };
for (const s of all) {
  console.log(`\n================ LUỒNG ${s.flow.startsWith('A') ? 'A (Thêm vào giỏ)' : 'B (Mua ngay)'}${s.flow.includes('gộp') ? ' — CÓ đoạn gộp lệnh đang chạy trên web' : ' — hành vi gốc (bỏ đoạn gộp trong trình duyệt thử)'} — lượt ${s.run} ================`);
  if (s.error) { console.log('LỖI PHIÊN: ' + s.error); }
  console.log(`Thời gian (UTC): ${s.startedAt} → ${s.endedAt}`);
  console.log('Mốc (ms từ lúc bắt đầu): ' + JSON.stringify(s.mark || {}));
  const L = s.list || [];
  const stat = L.filter(r => r.cls === 'tĩnh'); console.log(`File tĩnh: ${stat.length} (CF HIT ${stat.filter(r => r.cf === 'HIT').length})`);
  for (const ph of ['mở trang', 'chọn biến thể', 'đổi số lượng', 'bấm thêm giỏ', 'bấm mua ngay']) {
    const R = L.filter(r => r.phase === ph && r.cls !== 'tĩnh'); if (!R.length) continue;
    const wp = R.filter(r => r.cls.startsWith('WP')), cf = R.filter(r => r.cls === 'cloudflare'), ext = R.filter(r => r.cls.startsWith('NGOÀI'));
    console.log(`\n-- Pha "${ph}": WordPress ${wp.length}, Cloudflare ${cf.length}, ngoài ${ext.length}`);
    for (const r of wp) console.log(`   WP  t=${r.t}ms ${r.method} ${r.status || '?'}${r.redirect ? ' (chuyển hướng ' + r.redirect + ')' : ''} ${r.what} | chờ máy chủ ${r.wait ?? '?'}ms (dns ${r.dns ?? 0}/kết nối ${r.conn ?? 0}/tls ${r.tls ?? 0}) xong t=${r.end ?? '?'} cf=${r.cf || '-'}${r.fail ? ' LỖI ' + r.fail : ''}\n        body: ${r.body || '-'} #${r.bodyHash}\n        khởi tạo: ${r.ini}`);
    const byHost = {}; for (const r of ext) { const k = r.cls.replace('NGOÀI ', ''); (byHost[k] ||= []).push(r); }
    for (const [h, rs] of Object.entries(byHost)) console.log(`   NGOÀI ${h}: ${rs.length} lệnh, chờ ${rng(rs.map(r => r.wait))}ms${rs.some(r => r.ev.length) ? ' | sự kiện: ' + rs.flatMap(r => r.ev).join(', ') : ''}`);
  }
  // Woo Discount Rules
  const W = L.filter(r => /wdr_ajax/.test(r.body));
  if (W.length) {
    console.log(`\n-- WOO DISCOUNT RULES: ${W.length} lệnh`);
    for (const r of W) console.log(`   [${r.phase}] bắt đầu t=${r.t} xong t=${r.end} chờ ${r.wait}ms body#${r.bodyHash} ${r.body}\n        khởi tạo: ${r.ini}`);
    const groups = {}; for (const r of W) (groups[r.bodyHash] ||= []).push(r);
    for (const [h, g] of Object.entries(groups)) if (g.length > 1) { const overl = g.slice(1).every((r, i) => r.t < (g[i].end ?? Infinity)); console.log(`   => ${g.length} lệnh payload GIỐNG HỆT (#${h}, kể cả nonce): ${overl ? 'chạy SONG SONG (bắt đầu trước khi lệnh trước xong)' : 'NỐI TIẾP'}; cách nhau ${g.slice(1).map((r, i) => r.t - g[i].t).join(', ')}ms`); }
    for (const [k, v] of Object.entries(s.bodies || {})) console.log(`   phản hồi ${k.split('|')[1]}: ${v.map(x => `vid=${x.vid} ${x.len}B #${x.h}`).join(' ; ')}`);
  }
  // Tracking
  const evs = L.flatMap(r => r.ev.map(e => ({ e, t: r.t, ph: r.phase })));
  if (evs.length) { const c = {}; for (const x of evs) c[`${x.ph} | ${x.e}`] = (c[`${x.ph} | ${x.e}`] || 0) + 1; console.log('\n-- SỰ KIỆN ĐO LƯỜNG (pha | loại id tên: số lần)'); for (const [k, v] of Object.entries(c)) console.log(`   ${k}: ${v}${v > 1 ? '  <-- lặp' : ''}`); }
  if (s.listeners) { console.log('\n-- jQuery listener liên quan'); for (const l of s.listeners) console.log('   ' + l); }
  console.log(`\n-- Kết quả: URL ${s.url}; giỏ ${JSON.stringify(s.cart)}; tổng trên trang "${s.domPrice}"; lỗi JS: ${(s.errs || []).join(' | ') || 'không'}`);
  console.log(`-- Trình duyệt: ${JSON.stringify(s.script)}`);
  if (s.res) console.log('-- Tải theo máy chủ (số file, KB): ' + Object.entries(s.res).sort((a, b) => b[1].kb - a[1].kb).slice(0, 12).map(([h, o]) => `${h} ${o.n}/${Math.round(o.kb)}KB`).join(', '));
}
// Tổng hợp 3 lượt
console.log('\n================ TỔNG HỢP CÁC LƯỢT (thời gian chờ máy chủ, ms) ================');
const agg = {}; for (const s of all) for (const r of (s.list || [])) if (r.cls.startsWith('WP')) { const k = `${s.flow} | ${r.phase} | ${r.method} ${r.what}`; (agg[k] ||= []).push(r.wait); }
for (const [k, v] of Object.entries(agg)) console.log(`   ${k}: n=${v.length} giữa=${med(v)} khoảng=${rng(v)}`);
const mk = {}; for (const s of all) for (const [k, v] of Object.entries(s.mark || {})) (mk[s.flow + ' ' + k] ||= []).push(v);
console.log('\nMốc:'); for (const [k, v] of Object.entries(mk)) console.log(`   ${k}: ${v.join(', ')}`);
