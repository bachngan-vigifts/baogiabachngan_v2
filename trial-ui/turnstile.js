// CHỐNG BOT (Cloudflare Turnstile) ở đăng nhập / quên mật khẩu – 07/11/2026.
// Máy chủ báo khoá công khai qua GET /auth-config; rỗng = chưa bật → không tải gì, đăng nhập như cũ.
// Widget "interaction-only": người thật gần như không thấy gì; chỉ hiện ô xác minh khi Cloudflare nghi ngờ.
// Máy chủ mới là nơi kiểm tra mã (verifyTurnstile); giao diện chỉ lấy mã và gửi kèm.
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let configPromise = null, scriptPromise = null;
export function turnstileSiteKey(api) {
  return configPromise ||= Promise.resolve().then(() => api('/auth-config')).then(d => (typeof d?.turnstileSiteKey === 'string' ? d.turnstileSiteKey : '')).catch(() => { configPromise = null; return ''; });
}
function loadScript(doc = document) {
  return scriptPromise ||= new Promise((resolve, reject) => {
    if (globalThis.turnstile) { resolve(globalThis.turnstile); return; }
    const s = doc.createElement('script');
    s.src = SCRIPT; s.async = true;
    s.onload = () => resolve(globalThis.turnstile);
    s.onerror = () => { scriptPromise = null; reject(new Error('Không tải được bước xác minh chống bot.')); };
    doc.head.append(s);
  });
}
/** Gắn ô xác minh ngay trước `before` (nút gửi). `token()` = '' khi chưa bật / chưa xong; gọi `reset()` sau mỗi lần gửi lỗi. */
export function mountTurnstile({ api, before, action = 'login', doc = document }) {
  let token = '', widget = null;
  const ready = turnstileSiteKey(api).then(async key => {
    if (!key || !before?.isConnected) return;
    const box = doc.createElement('div'); box.className = 'turnstile-box';
    before.before(box);
    const ts = await loadScript(doc);
    widget = ts.render(box, { sitekey: key, action, appearance: 'interaction-only', language: 'vi',
      callback: t => { token = t; }, 'expired-callback': () => { token = ''; }, 'error-callback': () => { token = ''; } });
  }).catch(() => { /* không tải được script: máy chủ sẽ báo nếu bắt buộc */ });
  return {
    ready,
    token: () => token,
    reset() { token = ''; if (widget !== null) try { globalThis.turnstile?.reset(widget); } catch { /* bỏ qua */ } },
  };
}
