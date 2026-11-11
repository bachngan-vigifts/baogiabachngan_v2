import {createReportScoreCard,reportScoreOverview,reportScoreText} from './report-scores.js';
import { cacheLineNode } from './report-cache.js';
/** Dashboard doanh số (read-only): biểu đồ SVG dựng bằng DOM API (không chuỗi HTML), dùng API đã xác thực của app. */
const SVG_NS = 'http://www.w3.org/2000/svg';
// Bảng màu đã kiểm định (CVD/tương phản): thực tế = xanh, dự kiến = cam; giai đoạn pipeline = thang xanh có thứ tự.
const COLOR = { actual: '#2a78d6', expected: '#eb6834', ramp: ['#86b6ef', '#3987e5', '#184f95'] };
const STAGES = [['consulting', 'Đang tư vấn'], ['quote_sent', 'Đã gửi báo giá'], ['negotiating', 'Đang thương lượng']];
const RANK = [['actual', 'Thực tế'], ['expected', 'Dự kiến'], ['pipeline', 'Pipeline']];
const PRESETS = [[1, 'Tháng này'], [3, '3 tháng'], [6, '6 tháng'], [12, '12 tháng']];
// KPI Sale: 4 phần điểm (thứ tự như phiếu lương) – 4 màu phân biệt được khi mù màu; phần chưa đạt tới 100% màu nền.
const KPI_PARTS = { newCustomers: '#2a78d6', transactions: '#eb6834', contracts: '#1a9e77', revenue: '#8e5bd0' };
/** Presentation only; the server still enforces each report's viewer scope. */
export const dashboardReportsOnly=user=>user?.role==='employee'&&user?.positionId==='sale-admin';
/** Merge only the current month and already authorized API projections. */
export function dashboardScorePeople(kpi,reports,month){
 const people=new Map();
 for(const data of [kpi,reports])if(data?.month===month)for(const p of data.members||[])if(!people.has(p.id))people.set(p.id,{id:p.id,name:p.name});
 return [...people.values()];
}
export const kpiPercent = v => `${(Math.round(v * 1000) / 10).toLocaleString('vi-VN')}%`;
/** Cùng ngưỡng màu với thanh mức đạt KPI; chỉ dùng để hiển thị. */
export const kpiAttainmentClass = value => value >= 0.9 ? 'is-high' : value >= 0.6 ? 'is-low' : 'is-poor';
/** Lát biểu đồ tròn KPI: các phần điểm > 0, thêm phần "Chưa đạt" khi tổng < 100%. Cả vòng = max(100%, tổng). */
export function kpiSlices(member) {
  const parts = member.parts.filter(p => p.points > 0).map(p => ({ key: p.key, label: p.label, value: p.points, color: KPI_PARTS[p.key] }));
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total < 1) parts.push({ key: 'missing', label: 'Chưa đạt 100%', value: 1 - total, color: 'var(--dash-track, #e3e9e6)' });
  const whole = Math.max(1, total);
  let at = 0;
  return parts.map(p => { const from = at / whole; at += p.value; return { ...p, from, to: at / whole }; });
}
/** Mức thưởng KPI theo mức đạt (chỉ tỷ lệ). */
const kpiBonus = m => m.bonusRate > 0 ? `Thưởng KPI ${(Math.round(m.bonusRate * 10000) / 100).toLocaleString('vi-VN')}% doanh số tính thưởng` : 'Chưa đạt mức thưởng KPI (dưới 60%)';

