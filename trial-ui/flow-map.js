/**
 * SƠ ĐỒ QUY TRÌNH – PHẦN VẼ (trang #/flow).
 * Dữ liệu sơ đồ (cột, khối, mũi tên, nút) nằm ở `flow-config.js`; số liệu lấy một lượt từ `GET /flow`.
 * File này chỉ: dựng khối theo cấu hình → vẽ mũi tên SVG giữa các khối → mở bảng chi tiết khi bấm khối → chạy thao tác nhanh.
 * DOM dựng bằng createElement / textContent (không chèn chuỗi HTML).
 */
import { EDGES, ICONS, ITEM_ACTIONS, NODES, STAGES } from './flow-config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const svg = (tag, attrs = {}, text) => { const n = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (text != null) n.textContent = String(text); return n; };
const navigation = n => { n.dataset.mobileNavigation = ''; return n; };
const icon = (name, cls = 'flow-icon') => { const s = svg('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true' }); s.append(svg('path', { d: ICONS[name] || ICONS.doc })); return s; };

/** Chọn chỉ số nổi bật của khối: chỉ số đầu tiên có giá trị và có màu cảnh báo, không có thì chỉ số đầu. */
const headline = data => data.metrics.find(m => m.value && m.tone === 'danger') || data.metrics.find(m => m.value && m.tone) || data.metrics[0];

