// Thông báo dùng chung cho trang nhân viên và trang khách hàng:
//  - Web Push TỰ BẬT: đã cho phép thì tự đăng ký lại mỗi lần mở trang; chưa hỏi thì hỏi quyền ở lần chạm đầu tiên
//    (trình duyệt chỉ cho hỏi khi người dùng thao tác). Vẫn còn nút chuông → "Bật thông báo trên máy này" dự phòng;
//  - trang TỰ LÀM MỚI: khi có thông báo mới (qua push hoặc kiểm tra định kỳ 30 giây) gọi `onNew` để tải lại dữ liệu.
import { ding, setBadgePart, setSound, soundOn } from './alert.js';
const b64ToBytes = s => { const t = (s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t), c => c.charCodeAt(0)); };
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const when = iso => iso ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—';
const statusText = (s, err) => s === null || s === undefined ? `<span class="pill warn">Không gửi</span>` : s >= 200 && s < 300 ? `<span class="pill ok">${s} đã nhận</span>`
  : `<span class="pill danger">${s ? 'Lỗi ' + s : 'Lỗi mạng'}</span>`;
/** Hộp "Thiết bị nhận thông báo" (Manager): máy chủ đã bật push chưa, thiết bị từng người, nhật ký gửi gần đây. */
function showPushDevices(d) {
  const dlg = document.createElement('dialog'); dlg.className = 'modal wide push-devices';
  dlg.innerHTML = `<div class="modal-head"><div><span class="eyebrow">Thông báo đẩy</span><h2>Thiết bị nhận thông báo</h2></div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
    <div class="modal-body">
      <p>${d.serverEnabled ? '<span class="pill ok">Máy chủ đã bật thông báo đẩy</span>' : '<span class="pill danger">Máy chủ CHƯA bật thông báo đẩy – thiếu secret SAPO_SYNC_TOKEN (≥ 32 ký tự) trên Edge Function</span>'}</p>
      <h3>Thiết bị (${d.devices.length})</h3>
      <div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th>Thiết bị</th><th>Lần gửi gần nhất</th><th>Gửi được lần cuối</th><th>Lỗi</th></tr></thead><tbody>
      ${d.devices.map(x => `<tr${x.disabledAt ? ' class="muted"' : ''}><td>${esc(x.name)}${x.memberActive ? '' : ' <small>(nghỉ)</small>'}</td><td>${esc(x.device)}<small>${esc(x.pushHost)}${x.disabledAt ? ' · đã huỷ ' + when(x.disabledAt) : ''}</small></td>
        <td>${x.lastAttemptAt ? statusText(x.lastStatus) + `<small>${when(x.lastAttemptAt)}</small>` : '<span class="muted">Chưa gửi</span>'}</td><td>${when(x.lastOkAt)}</td>
        <td class="small">${esc(x.lastError)}${x.failureCount ? `<small>${x.failureCount} lần lỗi liên tiếp</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Chưa có thiết bị nào bật thông báo.</td></tr>'}
      </tbody></table></div>
      <h3>Nhật ký gửi gần đây</h3>
      <div class="table-wrap"><table><thead><tr><th>Lúc</th><th>Sự kiện</th><th>Người nhận</th><th>Kết quả</th><th>Lỗi</th></tr></thead><tbody>
      ${d.attempts.map(a => `<tr><td>${when(a.at)}</td><td>${esc(a.eventType)}</td><td>${esc(a.name || (a.memberId ? a.memberId : 'Theo vai trò'))}</td><td>${statusText(a.status)}</td><td class="small">${esc(a.error)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Chưa có lần gửi nào.</td></tr>'}
      </tbody></table></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn secondary" data-x>Đóng</button></div>`;
  document.body.append(dlg);
  dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
const ago = iso => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'vừa xong' : s < 3600 ? Math.floor(s / 60) + ' phút trước' : s < 86400 ? Math.floor(s / 3600) + ' giờ trước' : new Date(iso).toLocaleDateString('vi-VN'); };

export function setupNotifications({ api, root, onNew, onOpen, isManager = () => false, poll = true }) {
  root.innerHTML = `<button type="button" class="bell" aria-haspopup="true" aria-expanded="false" title="Thông báo">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z M10 20a2 2 0 0 0 4 0"/></svg><b class="bell-badge" hidden>0</b></button>
    <div class="bell-panel" hidden><div class="bell-head"><b>Thông báo</b><button type="button" class="link-btn" data-read-all>Đánh dấu đã đọc</button></div>
      <button type="button" class="btn secondary small block" data-enable-push hidden>Bật thông báo trên máy này</button>
      <button type="button" class="btn ghost small block" data-test-push hidden>Gửi thông báo thử</button>
      <p class="muted small" data-push-note hidden></p>
      <button type="button" class="btn ghost small block" data-push-devices hidden>Kiểm tra thiết bị nhận thông báo</button>
      <button type="button" class="btn ghost small block" data-sound></button><ul class="bell-list"></ul></div>`;
  const btn = root.querySelector('.bell'), panel = root.querySelector('.bell-panel'), badge = root.querySelector('.bell-badge'), list = root.querySelector('.bell-list');
  const pushBtn = root.querySelector('[data-enable-push]'), pushNote = root.querySelector('[data-push-note]'), testBtn = root.querySelector('[data-test-push]');
  let notes = [], newest = '', timer = null, started = false;
  // Âm báo + rung khi có việc mới lúc app đang mở (trial-ui/alert.js); bật / tắt ngay trong chuông.
  const soundBtn = root.querySelector('[data-sound]');
  const drawSound = () => { soundBtn.textContent = soundOn() ? '🔔 Âm báo & rung: Bật (bấm để tắt)' : '🔕 Âm báo & rung: Tắt (bấm để bật)'; };
  drawSound();
  soundBtn.addEventListener('click', e => { e.stopPropagation(); setSound(!soundOn()); drawSound(); });

  const draw = () => {
    const unread = notes.filter(n => !n.readAt).length;
    badge.hidden = !unread; badge.textContent = unread > 99 ? '99+' : String(unread);
    setBadgePart('notifications', unread); // số đỏ trên icon app
    list.innerHTML = notes.length ? notes.map(n => `<li class="${n.readAt ? '' : 'unread'}" data-id="${esc(n.id)}"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><small>${esc(ago(n.createdAt))}</small></li>`).join('')
      : '<li class="muted">Chưa có thông báo.</li>';
  };
  async function check(initial = false) {
    try {
      const d = await api('/notifications' + (newest ? '?since=' + encodeURIComponent(newest) : ''));
      const fresh = d.notifications.filter(n => !notes.some(x => x.id === n.id));
      if (fresh.length) {
        notes = [...fresh, ...notes].slice(0, 30); newest = notes[0].createdAt; draw();
        if (!initial) { onNew(fresh); if (fresh.some(n => !n.readAt)) ding(); } // có việc mới → trang tự làm mới + kêu
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
  /** Đăng ký nhận push trên máy này (quyền đã được cho) và lưu lên máy chủ. Gọi lại nhiều lần vẫn an toàn. */
  async function subscribeNow() {
    const cfg = await api('/push/config');
    if (!cfg.enabled) throw new Error('Máy chủ chưa bật thông báo đẩy.');
    const reg = await navigator.serviceWorker.register('push-sw.js');
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // Đăng ký cũ làm bằng khoá máy chủ khác (khoá đổi / máy chủ mới): dịch vụ push sẽ từ chối → huỷ và đăng ký lại bằng khoá hiện tại.
    const old = sub?.options?.applicationServerKey, want = b64ToBytes(cfg.publicKey);
    if (sub && old && !sameBytes(new Uint8Array(old), want)) { await sub.unsubscribe().catch(() => {}); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    await api('/push/subscribe', 'POST', { subscription: sub.toJSON() });
  }
  // Hỏi quyền phải gọi NGAY trong thao tác của người dùng (iPhone bắt buộc), trước mọi lệnh chờ mạng.
  const askPermission = () => Notification.requestPermission();
  pushBtn.addEventListener('click', async () => {
    try {
      if (await askPermission() !== 'granted') throw new Error('Chưa được phép hiện thông báo.');
      await subscribeNow();
      pushNote.hidden = false; pushNote.textContent = 'Đã bật thông báo trên máy này.';
    } catch (e) { pushNote.hidden = false; pushNote.textContent = e.message || 'Chưa bật được thông báo.'; }
    refreshPushButton();
  });
  // Tự bật thông báo, không cần vào chuông:
  //  - đã cho phép: âm thầm đăng ký lại mỗi lần mở trang (máy mới, đăng ký hết hạn, khoá máy chủ đổi…);
  //  - chưa hỏi: lần chạm / bấm đầu tiên trên trang sẽ hiện hộp "Cho phép thông báo" của trình duyệt
  //    (từ chối / bỏ qua thì 3 ngày sau mới hỏi lại, để không làm phiền);
  //  - iPhone mở bằng Safari thường (không hỗ trợ push): nhắc "Thêm vào Màn hình chính" (7 ngày một lần).
  const ASK_KEY = 'bn-push-asked', IOS_KEY = 'bn-ios-hint';
  const store = { get: k => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } }, set: k => { try { localStorage.setItem(k, String(Date.now())); } catch { /* chặn lưu trữ */ } } };
  function autoPush() {
    if (!pushSupported) { iosHint(); return; }
    if (Notification.permission === 'granted') { subscribeNow().catch(() => {}); return; }
    if (Notification.permission !== 'default' || Date.now() - store.get(ASK_KEY) < 3 * 86_400_000) return;
    const ask = () => {
      document.removeEventListener('click', ask, true);
      store.set(ASK_KEY);
      askPermission().then(async p => { if (p === 'granted') await subscribeNow(); refreshPushButton(); }).catch(() => {});
    };
    document.addEventListener('click', ask, true);
  }
  function iosHint() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!ios || navigator.standalone || Date.now() - store.get(IOS_KEY) < 7 * 86_400_000) return;
    const bar = document.createElement('div'); bar.className = 'push-hint'; bar.setAttribute('role', 'status');
    bar.innerHTML = '<span>Để nhận thông báo trên iPhone: bấm <b>Chia sẻ</b> → <b>Thêm vào MH chính</b>, rồi mở web từ biểu tượng đó.</span><button type="button" aria-label="Đóng">×</button>';
    bar.querySelector('button').addEventListener('click', () => { store.set(IOS_KEY); bar.remove(); });
    document.body.append(bar);
  }
  // Tự kiểm tra: máy chủ gửi push tới mọi thiết bị đã bật của tài khoản này.
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true; pushNote.hidden = false; pushNote.textContent = 'Đang gửi…';
    try {
      const r = await api('/push/test', 'POST', {});
      // Kết quả từng thiết bị: mã trả về của dịch vụ push (201 = đã nhận) hoặc lỗi.
      const lines = (r.results || []).map(x => `${x.device || 'Thiết bị'}: ${x.ok ? 'đã gửi ✓' : (x.status ? 'lỗi ' + x.status : 'không gửi') + (x.error ? ' – ' + x.error : '')}`);
      pushNote.textContent = (r.sent
        ? `Đã gửi tới ${r.sent}/${r.devices} thiết bị. Thông báo "Thông báo thử" sẽ hiện trong vài giây (trên điện thoại: thoát web hoặc khoá màn hình để thấy rõ).`
        : `Không gửi được tới thiết bị nào (${r.devices} thiết bị đã bật). Bấm "Bật thông báo trên máy này" lại trên máy cần nhận.`) + (lines.length ? '\n' + lines.join('\n') : '');
      if (!r.sent) pushBtn.hidden = false;
    } catch (e) { pushNote.textContent = e.message || 'Chưa gửi được thông báo thử.'; }
    testBtn.disabled = false;
  });
  // Manager: xem thiết bị đã bật thông báo của từng người + nhật ký gửi gần đây (mã trả về / lỗi).
  const devBtn = root.querySelector('[data-push-devices]');
  devBtn.addEventListener('click', async e => {
    e.stopPropagation(); devBtn.disabled = true;
    try { showPushDevices(await api('/push/devices')); } catch (ex) { pushNote.hidden = false; pushNote.textContent = ex.message || 'Chưa tải được trạng thái thiết bị.'; }
    devBtn.disabled = false;
  });
  if (pushSupported) navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'bn-notification') check(); });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) { refreshPushButton(); devBtn.hidden = !isManager(); }
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
  // poll = false: không tự hỏi định kỳ – trial-ui/pulse.js gọi check() khi có thông báo mới.
  if (poll) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && started) check(); });
  return {
    start() { if (started) return; started = true; check(true); if (poll) loop(); autoPush(); },
    reset() { clearInterval(timer);timer=null;started=false;notes=[];newest='';panel.hidden=true;btn.setAttribute('aria-expanded','false');draw(); },
    markRead(id) { const n=notes.find(x=>x.id===id);if(n){n.readAt=n.readAt||new Date().toISOString();draw();} },
    check,
  };
}
