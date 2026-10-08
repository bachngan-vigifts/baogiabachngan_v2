// TIN NHẮN nội bộ giữa nhân viên: nút chat nổi góc dưới phải mở khung chat (danh sách hội thoại 1-1 + nhóm bên trái, khung chat bên phải).
// Cập nhật: khung đang mở hỏi tin mới mỗi 3 giây; danh sách mỗi 10 giây; huy hiệu menu mỗi 20 giây (+ Web Push khi có tin).
import { ding, setBadgePart } from './alert.js';
import { avAttr } from './avatars.js';
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = name => String(name || '?').trim().split(/\s+/).slice(-2).map(w => w[0]).join('').toUpperCase();
const AVATAR = ['#2459a9', '#12805c', '#a86400', '#6b3fb4', '#0e6a91', '#b4232c', '#4338ca', '#0f766e'];
const color = id => AVATAR[[...String(id)].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVATAR.length];
const avatar = (id, name, group, key) => `<span class="chat-avatar ${group ? 'group' : ''}"${group ? '' : avAttr(key)} style="background-color:${group ? '#3c4a63' : color(id)}">${group ? '👥' : esc(initials(name))}</span>`;
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
const REF = { order: ['🛒', o => `#/orders/${o}`], contract: ['📝', o => `#/orders/${o}`], quote: ['📄', o => `#/quotes/${o}`], packing: ['📦', o => `#/packing/${o}`], task: ['✅', o => `#/tasks/${o}`] };
const fileSize = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const safeUrl = u => /^(https:\/\/|data:image\/(jpeg|png|webp|gif);|data:application\/[\w.+-]+;|data:text\/(plain|csv);)/.test(u || '') ? u : '';
/** Nội dung bong bóng: chữ, liên kết nhanh (đơn hàng / HĐKT / báo giá / phiếu / việc), file (ảnh xem trước, file khác tải về). */
function msgContent(m) {
  if (m.recalled) return '<i class="chat-recalled">Tin nhắn đã được thu hồi</i>';
  const ref = m.ref && REF[m.ref.type] ? `<a class="chat-ref" href="${esc(REF[m.ref.type][1](encodeURIComponent(m.ref.id)))}"><span>${REF[m.ref.type][0]}</span><b>${esc(m.ref.label)}</b></a>` : '';
  const files = (m.files || []).map(f => {
    const url = safeUrl(f.url);
    if (/^image\//.test(f.mime) && url) return `<a class="chat-img" href="${esc(url)}" target="_blank" rel="noopener" download="${esc(f.name)}"><img src="${esc(url)}" alt="${esc(f.name)}" loading="lazy"></a>`;
    return `<a class="chat-file" ${url ? `href="${esc(url)}" download="${esc(f.name)}" target="_blank" rel="noopener"` : ''}><span>📄</span><span><b>${esc(f.name)}</b><small>${fileSize(f.bytes || 0)}${url ? '' : ' · chưa tải được'}</small></span></a>`;
  }).join('');
  return (m.body ? linkify(m.body) : '') + ref + files;
}

export function initChat({ api, toast, userId, isManager, compress }) {
  /** Người còn lại trong chat 1-1 (để lấy màu + ảnh đại diện). */
  const other = c => c.members.find(m => m.id !== userId()) || { id: c.id };
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
      ${avatar(other(c).id, c.title, c.kind === 'group', other(c).avatar)}
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
    q('#chat-title').innerHTML = `${avatar(other(c).id, c.title, c.kind === 'group', other(c).avatar)}<span><b>${esc(c.title)}</b><small>${c.kind === 'group' ? `${c.members.length} thành viên` : 'Tin nhắn riêng'}</small></span>`;
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
      return html + `<div class="chat-msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}">${!mine && !grouped ? avatar(m.memberId, m.name, false, m.avatar) : '<span class="chat-avatar-space"></span>'}
        <div class="chat-bubble-wrap">${!mine && !grouped && c.kind === 'group' ? `<small class="chat-name">${esc(m.name)}</small>` : ''}<div class="chat-bubble ${m.recalled ? 'recalled' : ''} ${m.id === st.hit ? 'hit' : ''}" data-msg="${esc(m.id)}" title="${esc(new Date(m.createdAt).toLocaleString('vi-VN'))}">${msgContent(m)}${m.canRecall && !m.pending ? `<button type="button" class="chat-recall" data-recall="${esc(m.id)}" title="Thu hồi (trong 4 giờ)" aria-label="Thu hồi tin nhắn">↩</button>` : ''}<small>${vnTime(m.createdAt)}</small></div>
        ${seen && m === lastMine ? '<small class="chat-seen">Đã xem</small>' : ''}</div></div>`;
    }).join('') + (st.history ? '<button type="button" class="btn primary small chat-latest" data-latest>↓ Về tin mới nhất</button>' : '');
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
    st.active = m.conversation || st.active; st.messages = m.messages; st.reads = m.reads; st.more = m.more; st.loading = false; st.serverNow = m.now; st.history = false; st.hit = null;
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
    if (root.hidden || !st.active?.id || st.loading || polling || st.history) return; // đang xem tin cũ (tìm kiếm): không chèn tin mới
    // Lùi mốc 2 phút (bỏ trùng theo id): không sót tin người khác gửi cùng lúc với tin của mình.
    const lastAt = st.messages.filter(x => !x.pending).at(-1)?.createdAt;
    const after = lastAt ? new Date(Date.parse(lastAt) - 120_000).toISOString() : '';
    polling = true;
    try {
      const id = st.active.id, qs = new URLSearchParams(); if (after) qs.set('after', after); if (st.serverNow) qs.set('recalledSince', new Date(Date.parse(st.serverNow) - 120_000).toISOString());
      const m = await api(`/chat/${encodeURIComponent(id)}/messages?` + qs);
      if (st.active?.id !== id || st.loading) return; // đã chuyển sang hội thoại khác trong lúc chờ
      const fresh = m.messages.filter(x => !st.messages.some(y => y.id === x.id)), keep = atBottom();
      // Tin mình vừa gửi kèm file: thay bằng bản có link tải.
      let linked = false;
      for (const x of m.messages) { const y = st.messages.find(z => z.id === x.id); if (y && (y.files || []).some(f => !f.url) && (x.files || []).every(f => f.url)) { Object.assign(y, x); linked = true; } }
      if (linked && !fresh.length) { remember(); renderThread(); }
      const readsChanged = JSON.stringify(m.reads) !== JSON.stringify(st.reads);
      st.reads = m.reads; st.serverNow = m.now;
      // Tin người khác vừa thu hồi: thay bằng dấu "đã thu hồi".
      let recalled = false;
      for (const x of st.messages) if (!x.recalled && (m.recalledIds || []).includes(x.id)) { Object.assign(x, { recalled: true, body: '', ref: null, files: [], canRecall: false }); recalled = true; }
      if (recalled) { remember(); renderThread(); }
      if (fresh.length) { const done = st.messages.filter(x => !x.pending).concat(fresh).sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0); st.messages = done.concat(st.messages.filter(x => x.pending)); }
      if (fresh.length || readsChanged) { remember(); renderThread(); if (keep) toBottom(); }
      if (fresh.some(x => x.memberId !== userId())) { markRead(); ding(); }
    } catch { /* mạng chập chờn: lần sau thử lại */ } finally { polling = false; }
  }
  // File chờ gửi (ảnh nén trước, file khác giữ nguyên; ≤ 6 MB / file, tối đa 3 file mỗi tin).
  const pending = [];
  const MAX_FILE = 6 * 1024 * 1024;
  function drawPending() {
    const box = q('#chat-pending'); box.hidden = !pending.length;
    box.innerHTML = pending.map((f, i) => `<span class="chat-chip">${/^image\//.test(f.mime) ? '🖼️' : '📄'} ${esc(f.name)} <small>${fileSize(f.size)}</small><button type="button" data-unpend="${i}" aria-label="Bỏ file">×</button></span>`).join('');
  }
  const readB64 = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('Không đọc được file.')); r.readAsDataURL(file); });
  async function addFiles(list) {
    for (const file of list) {
      if (pending.length >= 3) { toast('Mỗi tin gửi tối đa 3 file.', 'err'); break; }
      try {
        let data, size = file.size, name = file.name || 'file', mime = file.type || '';
        if (/^image\/(jpeg|png|webp)$/.test(mime) && compress) {
          // Ảnh chụp từ điện thoại thường 3–8 MB: nén còn vài trăm KB (đủ nét để xem) trước khi gửi.
          const url = await compress(file, [[1600, .8], [1280, .75], [1024, .7]], 1_400_000, 'Ảnh quá lớn.');
          data = url.split(',')[1]; size = Math.floor(data.length * 3 / 4); mime = 'image/jpeg'; name = name.replace(/\.(png|webp|jpe?g|heic)$/i, '') + '.jpg';
        } else {
          if (file.size > MAX_FILE) { toast(`"${name}" lớn hơn 6 MB, chưa gửi được.`, 'err'); continue; }
          data = await readB64(file);
        }
        pending.push({ name, mime, size, data });
      } catch (e) { toast(e.message, 'err'); }
    }
    drawPending();
  }
  /** Gửi tin: chữ + file chờ gửi; `ref` = liên kết nhanh (đơn hàng / HĐKT / báo giá / phiếu / việc). */
  async function send(ref = null) {
    const inp = q('#chat-input'), body = ref ? '' : inp.value.trim(), files = ref ? [] : pending.splice(0);
    if ((!body && !files.length && !ref) || !st.active) return;
    if (!st.active.id) { toast('Đang mở cuộc trò chuyện, thử lại sau giây lát.'); pending.push(...files); return; }
    if (!ref) { inp.value = ''; autosize(); }
    drawPending();
    if (st.history) { await open(st.active.id); } // đang xem tin cũ: về tin mới nhất trước khi gửi
    const temp = { id: 'tmp-' + Date.now(), memberId: userId(), name: '', body, ref, files: files.map(f => ({ name: f.name, mime: f.mime, bytes: f.size, url: '' })), createdAt: new Date().toISOString(), pending: true };
    st.messages.push(temp); renderThread(); toBottom();
    try {
      const r = await api(`/chat/${encodeURIComponent(st.active.id)}/messages`, 'POST', { body, ref, files: files.map(f => ({ name: f.name, data: f.data })) });
      // Lượt hỏi định kỳ có thể đã kéo về chính tin này: bỏ bản tạm để khỏi hiện hai lần.
      if (st.messages.some(x => x.id === r.id)) { st.messages = st.messages.filter(x => x !== temp); renderThread(); }
      else { Object.assign(temp, { id: r.id, createdAt: r.createdAt, pending: false, canRecall: true }); renderThread(); }
      if (files.length) poll(); // lấy link tải của file vừa gửi
      remember(); loadList();
    } catch (e) { st.messages = st.messages.filter(x => x !== temp); renderThread(); if (!ref) { inp.value = body; pending.unshift(...files); drawPending(); } toast(e.message, 'err'); }
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
        <ul class="chat-pick-list">${list.map(p => `<li><label>${multi ? `<input type="checkbox" value="${esc(p.id)}">` : ''}${avatar(p.id, p.name, false, p.avatar)}<span>${esc(p.name)}</span>${multi ? '' : `<button type="button" class="btn secondary small" data-pick="${esc(p.id)}">Nhắn</button>`}</label></li>`).join('') || '<li class="muted">Không còn ai để thêm.</li>'}</ul></div>
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
      <div class="modal-body"><ul class="chat-pick-list">${c.members.map(m => `<li><label>${avatar(m.id, m.name, false, m.avatar)}<span>${esc(m.name)}${m.id === c.createdBy ? ' <small class="muted">(tạo nhóm)</small>' : ''}</span>${canEdit && m.id !== c.createdBy ? `<button type="button" class="btn ghost small danger-text" data-remove="${esc(m.id)}">Bớt</button>` : ''}</label></li>`).join('')}</ul></div>
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
  // ----- Thu hồi, về tin mới nhất, file chờ gửi
  q('#chat-messages').addEventListener('click', async e => {
    const rc = e.target.closest('[data-recall]');
    if (rc) {
      if (!confirm('Thu hồi tin nhắn này? Mọi người sẽ thấy "Tin nhắn đã được thu hồi".')) return;
      try {
        await api(`/chat/${encodeURIComponent(st.active.id)}/messages/${encodeURIComponent(rc.dataset.recall)}/recall`, 'POST', {});
        const x = st.messages.find(y => y.id === rc.dataset.recall); if (x) Object.assign(x, { recalled: true, body: '', ref: null, files: [], canRecall: false });
        remember(); renderThread(); loadList();
      } catch (ex) { toast(ex.message, 'err'); }
      return;
    }
    if (e.target.closest('[data-latest]') && st.active) open(st.active.id);
  });
  q('#chat-pending').addEventListener('click', e => { const b = e.target.closest('[data-unpend]'); if (b) { pending.splice(Number(b.dataset.unpend), 1); drawPending(); } });
  q('#chat-file').addEventListener('change', e => { const list = [...e.target.files]; e.target.value = ''; addFiles(list); });
  // Dán ảnh chụp màn hình vào ô nhập: gửi kèm như file.
  q('#chat-input').addEventListener('paste', e => { const imgs = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type)); if (imgs.length) { e.preventDefault(); addFiles(imgs); } });

  // ----- Biểu tượng cảm xúc
  const EMOJI = '😀 😁 😂 🤣 😊 😍 😘 😎 🤔 😅 😢 😭 😡 😴 🤝 👍 👎 👏 🙏 💪 👌 ✌️ 🙌 🎉 🎁 🔥 ✅ ❌ ⚠️ ❗ ❓ 💯 ❤️ 💙 ⭐ 📦 🚚 💰 📄 📞 ⏰ 📅 🛒 🍽️ ☕'.split(' ');
  const pops = ['#chat-emoji-pop', '#chat-quick-menu'];
  const closePops = except => pops.filter(x => x !== except).forEach(x => { q(x).hidden = true; });
  q('#chat-emoji-pop').innerHTML = EMOJI.map(x => `<button type="button" data-emo="${x}">${x}</button>`).join('');
  q('#chat-emoji').addEventListener('click', () => { closePops('#chat-emoji-pop'); q('#chat-emoji-pop').hidden = !q('#chat-emoji-pop').hidden; });
  q('#chat-emoji-pop').addEventListener('click', e => {
    const b = e.target.closest('[data-emo]'); if (!b) return;
    const t = q('#chat-input'), at = t.selectionStart ?? t.value.length;
    t.value = t.value.slice(0, at) + b.dataset.emo + t.value.slice(t.selectionEnd ?? at); t.focus(); t.selectionStart = t.selectionEnd = at + b.dataset.emo.length; autosize();
  });
  document.addEventListener('click', e => { if (!e.target.closest('.chat-tools')) closePops(); });

  // ----- Tác vụ nhanh: giao việc, gửi liên kết đơn hàng / HĐKT / báo giá / phiếu đóng gói
  q('#chat-quick').addEventListener('click', () => { closePops('#chat-quick-menu'); q('#chat-quick-menu').hidden = !q('#chat-quick-menu').hidden; });
  const fmtVnd = n => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0)) + ' ₫';
  const SOURCES = {
    order: { title: 'Gửi đơn hàng', ph: 'Tìm số đơn, khách hàng…', load: async t => (await api('/orders?flow=order&q=' + encodeURIComponent(t))).orders.map(o => ({ id: o.id, label: `Đơn ${o.orderNo} · ${o.customerName}`, sub: fmtVnd(o.total) })) },
    contract: { title: 'Gửi HĐKT', ph: 'Tìm số HĐKT, khách hàng…', load: async t => (await api('/contracts?q=' + encodeURIComponent(t))).contracts.map(k => ({ id: k.orderId, label: `HĐKT ${k.contractNo} · ${k.customerName}`, sub: `Đơn ${k.orderNo}` })) },
    quote: { title: 'Gửi báo giá', ph: 'Tìm số báo giá, khách hàng…', load: async t => { const f = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
      return (await api('/quotes')).quotes.filter(x => !f || `${x.quoteNo} ${x.customer}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').includes(f)).slice(0, 40)
        .map(x => ({ id: x.id, label: `Báo giá ${x.quoteNo} · ${x.customer}`, sub: fmtVnd(x.total) })); } },
    packing: { title: 'Gửi phiếu đóng gói / xuất kho', ph: 'Tìm số phiếu, số đơn, khách hàng…', load: async t => (await api('/packing?status=all&q=' + encodeURIComponent(t))).slips.map(x => ({ id: x.id, label: `Phiếu ${x.slipNo} · ${x.customerName}`, sub: `${x.sourceLabel} · đơn ${x.orderNo}` })) },
  };
  /** Hộp chọn một chứng từ để gửi liên kết. */
  function pickRef(type) {
    const src = SOURCES[type], dlg = document.createElement('dialog'); dlg.className = 'modal narrow chat-pick';
    dlg.innerHTML = `<div class="modal-head"><h2>${esc(src.title)}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body"><input type="search" class="chat-pick-search" placeholder="${esc(src.ph)}" aria-label="Tìm"><ul class="chat-pick-list chat-ref-list"><li class="muted">Đang tải…</li></ul></div>`;
    document.body.append(dlg); dlg.showModal();
    const close = () => { dlg.close(); dlg.remove(); }, list = dlg.querySelector('ul');
    let items = [], seq = 0, timer;
    const load = async () => { const n = ++seq; try { const r = await src.load(dlg.querySelector('input').value.trim()); if (n !== seq) return; items = r;
      list.innerHTML = r.length ? r.map((x, i) => `<li><button type="button" data-i="${i}"><b>${esc(x.label)}</b><small>${esc(x.sub || '')}</small></button></li>`).join('') : '<li class="muted">Không tìm thấy.</li>'; }
      catch (e) { if (n === seq) list.innerHTML = `<li class="error">${esc(e.message)}</li>`; } };
    dlg.querySelector('[data-x]').addEventListener('click', close); dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dlg.querySelector('input').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    list.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; const x = items[Number(b.dataset.i)]; close(); send({ type, id: x.id, label: x.label }); });
    load();
  }
  /** Giao việc ngay trong chat: người nhận = người đang nhắn (1-1) hoặc chọn trong nhóm; gửi kèm liên kết việc. */
  function quickTask() {
    const c = st.active, me = userId(), people = c.members.filter(x => x.id !== me);
    const dlg = document.createElement('dialog'); dlg.className = 'modal narrow chat-pick';
    dlg.innerHTML = `<form><div class="modal-head"><h2>Giao việc</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body"><label class="chat-field"><span>Việc cần làm</span><input name="title" maxlength="300" required value="${esc(q('#chat-input').value.trim().slice(0, 300))}" placeholder="Ví dụ: Gọi khách chốt mẫu in"></label>
        <label class="chat-field"><span>Người nhận</span><select name="who">${people.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}<option value="${esc(me)}">Tôi</option></select></label>
        <label class="chat-field"><span>Hạn</span><input type="date" name="due"></label>
        <label class="chat-field"><span>Ghi chú</span><textarea name="note" rows="2" maxlength="2000"></textarea></label></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button class="btn primary">Giao việc</button></div></form>`;
    document.body.append(dlg); dlg.showModal();
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close)); dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target, btn = f.querySelector('.btn.primary'); btn.disabled = true;
      try {
        const title = f.title.value.trim(), r = await api('/tasks', 'POST', { title, description: f.note.value, assigneeId: f.who.value, dueDate: f.due.value || null, priority: 'normal' });
        close(); if (q('#chat-input').value.trim() === title) { q('#chat-input').value = ''; autosize(); }
        send({ type: 'task', id: r.id, label: `Việc: ${title}${f.who.value !== me ? ' → ' + (people.find(x => x.id === f.who.value)?.name || '') : ''}` });
      } catch (ex) { toast(ex.message, 'err'); btn.disabled = false; }
    });
  }
  q('#chat-quick-menu').addEventListener('click', e => {
    const b = e.target.closest('[data-quick]'); if (!b || !st.active?.id) return;
    closePops(); if (b.dataset.quick === 'task') quickTask(); else pickRef(b.dataset.quick);
  });

  // ----- Tìm tin nhắn cũ (chữ / ngày), bấm kết quả để nhảy tới tin đó
  const findForm = q('#chat-find-form');
  q('#chat-find').addEventListener('click', () => { findForm.hidden = !findForm.hidden; findForm.here.checked = !!st.active?.id; findForm.here.disabled = !st.active?.id; if (!findForm.hidden) findForm.q.focus(); });
  q('#chat-find-close').addEventListener('click', () => { findForm.hidden = true; q('#chat-find-results').innerHTML = ''; });
  let found = [];
  findForm.addEventListener('submit', async e => {
    e.preventDefault();
    const p = new URLSearchParams(); for (const k of ['q', 'from', 'to']) if (findForm[k].value.trim()) p.set(k, findForm[k].value.trim());
    if (findForm.here.checked && st.active?.id) p.set('conversationId', st.active.id);
    const box = q('#chat-find-results'); box.innerHTML = '<li class="muted">Đang tìm…</li>';
    try {
      found = (await api('/chat/search?' + p)).results;
      box.innerHTML = found.length ? found.map((r, i) => `<li><button type="button" data-hit="${i}"><span class="chat-item-top"><b>${esc(r.conversation)}</b><small>${vnDay(r.createdAt)} ${vnTime(r.createdAt)}</small></span>
        <span class="chat-item-last">${esc(r.name)}: ${esc(r.body)}</span></button></li>`).join('') : '<li class="muted">Không tìm thấy tin nào.</li>';
    } catch (ex) { box.innerHTML = `<li class="error">${esc(ex.message)}</li>`; }
  });
  q('#chat-find-results').addEventListener('click', async e => {
    const b = e.target.closest('[data-hit]'); if (!b) return;
    const r = found[Number(b.dataset.hit)], seq = ++openSeq, known = st.list.find(c => c.id === r.conversationId);
    if (known) showThread(known);
    try {
      const m = await api(`/chat/${encodeURIComponent(r.conversationId)}/messages?full=1&around=${encodeURIComponent(r.createdAt)}`);
      if (seq !== openSeq) return;
      applyThread(m); st.history = m.newer; st.hit = r.id; renderThread();
      q(`[data-msg="${CSS.escape(r.id)}"]`)?.scrollIntoView({ block: 'center' });
    } catch (ex) { toast(ex.message, 'err'); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !root.hidden && st.active) poll(); });
  /** Có thông báo đẩy (tin mới): làm mới ngay thay vì chờ lượt hỏi kế tiếp. */
  function refresh() { if (root.hidden) badge(); else { poll(); loadList(); } }
  return { show, hide, open, badge, refresh, startBadge, stop: stopThread };
}
