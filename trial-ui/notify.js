// Thông báo dùng chung cho trang nhân viên và trang khách hàng:
//  - Web Push (bật bằng nút chuông → "Bật thông báo trên máy này"), service worker push-sw.js;
//  - trang TỰ LÀM MỚI: khi có thông báo mới (qua push hoặc kiểm tra định kỳ 30 giây) gọi `onNew` để tải lại dữ liệu.
const b64ToBytes = s => { const t = (s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t), c => c.charCodeAt(0)); };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = iso => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'vừa xong' : s < 3600 ? Math.floor(s / 60) + ' phút trước' : s < 86400 ? Math.floor(s / 3600) + ' giờ trước' : new Date(iso).toLocaleDateString('vi-VN'); };

export function setupNotifications({ api, root, onNew, onOpen }) {
  root.innerHTML = `<button type="button" class="bell" aria-haspopup="true" aria-expanded="false" title="Thông báo">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z M10 20a2 2 0 0 0 4 0"/></svg><b class="bell-badge" hidden>0</b></button>
    <div class="bell-panel" hidden><div class="bell-head"><b>Thông báo</b><button type="button" class="link-btn" data-read-all>Đánh dấu đã đọc</button></div>
      <button type="button" class="btn secondary small block" data-enable-push hidden>Bật thông báo trên máy này</button>
      <button type="button" class="btn ghost small block" data-test-push hidden>Gửi thông báo thử</button>
      <p class="muted small" data-push-note hidden></p><ul class="bell-list"></ul></div>`;
  const btn = root.querySelector('.bell'), panel = root.querySelector('.bell-panel'), badge = root.querySelector('.bell-badge'), list = root.querySelector('.bell-list');
  const pushBtn = root.querySelector('[data-enable-push]'), pushNote = root.querySelector('[data-push-note]'), testBtn = root.querySelector('[data-test-push]');
  let notes = [], newest = '', timer = null, started = false;

  const draw = () => {
    const unread = notes.filter(n => !n.readAt).length;
    badge.hidden = !unread; badge.textContent = unread > 99 ? '99+' : String(unread);
    list.innerHTML = notes.length ? notes.map(n => `<li class="${n.readAt ? '' : 'unread'}" data-id="${esc(n.id)}"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><small>${esc(ago(n.createdAt))}</small></li>`).join('')
      : '<li class="muted">Chưa có thông báo.</li>';
  };
  async function check(initial = false) {
    try {
      const d = await api('/notifications' + (newest ? '?since=' + encodeURIComponent(newest) : ''));
      const fresh = d.notifications.filter(n => !notes.some(x => x.id === n.id));
      if (fresh.length) {
        notes = [...fresh, ...notes].slice(0, 30); newest = notes[0].createdAt; draw();
        if (!initial) onNew(fresh); // có việc mới → trang tự làm mới
      } else if (initial) draw();
    } catch { /* mất mạng: lần sau thử lại */ }
  }
  const loop = () => { clearInterval(timer); timer = setInterval(() => { if (document.visibilityState === 'visible') check(); }, 30000); };

  // Web Push
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  async function refreshPushButton() {
    if (!pushSupported) { pushBtn.hidden = true; pushNote.hidden = false; pushNote.textContent = 'Trình duyệt này chưa hỗ trợ thông báo đẩy (iPhone: thêm trang vào Màn hình chính trước). Trang vẫn tự cập nhật khi đang mở.'; return; }
    const reg = await navigator.serviceWorker.getRegistration('push-sw.js').catch(() => null) || await navigator.serviceWorker.getRegistration().catch(() => null);
    const sub = reg && await reg.pushManager.getSubscription().catch(() => null);
    pushBtn.hidden = !!sub && Notification.permission === 'granted'; testBtn.hidden = !pushBtn.hidden;
    pushNote.hidden = !(Notification.permission === 'denied');
    if (Notification.permission === 'denied') pushNote.textContent = 'Thông báo đang bị chặn. Mở cài đặt trang web của trình duyệt để cho phép.';
  }
  pushBtn.addEventListener('click', async () => {
    try {
      const cfg = await api('/push/config');
      if (!cfg.enabled) throw new Error('Máy chủ chưa bật thông báo đẩy.');
      if (await Notification.requestPermission() !== 'granted') throw new Error('Chưa được phép hiện thông báo.');
      const reg = await navigator.serviceWorker.register('push-sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.publicKey) });
      await api('/push/subscribe', 'POST', { subscription: sub.toJSON() });
      pushNote.hidden = false; pushNote.textContent = 'Đã bật thông báo trên máy này.';
    } catch (e) { pushNote.hidden = false; pushNote.textContent = e.message || 'Chưa bật được thông báo.'; }
    refreshPushButton();
  });
  // Tự kiểm tra: máy chủ gửi push tới mọi thiết bị đã bật của tài khoản này.
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true; pushNote.hidden = false; pushNote.textContent = 'Đang gửi…';
    try {
      const r = await api('/push/test', 'POST', {});
      pushNote.textContent = r.sent
        ? `Đã gửi tới ${r.sent}/${r.devices} thiết bị. Thông báo "Thông báo thử" sẽ hiện trong vài giây (trên điện thoại: thoát web hoặc khoá màn hình để thấy rõ).`
        : `Không gửi được tới thiết bị nào (${r.devices} thiết bị đã bật). Bấm "Bật thông báo trên máy này" lại trên máy cần nhận.`;
      if (!r.sent) pushBtn.hidden = false;
    } catch (e) { pushNote.textContent = e.message || 'Chưa gửi được thông báo thử.'; }
    testBtn.disabled = false;
  });
  if (pushSupported) navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'bn-notification') check(); });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) refreshPushButton();
  });
  document.addEventListener('click', e => { if (!root.contains(e.target)) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  root.querySelector('[data-read-all]').addEventListener('click', async () => {
    await api('/notifications/read', 'POST', { all: true }).catch(() => {}); const at = new Date().toISOString(); notes = notes.map(n => ({ ...n, readAt: n.readAt || at })); draw();
  });
  list.addEventListener('click', async e => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const n = notes.find(x => x.id === li.dataset.id); if (!n) return;
    api('/notifications/read', 'POST', { ids: [n.id] }).catch(() => {}); n.readAt = n.readAt || new Date().toISOString(); draw();
    panel.hidden = true; onOpen(n);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && started) check(); });
  return {
    start() { if (started) return; started = true; check(true); loop(); if (pushSupported) navigator.serviceWorker.getRegistration().then(r => { if (!r && Notification.permission === 'granted') navigator.serviceWorker.register('push-sw.js').catch(() => {}); }); },
    check,
  };
}
