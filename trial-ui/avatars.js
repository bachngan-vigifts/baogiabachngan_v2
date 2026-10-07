// Ảnh đại diện nhân viên (chat, danh sách nhân viên, góc tài khoản).
//  - Chỗ nào hiện avatar chỉ cần gắn data-av="<mã ảnh>" lên ô chữ viết tắt; module tự tải ảnh (gộp nhiều mã một lượt),
//    lưu đệm trong máy theo mã (mã đổi mỗi lần thay ảnh) rồi phủ ảnh lên. Không có ảnh thì giữ chữ viết tắt.
//  - pickAvatar(): chọn ảnh từ máy / chụp ảnh, cắt vuông giữa, thu nhỏ 160 px JPEG (~10 KB) trước khi gửi lên.
const STORE = 'bn-av:';
const cache = new Map(); // mã → data URL ('' = không còn ảnh)
let api = null, queue = new Set(), timer = null;

const stored = key => { try { return localStorage.getItem(STORE + key); } catch { return null; } };
const remember = (key, url) => { try { localStorage.setItem(STORE + key, url); } catch { /* đầy bộ nhớ: chỉ đệm trong phiên */ } };

function paint(el) {
  const key = el.dataset.av || '', url = key ? cache.get(key) : '';
  if (url) { el.style.backgroundImage = `url("${url}")`; el.classList.add('has-img'); }
  else { el.style.backgroundImage = ''; el.classList.remove('has-img'); }
}
async function flush() {
  timer = null;
  const keys = [...queue]; queue = new Set();
  for (let i = 0; i < keys.length; i += 100) {
    const part = keys.slice(i, i + 100);
    try {
      const { avatars } = await api('/avatars?keys=' + part.join(','));
      for (const k of part) { cache.set(k, avatars[k] || ''); if (avatars[k]) remember(k, avatars[k]); }
    } catch { for (const k of part) cache.delete(k); continue; } // lỗi mạng: lần sau thử lại
    for (const k of part) document.querySelectorAll(`[data-av="${k}"]`).forEach(paint);
  }
}
function hydrate(el) {
  const key = el.dataset.av || '';
  if (key && !cache.has(key)) {
    const local = stored(key);
    if (local) cache.set(key, local);
    else if (api) { cache.set(key, ''); queue.add(key); timer ||= setTimeout(flush, 30); }
  }
  paint(el);
}
function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.hasAttribute('data-av')) hydrate(root);
  root.querySelectorAll('[data-av]').forEach(hydrate);
}

/** Gọi một lần khi khởi động: `apiFn(path)` là hàm gọi API đã kèm phiên đăng nhập. */
export function initAvatars(apiFn) {
  api = apiFn;
  scan(document.body);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'attributes') hydrate(m.target);
      else m.addedNodes.forEach(scan);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-av'] });
}

/** Thuộc tính gắn vào ô avatar. */
export const avAttr = key => key ? ` data-av="${String(key).replace(/[^a-f0-9]/g, '')}"` : '';

/** Đặt sẵn ảnh vừa tải lên vào bộ đệm (khỏi phải tải lại). */
export function primeAvatar(key, url) { if (key && url) { cache.set(key, url); remember(key, url); } }

/** Mở chọn ảnh → data URL JPEG vuông 160 px; null nếu bỏ chọn. */
export function pickAvatar() {
  return new Promise((resolve, reject) => {
    // iPhone (Safari / app trên màn hình chính) chỉ mở hộp chọn ảnh khi ô chọn file nằm trong trang.
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
    document.body.append(input);
    const done = () => setTimeout(() => input.remove(), 0);
    input.addEventListener('cancel', () => { done(); resolve(null); });
    input.addEventListener('change', async () => {
      done();
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (!file.type.startsWith('image/')) return reject(new Error('Vui lòng chọn file ảnh.'));
      try { resolve(await squareJpeg(file, 160)); } catch { reject(new Error('Không đọc được ảnh này. Vui lòng chọn ảnh JPEG hoặc PNG khác.')); }
    });
    input.click();
  });
}
async function squareJpeg(file, size) {
  const img = await new Promise((ok, fail) => {
    const url = URL.createObjectURL(file), el = new Image();
    el.onload = () => { URL.revokeObjectURL(url); ok(el); }; el.onerror = () => { URL.revokeObjectURL(url); fail(new Error('bad')); };
    el.src = url;
  });
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size }), g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); // ảnh PNG trong suốt → nền trắng
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.85);
}
