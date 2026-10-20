// Bảng CÔNG VIỆC: việc tự sinh (báo giá, check tồn, đơn hàng, giao hàng, HĐKT, công nợ, nhập hàng) + việc giao thủ công.
// Cấu hình nhãn / màu ở TASK_UI (cùng khoá với src/modules/tasks/domain/task-config.ts). Giao diện: thống kê nhanh,
// thêm việc một dòng (Enter), lọc theo nhóm / trạng thái / ưu tiên / nguồn, danh sách nhóm theo hạn, hộp chi tiết + trao đổi.
export const TASK_UI = {
  status: { todo: ['Cần làm', 'muted'], in_progress: ['Đang làm', 'info'], done: ['Hoàn thành', 'ok'], cancelled: ['Đã huỷ', 'off'] },
  priority: { urgent: ['Khẩn', 'urgent'], high: ['Cao', 'high'], normal: ['Bình thường', 'normal'], low: ['Thấp', 'low'] },
  source: {
    manual: ['Giao việc', 'manual'], quote: ['Báo giá', 'quote'], stock_request: ['Check tồn', 'stock'], order: ['Đơn hàng', 'order'], delivery: ['Giao hàng', 'delivery'],
    packing: ['Xuất kho / đóng hàng', 'packing'], contract: ['HĐKT', 'contract'], receivable: ['Công nợ', 'debt'], purchase: ['Nhập hàng', 'purchase'], invoice: ['Xuất hoá đơn', 'invoice'], care: ['Chăm sóc khách', 'care'],
  },
  /** Nhóm nhận việc (id chức vụ) – cùng danh sách TASK_TEAMS ở máy chủ. */
  teams: { warehouse: 'Kho', accounting: 'Kế toán', 'sale-admin': 'Sale Admin' },
  groups: [['overdue', 'Quá hạn'], ['today', 'Hôm nay'], ['upcoming', 'Sắp tới'], ['none', 'Chưa đặt hạn']],
};
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dmy = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
// "Hôm nay" theo giờ Việt Nam (khớp máy chủ), không theo múi giờ của máy đang mở.
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const pill = (map, k, extra = '') => `<span class="pill ${map[k]?.[1] || ''} ${extra}">${esc(map[k]?.[0] || k)}</span>`;
const completionHint = t => t.source === 'invoice' ? 'Việc xuất hoá đơn tự hoàn thành khi nhập số hoá đơn trên đơn / HĐKT. Mở chứng từ để ghi nhận số hoá đơn.' : /duyệt/i.test(t.title) ? 'Việc duyệt tự hoàn thành khi chứng từ được duyệt. Mở chứng từ để duyệt.' : 'Việc nhận hàng tự hoàn thành theo đơn mua. Mở chứng từ để ghi nhận hàng đã nhận.';
const ago = iso => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'vừa xong' : s < 3600 ? `${Math.floor(s / 60)} phút trước` : s < 86400 ? `${Math.floor(s / 3600)} giờ trước` : dmy(iso); };
function dueText(t) {
  if (!t.dueDate) return '<span class="muted">—</span>';
  const days = Math.round((Date.parse(t.dueDate) - Date.parse(todayIso())) / 864e5), done = t.status === 'done' || t.status === 'cancelled';
  const tone = done ? 'muted' : days < 0 ? 'danger' : days === 0 ? 'warn' : days <= 2 ? 'info' : 'ok';
  const note = done ? '' : days < 0 ? `trễ ${-days} ngày` : days === 0 ? 'hôm nay' : days === 1 ? 'ngày mai' : `còn ${days} ngày`;
  return `<span class="due-date ${tone}"><b>${dmy(t.dueDate)}${t.dueTime ? ' ' + esc(t.dueTime) : ''}</b>${note ? `<small>${note}</small>` : ''}</span>`;
}

/**
 * Gắn bảng công việc vào #view-tasks. `api(path, method, body)`, `toast(msg, kind)`, `go(hash)`, `isManager()`, `userId()`.
 * Trả về { load(id?), badge() }.
 */
