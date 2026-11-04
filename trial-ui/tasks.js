import { createTaskWriteIntent } from './task-write-intent.js';
// Bảng CÔNG VIỆC: việc tự sinh (báo giá, check tồn, đơn hàng, giao hàng, HĐKT, công nợ, nhập hàng, sổ quỹ) + việc giao thủ công.
// Cấu hình nhãn / màu ở TASK_UI (cùng khoá với src/modules/tasks/domain/task-config.ts). Bố cục:
//  - Tab chế độ xem có số đếm (Của tôi · Tôi giao · Việc nhóm · Đồng nghiệp · Chưa giao · Tất cả · Cần duyệt).
//  - 4 thẻ hạn (Quá hạn · Hôm nay · 7 ngày tới · Chưa đặt hạn) – bấm để lọc, không lặp với tab.
//  - Một thanh lọc (tìm · trạng thái · nguồn · ưu tiên · người nhận · hạn) + hàng chip bộ lọc đang bật (× từng cái, Xoá bộ lọc).
//  - Danh sách theo hạn (hoặc theo nhóm việc), mỗi việc một thẻ 6 cột; chọn việc → khung chi tiết bên phải (màn hình rộng)
//    hoặc hộp thoại (màn hình hẹp). Phím: N giao việc · / tìm · ↑↓ chọn việc · Enter mở.
export const TASK_UI = {
  status: { todo: ['Cần làm', 'muted'], in_progress: ['Đang làm', 'info'], done: ['Hoàn thành', 'ok'], cancelled: ['Đã huỷ', 'off'] },
  priority: { urgent: ['Khẩn', 'urgent'], high: ['Cao', 'high'], normal: ['Bình thường', 'normal'], low: ['Thấp', 'low'] },
  // Màu theo nhóm nghiệp vụ: Bán hàng xanh dương · Kho xanh lá · Kế toán tím · Công nợ / sổ quỹ cam · Chăm sóc hồng · Thủ công xám.
  source: {
    manual: ['Giao việc', 'manual'], quote: ['Báo giá', 'sales'], order: ['Đơn hàng', 'sales'], contract: ['HĐKT', 'sales'], stock_request: ['Check tồn', 'sales'],
    packing: ['Xuất kho', 'stock'], delivery: ['Giao hàng', 'stock'], transfer: ['Điều chuyển kho', 'stock'], purchase: ['Nhập hàng', 'stock'],
    invoice: ['Xuất hoá đơn', 'acct'], receivable: ['Công nợ', 'debt'], cash: ['Sổ quỹ', 'debt'], care: ['Chăm sóc khách', 'care'],
  },
  /** Nhóm nguồn (ô lọc Nguồn và chế độ "Nhóm theo nhóm việc"). Nguồn chưa khai báo rơi vào nhóm cuối. */
  categories: [
    ['sales', 'Bán hàng', ['quote', 'order', 'contract', 'stock_request']],
    ['warehouse', 'Kho & giao hàng', ['packing', 'delivery', 'transfer', 'purchase']],
    ['money', 'Kế toán & tiền', ['invoice', 'receivable', 'cash']],
    ['care', 'Chăm sóc khách', ['care']],
    ['manual', 'Thủ công', ['manual']],
  ],
  /** Nhóm nhận việc (id chức vụ) – cùng danh sách TASK_TEAMS ở máy chủ. */
  teams: { warehouse: 'Kho', accounting: 'Kế toán', 'sale-admin': 'Sale Admin' },
  groups: [['overdue', 'Quá hạn'], ['today', 'Hôm nay'], ['upcoming', 'Sắp tới'], ['none', 'Chưa đặt hạn']],
  /** Thẻ hạn (giá trị `due` gửi máy chủ). */
  dueCards: [['overdue', 'Quá hạn', 'cần xử lý ngay'], ['today', 'Đến hạn hôm nay', 'trong ngày'], ['week', 'Sắp tới', '7 ngày tới'], ['none', 'Chưa đặt hạn', 'nên đặt hạn']],
};
const DUE_LABEL = { overdue: 'Quá hạn', today: 'Hôm nay', week: '7 ngày tới', upcoming: 'Sắp tới', none: 'Chưa đặt hạn' };
const isClosed = t => t.status === 'done' || t.status === 'cancelled';
/** Chia việc theo nhóm việc; trong nhóm: việc mở trước, rồi việc sinh sau (mới tạo) lên trên cùng. */
export function groupTasks(list) {
  const cat = t => TASK_UI.categories.find(([, , src]) => src.includes(t.source))?.[0] || 'manual';
  return TASK_UI.categories.map(([k, label]) => [k, label, list.filter(t => cat(t) === k).sort((a, b) =>
    (isClosed(a) - isClosed(b)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))]).filter(([, , items]) => items.length);
}
/** Chia việc theo hạn (mặc định): Quá hạn · Hôm nay · Sắp tới · Chưa đặt hạn; việc đã xong / huỷ gom cuối. */
export function groupByDue(list) {
  const groups = TASK_UI.groups.map(([k, label]) => [k, label, list.filter(t => !isClosed(t) && t.due === k)]);
  groups.push(['closed', 'Đã xong / huỷ', list.filter(isClosed)]);
  return groups.filter(([, , items]) => items.length);
}
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dmy = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const dm = iso => iso ? String(iso).slice(5, 10).split('-').reverse().join('/') : '';
// "Hôm nay" theo giờ Việt Nam (khớp máy chủ), không theo múi giờ của máy đang mở.
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const hm = iso => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
const pill = (map, k, extra = '') => `<span class="pill ${map[k]?.[1] || ''} ${extra}">${esc(map[k]?.[0] || k)}</span>`;
const completionHint = t => t.completionHelp || (t.source === 'invoice' ? 'Việc xuất hoá đơn tự hoàn thành khi nhập số hoá đơn trên đơn / HĐKT. Mở chứng từ để ghi nhận số hoá đơn.' : /duyệt/i.test(t.title) ? 'Việc duyệt tự hoàn thành khi chứng từ được duyệt. Mở chứng từ để duyệt.' : 'Việc nhận hàng tự hoàn thành theo đơn mua. Mở chứng từ để ghi nhận hàng đã nhận.');
const ago = iso => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'vừa xong' : s < 3600 ? `${Math.floor(s / 60)} phút trước` : s < 86400 ? `${Math.floor(s / 3600)} giờ trước` : dmy(iso); };
function dueText(t) {
  if (!t.dueDate) return '<span class="muted">—</span>';
  const days = Math.round((Date.parse(t.dueDate) - Date.parse(todayIso())) / 864e5), done = isClosed(t);
  const tone = done ? 'muted' : days < 0 ? 'danger' : days === 0 ? 'warn' : '';
  const note = done ? '' : days < 0 ? `trễ ${-days} ngày` : days === 0 ? 'hôm nay' : days === 1 ? 'ngày mai' : `còn ${days} ngày`;
  return `<span class="due-date ${tone}"><b>${dm(t.dueDate)}${t.dueTime ? ' ' + esc(t.dueTime) : ''}</b>${note ? `<small>${note}</small>` : ''}</span>`;
}
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* bỏ qua */ } } };

