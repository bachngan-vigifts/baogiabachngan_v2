// Báo có việc mới khi app đang mở + số đỏ trên icon app (dùng chung cho trang nhân viên và trang khách):
//  - ding(): tiếng "ting" riêng của Bách Ngân (tạo bằng Web Audio, không cần file) + rung trên Android; bật / tắt trong chuông.
//  - setBadgePart(key, n): mỗi nguồn (thông báo, tin nhắn…) báo số chưa đọc của mình; tổng hiện trên icon app
//    (navigator.setAppBadge – iPhone từ iOS 16.4 khi đã "Thêm vào MH chính", Android / máy tính khi cài app).
//    Service worker giữ cùng con số để tự cộng khi có thông báo đẩy lúc app đang đóng (push-sw.js).
const SOUND_KEY = 'bn-sound';
let ctx = null, lastDing = 0;

export function soundOn() { try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch { return true; } }
export function setSound(on) { try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch { /* bỏ qua */ } if (on) ding(true); }

// Trình duyệt chỉ cho phát tiếng sau khi người dùng đã chạm / bấm vào trang: mở khoá âm thanh ở thao tác đầu tiên.
function unlock() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* trình duyệt không có Web Audio */ }
}
for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, unlock, { capture: true, passive: true });

/** Hai nốt ngắn (ting–ting). `force`: phát cả khi vừa phát (bấm thử). */
export function ding(force = false) {
  if (!soundOn()) return;
  const now = Date.now();
  if (!force && now - lastDing < 1500) return; // nhiều việc mới cùng lúc: chỉ kêu một lần
  lastDing = now;
  try {
    unlock();
    if (ctx && ctx.state === 'running') {
      const t0 = ctx.currentTime;
      for (const [freq, at] of [[880, 0], [1318.5, 0.14]]) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.35);
        osc.connect(gain).connect(ctx.destination); osc.start(t0 + at); osc.stop(t0 + at + 0.4);
      }
    }
  } catch { /* bỏ qua */ }
  try { navigator.vibrate?.([120, 60, 120]); } catch { /* iPhone không hỗ trợ rung từ web */ }
}

// ----- Số đỏ trên icon app
const parts = {};
export function setBadgePart(key, n) {
  parts[key] = Math.max(0, Number(n) || 0);
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  try { if (total) navigator.setAppBadge?.(total); else navigator.clearAppBadge?.(); } catch { /* không hỗ trợ */ }
  // Báo service worker con số đúng, để khi có thông báo đẩy lúc app đóng nó cộng tiếp từ đây.
  try {
    const msg = { type: 'bn-badge', count: total };
    if (navigator.serviceWorker?.controller) navigator.serviceWorker.controller.postMessage(msg);
    else navigator.serviceWorker?.getRegistration().then(r => r?.active?.postMessage(msg)).catch(() => {});
  } catch { /* bỏ qua */ }
}
