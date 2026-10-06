// Service worker nhận Web Push (như public/push-sw.js của web cũ). Nội dung thông báo được máy chủ mã hoá gửi kèm
// (web mới đăng nhập bằng mã phiên trong tab nên service worker không tự gọi API như web cũ).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let note = {};
    try { note = event.data ? event.data.json() : {}; } catch { /* nội dung lỗi: dùng tiêu đề mặc định */ }
    // Báo cho các tab đang mở: trang tự làm mới dữ liệu ngay.
    try {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: 'bn-notification', note });
    } catch { /* bỏ qua */ }
    await self.registration.showNotification(note.title || 'Có cập nhật mới', {
      body: note.body || 'Mở để xem chi tiết.', tag: note.id || 'bach-ngan', renotify: true,
      icon: 'favicon.svg', badge: 'favicon.svg', data: { url: note.url || '/', id: note.id || '' },
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
