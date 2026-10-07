// Service worker nhận Web Push (như public/push-sw.js của web cũ). Nội dung thông báo được máy chủ mã hoá gửi kèm
// (web mới đăng nhập bằng mã phiên trong tab nên service worker không tự gọi API như web cũ).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// Số đỏ trên icon app khi app đang đóng: trang (alert.js) báo con số đúng mỗi khi mở; mỗi thông báo đẩy cộng thêm 1.
// Lưu trong IndexedDB vì service worker có thể bị tắt giữa hai lần nhận push.
const idb = (mode, fn) => new Promise((resolve, reject) => {
  const open = indexedDB.open('bn-sw', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('kv');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction('kv', mode), req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => { open.result.close(); resolve(req?.result); };
    tx.onerror = () => { open.result.close(); reject(tx.error); };
  };
});
const getBadge = () => idb('readonly', st => st.get('badge')).then(v => Number(v) || 0).catch(() => 0);
const putBadge = n => idb('readwrite', st => st.put(n, 'badge')).catch(() => {});
async function showBadge(n) { try { if (n > 0) await self.navigator.setAppBadge?.(n); else await self.navigator.clearAppBadge?.(); } catch { /* không hỗ trợ */ } }
self.addEventListener('message', event => {
  if (event.data?.type === 'bn-badge') event.waitUntil(putBadge(Number(event.data.count) || 0));
});

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let note = {};
    try { note = event.data ? event.data.json() : {}; } catch { /* nội dung lỗi: dùng tiêu đề mặc định */ }
    // Báo cho các tab đang mở: trang tự làm mới dữ liệu ngay.
    try {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: 'bn-notification', note });
    } catch { /* bỏ qua */ }
    const n = (await getBadge()) + 1;
    await putBadge(n); await showBadge(n);
    await self.registration.showNotification(note.title || 'Có cập nhật mới', {
      body: note.body || 'Mở để xem chi tiết.', tag: note.id || 'bach-ngan', renotify: true, silent: false, vibrate: [120, 60, 120],
      icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: note.url || '/', id: note.id || '' },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/', self.location.origin);
    const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) { await client.focus(); return client.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
