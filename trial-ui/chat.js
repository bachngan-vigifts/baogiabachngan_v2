// TIN NHẮN nội bộ giữa nhân viên: nút chat nổi góc dưới phải mở khung chat (danh sách hội thoại 1-1 + nhóm bên trái, khung chat bên phải).
// Cập nhật: khung đang mở hỏi tin mới mỗi 3 giây; danh sách mỗi 10 giây; huy hiệu menu mỗi 20 giây (+ Web Push khi có tin).
import { ding, setBadgePart } from './alert.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = name => String(name || '?').trim().split(/\s+/).slice(-2).map(w => w[0]).join('').toUpperCase();
const AVATAR = ['#2459a9', '#12805c', '#a86400', '#6b3fb4', '#0e6a91', '#b4232c', '#4338ca', '#0f766e'];
const color = id => AVATAR[[...String(id)].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVATAR.length];
const avatar = (id, name, group) => `<span class="chat-avatar ${group ? 'group' : ''}" style="background:${group ? '#3c4a63' : color(id)}">${group ? '👥' : esc(initials(name))}</span>`;
const vnDay = iso => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
const vnTime = iso => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
function when(iso) {
  if (!iso) return '';
  const today = vnDay(new Date().toISOString()), d = vnDay(iso);
  return d === today ? vnTime(iso) : d.slice(0, 5);
}
/** Chữ an toàn + tự nhận liên kết (http…, và #/orders/… #/quotes/… trong web). */
const linkify = t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
  .replace(/(^|\s)(#\/(?:orders|quotes|tasks|contracts|deliveries)\/[\w-]+)/g, '$1<a href="$2">$2</a>').replace(/\n/g, '<br>');

/**
 * Gắn khung Tin nhắn vào #view-chat. `api(path, method, body)`, `toast`, `userId()`, `isManager()`.
 * Trả về { show(id?), hide(), open(id), badge(), refresh(), startBadge(), stop() }.
 */
export function initChat({ api, toast, userId, isManager }) {
  const root = document.getElementById('view-chat'), q = s => root.querySelector(s);
  const st = { list: [], active: null, messages: [], reads: [], last: null, people: null, filter: '', timers: [], loading: false, cache: new Map() };

  let lastUnread = null;
  async function badge() {
    try {
      const { unread } = await api('/chat/unread'), b = document.getElementById('nav-chat-count');
      b.hidden = !unread; b.textContent = unread > 99 ? '99+' : unread;
      setBadgePart('chat', unread); // số đỏ trên icon app
      // Khung chat đang đóng mà có tin mới: báo ngay (thông báo + tiếng), không chỉ đổi số trên nút.
      if (lastUnread !== null && unread > lastUnread && root.hidden) { toast(`Có ${unread - lastUnread} tin nhắn mới`); ding(); }
      lastUnread = unread;
    } catch { /* bỏ qua */ }
  }
  let badgeTimer = null;
  const startBadge = () => { if (!badgeTimer) { badge(); badgeTimer = setInterval(() => { if (document.visibilityState === 'visible' && root.hidden) badge(); }, 15_000); } };

  // ----- Danh sách hội thoại
  async function loadList() {
    try { st.list = (await api('/chat/conversations')).conversations; } catch (e) {
      // Lượt làm mới định kỳ lỗi (mạng chập chờn, máy chủ bận) mà danh sách đã có: giữ danh sách cũ, lần sau thử lại.
      if (st.listLoaded) return;
      q('#chat-list').innerHTML = `<li class="chat-error"><b>Chưa tải được tin nhắn</b><small>${esc(e.message)}</small><button type="button" class="btn secondary small" data-chat-retry>Thử lại</button></li>`;
      return;
    }
    st.listLoaded = true; renderList();
  }
  function renderList() {
    const f = st.filter.toLowerCase(), items = st.list.filter(c => !f || c.title.toLowerCase().includes(f) || c.members.some(m => m.name.toLowerCase().includes(f)));
    q('#chat-list').innerHTML = items.length ? items.map(c => `<li><button type="button" class="chat-item ${c.id === st.active?.id ? 'active' : ''} ${c.unread ? 'unread' : ''}" data-conv="${esc(c.id)}">
      ${avatar(c.members.find(m => m.id !== userId())?.id || c.id, c.title, c.kind === 'group')}
      <span class="chat-item-main"><span class="chat-item-top"><b>${esc(c.title)}</b><small>${when(c.last?.at || c.lastMessageAt)}</small></span>
      <span class="chat-item-last">${c.last ? (c.last.mine ? 'Bạn: ' : c.kind === 'group' && c.last.by ? esc(c.last.by.split(' ').pop()) + ': ' : '') + esc(c.last.body) : '<i>Chưa có tin nhắn</i>'}</span></span>
      ${c.unread ? `<span class="chat-unread">${c.unread}</span>` : ''}</button></li>`).join('')
      : `<li class="chat-empty-list muted">${st.list.length ? 'Không tìm thấy.' : 'Chưa có cuộc trò chuyện. Bấm <b>＋ Chat</b> để bắt đầu.'}</li>`;
  }

  // ----- Khung chat
  function renderThread() {
    const c = st.active, box = q('#chat-messages');
    if (!c) { q('#chat-thread').hidden = true; q('#chat-placeholder').hidden = false; root.classList.remove('thread-open'); return; }
    q('#chat-thread').hidden = false; q('#chat-placeholder').hidden = true; root.classList.add('thread-open');
    q('#chat-title').innerHTML = `${avatar(c.members.find(m => m.id !== userId())?.id || c.id, c.title, c.kind === 'group')}<span><b>${esc(c.title)}</b><small>${c.kind === 'group' ? `${c.members.length} thành viên` : 'Tin nhắn riêng'}</small></span>`;
    q('#chat-manage').hidden = c.kind !== 'group';
    const me = userId(); let day = '', prev = null;
    const lastMine = [...st.messages].reverse().find(m => m.memberId === me);
    const seen = lastMine && c.kind === 'direct' && st.reads.some(r => r.lastReadAt && r.lastReadAt >= lastMine.createdAt);
    if (st.loading && !st.messages.length) { box.innerHTML = '<p class="chat-loading muted">Đang tải tin nhắn…</p>'; return; }
    box.innerHTML = (st.more ? '<button type="button" class="btn ghost small chat-more" data-more>Xem tin cũ hơn</button>' : '') + st.messages.map(m => {
      const d = vnDay(m.createdAt), mine = m.memberId === me, system = /^.+ đã (tạo nhóm|rời nhóm|đổi tên|thêm|bớt)/.test(m.body) && c.kind === 'group' && m.body.startsWith(m.name + ' đã ');
      let html = d !== day ? `<div class="chat-day"><span>${d === vnDay(new Date().toISOString()) ? 'Hôm nay' : d}</span></div>` : '';
      day = d;
      if (system) { prev = null; return html + `<div class="chat-system">${esc(m.body)} · ${vnTime(m.createdAt)}</div>`; }
      // Tin liền nhau (cùng người, cách < 5 phút) gộp thành một cụm: chỉ tin đầu hiện ảnh + tên.
      const grouped = prev && prev.memberId === m.memberId && vnDay(prev.createdAt) === d && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < 5 * 60_000; prev = m;
      return html + `<div class="chat-msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}">${!mine && !grouped ? avatar(m.memberId, m.name) : '<span class="chat-avatar-space"></span>'}
        <div class="chat-bubble-wrap">${!mine && !grouped && c.kind === 'group' ? `<small class="chat-name">${esc(m.name)}</small>` : ''}<div class="chat-bubble" title="${esc(new Date(m.createdAt).toLocaleString('vi-VN'))}">${linkify(m.body)}<small>${vnTime(m.createdAt)}</small></div>
        ${seen && m === lastMine ? '<small class="chat-seen">Đã xem</small>' : ''}</div></div>`;
    }).join('');
  }
  const atBottom = () => { const b = q('#chat-messages'); return b.scrollHeight - b.scrollTop - b.clientHeight < 80; };
  const toBottom = () => { const b = q('#chat-messages'); b.scrollTop = b.scrollHeight; };

  /** Hiện khung chat ngay bằng dữ liệu đang có (danh sách / lần mở trước), rồi mới nạp tin từ máy chủ. */
  function showThread(conv) {
    const cached = conv.id && st.cache.get(conv.id);
    st.active = conv; st.messages = cached ? cached.messages.slice() : []; st.reads = cached?.reads || []; st.more = cached?.more || false;
    st.loading = !cached; renderThread(); toBottom(); renderList();
    q('#chat-input').focus();
  }
  const remember = () => { if (st.active?.id) st.cache.set(st.active.id, { messages: st.messages.filter(x => !x.pending), reads: st.reads, more: st.more }); };
  function applyThread(m) {
    st.active = m.conversation || st.active; st.messages = m.messages; st.reads = m.reads; st.more = m.more; st.loading = false;
    st.cache.set(st.active.id, { messages: m.messages, reads: m.reads, more: m.more });
    renderThread(); toBottom(); loadList(); badge(); startTimers();
  }
  let openSeq = 0;
  async function open(id) {
    if (!id) { st.active = null; renderThread(); await loadList(); return; }
    const seq = ++openSeq, known = st.list.find(c => c.id === id);
    if (known) showThread(known);
    try {
      // Một lượt gọi: tin nhắn + thông tin hội thoại + đánh dấu đã đọc.
      const m = await api(`/chat/${encodeURIComponent(id)}/messages?full=1&read=1`);
      if (seq === openSeq) applyThread(m);
    } catch (e) { if (seq !== openSeq) return; toast(e.message, 'err'); st.active = null; st.loading = false; renderThread(); }
  }
  /** Nhắn 1-1: có sẵn hội thoại thì mở ngay; chưa có thì hiện khung trống tức thì, tạo hội thoại trong một lượt gọi. */
  async function openDirect(person) {
    const me = userId(), existing = st.list.find(c => c.kind === 'direct' && c.members.some(x => x.id === person.id) && c.members.every(x => x.id === me || x.id === person.id));
    if (existing) return open(existing.id);
    const seq = ++openSeq;
    showThread({ id: '', kind: 'direct', title: person.name, members: [{ id: me, name: '' }, { id: person.id, name: person.name }], createdBy: me });
    try {
      const m = await api('/chat/direct', 'POST', { memberId: person.id });
      if (seq === openSeq) applyThread(m);
    } catch (e) { if (seq !== openSeq) return; toast(e.message, 'err'); st.active = null; st.loading = false; renderThread(); }
  }
  // Khi khung chat mở: hỏi tin mới của hội thoại đang xem mỗi 3 giây, làm mới danh sách mỗi 9 giây
  // (kể cả khi chưa chọn hội thoại nào, vd trên điện thoại đang ở danh sách).
  function startTimers() {
    if (st.timers.length) return;
    let tick = 0;
    st.timers.push(setInterval(() => {
      if (root.hidden) { stopThread(); return; }
      if (document.visibilityState !== 'visible') return;
      tick++; poll(); if (tick % 3 === 0) loadList();
    }, 3_000));
  }
  function stopThread() { st.timers.forEach(clearInterval); st.timers = []; }
  async function markRead() { if (!st.active) return; try { await api(`/chat/${encodeURIComponent(st.active.id)}/read`, 'POST', {}); badge(); } catch { /* bỏ qua */ } }
  let polling = false;
  async function poll() {
    if (root.hidden || !st.active?.id || st.loading || polling) return;
    // Lùi mốc 2 phút (bỏ trùng theo id): không sót tin người khác gửi cùng lúc với tin của mình.
    const lastAt = st.messages.filter(x => !x.pending).at(-1)?.createdAt;
    const after = lastAt ? new Date(Date.parse(lastAt) - 120_000).toISOString() : '';
    polling = true;
    try {
      const id = st.active.id, m = await api(`/chat/${encodeURIComponent(id)}/messages` + (after ? '?after=' + encodeURIComponent(after) : ''));
      if (st.active?.id !== id || st.loading) return; // đã chuyển sang hội thoại khác trong lúc chờ
      const fresh = m.messages.filter(x => !st.messages.some(y => y.id === x.id)), keep = atBottom();
      const readsChanged = JSON.stringify(m.reads) !== JSON.stringify(st.reads);
      st.reads = m.reads;
      if (fresh.length) { const done = st.messages.filter(x => !x.pending).concat(fresh).sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0); st.messages = done.concat(st.messages.filter(x => x.pending)); }
      if (fresh.length || readsChanged) { remember(); renderThread(); if (keep) toBottom(); }
      if (fresh.some(x => x.memberId !== userId())) { markRead(); ding(); }
    } catch { /* mạng chập chờn: lần sau thử lại */ } finally { polling = false; }
  }
  async function send() {
    const inp = q('#chat-input'), body = inp.value.trim(); if (!body || !st.active) return;
    if (!st.active.id) { toast('Đang mở cuộc trò chuyện, thử lại sau giây lát.'); return; }
    inp.value = ''; autosize();
    const temp = { id: 'tmp-' + Date.now(), memberId: userId(), name: '', body, createdAt: new Date().toISOString(), pending: true };
    st.messages.push(temp); renderThread(); toBottom();
    try {
      const r = await api(`/chat/${encodeURIComponent(st.active.id)}/messages`, 'POST', { body });
      // Lượt hỏi định kỳ có thể đã kéo về chính tin này: bỏ bản tạm để khỏi hiện hai lần.
      if (st.messages.some(x => x.id === r.id)) { st.messages = st.messages.filter(x => x !== temp); renderThread(); }
      else Object.assign(temp, { id: r.id, createdAt: r.createdAt, pending: false });
      remember(); loadList();
    } catch (e) { st.messages = st.messages.filter(x => x !== temp); renderThread(); inp.value = body; toast(e.message, 'err'); }
  }
  const autosize = () => { const t = q('#chat-input'); t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight) + 'px'; };

  // ----- Hộp chọn người / tạo nhóm / quản lý nhóm
  async function people() { if (!st.people) st.people = (await api('/chat/people')).people; return st.people; }
  async function pickDialog({ title, multi, withTitle, initialTitle = '', exclude = [], ok }) {
    let list;
    try { list = (await people()).filter(p => !exclude.includes(p.id)); } catch (e) { toast('Không tải được danh sách nhân viên: ' + e.message, 'err'); return null; }
    const dlg = document.createElement('dialog'); dlg.className = 'modal narrow chat-pick';
    dlg.innerHTML = `<form method="dialog"><div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body">${withTitle ? `<label class="chat-field"><span>Tên nhóm</span><input name="title" maxlength="120" value="${esc(initialTitle)}" placeholder="Ví dụ: Đơn Tết 2027" required></label>` : ''}
        <input type="search" class="chat-pick-search" placeholder="Tìm nhân viên…" aria-label="Tìm nhân viên">
        <ul class="chat-pick-list">${list.map(p => `<li><label>${multi ? `<input type="checkbox" value="${esc(p.id)}">` : ''}${avatar(p.id, p.name)}<span>${esc(p.name)}</span>${multi ? '' : `<button type="button" class="btn secondary small" data-pick="${esc(p.id)}">Nhắn</button>`}</label></li>`).join('') || '<li class="muted">Không còn ai để thêm.</li>'}</ul></div>
      ${multi ? `<div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button type="submit" class="btn primary">${esc(ok)}</button></div>` : ''}</form>`;
    document.body.append(dlg); dlg.showModal();
    return new Promise(resolve => {
      const done = v => { dlg.close(); dlg.remove(); resolve(v); };
      dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => done(null)));
      dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });
      dlg.querySelector('.chat-pick-search').addEventListener('input', e => { const f = e.target.value.toLowerCase(); dlg.querySelectorAll('.chat-pick-list li').forEach(li => { li.hidden = !li.textContent.toLowerCase().includes(f); }); });
      dlg.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => done({ ids: [b.dataset.pick] })));
      dlg.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        const ids = [...dlg.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value), t = dlg.querySelector('[name=title]')?.value.trim();
        if (withTitle && !t) return toast('Đặt tên nhóm.', 'err');
        if (!ids.length && !withTitle) return toast('Chọn ít nhất một người.', 'err');
        done({ ids, title: t });
      });
    });
  }
  q('#chat-new').addEventListener('click', async () => {
    const r = await pickDialog({ title: 'Nhắn tin cho…', multi: false }); if (!r) return;
    const person = (st.people || []).find(p => p.id === r.ids[0]); if (person) openDirect(person);
  });
  q('#chat-new-group').addEventListener('click', async () => {
    const r = await pickDialog({ title: 'Tạo nhóm chat', multi: true, withTitle: true, ok: 'Tạo nhóm' }); if (!r) return;
    try { const { id } = await api('/chat/groups', 'POST', { title: r.title, memberIds: r.ids }); open(id); } catch (e) { toast(e.message, 'err'); }
  });
  q('#chat-manage').addEventListener('click', async () => {
    const c = st.active; if (!c) return;
    const dlg = document.createElement('dialog'); dlg.className = 'modal narrow chat-pick';
    const canEdit = c.createdBy === userId() || isManager();
    dlg.innerHTML = `<div class="modal-head"><h2>Nhóm: ${esc(c.title)}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body"><ul class="chat-pick-list">${c.members.map(m => `<li><label>${avatar(m.id, m.name)}<span>${esc(m.name)}${m.id === c.createdBy ? ' <small class="muted">(tạo nhóm)</small>' : ''}</span>${canEdit && m.id !== c.createdBy ? `<button type="button" class="btn ghost small danger-text" data-remove="${esc(m.id)}">Bớt</button>` : ''}</label></li>`).join('')}</ul></div>
      <div class="modal-foot"><button type="button" class="btn ghost danger-text" data-leave>Rời nhóm</button><span class="grow"></span>${canEdit ? '<button type="button" class="btn secondary" data-rename>Đổi tên</button><button type="button" class="btn primary" data-add>＋ Thêm người</button>' : ''}</div>`;
    document.body.append(dlg); dlg.showModal();
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('[data-x]').addEventListener('click', close);
    const put = async body => { try { await api(`/chat/groups/${encodeURIComponent(c.id)}`, 'PUT', body); close(); open(c.id); } catch (e) { toast(e.message, 'err'); } };
    dlg.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => put({ removeMemberIds: [b.dataset.remove] })));
    dlg.querySelector('[data-rename]')?.addEventListener('click', () => { const t = prompt('Tên nhóm mới:', c.title); if (t && t.trim()) put({ title: t.trim() }); });
    dlg.querySelector('[data-add]')?.addEventListener('click', async () => {
      close(); const r = await pickDialog({ title: 'Thêm người vào nhóm', multi: true, exclude: c.members.map(m => m.id), ok: 'Thêm' });
      if (r?.ids.length) put({ addMemberIds: r.ids });
    });
    dlg.querySelector('[data-leave]').addEventListener('click', async () => {
      if (!confirm('Rời nhóm này?')) return;
      try { await api(`/chat/${encodeURIComponent(c.id)}/leave`, 'POST', {}); close(); open(null); } catch (e) { toast(e.message, 'err'); }
    });
  });

  // ----- Sự kiện
  q('#chat-list').addEventListener('click', e => {
    if (e.target.closest('[data-chat-retry]')) { loadList(); return; }
    const b = e.target.closest('[data-conv]'); if (b) open(b.dataset.conv);
  });
  q('#chat-search').addEventListener('input', e => { st.filter = e.target.value.trim(); renderList(); });
  q('#chat-back').addEventListener('click', () => { st.active = null; renderThread(); loadList(); });
  // Mở / đóng khung chat nổi.
  const launcher = document.getElementById('chat-launcher');
  async function show(id) {
    root.hidden = false; launcher.classList.add('active'); startTimers();
    if (!st.people) people().catch(() => {}); // nạp sẵn danh bạ: bấm ＋ Chat là hiện ngay
    if (id) await open(id); else { renderThread(); await loadList(); if (!st.active && innerWidth > 860 && st.list[0]) open(st.list[0].id); else if (st.active) open(st.active.id); }
  }
  function hide() { root.hidden = true; launcher.classList.remove('active'); stopThread(); badge(); }
  launcher.addEventListener('click', () => (root.hidden ? show() : hide()));
  for (const id of ['chat-close', 'chat-close-2']) q('#' + id).addEventListener('click', hide);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden && !document.querySelector('dialog[open]')) hide(); });
  q('#chat-form').addEventListener('submit', e => { e.preventDefault(); send(); });
  q('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  q('#chat-input').addEventListener('input', autosize);
  q('#chat-messages').addEventListener('click', async e => {
    if (!e.target.closest('[data-more]') || !st.active) return;
    const first = st.messages[0]?.createdAt, box = q('#chat-messages'), h = box.scrollHeight;
    try {
      const m = await api(`/chat/${encodeURIComponent(st.active.id)}/messages?before=${encodeURIComponent(first)}`);
      st.messages.unshift(...m.messages); st.more = m.more; renderThread(); box.scrollTop = box.scrollHeight - h;
    } catch (ex) { toast(ex.message, 'err'); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !root.hidden && st.active) poll(); });
  /** Có thông báo đẩy (tin mới): làm mới ngay thay vì chờ lượt hỏi kế tiếp. */
  function refresh() { if (root.hidden) badge(); else { poll(); loadList(); } }
  return { show, hide, open, badge, refresh, startBadge, stop: stopThread };
}