export function initTasks({ api, toast, confirmBox = async t => confirm(t), go, isManager, canApprove = isManager, userId, positionId = () => '' }) {
  const root = document.getElementById('view-tasks'), q = s => root.querySelector(s);
  const st = { view: 'mine', status: 'open', priority: '', source: '', search: '', people: null, list: [], tab: 'tasks', kind: '', taskKind: '', due: '', approvals: null, accounting: false };
  let searchTimer, loadSequence = 0;

  async function people() {
    if (!st.people) { try { st.people = (await api('/tasks/people')).people; } catch { st.people = []; } }
    return st.people;
  }
  // Người nhận: từng nhân viên, hoặc cả nhóm (Kho, Kế toán…) – giá trị `team:<chức vụ>`.
  const personOptions = (selected, allowEmpty, team = '') => (allowEmpty ? `<option value="">— Chưa giao —</option>` : '')
    + `<optgroup label="Nhân viên">${(st.people || []).map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}${p.id === userId() ? ' (tôi)' : ''}</option>`).join('')}</optgroup>`
    + `<optgroup label="Giao cho nhóm">${Object.entries(TASK_UI.teams).map(([k, l]) => `<option value="team:${k}" ${!selected && team === k ? 'selected' : ''}>Nhóm ${esc(l)}</option>`).join('')}</optgroup>`;
  const who = t => t.assigneeName ? esc(t.assigneeName) : t.teamName ? `<span class="team-tag">Nhóm ${esc(t.teamName)}</span>` : '<span class="danger-text">Chưa giao</span>';

  async function badge() {
    try {
      const s = await api('/tasks/summary'), b = document.getElementById('nav-task-count');
      const n = s.overdue || s.open; b.hidden = !n; b.textContent = n; b.classList.toggle('danger', s.overdue > 0);
      b.title = `${s.open} việc đang mở · ${s.overdue} quá hạn · ${s.today} đến hạn hôm nay`;
      return s;
    } catch { return null; }
  }

  function renderStats(s) {
    const ap = st.approvals?.counts.total ?? 0;
    const cards = [['mine', 'Việc của tôi', s.open, 'đang mở', ''], ['overdue', 'Quá hạn', s.overdue, 'cần xử lý ngay', s.overdue ? 'danger' : ''], ['today', 'Đến hạn hôm nay', s.today, 'trong ngày', s.today ? 'warn' : '']];
    if (isManager()) cards.push(['unassigned', 'Chưa giao', s.unassigned, 'chờ phân công', s.unassigned ? 'info' : '']);
    else if (s.team) cards.push(['team', 'Việc nhóm', s.team, 'chưa ai nhận', 'info']);
    // Hộp "Cần duyệt": Manager + người được Manager bật cờ "Được duyệt" (máy chủ kiểm lại ở GET /approvals và từng nút duyệt).
    if (canApprove()) cards.push(['approvals', 'Cần duyệt', ap, 'chờ duyệt', ap ? 'warn' : '']);
    const active = st.tab === 'approvals' ? 'approvals' : st.status === 'open' && !st.priority && !st.source && !st.search ? st.due || st.view : '';
    q('#tasks-stats').innerHTML = cards.map(([k, label, n, sub, tone]) => `<button type="button" class="stat task-stat ${tone}" data-stat="${k}" aria-pressed="${k === active}"><small>${label}</small><strong>${n}</strong><span class="muted">${sub}</span></button>`).join('');
  }

  function renderAccountingHead(a) {
    const k = a.kpis, cards = [
      ['Xuất hoá đơn chờ', k.invoice.count, `${k.invoice.overdue} quá hạn`, 'warn'],
      ['Trả NCC trong 3 ngày', k.payable.count, `Kỳ tổng ${money(k.payable.amount)} · ${k.payable.overdue} quá hạn`, 'danger'],
      ['Nợ quá hạn đang theo dõi', `${k.receivable.count} đơn`, `${money(k.receivable.amount)} đã quá hạn`, 'info'],
      ['Việc nhóm chưa ai nhận', k.unclaimed, 'Bấm “Nhận việc” để làm', 'ok'],
    ];
    q('#tasks-stats').innerHTML = cards.map(([label, n, sub, tone]) => `<div class="stat task-stat ${tone}"><small>${esc(label)}</small><strong>${esc(n)}</strong><span class="muted">${esc(sub)}</span></div>`).join('');
    const tabs = [['accounting-team', 'Nhóm Kế toán', a.tabs.team], ['accounting-mine', 'Của tôi', a.tabs.mine], ['accounting-colleagues', 'Đồng nghiệp', a.tabs.colleagues], ['accounting-done-today', 'Đã đóng hôm nay', a.tabs.doneToday]];
    q('#tasks-view').innerHTML = tabs.map(([v, label, n]) => `<button type="button" class="chip" data-v="${v}" aria-pressed="${st.view === v}">${esc(label)} · ${n}</button>`).join('');
    q('#tasks-view [data-v="accounting-colleagues"]').hidden = !st.canViewColleagues;
    const kinds = [['', 'Tất cả', a.types.all], ['invoice', 'Xuất HĐ', a.types.invoice], ['payable', 'Trả NCC', a.types.payable], ['receivable', 'Thu nợ', a.types.receivable], ['web', 'Đơn web GHN', a.types.web]];
    const box = q('#tasks-kind'); box.hidden = false; box.innerHTML = kinds.map(([v, label, n]) => `<button type="button" class="chip" data-kind="${v}" aria-pressed="${st.taskKind === v}">${esc(label)} · ${n}</button>`).join('');
    q('#tasks-status').hidden = true; q('#tasks-due').hidden = true; q('#tasks-priority').hidden = true; q('#tasks-source').hidden = true;
    const warning = q('#tasks-source-warning'); warning.hidden = !a.warnings.length;
    warning.innerHTML = a.warnings.map(w => `<span>⚠ 1 việc đã đóng tay nhưng chứng từ vẫn còn tồn: <b>${esc(w.title)}</b> còn ${money(w.amount)}.</span>${w.link ? `<a href="${esc(w.link)}">Xem đơn</a>` : ''}`).join('');
    q('.task-table thead').innerHTML = '<tr><th>Việc</th><th>Loại</th><th class="right">Số tiền</th><th>Hạn</th><th>Phụ trách</th><th>Hành động</th></tr>';
  }

  function accountingRow(t) {
    const i = t.accounting || {}, action = t.canClaim ? '<button type="button" class="btn secondary small" data-claim>Nhận việc</button>'
      : t.link ? `<a class="btn ghost small" href="${esc(t.link)}" data-open-link>${esc(i.actionLabel || 'Mở chứng từ')}</a>`
      : `<span class="pill off">${esc(i.actionLabel || 'Không có link đơn')}</span>`;
    return `<tr class="task-row prio-${t.priority}" data-task="${esc(t.id)}"><td class="task-main"><div class="task-title">${esc(t.title)}</div><div class="task-meta">${esc(i.subline || t.description || '')} ${pill(TASK_UI.priority, t.priority, 'prio')}<span class="pill off">Tự động</span></div></td>
      <td data-label="Loại"><b>${esc(i.typeLabel || TASK_UI.source[t.source]?.[0] || '')}</b></td><td data-label="Số tiền" class="right num">${money(i.amount || 0)}</td><td data-label="Hạn">${dueText(t)}</td>
      <td data-label="Phụ trách" class="task-people"><b>${who(t)}</b><small class="muted">${t.assigneeName ? (t.status === 'in_progress' ? 'đang làm' : 'chưa nhận') : 'chưa ai nhận'}</small></td><td class="task-go">${action}</td></tr>`;
  }

  function row(t) {
    const done = t.status === 'done' || t.status === 'cancelled', ro = t.viewOnly;
    return `<tr class="task-row ${ro ? 'is-peer' : ''} ${done ? 'is-done' : ''} prio-${t.priority}" data-task="${esc(t.id)}">
      <td class="task-check">${t.completionFromSource ? `<span class="muted" title="${esc(completionHint(t))}">—</span>` : `<input type="checkbox" ${t.status === 'done' ? 'checked' : ''} ${t.status === 'cancelled' || ro ? 'disabled' : ''} aria-label="Hoàn thành ${esc(t.title)}" data-toggle>`}</td>
      <td class="task-main"><div class="task-title">${esc(t.title)}${ro ? ' <span class="pill off" title="Việc của đồng nghiệp cùng chức vụ – chỉ xem">Đồng nghiệp · chỉ xem</span>' : ''}</div>
        <div class="task-meta">${pill(TASK_UI.source, t.source, 'src')}${t.auto && !t.createdBy ? '<span class="pill off" title="Hệ thống tự tạo, tự hoàn thành khi chứng từ xử lý xong">Tự động</span>' : ''}${t.description ? `<span class="muted task-desc">${esc(t.description)}</span>` : ''}${t.comments ? `<span class="task-cmt" title="Trao đổi">💬 ${t.comments}</span>` : ''}</div></td>
      <td data-label="Ưu tiên">${pill(TASK_UI.priority, t.priority, 'prio')}</td>
      <td data-label="Giao / nhận" class="task-people"><small class="muted">${esc(t.creatorName || 'Hệ thống')} →</small><b>${who(t)}</b>${t.canClaim && !done ? '<button type="button" class="btn secondary small claim-btn" data-claim>Nhận việc</button>' : ''}</td>
      <td data-label="Hạn">${dueText(t)}</td>
      <td data-label="Trạng thái"><select class="task-status st-${t.status}" data-status aria-label="Trạng thái" ${ro || (t.completionFromSource && done) ? 'disabled' : ''}>${Object.entries(TASK_UI.status).filter(([k]) => (!t.completionFromSource || k === t.status || (k !== 'done' && k !== 'cancelled')) && (k !== 'cancelled' || t.canManage || t.status === 'cancelled')).map(([k, [l]]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td class="task-go">${t.link ? `<a class="btn ghost small" href="${esc(t.link)}" data-open-link title="Mở chứng từ">Mở</a>` : ''}</td></tr>`;
  }

  // ----- Thẻ "Cần duyệt" (Manager): báo giá, đơn / HĐKT, khách hàng, sản phẩm đang chờ duyệt – GET /approvals (chỉ đọc).
  // Duyệt vẫn làm ở màn hình của từng loại (bấm "Mở"), giữ nguyên hộp kiểm tra như hiện nay.
  const KIND = { quote: ['Báo giá', 'quote'], order: ['Đơn hàng', 'order'], contract: ['HĐKT', 'contract'], purchase: ['Đơn mua NCC', 'purchase'], customer: ['Khách hàng', 'manual'], product: ['Sản phẩm', 'purchase'] };
  const money = n => new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';
  async function loadApprovals() {
    if (!canApprove()) { st.approvals = null; return null; }
    try { st.approvals = await api('/approvals'); } catch { st.approvals = null; }
    const n = st.approvals?.counts.total ?? 0, c = q('#tasks-approval-count');
    c.hidden = !n; c.textContent = n;
    return st.approvals;
  }
  function renderApprovals() {
    const box = q('#tasks-approvals'), d = st.approvals;
    if (!d) { box.innerHTML = '<p class="error">Chưa tải được danh sách cần duyệt.</p>'; return; }
    const items = st.kind ? d.items.filter(i => i.kind === st.kind) : d.items;
    box.innerHTML = `<div class="chips approval-kinds" role="group" aria-label="Lọc loại"><button type="button" class="chip" data-kind="" aria-pressed="${!st.kind}">Tất cả <b>${d.counts.total}</b></button>${Object.entries(KIND).map(([k, [l]]) => `<button type="button" class="chip" data-kind="${k}" aria-pressed="${st.kind === k}" ${d.counts[k] ? '' : 'disabled'}>${l} <b>${d.counts[k]}</b></button>`).join('')}</div>
      ${items.length ? `<div class="table-wrap"><table class="data-table task-table approval-table"><thead><tr><th>Cần duyệt</th><th>Người tạo</th><th>Chờ từ</th><th class="right">Giá trị</th><th><span class="sr-only">Mở</span></th></tr></thead><tbody>
      ${items.map(i => `<tr><td class="task-main"><div class="task-title">${esc(i.title)}</div><div class="task-meta"><span class="pill ${KIND[i.kind][1]} src">${esc(KIND[i.kind][0])}</span>${i.sub ? `<span class="muted task-desc">${esc(i.sub)}</span>` : ''}</div></td>
        <td data-label="Người tạo">${esc(i.by || '—')}</td><td data-label="Chờ từ">${i.at ? esc(ago(i.at)) : '—'}</td><td${i.amount ? ' data-label="Giá trị"' : ''} class="right num">${i.amount ? money(i.amount) : ''}</td>
        <td class="task-go"><a class="btn primary small" href="${esc(i.link)}">Mở để duyệt</a></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted task-empty">Không có gì đang chờ duyệt. 🎉</p>'}`;
  }
  function showTab(tab) {
    st.tab = canApprove() && tab === 'approvals' ? 'approvals' : 'tasks';
    q('#tasks-tabs').querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === st.tab)));
    q('#tasks-approvals').hidden = st.tab !== 'approvals'; q('.task-board').hidden = st.tab === 'approvals';
    if (st.tab === 'approvals') renderApprovals();
  }

  async function load(focusId) {
    const request = ++loadSequence;
    if (focusId === 'approvals') { focusId = undefined; st.tab = 'approvals'; }
    q('#tasks-tabs').hidden = !canApprove();
    const list = q('#tasks-list');
    if (!st.list.length) list.innerHTML = '<tr><td colspan="7" class="muted">Đang tải…</td></tr>';
    await people();
    if (request !== loadSequence) return;
    const unassignedChip = q('#tasks-view [data-v="unassigned"]'); if (unassignedChip) unassignedChip.hidden = !isManager();
    // Quyền đồng nghiệp do server cấp theo nhóm/chức vụ hiện có.
    const peers = !isManager() && st.canViewColleagues === true;
    const peerChip = q('#tasks-view [data-v="colleagues"]'); if (peerChip) peerChip.hidden = !peers;
    if (st.view === 'colleagues' && !peers) st.view = 'mine';
    const allChip = q('#tasks-view [data-v="all"]'); if (allChip) allChip.textContent = isManager() ? 'Tất cả' : 'Tất cả được xem';
    if (st.view === 'unassigned' && !isManager()) st.view = 'mine';
    const params = new URLSearchParams({ view: st.view, status: st.status });
    if (st.accounting && st.taskKind) params.set('kind', st.taskKind);
    if (st.due) params.set('due', st.due);
    if (st.priority) params.set('priority', st.priority); if (st.source) params.set('source', st.source); if (st.search) params.set('q', st.search);
    try {
      const [d, s] = await Promise.all([api('/tasks?' + params), badge(), loadApprovals()]);
      if (request !== loadSequence) return;
      showTab(st.tab);
      st.canViewColleagues = d.canViewColleagues === true;
      if (d.accounting && !st.accounting) { st.accounting = true; st.view = 'accounting-team'; st.status = 'open'; return load(focusId); }
      const colleaguesChip = q('#tasks-view [data-v="colleagues"]'); if (colleaguesChip) colleaguesChip.hidden = !st.canViewColleagues;
      st.list = d.tasks; if (d.accounting) renderAccountingHead(d.accounting); else if (s) renderStats(s);
      if (!q('#tasks-quick-assignee').options.length) q('#tasks-quick-assignee').innerHTML = personOptions(userId(), isManager());
      const groups = st.status === 'open' ? TASK_UI.groups.map(([k, label]) => [label, d.tasks.filter(t => t.due === k), k]).filter(([, items]) => items.length) : [['', d.tasks, '']];
      list.innerHTML = groups.map(([label, items, k]) => (label ? `<tr class="task-group g-${k}"><th colspan="${st.accounting ? 6 : 7}">${label} <span>${items.length}</span></th></tr>` : '') + items.map(st.accounting ? accountingRow : row).join('')).join('');
      q('#tasks-empty').hidden = d.tasks.length > 0;
      q('#tasks-empty-text').textContent = st.due ? 'Không có công việc phù hợp với hạn đã chọn.' : st.status === 'open' ? 'Không có việc nào đang mở. Thêm việc mới ở ô phía trên.' : 'Chưa có việc nào.';
      if (focusId) openDetail(focusId);
    } catch (e) { if (request !== loadSequence) return; list.innerHTML = `<tr><td colspan="7" class="error">${esc(e.message)}</td></tr>`; }
  }

  async function update(id, body, msg) {
    try { await api('/tasks/' + encodeURIComponent(id), 'PUT', body); if (msg) toast(msg); await load(); return true; }
    catch (e) { toast(e.message, 'err'); await load(); return false; }
  }

  // ----- Hộp chi tiết: sửa nhanh + trao đổi
  async function openDetail(id) {
    let t;
    try { t = (await api('/tasks/' + encodeURIComponent(id))).task; } catch (e) { toast(e.message, 'err'); return; }
    await people();
    if (t.accounting) return openAccountingDetail(t);
    const me = userId(), ro = !!t.viewOnly, canEdit = t.canManage && !ro, isAssignee = !ro && (t.assigneeId === me || t.canClaim), edit = canEdit || isAssignee, text = canEdit && !t.auto;
    const dlg = document.createElement('dialog'); dlg.className = 'modal task-dialog';
    dlg.innerHTML = `<form class="task-form">
      <div class="modal-head"><div><span class="eyebrow">${TASK_UI.source[t.source]?.[0] || ''}${t.auto ? ' · Tự động' : ''}</span>
        ${text ? `<input name="title" class="task-title-input" value="${esc(t.title)}" maxlength="300" required>` : `<h2>${esc(t.title)}</h2>`}</div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body">
        <div class="seg" role="group" aria-label="Trạng thái">${Object.entries(TASK_UI.status).filter(([k]) => (!t.completionFromSource || k === t.status || (k !== 'done' && k !== 'cancelled')) && (k !== 'cancelled' || canEdit)).map(([k, [l, c]]) => `<button type="button" class="seg-btn ${c}" data-set-status="${k}" aria-pressed="${k === t.status}" ${edit && !(t.completionFromSource && (t.status === 'done' || t.status === 'cancelled')) ? '' : 'disabled'}>${l}</button>`).join('')}</div>
        ${t.completionFromSource ? `<p class="muted small">${esc(completionHint(t))}</p>` : ''}
        <div class="task-grid">
          <label><span>Người nhận</span><select name="assigneeId" ${edit ? '' : 'disabled'}>${personOptions(t.assigneeId, isManager(), t.assigneePosition || '')}</select></label>
          <label><span>Ưu tiên</span><select name="priority" ${edit ? '' : 'disabled'}>${Object.entries(TASK_UI.priority).map(([k, [l]]) => `<option value="${k}" ${k === t.priority ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label><span>Hạn hoàn thành</span><input type="date" name="dueDate" value="${esc(t.dueDate || '')}" ${edit ? '' : 'disabled'}></label>
          <label><span>Giờ</span><input type="time" name="dueTime" value="${esc(t.dueTime || '')}" ${edit ? '' : 'disabled'}></label>
        </div>
        <label class="task-desc-field"><span>Mô tả</span>${text ? `<textarea name="description" rows="3" maxlength="5000">${esc(t.description)}</textarea>` : `<p class="pre">${esc(t.description) || '<span class="muted">—</span>'}</p>`}</label>
        <p class="muted small">${t.teamName && !t.assigneeId ? `Giao cho <b>nhóm ${esc(t.teamName)}</b> – người trong nhóm bấm "Nhận việc" hoặc chuyển sang Đang làm để nhận. · ` : ''}Giao bởi <b>${esc(t.creatorName)}</b> · ${ago(t.createdAt)}${t.completedAt ? ` · Hoàn thành ${dmy(t.completedAt)}${t.completedByName ? ' bởi ' + esc(t.completedByName) : ''}` : ''}${t.link ? ` · <a href="${esc(t.link)}" data-open-link>Mở chứng từ →</a>` : ''}</p>
        ${ro ? '<p class="muted small task-peer-note">Việc của đồng nghiệp cùng chức vụ: chỉ xem. Trao đổi trong việc chỉ người giao, người nhận và Manager xem được.</p>'
          : `<h3 class="task-cmt-title">Trao đổi</h3><ul class="task-comments" data-comments><li class="muted">Đang tải…</li></ul>
        <div class="task-cmt-add"><input name="comment" placeholder="Nhắn người giao / người nhận… (Enter để gửi)" maxlength="2000"><button type="button" class="btn secondary small" data-send>Gửi</button></div>`}
      </div>
      <div class="modal-foot">${t.canDelete ? '<button type="button" class="btn ghost danger-text" data-del>Xoá việc</button>' : ''}<span class="grow"></span>${t.canClaim && t.status !== 'done' ? '<button type="button" class="btn secondary" data-claim-dlg>Nhận việc</button>' : ''}<button type="button" class="btn secondary" data-x>Đóng</button>${edit ? '<button type="submit" class="btn primary">Lưu</button>' : ''}</div></form>`;
    document.body.append(dlg); dlg.showModal();
    const f = dlg.querySelector('form'), close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close)); dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelectorAll('[data-open-link]').forEach(a => a.addEventListener('click', close));
    let status = t.status;
    dlg.querySelectorAll('[data-set-status]').forEach(b => b.addEventListener('click', () => { status = b.dataset.setStatus; dlg.querySelectorAll('[data-set-status]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    const loadComments = async () => {
      const ul = dlg.querySelector('[data-comments]'); if (!ul) return;
      try {
        const { comments } = await api(`/tasks/${encodeURIComponent(t.id)}/comments`);
        ul.innerHTML = comments.length ? comments.map(c => `<li class="${c.memberId === me ? 'me' : ''}"><b>${esc(c.name)}</b><span>${esc(c.body)}</span><small>${ago(c.createdAt)}</small></li>`).join('') : '<li class="muted">Chưa có trao đổi.</li>';
        ul.scrollTop = ul.scrollHeight;
      } catch (e) { ul.innerHTML = `<li class="error">${esc(e.message)}</li>`; }
    };
    const send = async () => {
      const inp = f.comment, body = inp.value.trim(); if (!body) return;
      inp.disabled = true;
      try { await api(`/tasks/${encodeURIComponent(t.id)}/comments`, 'POST', { body }); inp.value = ''; await loadComments(); } catch (e) { toast(e.message, 'err'); } finally { inp.disabled = false; inp.focus(); }
    };
    dlg.querySelector('[data-send]')?.addEventListener('click', send);
    f.comment?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    dlg.querySelector('[data-claim-dlg]')?.addEventListener('click', async () => { if (await update(t.id, { assigneeId: me }, 'Đã nhận việc.')) close(); });
    dlg.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!await confirmBox(`Xoá công việc "${t.title || ''}"? Không khôi phục được.`, { title: 'Xoá việc', ok: 'Xoá việc', danger: true })) return;
      try { await api('/tasks/' + encodeURIComponent(t.id), 'DELETE'); toast('Đã xoá việc.'); close(); load(); } catch (e) { toast(e.message, 'err'); }
    });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const body = { revision: t.revision, ...(t.completionFromSource && status === t.status ? {} : { status }), priority: f.priority.value, dueDate: f.dueDate.value, dueTime: f.dueTime.value };
      const cur = t.assigneeId || (t.assigneePosition ? 'team:' + t.assigneePosition : '');
      if (f.assigneeId.value !== cur) body.assigneeId = f.assigneeId.value;
      if (text) { body.title = f.title.value; body.description = f.description.value; }
      if (await update(t.id, body, 'Đã lưu công việc.')) close();
    });
    loadComments();
    if (location.hash !== '#/tasks/' + t.id) history.replaceState(null, '', '#/tasks/' + t.id);
    dlg.addEventListener('close', () => { if (location.hash.startsWith('#/tasks/')) history.replaceState(null, '', '#/tasks'); });
  }

  function openAccountingDetail(t) {
    const i = t.accounting, d = i.detail || {}, me = userId(), ro = !!t.viewOnly;
    const labels = i.kind === 'payable' ? [['Tổng đơn mua', d.total], ['Đã trả', d.paid], [`Kỳ đến hạn ${d.dueDate ? dmy(d.dueDate) : ''}`, d.dueAmount], ['Còn nợ sau kỳ này', d.balance]]
      : i.kind === 'receivable' ? [['Quá hạn', d.overdue], ['Còn phải thu', d.balance]] : [['Giá trị', d.value], ...(d.taxCode ? [['Mã số thuế', d.taxCode]] : []), ['Hình thức', d.invoiceMode === 'draft' ? 'Bản nháp' : 'Phát hành chính thức']];
    const dlg = document.createElement('dialog'); dlg.className = 'modal task-dialog accounting-task-dialog';
    dlg.innerHTML = `<form class="task-form"><div class="modal-head"><div><span class="eyebrow">${esc(i.typeLabel)} · ${t.auto ? 'Tự động' : ''}</span><h2>${esc(t.title)}</h2><div class="task-meta">${pill(TASK_UI.priority, t.priority, 'prio')} · ${who(t)}</div></div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body"><section class="accounting-money"><h3>Số tiền</h3>${labels.map(([l, v], n) => `<div class="${n === labels.length - 1 ? 'total' : ''}"><span>${esc(l)}</span><b>${typeof v === 'number' ? money(v) : esc(v || '—')}</b></div>`).join('')}<small>Số liệu lấy trực tiếp từ chứng từ nguồn.</small></section>
      <h3>Cần làm</h3><p class="pre">${esc(t.description || i.subline || '')}</p><div class="task-detail-actions">${t.canClaim ? '<button type="button" class="btn primary" data-claim-dlg>Nhận việc</button>' : ''}${t.link ? `<a class="btn secondary" href="${esc(t.link)}">${esc(i.actionLabel)}</a>` : `<span class="pill off">Không có link đơn${d.ghnOrderCode ? ' · ' + esc(d.ghnOrderCode) : ''}</span>`}${i.kind === 'web' ? '<button type="button" class="btn secondary" data-complete>Hoàn thành</button>' : '<button type="button" class="btn secondary" disabled>Hoàn thành (tự động)</button>'}</div>
      <p class="muted small">${i.kind === 'web' ? 'Việc xuất hoá đơn đơn web hiện vẫn đóng bằng tay trong lúc chờ chốt nguồn trạng thái xuất HĐ.' : 'Hoàn thành tự động khi chứng từ nguồn được xử lý đầy đủ.'}</p>
      ${!ro ? '<h3 class="task-cmt-title">Trao đổi</h3><ul class="task-comments" data-comments><li class="muted">Đang tải…</li></ul><div class="task-cmt-add"><input name="comment" placeholder="Viết trao đổi…" maxlength="2000"><button type="button" class="btn secondary small" data-send>Gửi</button></div>' : ''}
      <p class="task-auto-note">Việc này do hệ thống tạo, không xoá được.</p></div></form>`;
    document.body.append(dlg); dlg.showModal(); const close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('[data-x]').addEventListener('click', close); dlg.querySelector('[data-claim-dlg]')?.addEventListener('click', async () => { if (await update(t.id, { assigneeId: me }, 'Đã nhận việc.')) close(); });
    dlg.querySelector('[data-complete]')?.addEventListener('click', async () => { if (await update(t.id, { status: 'done' }, 'Đã hoàn thành.')) close(); });
    const loadComments = async () => { const ul = dlg.querySelector('[data-comments]'); if (!ul) return; try { const x = await api(`/tasks/${encodeURIComponent(t.id)}/comments`); ul.innerHTML = x.comments.length ? x.comments.map(c => `<li><b>${esc(c.name)}</b><span>${esc(c.body)}</span><small>${ago(c.createdAt)}</small></li>`).join('') : '<li class="muted">Chưa có trao đổi.</li>'; } catch (e) { ul.textContent = e.message; } };
    dlg.querySelector('[data-send]')?.addEventListener('click', async () => { const inp = dlg.querySelector('[name=comment]'), body = inp.value.trim(); if (!body) return; await api(`/tasks/${encodeURIComponent(t.id)}/comments`, 'POST', { body }); inp.value = ''; loadComments(); });
    loadComments();
  }

  // ----- Sự kiện
  q('#tasks-quick').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, title = f.title.value.trim(); if (!title) return f.title.focus();
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      await api('/tasks', 'POST', { title, assigneeId: f.assigneeId.value, priority: f.priority.value, dueDate: f.dueDate.value || undefined });
      f.title.value = ''; toast('Đã thêm việc.'); await load(); f.title.focus();
    } catch (ex) { toast(ex.message, 'err'); } finally { btn.disabled = false; }
  });
  q('#tasks-quick').querySelectorAll('[data-due]').forEach(b => b.addEventListener('click', () => { q('#tasks-quick').dueDate.value = b.dataset.due === '' ? '' : addDays(todayIso(), Number(b.dataset.due)); }));
  const chips = (sel, key) => q(sel).addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    st[key] = b.dataset.v; st.due = ''; q('#tasks-due').value = ''; q(sel).querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); load();
  });
  chips('#tasks-view', 'view'); chips('#tasks-status', 'status');
  q('#tasks-kind').addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (!b) return; st.taskKind = b.dataset.kind; load(); });
  q('#tasks-due').addEventListener('change', e => { st.due = e.target.value; load(); });
  q('#tasks-priority').addEventListener('change', e => { st.priority = e.target.value; load(); });
  q('#tasks-source').addEventListener('change', e => { st.source = e.target.value; load(); });
  q('#tasks-search').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { st.search = e.target.value.trim(); load(); }, 250); });
  q('#tasks-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  q('#tasks-approvals').addEventListener('click', e => {
    const b = e.target.closest('[data-kind]'); if (!b) return;
    st.kind = b.dataset.kind; renderApprovals();
  });
  q('#tasks-stats').addEventListener('click', e => {
    const b = e.target.closest('[data-stat]'); if (!b) return;
    const k = b.dataset.stat;
    if (k === 'approvals') { showTab('approvals'); load(); return; }
    if (!['mine', 'overdue', 'today', 'team', 'unassigned'].includes(k)) return;
    clearTimeout(searchTimer); st.priority = ''; st.source = ''; st.search = '';
    q('#tasks-priority').value = ''; q('#tasks-source').value = ''; q('#tasks-search').value = '';
    st.due = k === 'overdue' || k === 'today' ? k : ''; q('#tasks-due').value = st.due;
    showTab('tasks'); st.view = k === 'unassigned' ? 'unassigned' : k === 'team' ? 'team' : 'mine'; st.status = 'open';
    q('#tasks-view').querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === st.view)));
    q('#tasks-status').querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === 'open')));
    load();
  });
  q('#tasks-list').addEventListener('change', e => {
    const tr = e.target.closest('[data-task]'); if (!tr) return;
    if (e.target.matches('[data-toggle]')) update(tr.dataset.task, { status: e.target.checked ? 'done' : 'todo' }, e.target.checked ? 'Đã hoàn thành ✓' : 'Mở lại việc.');
    if (e.target.matches('[data-status]')) update(tr.dataset.task, { status: e.target.value });
  });
  q('#tasks-list').addEventListener('click', e => {
    const tr = e.target.closest('[data-task]'); if (!tr) return;
    if (e.target.closest('[data-claim]')) return void update(tr.dataset.task, { assigneeId: userId() }, 'Đã nhận việc.');
    if (e.target.closest('input, select, a, button')) return;
    openDetail(tr.dataset.task);
  });
  // Phím tắt: "n" thêm việc, "/" tìm kiếm (khi đang ở bảng công việc và không gõ trong ô nhập).
  document.addEventListener('keydown', e => {
    if (root.hidden || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]')) return;
    if (e.key === 'n') { e.preventDefault(); q('#tasks-quick').title.focus(); }
    if (e.key === '/') { e.preventDefault(); q('#tasks-search').focus(); }
  });
  return { load, badge, refreshPeople: () => { st.people = null; } };
}
