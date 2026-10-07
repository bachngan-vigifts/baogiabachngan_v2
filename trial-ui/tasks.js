// Bảng CÔNG VIỆC: việc tự sinh (báo giá, check tồn, đơn hàng, giao hàng, HĐKT, công nợ, nhập hàng) + việc giao thủ công.
// Cấu hình nhãn / màu ở TASK_UI (cùng khoá với src/modules/tasks/domain/task-config.ts). Giao diện: thống kê nhanh,
// thêm việc một dòng (Enter), lọc theo nhóm / trạng thái / ưu tiên / nguồn, danh sách nhóm theo hạn, hộp chi tiết + trao đổi.
export const TASK_UI = {
  status: { todo: ['Cần làm', 'muted'], in_progress: ['Đang làm', 'info'], done: ['Hoàn thành', 'ok'], cancelled: ['Đã huỷ', 'off'] },
  priority: { urgent: ['Khẩn', 'urgent'], high: ['Cao', 'high'], normal: ['Bình thường', 'normal'], low: ['Thấp', 'low'] },
  source: {
    manual: ['Giao việc', 'manual'], quote: ['Báo giá', 'quote'], stock_request: ['Check tồn', 'stock'], order: ['Đơn hàng', 'order'], delivery: ['Giao hàng', 'delivery'],
    packing: ['Xuất kho / đóng hàng', 'packing'], contract: ['HĐKT', 'contract'], receivable: ['Công nợ', 'debt'], purchase: ['Nhập hàng', 'purchase'],
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
export function initTasks({ api, toast, go, isManager, userId }) {
  const root = document.getElementById('view-tasks'), q = s => root.querySelector(s);
  const st = { view: 'mine', status: 'open', priority: '', source: '', search: '', people: null, list: [] };
  let searchTimer;

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
    const cards = [['mine', 'Việc của tôi', s.open, 'đang mở', ''], ['overdue', 'Quá hạn', s.overdue, 'cần xử lý ngay', s.overdue ? 'danger' : ''], ['today', 'Đến hạn hôm nay', s.today, 'trong ngày', s.today ? 'warn' : '']];
    if (isManager()) cards.push(['unassigned', 'Chưa giao', s.unassigned, 'chờ phân công', s.unassigned ? 'info' : '']);
    else if (s.team) cards.push(['team', 'Việc nhóm', s.team, 'chưa ai nhận', 'info']);
    q('#tasks-stats').innerHTML = cards.map(([k, label, n, sub, tone]) => `<button type="button" class="stat task-stat ${tone}" data-stat="${k}"><small>${label}</small><strong>${n}</strong><span class="muted">${sub}</span></button>`).join('');
  }

  function row(t) {
    const done = t.status === 'done' || t.status === 'cancelled';
    return `<tr class="task-row ${done ? 'is-done' : ''} prio-${t.priority}" data-task="${esc(t.id)}">
      <td class="task-check"><input type="checkbox" ${t.status === 'done' ? 'checked' : ''} ${t.status === 'cancelled' ? 'disabled' : ''} aria-label="Hoàn thành ${esc(t.title)}" data-toggle></td>
      <td class="task-main"><div class="task-title">${esc(t.title)}</div>
        <div class="task-meta">${pill(TASK_UI.source, t.source, 'src')}${t.auto && !t.createdBy ? '<span class="pill off" title="Hệ thống tự tạo, tự hoàn thành khi chứng từ xử lý xong">Tự động</span>' : ''}${t.description ? `<span class="muted task-desc">${esc(t.description)}</span>` : ''}${t.comments ? `<span class="task-cmt" title="Trao đổi">💬 ${t.comments}</span>` : ''}</div></td>
      <td data-label="Ưu tiên">${pill(TASK_UI.priority, t.priority, 'prio')}</td>
      <td data-label="Giao / nhận" class="task-people"><small class="muted">${esc(t.creatorName || 'Hệ thống')} →</small><b>${who(t)}</b>${t.canClaim && !done ? '<button type="button" class="btn secondary small claim-btn" data-claim>Nhận việc</button>' : ''}</td>
      <td data-label="Hạn">${dueText(t)}</td>
      <td data-label="Trạng thái"><select class="task-status st-${t.status}" data-status aria-label="Trạng thái">${Object.entries(TASK_UI.status).filter(([k]) => k !== 'cancelled' || t.canManage || t.status === 'cancelled').map(([k, [l]]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td class="task-go">${t.link ? `<a class="btn ghost small" href="${esc(t.link)}" data-open-link title="Mở chứng từ">Mở</a>` : ''}</td></tr>`;
  }

  async function load(focusId) {
    const list = q('#tasks-list');
    if (!st.list.length) list.innerHTML = '<tr><td colspan="7" class="muted">Đang tải…</td></tr>';
    await people();
    q('#tasks-view [data-v="unassigned"]').hidden = !isManager();
    q('#tasks-view [data-v="all"]').textContent = isManager() ? 'Tất cả' : 'Tất cả của tôi';
    if (st.view === 'unassigned' && !isManager()) st.view = 'mine';
    const params = new URLSearchParams({ view: st.view, status: st.status });
    if (st.priority) params.set('priority', st.priority); if (st.source) params.set('source', st.source); if (st.search) params.set('q', st.search);
    try {
      const [d, s] = await Promise.all([api('/tasks?' + params), badge()]);
      st.list = d.tasks; if (s) renderStats(s);
      if (!q('#tasks-quick-assignee').options.length) q('#tasks-quick-assignee').innerHTML = personOptions(userId(), isManager());
      const groups = st.status === 'open' ? TASK_UI.groups.map(([k, label]) => [label, d.tasks.filter(t => t.due === k), k]).filter(([, items]) => items.length) : [['', d.tasks, '']];
      list.innerHTML = groups.map(([label, items, k]) => (label ? `<tr class="task-group g-${k}"><th colspan="7">${label} <span>${items.length}</span></th></tr>` : '') + items.map(row).join('')).join('');
      q('#tasks-empty').hidden = d.tasks.length > 0;
      q('#tasks-empty-text').textContent = st.status === 'open' ? 'Không có việc nào đang mở. Thêm việc mới ở ô phía trên.' : 'Chưa có việc nào.';
      if (focusId) openDetail(focusId);
    } catch (e) { list.innerHTML = `<tr><td colspan="7" class="error">${esc(e.message)}</td></tr>`; }
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
    const me = userId(), canEdit = t.canManage, isAssignee = t.assigneeId === me || t.canClaim, edit = canEdit || isAssignee, text = canEdit && !t.auto;
    const dlg = document.createElement('dialog'); dlg.className = 'modal task-dialog';
    dlg.innerHTML = `<form class="task-form">
      <div class="modal-head"><div><span class="eyebrow">${TASK_UI.source[t.source]?.[0] || ''}${t.auto ? ' · Tự động' : ''}</span>
        ${text ? `<input name="title" class="task-title-input" value="${esc(t.title)}" maxlength="300" required>` : `<h2>${esc(t.title)}</h2>`}</div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body">
        <div class="seg" role="group" aria-label="Trạng thái">${Object.entries(TASK_UI.status).filter(([k]) => k !== 'cancelled' || canEdit).map(([k, [l, c]]) => `<button type="button" class="seg-btn ${c}" data-set-status="${k}" aria-pressed="${k === t.status}" ${edit ? '' : 'disabled'}>${l}</button>`).join('')}</div>
        <div class="task-grid">
          <label><span>Người nhận</span><select name="assigneeId" ${edit ? '' : 'disabled'}>${personOptions(t.assigneeId, isManager(), t.assigneePosition || '')}</select></label>
          <label><span>Ưu tiên</span><select name="priority" ${edit ? '' : 'disabled'}>${Object.entries(TASK_UI.priority).map(([k, [l]]) => `<option value="${k}" ${k === t.priority ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label><span>Hạn hoàn thành</span><input type="date" name="dueDate" value="${esc(t.dueDate || '')}" ${edit ? '' : 'disabled'}></label>
          <label><span>Giờ</span><input type="time" name="dueTime" value="${esc(t.dueTime || '')}" ${edit ? '' : 'disabled'}></label>
        </div>
        <label class="task-desc-field"><span>Mô tả</span>${text ? `<textarea name="description" rows="3" maxlength="5000">${esc(t.description)}</textarea>` : `<p class="pre">${esc(t.description) || '<span class="muted">—</span>'}</p>`}</label>
        <p class="muted small">${t.teamName && !t.assigneeId ? `Giao cho <b>nhóm ${esc(t.teamName)}</b> – người trong nhóm bấm "Nhận việc" hoặc chuyển sang Đang làm để nhận. · ` : ''}Giao bởi <b>${esc(t.creatorName)}</b> · ${ago(t.createdAt)}${t.completedAt ? ` · Hoàn thành ${dmy(t.completedAt)}${t.completedByName ? ' bởi ' + esc(t.completedByName) : ''}` : ''}${t.link ? ` · <a href="${esc(t.link)}" data-open-link>Mở chứng từ →</a>` : ''}</p>
        <h3 class="task-cmt-title">Trao đổi</h3><ul class="task-comments" data-comments><li class="muted">Đang tải…</li></ul>
        <div class="task-cmt-add"><input name="comment" placeholder="Nhắn người giao / người nhận… (Enter để gửi)" maxlength="2000"><button type="button" class="btn secondary small" data-send>Gửi</button></div>
      </div>
      <div class="modal-foot">${t.canDelete ? '<button type="button" class="btn ghost danger-text" data-del>Xoá việc</button>' : ''}<span class="grow"></span>${t.canClaim && t.status !== 'done' ? '<button type="button" class="btn secondary" data-claim-dlg>Nhận việc</button>' : ''}<button type="button" class="btn secondary" data-x>Đóng</button>${edit ? '<button type="submit" class="btn primary">Lưu</button>' : ''}</div></form>`;
    document.body.append(dlg); dlg.showModal();
    const f = dlg.querySelector('form'), close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close)); dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelectorAll('[data-open-link]').forEach(a => a.addEventListener('click', close));
    let status = t.status;
    dlg.querySelectorAll('[data-set-status]').forEach(b => b.addEventListener('click', () => { status = b.dataset.setStatus; dlg.querySelectorAll('[data-set-status]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    const loadComments = async () => {
      const ul = dlg.querySelector('[data-comments]');
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
    dlg.querySelector('[data-send]').addEventListener('click', send);
    f.comment.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    dlg.querySelector('[data-claim-dlg]')?.addEventListener('click', async () => { if (await update(t.id, { assigneeId: me }, 'Đã nhận việc.')) close(); });
    dlg.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('Xoá công việc này?')) return;
      try { await api('/tasks/' + encodeURIComponent(t.id), 'DELETE'); toast('Đã xoá việc.'); close(); load(); } catch (e) { toast(e.message, 'err'); }
    });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const body = { revision: t.revision, status, priority: f.priority.value, dueDate: f.dueDate.value, dueTime: f.dueTime.value };
      const cur = t.assigneeId || (t.assigneePosition ? 'team:' + t.assigneePosition : '');
      if (f.assigneeId.value !== cur) body.assigneeId = f.assigneeId.value;
      if (text) { body.title = f.title.value; body.description = f.description.value; }
      if (await update(t.id, body, 'Đã lưu công việc.')) close();
    });
    loadComments();
    if (location.hash !== '#/tasks/' + t.id) history.replaceState(null, '', '#/tasks/' + t.id);
    dlg.addEventListener('close', () => { if (location.hash.startsWith('#/tasks/')) history.replaceState(null, '', '#/tasks'); });
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
    st[key] = b.dataset.v; q(sel).querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); load();
  });
  chips('#tasks-view', 'view'); chips('#tasks-status', 'status');
  q('#tasks-priority').addEventListener('change', e => { st.priority = e.target.value; load(); });
  q('#tasks-source').addEventListener('change', e => { st.source = e.target.value; load(); });
  q('#tasks-search').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { st.search = e.target.value.trim(); load(); }, 250); });
  q('#tasks-stats').addEventListener('click', e => {
    const b = e.target.closest('[data-stat]'); if (!b) return;
    const k = b.dataset.stat; st.view = k === 'unassigned' ? 'unassigned' : k === 'team' ? 'team' : 'mine'; st.status = 'open';
    q('#tasks-view').querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === st.view)));
    q('#tasks-status').querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === 'open')));
    load().then(() => { const g = q(`.task-group.g-${k === 'overdue' ? 'overdue' : k === 'today' ? 'today' : ''}`); g?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
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