const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
const monthIndex = ym => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5)) - 1;
const addMonths = (ym, n) => { const i = monthIndex(ym) + n; return `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`; };
/** 1.234.000.000 → "1,2 tỷ"; 350.400.000 → "350 tr". */
export function compact(v) {
  const a = Math.abs(v), f = (x, unit) => `${(Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toLocaleString('vi-VN')} ${unit}`;
  return a >= 1e9 ? f(v / 1e9, 'tỷ') : a >= 1e6 ? f(v / 1e6, 'tr') : a >= 1e3 ? f(v / 1e3, 'k') : String(Math.round(v));
}
/** Trục "tròn": 0 → top chia 3–5 vạch. */
function niceScale(max) {
  if (!(max > 0)) return { top: 1, ticks: [0] };
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
  const top = Math.ceil(max / step - 1e-9) * step, ticks = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(t);
  return { top, ticks };
}
const monthLabel = (ym, i) => `T${Number(ym.slice(5))}${i === 0 || ym.endsWith('-01') ? '/' + ym.slice(2, 4) : ''}`;
const barUp = (x, y, w, h) => { const r = Math.min(4, w / 2, h); return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`; };
const barRight = (x, y, w, h) => { const r = Math.min(4, h / 2, w); return `M${x},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x}Z`; };

export function initDashboard({ api, root, isManager, money, user=()=>null }) {
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; };
  const svgRoot = (W, H, label) => { const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label }); s.style.width = W + 'px'; s.style.height = H + 'px'; return s; };
  const svg = (tag, attrs = {}, text) => { const n = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (text != null) n.textContent = String(text); return n; };
  const pct = r => r.closeRate == null ? '—' : `${String(r.closeRate).replace('.', ',')}%`;
  let requestId = 0, data = null, rankBy = 'actual', preset = 1;
  let filters = { from: thisMonth(), to: thisMonth(), owner: '', group: '', neglectDays: '30', page: '1' };
  let options = { employees: [], groups: [] };
  const viewerKey=()=>{const u=user();return JSON.stringify([u?.id,u?.role,u?.positionId,Array.isArray(u?.perms)?[...u.perms].sort():null]);};
  let viewer=viewerKey();

  const wrap = node('div', null, 'revenue-dashboard'); root.append(wrap);
  const head = node('div', null, 'dash-head'), meta = node('p', null, 'dash-meta');
  // Bản tính sẵn 30 phút (máy chủ) – "Cập nhật" tính lại mọi khối của trang.
  const cacheSlot = node('div', null, 'dash-cache');
  head.append(node('h1', 'Tổng quan'), meta, cacheSlot);
  const fresh = refresh => refresh === true ? { refresh: '1' } : {};
  const form = node('form', null, 'dash-filters'), content = node('div', null, 'dash-content');
  const tip = node('div', null, 'dash-tip'); tip.hidden = true; tip.setAttribute('role', 'tooltip');
  wrap.append(head, form, content, tip);

  // ---- Bộ lọc: một hàng, kỳ trước tiên (preset → tuỳ chọn), áp dụng cho mọi biểu đồ bên dưới.
  const seg = node('div', null, 'dash-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Kỳ xem');
  const presetButtons = PRESETS.map(([n, label]) => {
    const b = node('button', label); b.type = 'button'; b.dataset.months = String(n);
    b.addEventListener('click', () => { preset = n; filters.to = thisMonth(); filters.from = addMonths(filters.to, 1 - n); apply(); });
    seg.append(b); return b;
  });
  form.append(seg);
  const field = (title, key, type) => {
    const label = node('label', null, 'dash-field'), input = node('input'); label.append(node('span', title), input);
    input.type = type; input.name = key; if (type === 'number') { input.min = '1'; input.max = '365'; input.inputMode = 'numeric'; }
    form.append(label); return input;
  };
  const from = field('Từ', 'from', 'month'), to = field('Đến', 'to', 'month');
  const select = (title, key) => { const label = node('label', null, 'dash-field'), s = node('select'); s.name = key; label.append(node('span', title), s); form.append(label); return s; };
  const group = select('Nhóm', 'group'), owner = select('Nhân viên', 'owner');
  const fillSelect = (s, rows, all) => { s.replaceChildren(); const any = node('option', all); any.value = ''; s.append(any); for (const r of rows) { const o = node('option', r.name); o.value = r.id; s.append(o); } s.value = filters[s.name]; };
  const syncForm = () => {
    from.value = filters.from; to.value = filters.to;
    const span = monthIndex(filters.to) - monthIndex(filters.from) + 1;
    for (const b of presetButtons) b.setAttribute('aria-pressed', String(filters.to === thisMonth() && Number(b.dataset.months) === span && preset === span));
  };
  function apply() { filters.page = '1'; syncForm(); load(); }
  form.addEventListener('change', e => {
    const t = e.target; if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement) || (!t.value&&t instanceof HTMLInputElement)) return;
    filters[t.name] = t.value; preset = 0;
    if (t === from && to.value < from.value) filters.to = from.value;
    if (t === to && to.value < from.value) filters.from = to.value;
    if (monthIndex(filters.to) - monthIndex(filters.from) > 11) { if (t === from) filters.to = addMonths(filters.from, 11); else filters.from = addMonths(filters.to, -11); }
    apply();
  });
  form.addEventListener('submit', e => { e.preventDefault(); apply(); });

  // ---- Tooltip: một ô duy nhất; giá trị đậm trước, nhãn sau; hiện cả khi focus bàn phím.
  const showTip = (e, title, rows) => {
    tip.replaceChildren(node('div', title, 'dash-tip-title'));
    for (const r of rows) { const line = node('div', null, 'dash-tip-row'), key = node('i'); key.style.background = r.color || 'transparent'; line.append(key, node('strong', r.value), node('span', r.label)); tip.append(line); }
    tip.hidden = false;
    const box = e.currentTarget.getBoundingClientRect(), x = e.clientX ?? box.left + box.width / 2, y = e.clientY ?? box.top, t = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(innerWidth - t.width - 8, x + 14)) + 'px';
    tip.style.top = (y - t.height - 12 < 8 ? y + 18 : y - t.height - 12) + 'px';
  };
  const hideTip = () => { tip.hidden = true; };
  const hover = (el, read, onEnter, onLeave) => {
    el.setAttribute('tabindex', '0'); el.classList.add('dash-hit');
    const enter = e => { onEnter?.(); const [title, rows] = read(); showTip(e, title, rows); };
    const leave = () => { onLeave?.(); hideTip(); };
    el.addEventListener('pointermove', enter); el.addEventListener('pointerdown', enter); el.addEventListener('focus', enter);
    el.addEventListener('pointerleave', leave); el.addEventListener('blur', leave);
  };

  // ---- Biểu đồ cột theo tháng (nhiều chuỗi, một trục).
  function columnChart(host, months, series, label) {
    const W = Math.max(280, host.clientWidth), H = 260, L = 52, R = 6, T = 22, B = 30, plotH = H - T - B;
    const { top, ticks } = niceScale(Math.max(0, ...months.flatMap(m => series.map(s => m[s.key]))));
    const y = v => T + plotH * (1 - v / top), s = svgRoot(W, H, label);
    for (const t of ticks) { s.append(svg('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: 'dash-gridline' }), svg('text', { x: L - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'dash-axis' }, compact(t))); }
    const band = (W - L - R) / months.length, n = series.length, bw = Math.max(3, Math.min(24, (band * 0.72 - 2 * (n - 1)) / n)), gw = bw * n + 2 * (n - 1);
    const peak = months.reduce((best, m, i) => m[series[0].key] > (months[best]?.[series[0].key] ?? 0) ? i : best, -1);
    const every = Math.ceil(months.length / Math.max(1, Math.floor((W - L) / 44)));
    months.forEach((m, i) => {
      const x0 = L + band * i + (band - gw) / 2, g = svg('g');
      series.forEach((se, j) => { const v = m[se.key]; if (v > 0) g.append(svg('path', { d: barUp(x0 + j * (bw + 2), y(v), bw, y(0) - y(v)), fill: se.color })); });
      if (i === peak) g.append(svg('text', { x: x0 + bw / 2, y: y(m[series[0].key]) - 6, 'text-anchor': 'middle', class: 'dash-label' }, compact(m[series[0].key])));
      if (i % every === 0 || i === months.length - 1) g.append(svg('text', { x: L + band * i + band / 2, y: H - 10, 'text-anchor': 'middle', class: 'dash-axis' }, monthLabel(m.month, i)));
      const hit = svg('rect', { x: L + band * i, y: T, width: band, height: plotH, fill: 'transparent' });
      hover(hit, () => [`Tháng ${m.month.slice(5)}/${m.month.slice(0, 4)}`, series.map(se => ({ color: se.color, value: money(m[se.key]), label: se.label }))],
        () => g.classList.add('is-on'), () => g.classList.remove('is-on'));
      s.append(g, hit);
    });
    s.append(svg('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), class: 'dash-base' }));
    if (top === 1 && ticks.length === 1) s.append(svg('text', { x: (L + W) / 2, y: T + plotH / 2, 'text-anchor': 'middle', class: 'dash-empty' }, 'Chưa có doanh số trong kỳ'));
    host.replaceChildren(s);
  }

  // ---- Đường tỷ lệ chốt theo tháng (0–100%), crosshair theo tháng.
  function lineChart(host, months, label) {
    const W = Math.max(280, host.clientWidth), H = 220, L = 40, R = 30, T = 16, B = 30, plotH = H - T - B;
    const s = svgRoot(W, H, label);
    const step = (W - L - R) / Math.max(1, months.length - 1), x = i => months.length === 1 ? (L + W - R) / 2 : L + step * i, y = v => T + plotH * (1 - v / 100);
    for (const t of [0, 25, 50, 75, 100]) s.append(svg('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: t ? 'dash-gridline' : 'dash-base' }), svg('text', { x: L - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'dash-axis' }, t + '%'));
    const pts = months.map((m, i) => m.closeRate == null ? null : [x(i), y(m.closeRate)]);
    let d = '', area = '', run = [];
    const flush = () => { if (run.length > 1) area += `M${run[0][0]},${y(0)}` + run.map(p => `L${p[0]},${p[1]}`).join('') + `L${run.at(-1)[0]},${y(0)}Z`; run = []; };
    pts.forEach(p => { if (!p) { flush(); return; } d += (run.length ? 'L' : 'M') + p[0] + ',' + p[1]; run.push(p); }); flush();
    s.append(svg('path', { d: area, class: 'dash-area' }), svg('path', { d, class: 'dash-line' }));
    const cross = svg('line', { y1: T, y2: y(0), class: 'dash-cross', visibility: 'hidden' }); s.append(cross);
    const every = Math.ceil(months.length / Math.max(1, Math.floor((W - L) / 44))), last = pts.findLastIndex(Boolean);
    months.forEach((m, i) => {
      if (i % every === 0 || i === months.length - 1) s.append(svg('text', { x: x(i), y: H - 10, 'text-anchor': 'middle', class: 'dash-axis' }, monthLabel(m.month, i)));
      if (pts[i]) s.append(svg('circle', { cx: pts[i][0], cy: pts[i][1], r: 4, class: 'dash-dot' }));
      const w = months.length === 1 ? W - L - R : step, hit = svg('rect', { x: Math.max(L - 10, x(i) - w / 2), y: T, width: w, height: plotH, fill: 'transparent' });
      hover(hit, () => [`Tháng ${m.month.slice(5)}/${m.month.slice(0, 4)}`, [{ color: COLOR.actual, value: pct(m), label: `${m.converted}/${m.quotes} báo giá thành đơn` }]],
        () => { cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible'); }, () => cross.setAttribute('visibility', 'hidden'));
      s.append(hit);
    });
    if (last < 0) s.append(svg('text', { x: (L + W - R) / 2, y: T + plotH / 2, 'text-anchor': 'middle', class: 'dash-empty' }, 'Chưa có báo giá trong kỳ'));
    if (last >= 0) s.append(svg('text', { x: Math.min(pts[last][0] + 8, W - 2), y: pts[last][1] - 8, 'text-anchor': pts[last][0] + 40 > W ? 'end' : 'start', class: 'dash-label' }, pct(months[last])));
    host.replaceChildren(s);
  }

  // ---- Thanh ngang: nhãn phía trên thanh (đọc được trên điện thoại), giá trị ở đầu thanh.
  function barList(host, rows, label) {
    const W = Math.max(260, host.clientWidth), rowH = 42, valueW = 70, H = rows.length * rowH + 4, max = Math.max(0, ...rows.map(r => r.value)) || 1;
    const s = svgRoot(W, H, label);
    rows.forEach((r, i) => {
      const y0 = i * rowH, w = r.value > 0 ? Math.max(4, (W - valueW) * r.value / max) : 0, g = svg('g');
      g.append(svg('text', { x: 0, y: y0 + 14, class: 'dash-name' }, r.label));
      g.append(svg('rect', { x: 0, y: y0 + 21, width: W - valueW, height: 14, rx: 4, class: 'dash-track' }));
      if (w) g.append(svg('path', { d: barRight(0, y0 + 21, w, 14), fill: r.color }));
      g.append(svg('text', { x: w + 8, y: y0 + 32, class: 'dash-label' }, compact(r.value)));
      const hit = svg('rect', { x: 0, y: y0, width: W, height: rowH, fill: 'transparent' });
      hover(hit, () => [r.label, [{ color: r.color, value: money(r.value), label: r.sub || '' }]], () => g.classList.add('is-on'), () => g.classList.remove('is-on'));
      s.append(g, hit);
    });
    host.replaceChildren(s);
  }

  // ---- Bảng số liệu (không cần hover vẫn đọc được mọi giá trị).
  const dataTable = (headers, rows, open = false) => {
    const d = node('details', null, 'dash-table'); d.open = open; d.append(node('summary', 'Bảng số liệu'));
    const box = node('div', null, 'revenue-table-scroll'), t = node('table'), hr = node('tr'), body = node('tbody');
    for (const h of headers) hr.append(node('th', h)); const th = node('thead'); th.append(hr); t.append(th);
    for (const cells of rows) { const r = node('tr'); for (const v of cells) { const c = node('td'); if (v instanceof Node) c.append(v); else c.textContent = String(v ?? '—'); r.append(c); } body.append(r); }
    if (!rows.length) { const r = node('tr'), c = node('td', 'Chưa có dữ liệu trong kỳ.'); c.colSpan = headers.length; r.append(c); body.append(r); }
    t.append(body); box.append(t); d.append(box); return d;
  };
  const card = (title, sub, cls = '') => { const c = node('section', null, 'card dash-card ' + cls), h = node('div', null, 'dash-card-head'); h.append(node('h2', title)); if (sub) h.append(node('p', sub, 'dash-sub')); c.append(h); return c; };
  const legend = items => { const l = node('div', null, 'dash-legend'); for (const [color, label] of items) { const k = node('span'), sw = node('i'); sw.style.background = color; k.append(sw, document.createTextNode(label)); l.append(k); } return l; };
  const tile = (label, value, sub, cls = '') => { const t = node('div', null, 'dash-tile ' + cls); t.append(node('p', label, 'dash-tile-label'), node('strong', value)); if (sub) t.append(node('p', sub, 'dash-tile-sub')); return t; };

  // ---- Điểm KPI Sale (tải riêng sau doanh số; cùng bộ lọc, tháng cuối kỳ mặc định).
  let kpiData = null, kpiMonth = '', kpiPick = '', kpiRequest = 0, kpiLoading=true, kpiError='';
  let reportData=null,reportRequest=0,reportLoading=true,reportError='';
  const reportDetailsOpen=new Map(),ownReportsOnly=()=>dashboardReportsOnly(user());
  const kpiCard = card('KPI Sale & báo cáo tuần / tháng', null, 'is-wide dash-kpi-card'), kpiBody = node('div', null, 'dash-kpi');
  const kpiMonthSelect = node('select', null, 'dash-mini'); kpiMonthSelect.setAttribute('aria-label', 'Tháng xem KPI và báo cáo');
  kpiMonthSelect.addEventListener('change', () => { kpiMonth = kpiMonthSelect.value; loadScorePanels(); });
  kpiCard.firstChild.append(kpiMonthSelect); kpiCard.append(kpiBody);
  const ring = (cx, cy, R, r, a0, a1) => {
    const pt = (rad, a) => [cx + rad * Math.sin(a * 2 * Math.PI), cy - rad * Math.cos(a * 2 * Math.PI)].map(v => Math.round(v * 100) / 100).join(',');
    const large = a1 - a0 > 0.5 ? 1 : 0;
    return `M${pt(R, a0)}A${R},${R} 0 ${large} 1 ${pt(R, a1)}L${pt(r, a1)}A${r},${r} 0 ${large} 0 ${pt(r, a0)}Z`;
  };
  function kpiDonut(m) {
    const S = 220, c = S / 2, R = 100, r = 66, s = svgRoot(S, S, `Biểu đồ tròn điểm KPI của ${m.name}: tổng ${kpiPercent(m.total)}`);
    s.classList.add('dash-donut');
    for (const sl of kpiSlices(m)) {
      // Một lát trọn vòng: chia đôi để cung SVG không suy biến.
      const segs = sl.to - sl.from >= 0.999 ? [[sl.from, sl.from + 0.5], [sl.from + 0.5, sl.to]] : [[sl.from, sl.to]];
      const g = svg('g');
      for (const [a, b] of segs) g.append(svg('path', { d: ring(c, c, R, r, a, segs.length > 1 ? b : b - Math.min(0.002, (b - a) / 3)), fill: sl.color, class: sl.key === 'missing' ? 'dash-donut-missing' : '' }));
      hover(g, () => [sl.label, [{ color: sl.color, value: kpiPercent(sl.value), label: sl.key === 'missing' ? 'còn thiếu để đạt 100%' : 'điểm KPI' }]], () => g.classList.add('is-on'), () => g.classList.remove('is-on'));
      s.append(g);
    }
    s.append(svg('text', { x: c, y: c + 2, 'text-anchor': 'middle', class: `dash-donut-value dash-kpi-score ${kpiAttainmentClass(m.total)}` }, kpiPercent(m.total)),
      svg('text', { x: c, y: c + 24, 'text-anchor': 'middle', class: 'dash-donut-label', style: 'font-weight:400;font-size:12px' }, 'Tổng điểm KPI'));
    return s;
  }
  function kpiDetail(m) {
    const box = node('div', null, 'dash-kpi-detail'), t = node('table', null, 'dash-kpi-table'), head = node('tr'), body = node('tbody');
    for (const h of ['Chỉ tiêu', 'Thực tế', 'Điểm']) head.append(node('th', h));
    const th = node('thead'); th.append(head); t.append(th);
    const count = v => v == null ? 'Chưa nhập' : Number(v).toLocaleString('vi-VN');
    for (const p of m.parts) {
      const tr = node('tr'), name = node('td'), sw = node('i', null, 'dash-kpi-key'); sw.style.background = KPI_PARTS[p.key]; name.append(sw, document.createTextNode(p.label));
      // Hai dòng mỗi ô: số chính + chỉ tiêu / điểm tối đa (vừa màn hình điện thoại, không cuộn ngang).
      const two = (main, sub) => { const td = node('td'); td.append(node('strong', main), node('small', sub)); return td; };
      const actual = p.key === 'revenue' ? money(p.actual ?? 0) : count(p.actual) + (p.extra ? ` + ${p.extra.toLocaleString('vi-VN')} quy đổi` : '');
      tr.append(name, two(actual, (p.own ? 'chỉ tiêu riêng ' : 'chỉ tiêu ') + (p.key === 'revenue' ? money(p.target) : p.target.toLocaleString('vi-VN'))),
        two(kpiPercent(p.points), p.max == null ? 'không giới hạn' : 'tối đa ' + kpiPercent(p.max)));
      body.append(tr);
    }
    const sum = node('tr', null, 'is-total'); sum.append(node('td', 'Tổng điểm KPI'), node('td', ''), node('td', kpiPercent(m.total), `dash-kpi-score ${kpiAttainmentClass(m.total)}`)); body.append(sum);
    t.append(body);
    const scroll = node('div', null, 'revenue-table-scroll'); scroll.append(t);
    const notes = node('ul', null, 'dash-kpi-notes');
    const note = text => notes.append(node('li', text));
    if (m.adjustedBy) note(`Điểm thực tế theo chỉ tiêu: ${kpiPercent(m.total)}. Bảng lương áp dụng ${m.adjustedBy === 'fixed' ? 'KPI cố định trong hồ sơ' : 'KPI chốt'} ${kpiPercent(m.used)}; mức này không thay thế điểm thực tế trên Tổng quan.`);
    note((m.adjustedBy ? 'Theo KPI áp dụng trên bảng lương: ' : '') + kpiBonus(m) + '.');
    note(m.status === 'estimate' ? 'Tạm tính theo số liệu hiện tại; chốt lương sẽ giữ cố định.' : 'Theo phiếu lương đã chốt (số lúc chốt).');
    note(m.source === 'crm' ? 'KH mới: hồ sơ đã duyệt trong kỳ, tính cho người tạo, không cần đơn hàng. Giao dịch và số HĐKT lấy tự động từ CRM.' : 'KH mới, giao dịch, số HĐKT theo số nhập trên bảng lương.');
    if (m.crmPreview != null) note(`KPI tính từ CRM (đối chiếu, chưa áp dụng): ${kpiPercent(m.crmPreview)}.`);
    if (m.merchDays || m.tripDays) note(`Đã cộng quy đổi ${m.merchDays} ngày làm hàng, ${m.tripDays} ngày công tác.`);
    box.append(scroll, notes); return box;
  }
  function loadMessage(body,message,retry){
    const b=node('button','Thử lại','btn secondary small');b.type='button';b.onclick=retry;
    body.replaceChildren(node('p',message,'error'),b);
  }
  // One employee and one month drive both panels, including Sale Admin without a sales KPI.
  function renderKpi() {
    const people=dashboardScorePeople(kpiData,reportData,kpiMonth);
    const reportFirst=reportData?.month===kpiMonth&&reportData.members.length&&reportData.members.every(p=>p.positionId==='sale-admin')?people.find(p=>p.id===reportData.members[0].id):null;
    const person=people.find(p=>p.id===kpiPick)||reportFirst||(!kpiLoading&&(!kpiPick||!reportLoading)?people[0]:null);if(person)kpiPick=person.id;
    const m=kpiData?.members.find(m=>m.id===kpiPick),selectedReport=reportData?.members.find(p=>p.id===kpiPick);
    const reportsOnly=ownReportsOnly()||!m&&selectedReport?.positionId==='sale-admin';
    kpiCard.classList.toggle('is-reports-only',reportsOnly);
    kpiCard.hidden=!kpiLoading&&!reportLoading&&!kpiError&&!reportError&&!kpiData?.available&&!reportData?.available;
    kpiMonthSelect.replaceChildren(...(data?.months?.map(m=>m.month)||[kpiMonth]).map(month=>{const o=node('option',`T${Number(month.slice(5))}/${month.slice(0,4)}`);o.value=month;return o;}));
    kpiMonthSelect.value=kpiMonth;kpiMonthSelect.hidden=kpiMonthSelect.options.length<2;
    kpiCard.firstChild.querySelector('h2').textContent=reportsOnly?'Báo cáo tuần / tháng · Sale Admin':'KPI Sale & báo cáo tuần / tháng';
    const sub=kpiCard.firstChild.querySelector('.dash-sub')||node('p',null,'dash-sub');sub.textContent=`Tháng ${Number(kpiMonth.slice(5))}/${kpiMonth.slice(0,4)} · ${reportsOnly?'điểm và trạng thái báo cáo của nhân viên':'KPI và báo cáo hiển thị riêng, cùng nhân viên'}`;kpiCard.firstChild.insertBefore(sub,kpiMonthSelect);
    const out=[];
    if(people.length>1){
      const list=node('ol',null,'dash-kpi-list');list.setAttribute('aria-label','Chọn nhân viên xem KPI và báo cáo');
      for(const p of people){
        const li=node('li'),b=node('button',null,'dash-kpi-person');b.type='button';b.setAttribute('aria-pressed',String(p.id===kpiPick));b.dataset.scoreMember=p.id;
        b.append(node('span',p.name,'dash-kpi-person-name'));
        const k=kpiData?.members.find(m=>m.id===p.id);
        if(k){const bar=node('span',null,'dash-kpi-bar'),fill=node('i');fill.style.width=Math.min(100,k.total*100)+'%';fill.className=kpiAttainmentClass(k.total);bar.append(fill);b.append(bar,node('strong',kpiPercent(k.total),`dash-kpi-score ${kpiAttainmentClass(k.total)}`));}
        else {
          const report=reportData?.members.find(r=>r.id===p.id),summary=reportScoreOverview(report);
          b.append(node('strong',report?reportScoreText(report):'Đang tải…','dash-report-person-points'));
          if(summary)b.append(node('small',`Tuần ${summary.submitted}/${summary.total} đã nộp · Tháng: ${summary.monthly}`,'dash-report-person-summary'));
        }
        b.onclick=()=>{kpiPick=p.id;renderKpi();};li.append(b);list.append(li);
      }out.push(list);
    }
    const body=node('div');body.setAttribute('aria-busy',String(kpiLoading));
    body.hidden=reportsOnly;
    if(!reportsOnly){
    if(kpiLoading)body.append(node('p','Đang tính KPI…','dash-sub'));
    else if(kpiError)loadMessage(body,kpiError,()=>loadKpi(true));
    else if(m){
      const main=node('div',null,'dash-kpi-main'),chart=node('div',null,'dash-kpi-chart');
      chart.append(node('p',m.name,'dash-kpi-name'),kpiDonut(m),legend(m.parts.map(p=>[KPI_PARTS[p.key],p.label])));main.append(chart,kpiDetail(m));body.append(main);
    }else body.append(node('p',person?`${person.name}: chưa có KPI Sale trong tháng này (chưa bật KPI hoặc không thuộc bảng Sale).`:'Không có KPI Sale trong tháng và phạm vi đang xem.','dash-sub'));
    }
    if(kpiData?.restricted)out.push(node('p','Chỉ hiện điểm của bạn – điểm nhân viên khác chỉ Manager xem.','dash-sub'));
    kpiBody.replaceChildren(...out,body);kpiBody.hidden=reportsOnly&&!out.length;renderReports();
  }
  async function loadKpi(refresh) {
    const id=++kpiRequest;if(!data)return;kpiLoading=true;kpiError='';renderKpi();
    try{const result=await api('/dashboard/kpi?'+new URLSearchParams({from:filters.from,to:filters.to,owner:filters.owner,group:filters.group,month:kpiMonth,...fresh(refresh)}));if(id!==kpiRequest)return;kpiData=result;}
    catch(e){if(id!==kpiRequest)return;kpiData=null;kpiError=e.message||'Chưa tính được KPI.';}
    finally{if(id===kpiRequest){kpiLoading=false;renderKpi();}}
  }
  const reportCard=node('section',null,'dash-report-card'),reportBody=node('div',null,'dash-report-body');
  reportCard.append(node('h3','Báo cáo tuần / tháng'),reportBody);kpiCard.append(reportCard);
  function renderReports(){
    const pendingMember=ownReportsOnly()?user()?.id:kpiPick;
    reportCard.classList.toggle('is-details-collapsed',reportDetailsOpen.get(kpiMonth+':'+pendingMember)===false);
    reportBody.setAttribute('aria-busy',String(reportLoading));
    if(reportLoading||kpiLoading&&!dashboardScorePeople(kpiData,reportData,kpiMonth).some(p=>p.id===kpiPick)){reportBody.replaceChildren(node('p','Đang tải điểm báo cáo…','dash-sub'));return;}
    if(reportError){loadMessage(reportBody,reportError,()=>loadReports(true));return;}
    const member=reportData?.members.find(m=>m.id===kpiPick);
    if(!member){reportBody.replaceChildren(node('p','Chưa có điểm báo cáo tuần / tháng cho nhân viên này trong kỳ đang xem.','dash-sub'));return;}
    const summary=reportScoreOverview(member),children=[node('p',member.name,'dash-kpi-name')];
    if(summary){
      const stats=node('div',null,'dash-report-stats');
      const stat=(key,label,value,sub)=>{const n=tile(label,value,sub);n.dataset.reportStat=key;return n;};
      stats.append(stat('weekly','Báo cáo tuần',`${summary.submitted} / ${summary.total} đã nộp`,`${summary.onTime} đúng hạn · ${summary.late} trễ · ${summary.missing} chưa nộp · ${summary.notDue} chưa tới hạn · ${summary.excused} miễn`),
        stat('monthly','Báo cáo tháng',summary.monthly,'Theo kết quả nộp và duyệt'),stat('pending','Chờ duyệt',String(summary.pending),'Kỳ báo cáo tuần / tháng'),stat('points','Tổng điểm báo cáo',summary.points,'Tách riêng với tổng điểm KPI'));
      children.push(stats);
    }
    const details=node('details',null,'dash-report-details'),detailKey=kpiMonth+':'+member.id;
    details.open=reportDetailsOpen.get(detailKey)??member.positionId==='sale-admin';
    details.addEventListener('toggle',()=>{if(details.isConnected)reportDetailsOpen.set(detailKey,details.open);});
    details.append(node('summary','Chi tiết từng tuần / tháng và hạn nộp'),createReportScoreCard(member));children.push(details);
    const links=node('div',null,'dash-report-links');for(const [path,label]of [['weekly-reports','Xem báo cáo tuần'],['monthly-reports','Xem báo cáo tháng']]){const a=node('a',label,'btn ghost small');a.href='#/'+path+'?month='+encodeURIComponent(kpiMonth);links.append(a);}children.push(links);
    // Source/snapshot semantics are visible even while the detailed table is collapsed.
    children.push(node('p',member.source==='snapshot'?'Theo bản lưu lúc chốt lương.':member.source==='live'?'Tạm tính theo báo cáo và kết quả duyệt hiện tại.':'Phiếu đã chốt chưa có bản lưu điểm báo cáo; không thay bằng điểm hiện tại.','dash-sub'));
    reportBody.replaceChildren(...children);
  }
  async function loadReports(refresh){
    const id=++reportRequest;if(!data)return;reportLoading=true;reportError='';renderReports();
    try{const result=await api('/dashboard/report-scores?'+new URLSearchParams({from:filters.from,to:filters.to,owner:filters.owner,group:filters.group,month:kpiMonth,...fresh(refresh)}));if(id!==reportRequest)return;reportData=result;}
    catch(e){if(id!==reportRequest)return;reportData=null;reportError=e.message||'Chưa tải được điểm báo cáo.';}
    finally{if(id===reportRequest){reportLoading=false;renderKpi();}}
  }
  function loadScorePanels(refresh){
    ++kpiRequest;++reportRequest;kpiData=reportData=null;kpiError=reportError='';kpiLoading=reportLoading=true;
    const months=data.months.map(m=>m.month);if(!months.includes(kpiMonth))kpiMonth=months.at(-1);
    if(ownReportsOnly()){kpiLoading=false;kpiData={month:kpiMonth,available:false,scope:'self',members:[]};}
    renderKpi();if(!ownReportsOnly())loadKpi(refresh);loadReports(refresh);
  }

  // ---- Doanh số cửa hàng (NVBH / CHT): DS chung CRM + POS, chỉ tiêu, mốc thưởng, DS từng người. Tải riêng như KPI.
  let storeData = null, storeMonth = '', storeRequest = 0;
  const storeCard = card('Doanh số cửa hàng', null, 'is-wide dash-store-card'), storeBody = node('div', null, 'dash-store');
  const storeMonthSelect = node('select', null, 'dash-mini'); storeMonthSelect.setAttribute('aria-label', 'Tháng xem doanh số cửa hàng');
  storeMonthSelect.addEventListener('change', () => { storeMonth = storeMonthSelect.value; loadStore(); });
  storeCard.firstChild.append(storeMonthSelect); storeCard.append(storeBody); storeCard.hidden = true;
  const rateText = r => `${(Math.round(r * 10000) / 100).toLocaleString('vi-VN')}%`;
  function storeBlock(st, x) {
    const box = node('div', null, 'dash-store-one'), ratio = st.target > 0 ? st.revenue / st.target : 0;
    const hit = t => t.strict ? st.revenue > t.at : st.revenue >= t.at;
    const reached = st.tiers.filter(hit), nextTier = st.tiers.find(t => !hit(t));
    // Dự báo cuối tháng chỉ khi đang xem tháng hiện tại (theo nhịp bán từ đầu tháng tới hôm nay).
    const current = x.month === x.today.slice(0, 7), day = Number(x.today.slice(8, 10));
    const days = new Date(Date.UTC(+x.month.slice(0, 4), +x.month.slice(5), 0)).getUTCDate();
    const forecast = current && day > 0 ? Math.round(st.revenue / day * days) : null;
    box.append(node('h3', st.name, 'dash-store-name'));
    const tiles = node('div', null, 'dash-kpis dash-store-tiles');
    tiles.append(
      tile('DS chung cửa hàng', compact(st.revenue), `${money(st.revenue)} · CRM ${compact(st.crm)} + POS ${compact(st.pos)}`, 'is-hero'),
      tile('Chỉ tiêu tháng', compact(st.target), money(st.target)),
      tile('Tỷ lệ đạt', kpiPercent(ratio), ratio >= 1 ? 'Đã vượt chỉ tiêu' : `Còn thiếu ${money(Math.max(0, st.target - st.revenue))}`),
      tile('Mức thưởng đang đạt', st.rate > 0 ? rateText(st.rate) : 'Chưa đạt', st.rate > 0 ? `≈ ${money(st.bonusPerPerson)}/người (chia ${st.split})` : nextTier ? `Mốc đầu: ${money(nextTier.at)}` : ''),
      tile('Mốc tiếp theo', nextTier ? `+${compact(nextTier.at - st.revenue)}` : 'Đã đạt hết', nextTier ? `${nextTier.strict ? 'Vượt' : 'Đạt'} ${money(nextTier.at)} → thưởng ${rateText(nextTier.rate)}` : 'Đã đạt mốc cao nhất'),
      ...(forecast != null ? [tile('Dự báo cuối tháng', compact(forecast), `Theo nhịp ${day}/${days} ngày · ${kpiPercent(st.target ? forecast / st.target : 0)} chỉ tiêu`)] : []));
    // Thanh tiến độ: vạch tại từng mốc thưởng; thang tới max(mốc cao nhất × 1,1, DS).
    const top = Math.max(st.target, ...st.tiers.map(t => t.at), st.revenue) * 1.1 || 1;
    const bar = node('div', null, 'dash-store-bar'), fill = node('i', null, reached.length ? 'is-on' : '');
    bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', `Đạt ${kpiPercent(ratio)} chỉ tiêu`);
    fill.style.width = Math.min(100, st.revenue / top * 100) + '%'; bar.append(fill);
    for (const t of st.tiers) { const mark = node('span', null, 'dash-store-mark' + (hit(t) ? ' is-done' : '')); mark.style.left = (t.at / top * 100) + '%'; mark.title = `${money(t.at)} → ${rateText(t.rate)}`; bar.append(mark); }
    const tierTable = node('table', null, 'dash-kpi-table dash-store-tiers'), th = node('thead'), hr = node('tr'), tb = node('tbody');
    for (const h of ['Mốc thưởng', 'DS cần đạt', 'Tỷ lệ thưởng', 'Thưởng tối thiểu / người', 'Trạng thái']) hr.append(node('th', h));
    th.append(hr); tierTable.append(th);
    st.tiers.forEach((t, i) => {
      const tr = node('tr', null, hit(t) ? 'is-done' : '');
      tr.append(node('td', `Mốc ${i + 1} · ${t.strict ? 'trên' : 'từ'} ${kpiPercent(st.target ? t.at / st.target : 0)} chỉ tiêu`), node('td', money(t.at)), node('td', rateText(t.rate) + ' DS'),
        node('td', money(Math.round(t.at * t.rate / st.split))), node('td', hit(t) ? 'Đã đạt' : `Còn ${money(Math.max(0, t.at - st.revenue))}${t.strict ? ' (phải vượt)' : ''}`));
      tb.append(tr);
    });
    tierTable.append(tb);
    const tierScroll = node('div', null, 'revenue-table-scroll'); tierScroll.append(tierTable);
    const people = node('table', null, 'dash-kpi-table dash-store-people'), ph = node('thead'), phr = node('tr'), pb = node('tbody');
    for (const h of ['Nhân viên', 'DS CRM', 'DS POS', 'Tổng', 'Đóng góp', 'So chỉ tiêu']) phr.append(node('th', h));
    ph.append(phr); people.append(ph);
    for (const m of st.members) {
      const tr = node('tr', null, m.id === x.me ? 'is-me' : ''), name = node('td');
      name.append(document.createTextNode(m.name + (m.active ? '' : ' (nghỉ)')));
      if (m.storeManager) name.append(node('span', 'CHT', 'dash-pill'));
      tr.append(name, node('td', money(m.crm)), node('td', money(m.pos)), node('td', money(m.total)),
        node('td', st.revenue > 0 ? kpiPercent(m.total / st.revenue) : '—'), node('td', st.target > 0 ? kpiPercent(m.total / st.target) : '—'));
      pb.append(tr);
    }
    if (!st.members.length) { const tr = node('tr'), td = node('td', 'Chưa có nhân viên trong cửa hàng.'); td.colSpan = 6; tr.append(td); pb.append(tr); }
    const sum = node('tr', null, 'is-total'); sum.append(node('td', 'Cả cửa hàng'), node('td', money(st.crm)), node('td', money(st.pos)), node('td', money(st.revenue)), node('td', '100%'), node('td', kpiPercent(ratio))); pb.append(sum);
    people.append(pb);
    const peopleScroll = node('div', null, 'revenue-table-scroll'); peopleScroll.append(people);
    const notes = node('ul', null, 'dash-kpi-notes');
    notes.append(node('li', `Thưởng DS cửa hàng = DS chung × tỷ lệ mốc đạt, chia đều ${st.split} người. Dưới mốc 1 không thưởng. Tạm tính – số chốt theo phiếu lương.`),
      node('li', 'DS CRM: đơn đã duyệt của nhân viên thuộc cửa hàng (cùng cách tính bảng lương). DS POS: đơn bán quầy, chia theo người mở ca.'));
    if (st.issues) notes.append(node('li', `Còn ${st.issues} đơn chưa đối chiếu – doanh số có thể thay đổi.`, 'error'));
    box.append(tiles, bar, node('h4', 'Các mốc thưởng', 'dash-store-sub'), tierScroll, node('h4', 'Doanh số từng nhân viên', 'dash-store-sub'), peopleScroll, notes);
    return box;
  }
  function renderStore() {
    const x = storeData; storeCard.hidden = !x?.available; if (!x?.available) return;
    storeMonthSelect.replaceChildren(); for (const mo of data?.months?.map(m => m.month) || [x.month]) { const o = node('option', `T${Number(mo.slice(5))}/${mo.slice(0, 4)}`); o.value = mo; storeMonthSelect.append(o); }
    storeMonthSelect.value = x.month; storeMonthSelect.hidden = storeMonthSelect.options.length < 2;
    const sub = storeCard.querySelector('.dash-sub') || node('p', null, 'dash-sub'); sub.textContent = `Tháng ${Number(x.month.slice(5))}/${x.month.slice(0, 4)} · CRM + bán quầy, cùng cách tính thưởng với phiếu lương`; storeCard.firstChild.insertBefore(sub, storeMonthSelect);
    storeBody.replaceChildren(...x.stores.map(st => storeBlock(st, x)));
  }
  async function loadStore(refresh) {
    const id = ++storeRequest; if (!data) return;
    const months = data.months.map(m => m.month); if (!months.includes(storeMonth)) storeMonth = months.at(-1);
    storeCard.classList.add('is-loading');
    try { const r = await api('/dashboard/store?' + new URLSearchParams({ month: storeMonth, ...fresh(refresh) })); if (id !== storeRequest) return; storeData = r; renderStore(); }
    catch (e) { if (id !== storeRequest) return; storeData = null; storeCard.hidden = false; const retry = node('button', 'Thử lại', 'btn'); retry.type = 'button'; retry.addEventListener('click', loadStore); storeBody.replaceChildren(node('p', e.message || 'Chưa tải được doanh số cửa hàng.', 'error'), retry); }
    finally { if (id === storeRequest) storeCard.classList.remove('is-loading'); }
  }

  let draws = [], lastWidth = 0;
  const redraw = () => { for (const draw of draws) draw(); };
  new ResizeObserver(() => { const w = content.clientWidth; if (data && w && Math.abs(w - lastWidth) > 8) { lastWidth = w; redraw(); } }).observe(content);

  function render() {
    const x = data, sum = x.summary, manager = x.scope === 'company'; draws = [];
    const date = v => new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' });
    meta.textContent = `${manager ? 'Toàn công ty' : 'Doanh số của bạn'} · ${monthLabel(x.from.slice(0, 7), 0)} – ${monthLabel(x.to, 0)} · ${x.lastSyncedAt ? 'Đồng bộ Sapo ' + date(x.lastSyncedAt) : 'Chưa có mốc đồng bộ Sapo'} · Tính lúc ${date(x.calculatedAt)}`;

    const kpis = node('div', null, 'dash-kpis');
    const hero = tile('Doanh số đã chốt', compact(sum.actual), `${money(sum.actual)} · ${sum.orders.toLocaleString('vi-VN')} đơn/HĐKT`, 'is-hero');
    kpis.append(hero,
      tile('Dự kiến từ chăm sóc', compact(sum.expected), 'Lần chăm sóc mới nhất trong kỳ'),
      tile('Pipeline đang theo đuổi', compact(sum.pipeline), 'Tư vấn · báo giá · thương lượng'),
      tile('Tỷ lệ chốt báo giá', pct(sum), `${sum.converted}/${sum.quotes} báo giá thành đơn`),
      tile('Khách đã rớt', sum.lost.toLocaleString('vi-VN'), 'Theo lần chăm sóc trong kỳ'),
      tile('Lâu chưa chăm sóc', x.neglected.total.toLocaleString('vi-VN'), `Quá ${x.neglected.days} ngày`));

    const grid = node('div', null, 'dash-grid');
    const series = [{ key: 'actual', label: 'Thực tế', color: COLOR.actual }, { key: 'expected', label: 'Dự kiến', color: COLOR.expected }];
    const trend = card('Doanh số theo tháng', 'Thực tế (đơn/HĐKT, gồm VAT) so với dự kiến từ chăm sóc', 'is-wide'), trendHost = node('div', null, 'dash-plot');
    trend.append(legend(series.map(s => [s.color, s.label])), trendHost, dataTable(['Tháng', 'Thực tế', 'Số đơn', 'Dự kiến', 'Tỷ lệ chốt', 'Đã rớt'], x.months.map(m => [m.month, money(m.actual), m.orders, money(m.expected), pct(m), m.lost])));
    draws.push(() => columnChart(trendHost, x.months, series, 'Doanh số thực tế và dự kiến theo tháng'));

    const rate = card('Tỷ lệ chốt theo tháng', 'Báo giá trong tháng đã sinh đơn còn hiệu lực'), rateHost = node('div', null, 'dash-plot');
    rate.append(rateHost); draws.push(() => lineChart(rateHost, x.months, 'Tỷ lệ chốt báo giá theo tháng'));

    const pipe = card('Pipeline theo giai đoạn', `Tổng ${money(sum.pipeline)}`), pipeHost = node('div', null, 'dash-plot');
    const stages = STAGES.map(([k, label], i) => ({ label, value: sum[k], color: COLOR.ramp[i], sub: 'Giá trị dự kiến' }));
    pipe.append(pipeHost); draws.push(() => barList(pipeHost, stages, 'Giá trị pipeline theo giai đoạn'));

    grid.append(rate, pipe);

    if (x.employees.length > 1) {
      const people = card('Xếp hạng nhân viên', null, 'is-wide'), peopleHost = node('div', null, 'dash-plot'), toggle = node('div', null, 'dash-seg is-small');
      for (const [k, label] of RANK) { const b = node('button', label); b.type = 'button'; b.setAttribute('aria-pressed', String(k === rankBy)); b.addEventListener('click', () => { rankBy = k; for (const o of toggle.children) o.setAttribute('aria-pressed', String(o === b)); drawPeople(); }); toggle.append(b); }
      people.firstChild.append(toggle);
      const drawPeople = () => barList(peopleHost, [...x.employees].sort((a, b) => b[rankBy] - a[rankBy] || a.name.localeCompare(b.name, 'vi'))
        .map(r => ({ label: r.name + (r.active ? '' : ' (nghỉ)'), value: r[rankBy], color: COLOR.actual, sub: `${r.groupName || 'Chưa phân nhóm'} · tỷ lệ chốt ${pct(r)}` })), 'Xếp hạng nhân viên');
      people.append(peopleHost, dataTable(['Nhân viên', 'Nhóm', 'Thực tế', 'Dự kiến', 'Pipeline', 'Tỷ lệ chốt', 'Đã rớt'], x.employees.map(r => [r.name + (r.active ? '' : ' (nghỉ)'), r.groupName || 'Chưa phân nhóm', money(r.actual), money(r.expected), money(r.pipeline), pct(r), r.lost])));
      draws.push(drawPeople); grid.append(people);
    }
    if (manager && x.groups.length > 1) {
      const teams = card('Doanh số theo nhóm', 'Thực tế trong kỳ'), teamHost = node('div', null, 'dash-plot');
      teams.append(teamHost, dataTable(['Nhóm', 'Thực tế', 'Dự kiến', 'Pipeline', 'Tỷ lệ chốt', 'Đã rớt'], x.groups.map(r => [r.name, money(r.actual), money(r.expected), money(r.pipeline), pct(r), r.lost])));
      draws.push(() => barList(teamHost, [...x.groups].sort((a, b) => b.actual - a.actual).map(r => ({ label: r.name, value: r.actual, color: COLOR.actual, sub: `Tỷ lệ chốt ${pct(r)}` })), 'Doanh số theo nhóm'));
      grid.append(teams);
    }

    const stale = card('Khách lâu chưa chăm sóc', `${x.neglected.total.toLocaleString('vi-VN')} khách`), list = node('ol', null, 'dash-stale');
    for (const r of x.neglected.customers) {
      const li = node('li'), a = node('a', r.name); a.href = '#/customers/' + encodeURIComponent(r.id);
      const ago = r.lastAt ? Math.floor((Date.now() - Date.parse(r.lastAt)) / 86400000) : null;
      li.append(a, node('span', ago == null ? 'Chưa chăm sóc' : `${ago} ngày`, ago == null ? 'dash-pill is-never' : 'dash-pill')); list.append(li);
    }
    if (!x.neglected.customers.length) list.append(node('li', 'Không có khách nào quá hạn chăm sóc.', 'dash-sub'));
    const days = node('select', null, 'dash-mini'); days.setAttribute('aria-label', 'Số ngày chưa chăm sóc');
    for (const n of new Set([7, 14, 30, 60, 90, 180, x.neglected.days].sort((a, b) => a - b))) { const o = node('option', `> ${n} ngày`); o.value = String(n); days.append(o); }
    days.value = String(x.neglected.days); days.addEventListener('change', () => { filters.neglectDays = days.value; filters.page = '1'; load(); });
    stale.firstChild.append(days); stale.append(list);
    const pages = Math.max(1, Math.ceil(x.neglected.total / x.neglected.pageSize));
    if (pages > 1) {
      const pager = node('div', null, 'revenue-pager');
      for (const [label, delta] of [['‹ Trước', -1], ['Sau ›', 1]]) { const b = node('button', label, 'btn'); b.type = 'button'; b.disabled = delta < 0 ? x.neglected.page <= 1 : x.neglected.page >= pages; b.addEventListener('click', () => { filters.page = String(x.neglected.page + delta); load(); }); pager.append(b); }
      pager.append(node('span', `Trang ${x.neglected.page}/${pages}`)); stale.append(pager);
    }
    grid.append(stale);

    const how = node('details', null, 'dash-how'); how.append(node('summary', 'Cách tính số liệu'),
      node('p', 'Thực tế: đơn hàng/HĐKT trong kỳ (gồm VAT), bỏ đơn huỷ và đơn nháp chưa có hợp đồng ký; mỗi HĐKT tính một lần. Dự kiến và số khách rớt: lần chăm sóc mới nhất của từng cặp khách/nhân viên trong kỳ. Pipeline: trạng thái chăm sóc mới nhất đến cuối kỳ (tư vấn, đã gửi báo giá, thương lượng). Tỷ lệ chốt = báo giá trong kỳ đã sinh đơn còn hiệu lực / tổng báo giá trong kỳ. Dữ liệu Sapo có thể chậm.'));
    // KPI nằm ngoài lưới biểu đồ: trên điện thoại lưới được gom sau "Xem thêm thống kê", KPI vẫn hiện ngay.
    content.replaceChildren(kpiCard, trend, kpis, storeCard, grid, how);
    lastWidth = content.clientWidth; redraw();
  }

  async function load(refresh) {
    const nextViewer=viewerKey();
    if(nextViewer!==viewer){
      viewer=nextViewer;data=null;kpiPick='';kpiMonth='';preset=1;reportDetailsOpen.clear();
      filters={from:thisMonth(),to:thisMonth(),owner:'',group:'',neglectDays:'30',page:'1'};
      options={employees:[],groups:[]};fillSelect(group,[],'Tất cả nhóm');fillSelect(owner,[],'Tất cả nhân viên');
      ++storeRequest;storeData=null;storeMonth='';storeCard.hidden=true;storeBody.replaceChildren();
    }
    if(!isManager()){filters.owner='';filters.group='';}
    const id = ++requestId; ++kpiRequest;++reportRequest;kpiData=reportData=null;kpiLoading=reportLoading=true;kpiError=reportError='';kpiBody.replaceChildren();reportBody.replaceChildren();syncForm(); hideTip();
    group.parentElement.hidden = owner.parentElement.hidden = !isManager();
    content.classList.add('is-loading'); if (!data) content.replaceChildren(node('p', 'Đang tải tổng quan…', 'dash-sub'));
    try {
      const res = await api('/dashboard/revenue?' + new URLSearchParams({ ...filters, ...fresh(refresh) })); if (id !== requestId) return;
      options = res.filters;
      // A staff member removed since the last refresh must also leave the cached selector.
      if (isManager() && filters.owner && !options.employees.some(m => m.id === filters.owner)) {
        filters.owner = ''; filters.page = '1'; return load();
      }
      fillSelect(group, options.groups, 'Tất cả nhóm'); fillSelect(owner, options.employees, 'Tất cả nhân viên');
      cacheSlot.replaceChildren(cacheLineNode(document, res.cache, () => load(true)));
      data = res; render(); loadScorePanels(refresh); loadStore(refresh);
    } catch (e) {
      if (id !== requestId) return;
      data = null; const retry = node('button', 'Thử lại', 'btn'); retry.type = 'button'; retry.addEventListener('click', load);
      content.replaceChildren(node('p', e.message || 'Không tải được tổng quan.', 'error'), retry);
    } finally { if (id === requestId) content.classList.remove('is-loading'); }
  }
  return { load };
}
