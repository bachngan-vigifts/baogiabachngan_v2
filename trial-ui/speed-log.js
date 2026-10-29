// ĐO TỐC ĐỘ (menu tài khoản → "Đo tốc độ"): ghi thời gian các lời gọi API gần nhất trên máy này và tách ra
//  - Máy chủ: thời gian Edge xử lý (header Server-Timing): chờ kết nối CSDL (db), xử lý + số truy vấn (app), vùng chạy;
//  - Mạng: phần còn lại (đường truyền, hàng chờ trình duyệt, tải dữ liệu về).
// Chỉ giữ trong bộ nhớ của tab (300 lượt gần nhất), không gửi đi đâu. Nút "Sao chép" để gửi cho người hỗ trợ kỹ thuật.
const MAX = 300;
const entries = [];

/** "db;dur=12.5, app;dur=80;desc="9 queries", total;dur=95, region;desc="ap-southeast-1"" → số liệu. */
export function parseServerTiming(header) {
  const out = {};
  for (const part of String(header || '').split(',')) {
    const [name, ...params] = part.trim().split(';').map(s => s.trim());
    if (!name) continue;
    for (const p of params) {
      const [k, v = ''] = p.split('=');
      if (k === 'dur') out[name] = Number(v);
      if (k === 'desc') { const d = v.replace(/^"|"$/g, ''); if (name === 'app') out.queries = Number.parseInt(d, 10) || 0; else if (name === 'region') out.region = d; else if (name === 'dbregion') out.dbRegion = d; }
    }
  }
  return out;
}

/** Nhóm theo đường dẫn: bỏ query string, mã (uuid / số dài) → :id. */
export const routeOf = path => String(path || '').split('?')[0].replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:id').replace(/\/[A-Za-z0-9_%.-]*\d[A-Za-z0-9_%.-]{5,}(?=\/|$)/g, '/:id');

export function recordApi({ path, method = 'GET', ms, status = 0, serverTiming = '', at = Date.now() }) {
  const t = parseServerTiming(serverTiming);
  entries.push({ route: method + ' ' + routeOf(path), ms: Math.round(ms), status, at, server: t.total, db: t.db, app: t.app, queries: t.queries, region: t.region, dbRegion: t.dbRegion });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
}
export const speedEntries = () => entries.slice();

const pct = (xs, p) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
/** Tổng hợp: toàn bộ + theo từng API (trung vị, p90 tổng thời gian; trung vị máy chủ / chờ CSDL / số truy vấn; mạng = tổng − máy chủ). */
export function summarize(list = entries) {
  const stat = xs => {
    const total = xs.map(x => x.ms), server = xs.map(x => x.server), net = xs.filter(x => Number.isFinite(x.server)).map(x => x.ms - x.server);
    return { count: xs.length, median: pct(total, 0.5), p90: pct(total, 0.9), server: pct(server, 0.5), db: pct(xs.map(x => x.db), 0.5), queries: pct(xs.map(x => x.queries), 0.5), network: pct(net, 0.5) };
  };
  const groups = new Map();
  for (const e of list) { if (!groups.has(e.route)) groups.set(e.route, []); groups.get(e.route).push(e); }
  const routes = [...groups].map(([route, xs]) => ({ route, ...stat(xs) })).sort((a, b) => b.median * b.count - a.median * a.count);
  return { all: stat(list), routes, region: [...list].reverse().find(x => x.region)?.region || '', dbRegion: [...list].reverse().find(x => x.dbRegion)?.dbRegion || '' };
}

const fmt = n => Number.isFinite(n) ? Math.round(n).toLocaleString('vi-VN') + ' ms' : '–';
/** Văn bản gửi hỗ trợ kỹ thuật. */
export function speedReport(list = entries, nav = globalThis.navigator) {
  const s = summarize(list), conn = nav?.connection;
  const lines = [`Đo tốc độ CRM – ${new Date().toLocaleString('vi-VN')}`, `Số lượt: ${s.all.count} · vùng máy chủ: ${s.region || 'chưa rõ'} · vùng CSDL: ${s.dbRegion || 'chưa rõ'}` + (conn?.effectiveType ? ` · mạng: ${conn.effectiveType}${conn.rtt ? ` (rtt ${conn.rtt} ms)` : ''}` : ''),
    `Toàn bộ: trung vị ${fmt(s.all.median)}, p90 ${fmt(s.all.p90)} · máy chủ ${fmt(s.all.server)} (chờ CSDL ${fmt(s.all.db)}, ${Number.isFinite(s.all.queries) ? s.all.queries : '–'} truy vấn) · mạng ${fmt(s.all.network)}`, ''];
  for (const r of s.routes.slice(0, 15)) lines.push(`${r.route} ×${r.count}: ${fmt(r.median)} (p90 ${fmt(r.p90)}) · máy chủ ${fmt(r.server)} · CSDL chờ ${fmt(r.db)} · ${Number.isFinite(r.queries) ? r.queries : '–'} truy vấn · mạng ${fmt(r.network)}`);
  return lines.join('\n');
}

/** Hộp "Đo tốc độ": bảng tổng hợp + nút sao chép. Dựng bằng textContent (không chèn HTML). */
export function openSpeedDialog({ doc = document, toast = () => {} } = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  const dlg = el('dialog', 'speed-dialog'), s = summarize();
  const head = el('div', 'speed-head'), close = el('button', 'btn secondary', 'Đóng'); close.type = 'button'; close.onclick = () => dlg.close();
  head.append(el('h2', '', 'Đo tốc độ'), close);
  const note = el('p', 'muted', s.all.count
    ? `${s.all.count} lượt gọi gần nhất trên máy này. Trung vị ${fmt(s.all.median)} (p90 ${fmt(s.all.p90)}) – máy chủ ${fmt(s.all.server)}, trong đó chờ kết nối CSDL ${fmt(s.all.db)}; mạng ${fmt(s.all.network)}. Vùng máy chủ: ${s.region || 'chưa rõ'}, vùng CSDL: ${s.dbRegion || 'chưa rõ'}.`
    : 'Chưa có số liệu. Dùng app vài phút (mở các trang hay dùng) rồi mở lại mục này.');
  const table = el('table', 'data-table speed-table'), thead = el('thead'), tr = el('tr');
  for (const h of ['API', 'Lượt', 'Trung vị', 'p90', 'Máy chủ', 'Chờ CSDL', 'Truy vấn', 'Mạng']) tr.append(el('th', '', h));
  thead.append(tr); table.append(thead);
  const body = el('tbody');
  for (const r of s.routes.slice(0, 20)) {
    const row = el('tr');
    for (const v of [r.route, r.count, fmt(r.median), fmt(r.p90), fmt(r.server), fmt(r.db), Number.isFinite(r.queries) ? r.queries : '–', fmt(r.network)]) row.append(el('td', '', v));
    body.append(row);
  }
  table.append(body);
  const wrap = el('div', 'table-wrap'); wrap.append(table);
  const copy = el('button', 'btn primary', 'Sao chép để gửi hỗ trợ'); copy.type = 'button';
  copy.onclick = async () => { try { await globalThis.navigator.clipboard.writeText(speedReport()); toast('Đã sao chép số liệu đo tốc độ.'); } catch { toast('Không sao chép được – chụp màn hình bảng này để gửi.', 'err'); } };
  dlg.append(head, note, wrap, copy);
  doc.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  dlg.showModal();
  return dlg;
}