export function initFlowMap({ api, root, go, confirmBox, toast, money, openers = {} }) {
  let data = null, openId = '', busy = false;
  const fmt = m => m.money ? money(m.value) : new Intl.NumberFormat('vi-VN').format(m.value);

  // ---- Khung trang
  const page = el('div', 'flow-page');
  const head = el('div', 'flow-head'), titles = el('div');
  titles.append(el('span', 'eyebrow', 'Quy trình bán hàng'), el('h1', '', 'Sơ đồ quy trình'),
    el('p', 'muted', 'Bấm vào từng khối để xem việc đang chờ và thao tác nhanh. Số trên khối là việc của bạn (Manager: toàn công ty).'));
  const refresh = navigation(el('button', 'btn secondary', 'Làm mới')); refresh.type = 'button'; refresh.addEventListener('click', () => load());
  const stamp = el('span', 'muted small flow-stamp');
  const tools = el('div', 'flow-tools'); tools.append(stamp, refresh);
  head.append(titles, tools);
  const board = el('div', 'flow-board'), stagesRow = el('div', 'flow-stages'), grid = el('div', 'flow-grid'), lines = svg('svg', { class: 'flow-lines', 'aria-hidden': 'true' });
  board.append(stagesRow, grid);
  const legend = el('p', 'flow-legend muted small');
  legend.append(el('span', 'flow-key', ''), document.createTextNode(' luồng chính   '), el('span', 'flow-key alt', ''), document.createTextNode(' nhánh phụ (thiếu hàng, chăm sóc lại)'));
  const status = el('p', 'muted');
  const mobileHint=el('p','flow-mobile-hint muted small','Chọn giai đoạn hoặc một mục bên dưới để xem việc đang chờ.');
  page.append(head, status, mobileHint, board, legend);
  // Bảng chi tiết (ngăn kéo bên phải).
  const shade = el('div', 'flow-shade'); shade.hidden = true; shade.addEventListener('click', () => closePanel());
  const panel = el('aside', 'flow-panel'); panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false');
  root.append(page);
  // Mobile's fixed workspace creates a stacking context below the global navigation.
  // Keep overlays at body level so they can actually cover those controls.
  document.body.append(shade, panel);
  window.addEventListener('hashchange', () => closePanel());
  const workspace=root.closest('#workspace');
  const visibility=new MutationObserver(()=>{if(root.hidden||workspace?.hidden)closePanel();});
  visibility.observe(root,{attributes:true,attributeFilter:['hidden']});
  if(workspace)visibility.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });

  // ---- Vẽ khối
  function render() {
    const visible = NODES.filter(nd => data.nodes[nd.id]);
    const stages = STAGES.filter(s => visible.some(nd => nd.stage === s.id));
    const rows = [...new Set(visible.map(nd => nd.row))].sort((a, b) => a - b);
    const col = id => stages.findIndex(s => s.id === id) + 1, row = r => rows.indexOf(r) + 1;
    board.style.setProperty('--flow-cols', String(stages.length)); board.style.setProperty('--flow-rows', String(rows.length));
    // Tiêu đề cột bấm được: mở bảng tổng hợp mọi khối của giai đoạn đó.
    stagesRow.replaceChildren(...stages.map(s => {
      const t = el('button', 'flow-stage' + (openId === 'stage:' + s.id ? ' is-open' : '')); navigation(t); t.type = 'button'; t.dataset.stage = s.id;
      t.title = 'Xem tổng hợp giai đoạn ' + s.title; t.append(icon(s.icon), el('span', '', s.title));
      t.addEventListener('click', () => openPanel('stage:' + s.id)); return t;
    }));
    grid.replaceChildren(lines);
    // Dải nền mỗi cột (xen kẽ đậm / nhạt), cao hết sơ đồ.
    stages.forEach((s, i) => { const lane = el('div', 'flow-lane' + (i % 2 ? ' alt' : '')); lane.style.gridColumn = String(i + 1); lane.style.gridRow = '1 / -1'; grid.append(lane); });
    for (const nd of visible) {
      const d = data.nodes[nd.id], h = headline(d);
      const b = el('button', 'flow-node' + (h?.value && h.tone ? ' tone-' + h.tone : '') + (nd.id === openId ? ' is-open' : ''));
      navigation(b); b.type = 'button'; b.dataset.node = nd.id;b.dataset.stageTitle=STAGES.find(s=>s.id===nd.stage)?.title||'';
      b.style.gridColumn = String(col(nd.stage)); b.style.gridRow = String(row(nd.row));
            const dot = el('span', 'flow-dot'); dot.append(icon(nd.icon));
      if (h?.value) { const c = el('span', 'flow-count', h.money ? '!' : h.value > 99 ? '99+' : h.value); dot.append(c); }
      const body = el('span', 'flow-node-body');
      body.append(el('span', 'flow-node-title', nd.title),
        el('span', 'flow-node-sub', h ? `${h.label}: ${fmt(h)}` : ''));
      b.append(dot, body);
      b.addEventListener('click', () => openPanel(nd.id));
      grid.append(b);
    }
    requestAnimationFrame(drawEdges);
  }

  // ---- Vẽ mũi tên: đường gấp khúc vuông góc giữa các khối (tính lại khi đổi kích thước).
  function drawEdges() {
    if (!data || !grid.getClientRects().length || getComputedStyle(lines).display === 'none') return;
    const g = grid.getBoundingClientRect();
    lines.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`); lines.setAttribute('width', g.width); lines.setAttribute('height', g.height);
    const defs = svg('defs');
    for (const k of ['main', 'alt']) { const m = svg('marker', { id: 'flow-arrow-' + k, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }); m.append(svg('path', { d: 'M0 0L10 5L0 10z', class: 'flow-tip ' + k })); defs.append(m); }
    lines.replaceChildren(defs);
    // Mỗi khối: khung thẻ + chấm tròn. Đường ngang luôn đi ở cao độ chấm tròn (vùng trống giữa các chấm), đường dọc đi giữa các cột.
    const box = id => {
      const node = grid.querySelector(`[data-node="${id}"]`); if (!node) return null;
      const r = node.getBoundingClientRect(), dot = node.querySelector('.flow-dot').getBoundingClientRect();
      const cx = dot.left + dot.width / 2 - g.left, rad = dot.width / 2 + 6;
      return { t: r.top - g.top, b: r.bottom - g.top, cx, cy: dot.top + dot.height / 2 - g.top, dl: cx - rad, dr: cx + rad, col: Number(node.style.gridColumn), row: Number(node.style.gridRow) };
    };
    const cols = Number(getComputedStyle(board).getPropertyValue('--flow-cols') || 6), colW = g.width / cols, loopY = g.height - 16;
    const occupied = new Set([...grid.querySelectorAll('[data-node]')].map(nd => nd.style.gridColumn + ':' + nd.style.gridRow));
    /** Đường ngang ở hàng `row` từ cột `from` (không tính) tới cột `to` (tính) có đi qua khối nào không. */
    const blocked = (row, from, to) => { for (let c = from + 1; c <= to; c++) if (occupied.has(c + ':' + row)) return true; return false; };
    for (const e of EDGES) {
      const a = box(e.from), b = box(e.to); if (!a || !b) continue;
      let pts, label;
      if (a.col === b.col && Math.abs(a.row - b.row) === 1) { // cùng cột, hàng kề: đường dọc giữa hai khối, chữ bên phải
        const down = b.row > a.row; pts = [[a.cx, down ? a.b : a.t], [b.cx, down ? b.t : b.b]]; label = [a.cx + 8, (pts[0][1] + pts[1][1]) / 2 + 4, 'start'];
      } else if (a.col === b.col) { // cùng cột, cách hàng: vòng qua ranh giới bên phải cột
        const x = a.cx + colW / 2; pts = [[a.dr, a.cy], [x, a.cy], [x, b.cy], [b.dr, b.cy]]; label = [b.dr + 6, b.cy - 8, 'start'];
      } else if (b.col > a.col && a.row === b.row) { // sang phải cùng hàng: thẳng, chữ sát khối đích
        pts = [[a.dr, a.cy], [b.dl, b.cy]]; label = [(a.dr + b.dl) / 2, a.cy - 8, 'middle'];
      } else if (b.col > a.col && !blocked(a.row, a.col, b.col)) { // sang phải khác hàng: đi ngang tới cột đích rồi vào đỉnh / đáy khối
        const down = b.row > a.row; pts = [[a.dr, a.cy], [b.cx, a.cy], [b.cx, down ? b.t : b.b]]; label = [a.dr + 6, a.cy - 8, 'start'];
      } else if (b.col > a.col) { // đường ngang bị khối chắn: gấp khúc ở ranh giới hai cột
        const mid = a.cx + colW / 2; pts = [[a.dr, a.cy], [mid, a.cy], [mid, b.cy], [b.dl, b.cy]]; label = [b.dl - 8, b.cy - 8, 'end'];
      } else { // quay ngược về cột trước: đi vòng dưới đáy sơ đồ
        pts = [[a.cx, a.b], [a.cx, loopY], [b.cx, loopY], [b.cx, b.b]]; label = [(a.cx + b.cx) / 2, loopY - 7, 'middle'];
      }
      // Cấu hình có thể ép vị trí chữ: `labelAt: 'source'` (sát khối nguồn) | 'target' (sát khối đích).
      if (e.labelAt === 'source' && a.col !== b.col) label = [a.dr + 6, a.cy - 8, 'start'];
      if (e.labelAt === 'target' && a.col !== b.col) label = [b.dl - 8, b.cy - 8, 'end'];
      const kind = e.alt ? 'alt' : 'main';
      lines.append(svg('path', { d: 'M' + pts.map(p => p.map(Math.round).join(' ')).join(' L'), class: 'flow-edge ' + kind, 'marker-end': `url(#flow-arrow-${kind})` }));
      if (e.label) lines.append(svg('text', { x: Math.round(label[0]), y: Math.round(label[1]), 'text-anchor': label[2], class: 'flow-edge-label ' + kind }, e.label));
    }
  }
  new ResizeObserver(() => requestAnimationFrame(drawEdges)).observe(grid);

  // ---- Bảng chi tiết của một khối
  function openPanel(id) {
    openId = id; renderPanel();
    panel.hidden = false; shade.hidden = false;
    grid.querySelectorAll('.flow-node').forEach(n => n.classList.toggle('is-open', n.dataset.node === id));
    stagesRow.querySelectorAll('.flow-stage').forEach(n => n.classList.toggle('is-open', 'stage:' + n.dataset.stage === id));
    panel.querySelector('.flow-panel-close')?.focus();
  }
  function closePanel() {
    openId = ''; panel.hidden = true; shade.hidden = true;
    grid.querySelectorAll('.flow-node.is-open').forEach(n => n.classList.remove('is-open'));
    stagesRow.querySelectorAll('.flow-stage.is-open').forEach(n => n.classList.remove('is-open'));
  }
  /** Bảng tổng hợp một giai đoạn: mỗi khối một thẻ (chỉ số + nút xem chi tiết / mở trang). */
  function renderStagePanel(stageId) {
    const st = STAGES.find(s => s.id === stageId), nodes = NODES.filter(nd => nd.stage === stageId && data?.nodes[nd.id]);
    if (!st || !nodes.length) { closePanel(); return; }
    const top = el('div', 'flow-panel-head'), t = el('div', 'flow-panel-title');
    const dot = el('span', 'flow-dot small'); dot.append(icon(st.icon));
    t.append(dot, el('div')); t.lastChild.append(el('span', 'eyebrow', 'Giai đoạn'), el('h2', '', st.title));
    const x = el('button', 'icon-btn flow-panel-close', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Đóng'); x.addEventListener('click', closePanel);
    top.append(t, x);
    const cards = nodes.map(nd => {
      const d = data.nodes[nd.id], card = el('section', 'flow-stage-card');
      card.append(el('h3', 'flow-list-head', nd.title), el('p', 'muted small', nd.desc));
      const stats = el('div', 'flow-stats');
      for (const m of d.metrics) {
        const b = el('button', 'flow-stat' + (m.value && m.tone ? ' tone-' + m.tone : '')); b.type = 'button';
        navigation(b); b.append(el('strong', '', fmt(m)), el('small', '', m.label));
        b.addEventListener('click', () => { closePanel(); go(nd.page); }); stats.append(b);
      }
      const acts = el('div', 'flow-item-actions');
      const more = el('button', 'btn small primary', `Xem việc (${d.items.length})`); navigation(more); more.type = 'button'; more.addEventListener('click', () => openPanel(nd.id));
      const page = el('button', 'btn small secondary', 'Mở trang'); navigation(page); page.type = 'button'; page.addEventListener('click', () => { closePanel(); go(nd.page); });
      acts.append(more, page); card.append(stats, acts);
      return card;
    });
    panel.replaceChildren(top, ...cards);
  }
  function renderPanel() {
    if (openId.startsWith('stage:')) { renderStagePanel(openId.slice(6)); return; }
    const nd = NODES.find(x => x.id === openId), d = data?.nodes[openId];
    if (!nd || !d) { closePanel(); return; }
    const top = el('div', 'flow-panel-head'), t = el('div', 'flow-panel-title');
    const dot = el('span', 'flow-dot small'); dot.append(icon(nd.icon));
    t.append(dot, el('div'));
    t.lastChild.append(el('span', 'eyebrow', STAGES.find(s => s.id === nd.stage)?.title || ''), el('h2', '', nd.title));
    const x = el('button', 'icon-btn flow-panel-close', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Đóng'); x.addEventListener('click', closePanel);
    top.append(t, x);
    const desc = el('p', 'muted small', nd.desc);
    // Chỉ số: bấm để mở trang danh sách tương ứng.
    const stats = el('div', 'flow-stats');
    for (const m of d.metrics) {
      const s = el('button', 'flow-stat' + (m.value && m.tone ? ' tone-' + m.tone : '')); s.type = 'button';
      navigation(s); s.append(el('strong', '', fmt(m)), el('small', '', m.label));
      s.addEventListener('click', () => { closePanel(); go(nd.page); }); stats.append(s);
    }
    // Việc cần xử lý + nút thao tác nhanh.
    const listHead = el('h3', 'flow-list-head', d.error ? d.error : d.items.length ? 'Việc cần xử lý' : 'Không có việc nào đang chờ 🎉');
    const list = el('ul', 'flow-items');
    for (const it of d.items) {
      const li = el('li', 'flow-item'), open = navigation(el('button', 'flow-item-main')); open.type = 'button';
      open.append(el('b', '', it.title), el('small', '', it.sub || ''));
      if (it.badge) open.append(el('span', 'flow-badge' + (it.tone ? ' tone-' + it.tone : ''), it.badge));
      open.addEventListener('click', () => { closePanel(); go(it.hash); });
      li.append(open);
      const acts = (it.actions || []).map(k => [k, ITEM_ACTIONS[k]]).filter(([, a]) => a);
      if (acts.length) {
        const box = el('div', 'flow-item-actions');
        for (const [k, a] of acts) {
          const btn = el('button', 'btn small ' + (k.endsWith('done') || k.startsWith('approve') ? 'primary' : 'secondary'), a.label); btn.type = 'button';
          btn.addEventListener('click', () => runAction(a, it, btn)); box.append(btn);
        }
        li.append(box);
      }
      list.append(li);
    }
    const foot = el('div', 'flow-panel-foot');
    for (const a of nd.actions || []) {
      const btn = el('button', 'btn ' + (a.open ? 'primary' : 'secondary'), a.label); btn.type = 'button';
      if(a.go)navigation(btn);
      btn.addEventListener('click', () => {
        if (a.open) { const fn = openers[a.open]; if (fn) fn(() => load()); else toast('Chưa hỗ trợ thao tác này.', 'err'); }
        else { closePanel(); go(a.go); }
      });
      foot.append(btn);
    }
    panel.replaceChildren(top, desc, stats, listHead, list, foot);
  }

  async function runAction(action, item, btn) {
    if (busy) return;
    if (action.go) { closePanel(); go(action.go(item)); return; }
    if (action.confirm && !await confirmBox(action.confirm(item), { title: action.label, ok: action.label })) return;
    busy = true; btn.disabled = true;
    try { const [method, path, body] = action.request(item); await api(path, method, body); toast(action.done || 'Đã cập nhật.'); await load(); }
    catch (e) { toast(e.message || 'Không thực hiện được.', 'err'); btn.disabled = false; }
    finally { busy = false; }
  }

  async function load() {
    page.classList.add('is-loading'); if (!data) status.textContent = 'Đang tải sơ đồ…';
    try {
      data = await api('/flow'); status.textContent = '';
      stamp.textContent = 'Cập nhật ' + new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      render(); if (openId) renderPanel();
    } catch (e) { status.textContent = e.message || 'Không tải được sơ đồ.'; }
    finally { page.classList.remove('is-loading'); }
  }
  return { load };
}
