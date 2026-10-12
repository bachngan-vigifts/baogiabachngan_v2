/** Dashboard doanh số (read-only): biểu đồ SVG dựng bằng DOM API (không chuỗi HTML), dùng API đã xác thực của app. */
const SVG_NS = 'http://www.w3.org/2000/svg';
// Bảng màu đã kiểm định (CVD/tương phản): thực tế = xanh, dự kiến = cam; giai đoạn pipeline = thang xanh có thứ tự.
const COLOR = { actual: '#2a78d6', expected: '#eb6834', ramp: ['#86b6ef', '#3987e5', '#184f95'] };
const STAGES = [['consulting', 'Đang tư vấn'], ['quote_sent', 'Đã gửi báo giá'], ['negotiating', 'Đang thương lượng']];
const RANK = [['actual', 'Thực tế'], ['expected', 'Dự kiến'], ['pipeline', 'Pipeline']];
const PRESETS = [[1, 'Tháng này'], [3, '3 tháng'], [6, '6 tháng'], [12, '12 tháng']];

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

export function initDashboard({ api, root, isManager, money }) {
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; };
  const svgRoot = (W, H, label) => { const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label }); s.style.width = W + 'px'; s.style.height = H + 'px'; return s; };
  const svg = (tag, attrs = {}, text) => { const n = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (text != null) n.textContent = String(text); return n; };
  const pct = r => r.closeRate == null ? '—' : `${String(r.closeRate).replace('.', ',')}%`;
  let requestId = 0, data = null, rankBy = 'actual', preset = 6;
  let filters = { from: addMonths(thisMonth(), -5), to: thisMonth(), owner: '', group: '', neglectDays: '30', page: '1' };
  let options = { employees: [], groups: [] };

  const wrap = node('div', null, 'revenue-dashboard'); root.append(wrap);
  const head = node('div', null, 'dash-head'), meta = node('p', null, 'dash-meta');
  head.append(node('h1', 'Tổng quan doanh số'), meta);
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
    const t = e.target; if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement) || !t.value) return;
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

  let draws = [], lastWidth = 0;
  const redraw = () => { for (const draw of draws) draw(); };
  new ResizeObserver(() => { const w = content.clientWidth; if (data && w && Math.abs(w - lastWidth) > 8) { lastWidth = w; redraw(); } }).observe(content);

  function render() {
    const x = data, sum = x.summary, manager = x.scope === 'company'; draws = [];
    const date = v => new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' });
    meta.textContent = `${manager ? 'Toàn công ty' : x.scope === 'department' ? 'Doanh số cùng phòng ban' : 'Doanh số của bạn'} · ${monthLabel(x.from.slice(0, 7), 0)} – ${monthLabel(x.to, 0)} · ${x.lastSyncedAt ? 'Đồng bộ Sapo ' + date(x.lastSyncedAt) : 'Chưa có mốc đồng bộ Sapo'} · Tính lúc ${date(x.calculatedAt)}`;

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

    grid.append(trend, rate, pipe);

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
    content.replaceChildren(kpis, grid, how);
    lastWidth = content.clientWidth; redraw();
  }

  async function load() {
    const id = ++requestId; syncForm(); hideTip();
    group.parentElement.hidden = owner.parentElement.hidden = !isManager();
    content.classList.add('is-loading'); if (!data) content.replaceChildren(node('p', 'Đang tải tổng quan…', 'dash-sub'));
    try {
      const res = await api('/dashboard/revenue?' + new URLSearchParams(filters)); if (id !== requestId) return;
      options = res.filters;
      // A staff member removed since the last refresh must also leave the cached selector.
      if (isManager() && filters.owner && !options.employees.some(m => m.id === filters.owner)) {
        filters.owner = ''; filters.page = '1'; return load();
      }
      fillSelect(group, options.groups, 'Tất cả nhóm'); fillSelect(owner, options.employees, 'Tất cả nhân viên');
      data = res; render();
    } catch (e) {
      if (id !== requestId) return;
      data = null; const retry = node('button', 'Thử lại', 'btn'); retry.type = 'button'; retry.addEventListener('click', load);
      content.replaceChildren(node('p', e.message || 'Không tải được tổng quan.', 'error'), retry);
    } finally { if (id === requestId) content.classList.remove('is-loading'); }
  }
  return { load };
}
