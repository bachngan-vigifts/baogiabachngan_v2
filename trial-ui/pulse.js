/**
 * NHỊP KIỂM TRA THAY ĐỔI: một lượt GET /pulse mỗi 30 giây thay cho tải lại nhiều danh sách (giảm số lượt gọi Edge Function).
 *  - Chỉ hỏi khi tab đang hiện và người dùng còn thao tác trong 5 phút gần nhất; quay lại tab / thao tác lại thì hỏi ngay.
 *  - `stamp` đổi → onData() (trang tải lại dữ liệu đang xem) · `notifyAt` đổi → onNotify() · `chatUnread` → onChat(n).
 */
export function setupPulse({ api, onData, onNotify, onChat, onTick = () => {}, interval = 30_000, idleAfter = 5 * 60_000,
  doc = document, win = window, now = () => Date.now(), schedule = setInterval, cancel = clearInterval }) {
  let timer, busy = false, last = null, lastActive = now(), lastCheck = 0;
  const visible = () => doc.visibilityState !== 'hidden';
  async function check(force = false) {
    if (busy || !visible() || (!force && now() - lastActive > idleAfter)) return;
    busy = true; lastCheck = now();
    try {
      const p = await api('/pulse');
      const hadLast = !!last;
      if (last) {
        if (p.stamp !== last.stamp) onData();
        if (p.notifyAt !== last.notifyAt) onNotify();
      }
      if (!last || p.chatUnread !== last.chatUnread) onChat(p.chatUnread);
      last = p;
      if (hadLast) onTick(); // First load already fetches the active page; avoid a duplicate opening request.
    } catch { /* mất mạng / hết phiên: lượt sau thử lại */ }
    finally { busy = false; }
  }
  // Người dùng quay lại sau khi rảnh / ẩn tab: hỏi ngay một lần (không chờ hết 30 giây).
  const active = () => { const wasIdle = now() - lastActive > idleAfter; lastActive = now(); if (wasIdle && timer) check(); };
  const wake = () => { if (visible() && timer && now() - lastCheck > 5_000) { lastActive = now(); check(); } };
  for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart']) doc.addEventListener(e, active, { passive: true });
  doc.addEventListener('visibilitychange', wake); win.addEventListener('focus', wake); win.addEventListener('online', wake);
  return {
    start() { if (timer) return; lastActive = now(); timer = schedule(() => check(), interval); check(true); },
    stop() { cancel(timer); timer = undefined; last = null; },
    check: () => check(true),
  };
}