/**
 * Gắn bảng công việc vào #view-tasks. `api(path, method, body)`, `toast(msg, kind)`, `go(hash)`, `isManager()`, `userId()`.
 * Trả về { load(id?), badge() }.
 */
export function initTasks({ api: rawApi, toast, confirmBox = async t => confirm(t), go, isManager, canApprove = isManager, userId, positionId = () => '', approvalFeed, sendOnce = (_scope, _content, send) => send(crypto.randomUUID()) }) {
  /**
   * Lưu sẵn danh sách theo bộ lọc (trong bộ nhớ trang, không lưu ổ đĩa): mở lại trang Công việc hiện ngay bản trước rồi tải bản mới ở nền.
   * Mọi thao tác ghi (giao việc, sửa, xoá, bình luận…) xoá bản lưu để lần tải sau lấy dữ liệu mới.
   */
  const cache = new Map(), CACHE_MAX = 20;
  const api = (path, method = 'GET', body) => { if (method !== 'GET') cache.clear(); return rawApi(path, method, body); };
  const root = document.getElementById('view-tasks'), q = s => root.querySelector(s);
  const st = { view: 'mine', status: 'open', priority: '', source: '', assignee: '', search: '', due: '', people: null, list: [], tab: 'tasks', kind: '', approvals: null,
    summary: null, dueCounts: null, collapsed: new Set(), groupBy: store.get('bn-tasks-group') === 'category' ? 'category' : 'due', selected: '', refresh: false };
  let approvalPending = null, approvalError = false, approvalOwner = userId();
  let searchTimer, loadSequence = 0, accountingMode, accountingBoard, accountingEntry, panelTask = null;
  const wide = () => !!globalThis.matchMedia?.('(min-width: 1280px)').matches;

  async function people() {
    if (!st.people) { try { st.people = (await api('/tasks/people')).people; } catch { st.people = []; } }
    return st.people;
  }
  // Người nhận: từng nhân viên, hoặc cả nhóm (Kho, Kế toán…) – giá trị `team:<chức vụ>`.
  const personOptions = (selected, allowEmpty, team = '') => (allowEmpty ? `<option value="">— Chưa giao —</option>` : '')
    + `<optgroup label="Nhân viên">${(st.people || []).map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}${p.id === userId() ? ' (tôi)' : ''}</option>`).join('')}</optgroup>`
    + `<optgroup label="Giao cho nhóm">${Object.entries(TASK_UI.teams).map(([k, l]) => `<option value="team:${k}" ${!selected && team === k ? 'selected' : ''}>Nhóm ${esc(l)}</option>`).join('')}</optgroup>`;
  const who = t => t.assigneeName ? esc(t.assigneeName) : t.teamName ? `<span class="team-tag">Nhóm ${esc(t.teamName)}</span>` : '<span class="danger-text">Chưa giao</span>';
  const whoSub = t => !t.assigneeName && t.teamName ? 'Chưa ai nhận' : `Giao bởi ${esc(t.creatorName || 'Hệ thống')}`;

  /** `known`: số đếm đã có (từ GET /badges) → không gọi máy chủ. */
  async function badge(known) {
    try {
      const s = known || await api('/tasks/summary'), b = document.getElementById('nav-task-count');
      const n = s.overdue || s.open; b.hidden = !n; b.textContent = n; b.classList.toggle('danger', s.overdue > 0);
      b.title = `${s.open} việc đang mở · ${s.overdue} quá hạn · ${s.today} đến hạn hôm nay`;
      return s;
    } catch { return null; }
  }

  // ----- Tab chế độ xem (có số đếm việc đang mở) + tab Cần duyệt.
  function viewTabs() {
    const s = st.summary || {}, v = s.views || {}, team = (s.teamNames || []).join(' / ');
    return [['mine', 'Của tôi'], ['created', 'Tôi giao'], ...(isManager() || team ? [['team', 'Việc nhóm' + (team ? ' ' + team : '')]] : []),
      ...(s.canViewColleagues ? [['colleagues', 'Đồng nghiệp']] : []), ...(isManager() ? [['unassigned', 'Chưa giao']] : []), ['all', isManager() ? 'Tất cả' : 'Tất cả được xem']]
      .map(([k, label]) => [k, label, v[k]]);
  }
  function renderTabs() {
    const ap = st.approvals?.counts.total ?? 0, active = st.tab === 'approvals' ? 'approvals' : st.view;
    q('#tasks-view').innerHTML = viewTabs().map(([k, label, n]) => `<button type="button" role="tab" class="task-tab" data-v="${k}" aria-selected="${k === active}">${esc(label)}${n != null ? ` <b>${n}</b>` : ''}</button>`).join('')
      // Hộp "Cần duyệt": Manager + người được Manager bật cờ "Được duyệt" (máy chủ kiểm lại ở GET /approvals và từng nút duyệt).
      + (canApprove() ? `<button type="button" role="tab" class="task-tab task-tab-approve" data-v="approvals" aria-selected="${active === 'approvals'}">Cần duyệt${ap ? ` <b class="tab-count">${ap}</b>` : ''}</button>` : '');
  }
  // ----- Thẻ hạn: đếm theo bộ lọc hiện tại (trừ hạn) – máy chủ trả `dueCounts`.
  function renderCards() {
    const c = st.dueCounts || {};
    q('#tasks-stats').innerHTML = TASK_UI.dueCards.map(([k, label, sub]) => `<button type="button" class="stat task-due-card d-${k}" data-stat="${k}" aria-pressed="${st.due === k}"><span>${label}</span><strong>${c[k] ?? 0}</strong><small>${sub}</small></button>`).join('');
  }
  // ----- Chip bộ lọc đang bật.
  const assigneeLabel = v => v === 'none' ? 'Chưa giao' : v.startsWith('team:') ? 'Nhóm ' + (TASK_UI.teams[v.slice(5)] || v.slice(5)) : v === userId() ? 'Tôi' : (st.people || []).find(p => p.id === v)?.name || v;
  function renderActive() {
    const chips = [];
    if (st.status !== 'open') chips.push(['status', 'Trạng thái: ' + (st.status === 'done' ? 'Đã xong' : 'Tất cả')]);
    if (st.source) chips.push(['source', 'Nguồn: ' + (TASK_UI.source[st.source]?.[0] || st.source)]);
    if (st.priority) chips.push(['priority', 'Ưu tiên: ' + TASK_UI.priority[st.priority][0]]);
    if (st.assignee) chips.push(['assignee', 'Người nhận: ' + assigneeLabel(st.assignee)]);
    if (st.due) chips.push(['due', 'Hạn: ' + DUE_LABEL[st.due]]);
    if (st.search) chips.push(['search', `Tìm: "${st.search}"`]);
    const box = q('#tasks-active');
    box.hidden = !chips.length || st.tab === 'approvals';
    box.innerHTML = chips.map(([k, l]) => `<span class="task-chip">${esc(l)}<button type="button" data-clear="${k}" aria-label="Bỏ lọc ${esc(l)}">×</button></span>`).join('')
      + (chips.length ? '<button type="button" class="link-btn" data-clear="all">Xoá bộ lọc</button>' : '');
  }
  function fillFilters() {
    q('#tasks-source').innerHTML = '<option value="">Nguồn · Tất cả</option>' + TASK_UI.categories.map(([, label, src]) => `<optgroup label="${esc(label)}">${src.map(k => `<option value="${k}">${esc(TASK_UI.source[k][0])}</option>`).join('')}</optgroup>`).join('');
    q('#tasks-assignee').innerHTML = '<option value="">Người nhận · Tất cả</option>' + (isManager() ? '<option value="none">Chưa giao</option>' : '')
      + `<optgroup label="Nhóm">${Object.entries(TASK_UI.teams).map(([k, l]) => `<option value="team:${k}">Nhóm ${esc(l)} (chưa ai nhận)</option>`).join('')}</optgroup>`
      + `<optgroup label="Nhân viên">${(st.people || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.id === userId() ? ' (tôi)' : ''}</option>`).join('')}</optgroup>`;
    for (const [sel, key] of [['#tasks-source', 'source'], ['#tasks-priority', 'priority'], ['#tasks-assignee', 'assignee'], ['#tasks-due', 'due']]) q(sel).value = st[key];
    q('#tasks-search').value = st.search;
    q('#tasks-status').querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === st.status)));
  }

  function row(t) {
    const done = isClosed(t), ro = t.viewOnly, sel = t.id === st.selected;
    const tags = [pill(TASK_UI.source, t.source, 'src'),
      t.auto && !t.createdBy ? `<span class="tag dashed" title="Hệ thống tự tạo${t.completionFromSource ? '; tự hoàn thành khi chứng từ xử lý xong' : ''}">Tự động${t.completionFromSource ? ' · không đóng tay' : ''}</span>` : '',
      ro ? '<span class="tag" title="Việc của đồng nghiệp cùng chức vụ – chỉ xem">Đồng nghiệp · chỉ xem</span>' : '',
      t.description ? `<span class="tag task-desc">${esc(t.description)}</span>` : '',
      t.comments ? `<span class="task-cmt" title="Trao đổi">💬 ${t.comments}</span>` : ''].join('');
    // Hoàn thành: việc làm tay dùng ô tick; việc tự hoàn thành theo chứng từ không có ô tick (chỉ ⟳ + giải thích).
    const check = t.completionFromSource ? `<span class="task-auto-dot" title="${esc(completionHint(t))}">⟳</span>`
      : `<input type="checkbox" ${t.status === 'done' ? 'checked' : ''} ${t.status === 'cancelled' || ro ? 'disabled' : ''} aria-label="Hoàn thành ${esc(t.title)}" data-toggle>`;
    // Trạng thái: bấm đổi Cần làm ↔ Đang làm (hoàn thành bằng ô tick / theo chứng từ).
    const state = done || ro ? pill(TASK_UI.status, t.status, 'state') : `<button type="button" class="task-state st-${t.status}" data-cycle title="Bấm để đổi Cần làm ↔ Đang làm">${TASK_UI.status[t.status][0]}</button>`;
    return `<div class="task-row ${ro ? 'is-peer' : ''} ${done ? 'is-done' : ''} ${t.due === 'overdue' && !done ? 'is-late' : ''} prio-${t.priority} ${sel ? 'is-selected' : ''}" data-task="${esc(t.id)}" role="row" aria-selected="${sel}">
      <div class="task-check">${check}</div>
      <div class="task-main"><div class="task-title">${esc(t.title)}</div><div class="task-meta">${tags}</div></div>
      <div class="task-people" data-label="Người nhận"><b>${who(t)}</b><small>${whoSub(t)}</small>${t.canClaim && !done ? '<button type="button" class="btn secondary small claim-btn" data-claim>Nhận việc</button>' : ''}</div>
      <div class="task-due" data-label="Hạn">${dueText(t)}</div>
      <div class="task-prio" data-label="Ưu tiên">${pill(TASK_UI.priority, t.priority, 'prio')}</div>
      <div class="task-st" data-label="Trạng thái">${state}</div></div>`;
  }
  function renderList() {
    root.dataset.resultCount=String(st.dueCounts?.total??st.list.length);
    const groups = st.groupBy === 'category' ? groupTasks(st.list) : groupByDue(st.list);
    q('#tasks-list').innerHTML = groups.map(([k, label, items]) => {
      const late = items.filter(t => t.due === 'overdue' && !isClosed(t)).length, shut = st.collapsed.has(k);
      return `<div class="task-group g-${k}" data-cat="${k}"><button type="button" class="task-group-btn" data-collapse="${k}" aria-expanded="${!shut}"><span class="task-group-caret" aria-hidden="true">▾</span>${label}<span class="task-group-n">${items.length}</span>${st.groupBy === 'category' && late ? `<span class="task-group-late">${late} quá hạn</span>` : ''}</button></div>`
        + (shut ? '' : items.map(row).join(''));
    }).join('');
    q('#tasks-empty').hidden = st.list.length > 0;
    const total = st.dueCounts?.total ?? st.list.length;
    q('#tasks-count').textContent = `Hiển thị ${st.list.length} / ${total} việc${st.view === 'mine' ? ' của bạn' : ''}`;
    q('#tasks-group').querySelectorAll('[data-group]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.group === st.groupBy)));
  }
  function emptyText() {
    const parts = [st.source && 'Nguồn: ' + (TASK_UI.source[st.source]?.[0] || st.source), st.priority && 'Ưu tiên: ' + TASK_UI.priority[st.priority][0],
      st.assignee && 'Người nhận: ' + assigneeLabel(st.assignee), st.search && `"${st.search}"`].filter(Boolean);
    const when = st.due ? ' ' + ({ overdue: 'đang quá hạn', today: 'đến hạn hôm nay', week: 'trong 7 ngày tới', none: 'chưa đặt hạn' }[st.due] || '') : '';
    if (parts.length || st.due) return `Không có việc nào${parts.length ? ' có ' + parts.join(', ') : ''}${when}.`;
    return st.status === 'open' ? 'Không có việc nào đang mở. Bấm "+ Giao việc" để giao việc mới.' : 'Chưa có việc nào.';
  }

  // ----- Thẻ "Cần duyệt" (Manager / người được chỉ định): báo giá, đơn / HĐKT, phiếu thu chi, đổi trả, khách hàng, sản phẩm – GET /approvals (chỉ đọc).
  // Duyệt vẫn làm ở màn hình của từng loại (bấm "Mở"), giữ nguyên hộp kiểm tra như hiện nay.
  const KIND = { quote: ['Báo giá', 'sales'], order: ['Đơn hàng', 'sales'], contract: ['HĐKT', 'sales'], purchase: ['Đơn mua NCC', 'stock'], transfer: ['Điều chuyển kho', 'stock'], cash: ['Thu / chi sổ quỹ', 'debt'], return: ['Đổi / trả hàng', 'sales'], customer: ['Khách hàng', 'manual'], product: ['Sản phẩm', 'stock'] };
  const money = n => new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';
  function approvalSnapshot() {
    const who = userId();
    if (who !== approvalOwner || !canApprove()) { st.approvals = null; approvalPending = null; approvalError = false; approvalOwner = who; }
    if (approvalFeed) st.approvals = approvalFeed.peek();
    return st.approvals;
  }
  function loadApprovals(force = false) {
    if (!canApprove()) { st.approvals = null; return Promise.resolve(null); }
    approvalSnapshot();
    if (approvalPending) return approvalPending;
    const who = userId(); approvalError = false;
    const request = Promise.resolve().then(() => approvalFeed ? approvalFeed.load({ force }) : api('/approvals')).then(data => {
      if (data && who === userId() && canApprove()) st.approvals = data;
      return data;
    }).catch(() => { if (who === userId()) approvalError = true; return null; }).finally(() => {
      if (approvalPending === request) approvalPending = null;
      if (who === userId()) { renderTabs(); if (st.tab === 'approvals') renderApprovals(); }
    });
    approvalPending = request;
    return request;
  }
  function renderApprovals() {
    const box = q('#tasks-approvals'), d = approvalSnapshot();
    const notice = approvalError ? '<p class="error" role="status">Chưa cập nhật được danh sách. <button type="button" class="btn secondary small" data-retry-approvals>Thử lại</button></p>' : '';
    if (!d) { box.innerHTML = notice || '<p class="muted task-empty" role="status">Đang tải danh sách cần duyệt…</p>'; return; }
    const items = st.kind ? d.items.filter(i => i.kind === st.kind) : d.items;
    box.innerHTML = `${notice}<div class="chips approval-kinds" role="group" aria-label="Lọc loại"><button type="button" class="chip" data-kind="" aria-pressed="${!st.kind}">Tất cả <b>${d.counts.total}</b></button>${Object.entries(KIND).filter(([k]) => d.counts[k] || st.kind === k).map(([k, [l]]) => `<button type="button" class="chip" data-kind="${k}" aria-pressed="${st.kind === k}">${l} <b>${d.counts[k] ?? 0}</b></button>`).join('')}</div>
      ${d.truncated ? '<p class="muted small">Danh sách chỉ hiện các chứng từ mới nhất. Số đếm là toàn bộ; mở trang từng loại để xem các chứng từ cũ hơn.</p>' : ''}${items.length ? `<div class="table-wrap"><table class="data-table task-table approval-table"><thead><tr><th>Cần duyệt</th><th>Người tạo</th><th>Chờ từ</th><th class="right">Giá trị</th><th><span class="sr-only">Mở</span></th></tr></thead><tbody>
      ${items.map(i => `<tr><td class="task-main"><div class="task-title">${esc(i.title)}</div><div class="task-meta"><span class="pill ${KIND[i.kind][1]} src">${esc(KIND[i.kind][0])}</span>${i.sub ? `<span class="muted task-desc">${esc(i.sub)}</span>` : ''}</div></td>
        <td data-label="Người tạo">${esc(i.by || '—')}</td><td data-label="Chờ từ">${i.at ? esc(ago(i.at)) : '—'}</td><td${i.amount ? ' data-label="Giá trị"' : ''} class="right num">${i.amount ? money(i.amount) : ''}</td>
        <td class="task-go"><a class="btn primary small" href="${esc(i.link)}">Mở để duyệt</a></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted task-empty">Không có gì đang chờ duyệt. 🎉</p>'}`;
  }
  function showTab(tab) {
    st.tab = canApprove() && tab === 'approvals' ? 'approvals' : 'tasks';
    const appr = st.tab === 'approvals';
    q('#tasks-approvals').hidden = !appr;
    for (const sel of ['.task-board', '#tasks-stats', '.task-filterbar', '.task-foot']) q(sel).hidden = appr;
    if (appr) { q('#tasks-active').hidden = true; renderApprovals(); } else renderActive();
    renderTabs();
  }

  approvalFeed?.subscribe?.(() => {
    approvalSnapshot(); renderTabs();
    if (st.tab === 'approvals') { approvalError = false; renderApprovals(); }
  });

  const syncText = d => `Đồng bộ lúc ${hm(d.syncedAt || new Date().toISOString())} · việc tự sinh cập nhật khi mở trang`;
  /** Vẽ trang từ dữ liệu `/tasks` + `/tasks/summary` (bản lưu sẵn hoặc bản mới). */
  async function apply(d, s, request, focusId) {
    if (s?.accountingAvailable) {
      if (!accountingEntry) {
        accountingEntry = document.createElement('button'); accountingEntry.type = 'button'; accountingEntry.className = 'btn secondary'; accountingEntry.textContent = 'Nhóm Kế toán';
        accountingEntry.addEventListener('click', () => { accountingMode = true; load(); }); q('.task-top-actions').prepend(accountingEntry);
      }
      if (accountingMode === undefined) accountingMode = positionId() === 'accounting';
      if (accountingMode && st.tab !== 'approvals') {
        if (!accountingBoard) { const { initAccountingTasks } = await import('./accounting-tasks.js'); accountingBoard = initAccountingTasks({ root, api, toast, userId, sendOnce, back: () => { accountingMode = false; accountingBoard.hide(); load(); } }); }
        if (request !== loadSequence) return;
        await accountingBoard.load(focusId); return;
      }
    } else { accountingMode = false; if (accountingEntry) accountingEntry.hidden = true; }
    accountingBoard?.hide();
    if (s) st.summary = s;
    if (st.view === 'colleagues' && !d.canViewColleagues) st.view = 'mine';
    st.list = d.tasks; st.dueCounts = d.dueCounts || null;
    if (!q('#tasks-quick-assignee').options.length) q('#tasks-quick-assignee').innerHTML = personOptions(userId(), isManager());
    if (!q('#tasks-assignee').options.length) fillFilters();
    q('#tasks-sync').textContent = syncText(d);
    showTab(st.tab); renderCards(); renderList();
    q('#tasks-empty-text').textContent = emptyText();
    if (focusId) openDetail(focusId);
    else if (panelTask && wide()) { if (st.list.some(t => t.id === panelTask)) showPanel(panelTask); else closePanel(); }
  }
  /** Tải sẵn bảng việc mặc định (gọi lúc rảnh sau khi đăng nhập): lần bấm đầu vào trang Công việc hiện ngay. */
  async function prefetch() {
    void loadApprovals();
    if (cache.size) return;
    const params = new URLSearchParams({ view: st.view, status: st.status });
    try {
      const [d, s] = await Promise.all([rawApi('/tasks?' + params), rawApi('/tasks/summary')]);
      if (!cache.has(params.toString())) cache.set(params.toString(), { d, s });
    } catch { /* bỏ qua: mở trang sẽ tải như thường */ }
  }

  async function load(focusId) {
    resetQuickOwner();
    const request = ++loadSequence;
    if (focusId === 'approvals') { focusId = undefined; st.tab = 'approvals'; }
    if (st.tab === 'approvals' && canApprove()) {
      accountingBoard?.hide(); showTab('approvals');
      const force = st.refresh; st.refresh = false;
      const loading = loadApprovals(force); renderApprovals();
      await loading; return;
    }
    const list = q('#tasks-list');
    if (!st.list.length) list.innerHTML = '<p class="muted task-empty">Đang tải…</p>';
    void people().then(() => { if (request === loadSequence) fillFilters(); });
    if (st.view === 'unassigned' && !isManager()) st.view = 'mine';
    const params = new URLSearchParams({ view: st.view, status: st.status });
    if (st.due) params.set('due', st.due);
    if (st.priority) params.set('priority', st.priority); if (st.source) params.set('source', st.source);
    if (st.assignee) params.set('assignee', st.assignee); if (st.search) params.set('q', st.search);
    const key = params.toString();
    if (st.refresh) { params.set('refresh', '1'); st.refresh = false; cache.delete(key); }
    // Bản lưu sẵn: hiện ngay (không chờ máy chủ), mở việc được chọn một lần; bản mới về thì vẽ lại nếu khác.
    const hit = cache.get(key);
    if (hit) { try { await apply(hit.d, hit.s, request, focusId); } catch { /* bản lưu hỏng: chờ bản mới */ } focusId = undefined; }
    try {
      // "Cần duyệt" (nặng nhất) không chặn danh sách: chỉ chờ khi đang mở thẻ Cần duyệt, còn lại tải sau rồi cập nhật số trên thẻ.
      const approvals = loadApprovals();
      const [d, s] = await Promise.all([api('/tasks?' + params), badge(), ...(st.tab === 'approvals' ? [approvals] : [])]);
      if (request !== loadSequence) return;
      const same = hit && JSON.stringify(hit.d.tasks) === JSON.stringify(d.tasks) && JSON.stringify(hit.d.dueCounts) === JSON.stringify(d.dueCounts);
      cache.delete(key); cache.set(key, { d, s });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      if (same) { if (s) { st.summary = s; renderTabs(); } q('#tasks-sync').textContent = syncText(d); }
      else await apply(d, s, request, focusId);
      if (st.tab !== 'approvals') approvals.then(() => { if (request === loadSequence) renderTabs(); });
    } catch (e) {
      if (request !== loadSequence) return;
      // Đang hiện bản lưu sẵn: giữ danh sách, chỉ báo lỗi tải bản mới.
      if (hit) toast(e.message, 'err'); else list.innerHTML = `<p class="error task-empty">${esc(e.message)}</p>`;
    }
  }

  async function update(id, body, msg) {
    const owner=userId(),view=JSON.stringify([st.view,st.status,st.priority,st.source,st.assignee,st.search,st.due,st.tab]);
    loadSequence++;
    try {
      const result=await api('/tasks/' + encodeURIComponent(id), 'PUT', {...body,returnTask:true});
      if(owner!==userId())return false;if(msg)toast(msg);
      if(view!==JSON.stringify([st.view,st.status,st.priority,st.source,st.assignee,st.search,st.due,st.tab]))return true;
      if(result.task){st.list=st.list.map(t=>t.id===id?result.task:t).filter(t=>t.id!==id||!st.status||st.status==='all'||(st.status==='open'?!isClosed(t):t.status===st.status));renderList();q('#tasks-sync').textContent='Đã lưu thay đổi · đang cập nhật số đếm…';void load();}
      else await load();
      return true;
    } catch(e){if(owner===userId()){toast(e.message,'err');void load();}return false;}
  }

  // ----- Chi tiết việc: khung bên phải (màn hình rộng) hoặc hộp thoại. Tab Chi tiết · Trao đổi · Lịch sử.
  function detailHtml(t, inPanel) {
    const me = userId(), ro = !!t.viewOnly, canEdit = t.canManage && !ro, isAssignee = !ro && (t.assigneeId === me || t.canClaim), edit = canEdit || isAssignee, text = canEdit && !t.auto;
    const statuses = Object.entries(TASK_UI.status).filter(([k]) => (!t.completionFromSource || k === t.status || (k !== 'done' && k !== 'cancelled')) && (k !== 'cancelled' || canEdit));
    const kv = (label, value) => `<div class="task-kv-row"><span>${label}</span><div>${value}</div></div>`;
    return `<form class="task-form">
      <div class="task-detail-head"><div class="task-detail-tags">${pill(TASK_UI.source, t.source, 'src')}${t.auto ? '<span class="tag dashed">Tự động</span>' : ''}${ro ? '<span class="tag">Chỉ xem</span>' : ''}</div>
        <button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      ${text ? `<input name="title" class="task-title-input" value="${esc(t.title)}" maxlength="300" required aria-label="Tên việc">` : `<h2 class="task-detail-title">${esc(t.title)}</h2>`}
      <div class="task-detail-tabs" role="tablist"><button type="button" role="tab" data-dtab="info" aria-selected="true">Chi tiết</button>${ro || t.canComment === false ? '' : `<button type="button" role="tab" data-dtab="chat" aria-selected="false">Trao đổi${t.comments ? ' <b>' + t.comments + '</b>' : ''}</button>`}<button type="button" role="tab" data-dtab="log" aria-selected="false">Lịch sử</button></div>
      <div class="task-dpane" data-pane="info">
        <div class="task-kv">
          ${kv('Người nhận', edit ? `<select name="assigneeId" aria-label="Người nhận">${personOptions(t.assigneeId, isManager(), t.assigneePosition || '')}</select>` : who(t))}
          ${kv('Người giao', esc(t.creatorName || 'Hệ thống'))}
          ${kv('Hạn', edit ? `<span class="task-kv-due"><input type="date" name="dueDate" value="${esc(t.dueDate || '')}" aria-label="Hạn"><input type="time" name="dueTime" value="${esc(t.dueTime || '')}" aria-label="Giờ"></span>` : dueText(t))}
          ${kv('Ưu tiên', edit ? `<select name="priority" aria-label="Ưu tiên">${Object.entries(TASK_UI.priority).map(([k, [l]]) => `<option value="${k}" ${k === t.priority ? 'selected' : ''}>${l}</option>`).join('')}</select>` : pill(TASK_UI.priority, t.priority, 'prio'))}
          ${kv('Nguồn', esc(TASK_UI.source[t.source]?.[0] || t.source))}
          ${kv('Trạng thái', `<div class="seg" role="group" aria-label="Trạng thái">${statuses.map(([k, [l, c]]) => `<button type="button" class="seg-btn ${c}" data-set-status="${k}" aria-pressed="${k === t.status}" ${edit && !(t.completionFromSource && isClosed(t)) ? '' : 'disabled'}>${l}</button>`).join('')}</div>`)}
        </div>
        ${t.completionFromSource ? `<p class="task-note warn">${esc(completionHint(t))} Không đóng tay được.</p>` : ''}
        ${t.teamName && !t.assigneeId ? `<p class="task-note">Giao cho <b>nhóm ${esc(t.teamName)}</b>: người trong nhóm bấm "Nhận việc" hoặc chuyển sang Đang làm để nhận.</p>` : ''}
        <div class="task-detail-actions">${t.link ? `<a class="btn primary" href="${esc(t.link)}" data-open-link>${t.completionFromSource ? 'Mở chứng từ để xử lý' : 'Mở chứng từ'}</a>` : ''}${t.canClaim && !isClosed(t) ? '<button type="button" class="btn secondary" data-claim-dlg>Nhận việc</button>' : ''}${edit ? '<button type="submit" class="btn secondary">Lưu thay đổi</button>' : ''}</div>
        <label class="task-desc-field"><span>Mô tả</span>${text ? `<textarea name="description" rows="3" maxlength="5000">${esc(t.description)}</textarea>` : `<p class="pre">${esc(t.description) || '<span class="muted">—</span>'}</p>`}</label>
        ${t.auto ? '<p class="task-note">Cập nhật tự động: hệ thống đổi người nhận, hạn và mô tả khi chứng từ thay đổi. Không sửa được tên việc.</p>' : ''}
        ${t.canDelete ? '<button type="button" class="btn ghost danger-text small" data-del>Xoá việc</button>' : ''}
      </div>
      <div class="task-dpane" data-pane="chat" hidden>
        <ul class="task-comments" data-comments><li class="muted">Đang tải…</li></ul>
        <div class="task-cmt-add"><input name="comment" placeholder="Nhắn người giao / người nhận… (Enter để gửi)" maxlength="2000"><button type="button" class="btn secondary small" data-send>Gửi</button></div>
      </div>
      <div class="task-dpane" data-pane="log" hidden><ul class="task-log">
        <li><b>${esc(t.creatorName || 'Hệ thống')}</b> tạo việc<small>${dmy(t.createdAt)} ${hm(t.createdAt)}</small></li>
        ${t.updatedAt && t.updatedAt !== t.createdAt ? `<li>Cập nhật gần nhất<small>${dmy(t.updatedAt)} ${hm(t.updatedAt)}</small></li>` : ''}
        ${t.completedAt ? `<li><b>${esc(t.completedByName || 'Hệ thống')}</b> ${t.status === 'cancelled' ? 'huỷ' : 'hoàn thành'}<small>${dmy(t.completedAt)} ${hm(t.completedAt)}</small></li>` : ''}
      </ul>${ro || t.canComment === false ? '<p class="muted small task-peer-note">Việc của đồng nghiệp cùng chức vụ: chỉ xem. Trao đổi chỉ người giao, người nhận và Manager xem được.</p>' : ''}</div>
      ${inPanel ? '' : '<div class="modal-foot"><span class="grow"></span><button type="button" class="btn secondary" data-x>Đóng</button></div>'}</form>`;
  }
  function bindDetail(host, t, close) {
    const me = userId(), f = host.querySelector('form'), isDialog = host.tagName === 'DIALOG';
    host.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close));
    host.querySelectorAll('[data-open-link]').forEach(a => a.addEventListener('click', () => { if (isDialog) close(); }));
    const loadComments = async () => {
      const ul = host.querySelector('[data-comments]'); if (!ul) return;
      try {
        const { comments } = await api(`/tasks/${encodeURIComponent(t.id)}/comments`);
        ul.innerHTML = comments.length ? comments.map(c => `<li class="${c.memberId === me ? 'me' : ''}"><b>${esc(c.name)}</b><span>${esc(c.body)}</span><small>${ago(c.createdAt)}</small></li>`).join('') : '<li class="muted">Chưa có trao đổi.</li>';
        ul.scrollTop = ul.scrollHeight;
      } catch (e) { ul.innerHTML = `<li class="error">${esc(e.message)}</li>`; }
    };
    host.querySelectorAll('[data-dtab]').forEach(b => b.addEventListener('click', () => {
      host.querySelectorAll('[data-dtab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
      host.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.dtab; });
      if (b.dataset.dtab === 'chat') loadComments();
    }));
    let status = t.status;
    host.querySelectorAll('[data-set-status]').forEach(b => b.addEventListener('click', () => { status = b.dataset.setStatus; host.querySelectorAll('[data-set-status]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    const send = async () => {
      const inp = f.comment, body = inp.value.trim(); if (!body) return;
      inp.disabled = true;
      try { await api(`/tasks/${encodeURIComponent(t.id)}/comments`, 'POST', { body }); inp.value = ''; await loadComments(); } catch (e) { toast(e.message, 'err'); } finally { inp.disabled = false; inp.focus(); }
    };
    host.querySelector('[data-send]')?.addEventListener('click', send);
    f.comment?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    host.querySelector('[data-claim-dlg]')?.addEventListener('click', async () => { if (await update(t.id, { assigneeId: me }, 'Đã nhận việc.') && isDialog) close(); });
    host.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!await confirmBox(`Xoá công việc "${t.title || ''}"? Không khôi phục được.`, { title: 'Xoá việc', ok: 'Xoá việc', danger: true })) return;
      try { await api('/tasks/' + encodeURIComponent(t.id), 'DELETE'); toast('Đã xoá việc.'); close(); load(); } catch (e) { toast(e.message, 'err'); }
    });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const body = { revision: t.revision, ...(t.completionFromSource && status === t.status ? {} : { status }), priority: f.priority.value, dueDate: f.dueDate.value, dueTime: f.dueTime.value };
      const cur = t.assigneeId || (t.assigneePosition ? 'team:' + t.assigneePosition : '');
      if (f.assigneeId.value !== cur) body.assigneeId = f.assigneeId.value;
      if (f.title?.tagName === 'INPUT') { body.title = f.title.value; body.description = f.description.value; }
      if (await update(t.id, body, 'Đã lưu công việc.') && isDialog) close();
    });
  }
  async function fetchTask(id) {
    try { const t = (await api('/tasks/' + encodeURIComponent(id))).task; await people(); return t; } catch (e) { toast(e.message, 'err'); return null; }
  }
  async function showPanel(id) {
    const t = await fetchTask(id); if (!t) return;
    const panel = q('#tasks-panel');
    panelTask = t.id; panel.innerHTML = detailHtml(t, true); panel.hidden = false;
    root.className = String(root.className).replace(/\s*has-panel/g, '') + ' has-panel';
    bindDetail(panel, t, closePanel);
  }
  function closePanel() {
    const panel = q('#tasks-panel'); panel.hidden = true; panel.innerHTML = ''; panelTask = null; st.selected = '';
    root.className = String(root.className).replace(/\s*has-panel/g, '');
    q('#tasks-list').querySelectorAll('.is-selected').forEach(r => { r.className = r.className.replace(' is-selected', ''); r.setAttribute('aria-selected', 'false'); });
  }
  async function openDetail(id) {
    select(id, false);
    if (wide()) return showPanel(id);
    const t = await fetchTask(id); if (!t) return;
    const dlg = document.createElement('dialog'); dlg.className = 'modal task-dialog';
    dlg.innerHTML = detailHtml(t, false);
    document.body.append(dlg); dlg.showModal();
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('close', () => { dlg.remove(); if (location.hash.startsWith('#/tasks/')) history.replaceState(null, '', '#/tasks'); });
    bindDetail(dlg, t, close);
    if (location.hash !== '#/tasks/' + t.id) history.replaceState(null, '', '#/tasks/' + t.id);
  }
  /** Chọn việc (tô viền); `open` = mở chi tiết luôn. */
  function select(id, open = true) {
    st.selected = id;
    q('#tasks-list').querySelectorAll('[data-task]').forEach(r => {
      const on = r.dataset.task === id; r.setAttribute('aria-selected', String(on));
      r.className = r.className.replace(' is-selected', '') + (on ? ' is-selected' : '');
      if (on) r.scrollIntoView?.({ block: 'nearest' });
    });
    if (open) openDetail(id);
  }

  // ----- Sự kiện
  const quick = q('#tasks-quick'),taskIntent=createTaskWriteIntent({owner:userId,scope:'tasks'});
  let quickOwner=userId();
  function resetQuickOwner(){if(quickOwner!==userId()){quickOwner=userId();quick.reset?.();quick.hidden=true;}}
  // Lần giao việc chưa rõ kết quả: nút "Bỏ lần giao việc này" để không bị kẹt khi gửi lại bị từ chối (mất quyền, người nhận nghỉ…).
  const discardBtn=quick.querySelector('[data-discard]');
  const syncPendingUi=()=>{const pending=!!taskIntent.pending();quick.querySelector('button[type=submit]').textContent=pending?'Gửi lại lần giao việc trước':'Giao việc';if(discardBtn)discardBtn.hidden=!pending;};
  discardBtn?.addEventListener?.('click',async()=>{
    if(!await confirmBox('Bỏ lần giao việc chưa rõ kết quả trên máy này? Việc có thể ĐÃ được tạo – kiểm tra danh sách việc trước khi giao lại.',{title:'Bỏ lần giao việc',ok:'Bỏ lần giao việc'}))return;
    if(taskIntent.discard()){quick.reset?.();syncPendingUi();toast('Đã bỏ. Kiểm tra danh sách việc xem việc đã được tạo chưa.');void load();}
  });
  const toggleQuick = (show = quick.hidden) => { resetQuickOwner();quick.hidden = !show; if(show){const pending=taskIntent.pending();syncPendingUi();if(pending){for(const key of ['title','assigneeId','priority','dueDate'])quick.elements[key].value=pending.content[key]||'';toast('Có lần giao việc chưa rõ kết quả. Nội dung đã được khôi phục để gửi lại đúng mã.');}quick.querySelector('[name=title]').focus?.();} };
  q('#tasks-new').addEventListener('click', () => toggleQuick());
  quick.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, title = f.title.value.trim(); if (!title) return f.title.focus();
    const btn = f.querySelector('button[type=submit]'),owner=userId(); btn.disabled = true;
    try {

      const content = { title, assigneeId: f.assigneeId.value, priority: f.priority.value, dueDate: f.dueDate.value || undefined };
      await taskIntent.send(content,(clientKey,content)=>api('/tasks','POST',{...content,clientKey}));
      if(owner!==userId())return;
      f.title.value = ''; syncPendingUi(); toast('Đã giao việc.'); await load(); f.title.focus();
    } catch (ex) { if(owner===userId())toast(ex.message+(taskIntent.pending()&&ex.status>=400&&ex.status<500?' Có thể bấm "Bỏ lần giao việc này".':''), 'err'); } finally { if(owner===userId()){btn.disabled = false;syncPendingUi();} }
  });
  quick.querySelector('[data-cancel]')?.addEventListener('click', () => toggleQuick(false));
  quick.querySelectorAll('[data-due]').forEach(b => b.addEventListener('click', () => { quick.dueDate.value = b.dataset.due === '' ? '' : addDays(todayIso(), Number(b.dataset.due)); }));
  q('#tasks-refresh').addEventListener('click', () => { st.refresh = true; load(); });
  q('#tasks-view').addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    if (b.dataset.v === 'approvals') { load('approvals'); return; }
    st.view = b.dataset.v; st.assignee = ''; showTab('tasks'); fillFilters(); load();
  });
  q('#tasks-status').addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    st.status = b.dataset.v; q('#tasks-status').querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); load();
  });
  q('#tasks-stats').addEventListener('click', e => {
    const b = e.target.closest('[data-stat]'); if (!b) return;
    st.due = st.due === b.dataset.stat ? '' : b.dataset.stat; q('#tasks-due').value = st.due; showTab('tasks'); load();
  });
  for (const [sel, key] of [['#tasks-due', 'due'], ['#tasks-priority', 'priority'], ['#tasks-source', 'source'], ['#tasks-assignee', 'assignee']])
    q(sel).addEventListener('change', e => { st[key] = e.target.value; load(); });
  q('#tasks-search').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { st.search = e.target.value.trim(); load(); }, 250); });
  q('#tasks-active').addEventListener('click', e => {
    const b = e.target.closest('[data-clear]'); if (!b) return;
    const k = b.dataset.clear;
    clearTimeout(searchTimer);
    for (const key of k === 'all' ? ['source', 'priority', 'assignee', 'due', 'search'] : k === 'status' ? [] : [k]) st[key] = '';
    if (k === 'all' || k === 'status') st.status = 'open';
    fillFilters(); load();
  });
  q('#tasks-group').addEventListener('click', e => {
    const b = e.target.closest('[data-group]'); if (!b) return;
    st.groupBy = b.dataset.group; store.set('bn-tasks-group', st.groupBy); st.collapsed.clear(); renderList();
  });
  q('#tasks-approvals').addEventListener('click', e => {
    if (e.target.closest('[data-retry-approvals]')) { void loadApprovals(true); renderApprovals(); return; }
    const b = e.target.closest('[data-kind]'); if (!b) return;
    st.kind = b.dataset.kind; renderApprovals();
  });
  q('#tasks-list').addEventListener('change', e => {
    const r = e.target.closest('[data-task]'); if (!r) return;
    if (e.target.matches('[data-toggle]')) update(r.dataset.task, { status: e.target.checked ? 'done' : 'todo' }, e.target.checked ? 'Đã hoàn thành ✓' : 'Mở lại việc.');
  });
  q('#tasks-list').addEventListener('click', e => {
    const fold = e.target.closest('[data-collapse]');
    if (fold) { const k = fold.dataset.collapse; st.collapsed.has(k) ? st.collapsed.delete(k) : st.collapsed.add(k); renderList(); return; }
    const r = e.target.closest('[data-task]'); if (!r) return;
    if (e.target.closest('[data-claim]')) return void update(r.dataset.task, { assigneeId: userId() }, 'Đã nhận việc.');
    if (e.target.closest('[data-cycle]')) { const t = st.list.find(x => x.id === r.dataset.task); return void update(r.dataset.task, { status: t?.status === 'in_progress' ? 'todo' : 'in_progress' }); }
    if (e.target.closest('input, select, a, button')) return;
    select(r.dataset.task);
  });
  // Phím tắt: N giao việc · / tìm · ↑↓ chọn việc · Enter mở · Esc đóng khung chi tiết (khi không gõ trong ô nhập).
  document.addEventListener('keydown', e => {
    if (root.hidden || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]')) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); toggleQuick(true); }
    else if (e.key === '/') { e.preventDefault(); q('#tasks-search').focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const ids = [...q('#tasks-list').querySelectorAll('[data-task]')].map(r => r.dataset.task); if (!ids.length) return;
      e.preventDefault();
      const i = ids.indexOf(st.selected), next = ids[i < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      select(next, wide());
    } else if (e.key === 'Enter' && st.selected) { e.preventDefault(); openDetail(st.selected); }
    else if (e.key === 'Escape' && panelTask) closePanel();
  });
  return { load, badge, prefetch, refreshPeople: () => { st.people = null; } };
}
