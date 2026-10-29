// NÚT ĐANG XỬ LÝ – áp dụng chung cho mọi nút (không phải sửa từng màn hình).
// Bấm một nút (hoặc gửi form) mà thao tác đó gọi API ghi (POST / PUT / PATCH / DELETE) → nút đó bị khoá, hiện vòng xoay
// (.is-busy, aria-busy) tới khi máy chủ trả lời; bấm thêm trong lúc chờ bị bỏ qua (không gửi trùng).
//  - Nút mở hộp xác nhận rồi mới gửi: nếu nút trong hộp đã đóng / bị xoá thì khoá nút gốc đã bấm trước đó.
//  - Gõ phím trong ô nhập sau khi bấm → bỏ ghi nhớ (tránh tự lưu nháp khoá nhầm nút cũ).
//  - Nút .btn gọi API đọc ngay khi bấm (Xuất Excel, Tải lại…) cũng hiện đang xử lý; chip / tab lọc thì không.
//  - Nút tự quản lý trạng thái riêng hoặc không muốn khoá: đặt data-no-busy.
// Link / dòng / bộ lọc / thanh tiến trình đầu trang: loading-feedback.js (cài cùng lúc ở đây).
import { installLoadingFeedback, trackRequest, trackWrite } from './loading-feedback.js';
const WINDOW_MS = 30_000, READ_WINDOW_MS = 1000;
/** POST chỉ để tính / tra / đánh dấu đã đọc, chạy tự động khi đổi giỏ hàng, gõ… → không khoá nút (vd. +/− số lượng ở quầy). */
const PASSIVE = /\/(preview|csp-report|read|locations|typing|presence)(\?|$)/;
let recent = []; // nút vừa bấm gần nhất trước (tối đa 2: nút trong hộp xác nhận + nút gốc mở hộp)

const actionable = el => el && !el.closest('[data-no-busy]') && (el.matches('button, input[type=submit], input[type=button]') || el.classList?.contains('btn'));
function remember(el) {
  recent = [{ el, at: Date.now() }, ...recent.filter(r => r.el !== el)].slice(0, 2);
}
function blockIfBusy(el, e) {
  if (el?.dataset?.busy !== '1') return false;
  e.preventDefault(); e.stopImmediatePropagation();
  return true;
}

export function installBusyButtons(doc = document) {
  doc.addEventListener('click', e => {
    const el = e.target.closest?.('button, a.btn, input[type=submit], input[type=button]');
    if (!el || blockIfBusy(el, e)) return;
    if (actionable(el)) remember(el);
  }, true);
  doc.addEventListener('submit', e => {
    const el = e.submitter || e.target.querySelector?.('button[type=submit], button:not([type]), input[type=submit]');
    if (!el || blockIfBusy(el, e)) return;
    if (actionable(el)) remember(el);
  }, true);
  doc.addEventListener('input', () => { recent = []; }, true);
  if (doc === globalThis.document) installLoadingFeedback(doc);
}

/** Nút .btn vừa bấm (≤ 1 giây) cho lời gọi API đọc – không xoá ghi nhớ (lời gọi ghi sau đó vẫn tìm được nút). */
function readTarget() {
  const r = recent[0];
  return r && Date.now() - r.at < READ_WINDOW_MS && r.el.isConnected && r.el.classList?.contains('btn') ? r.el : null;
}
/** Nút sẽ được khoá cho lời gọi API ghi vừa bắt đầu (null nếu không có nút nào vừa bấm). */
function target() {
  const now = Date.now(), live = recent.filter(r => now - r.at < WINDOW_MS && r.el.isConnected && !r.el.closest('dialog:not([open])'));
  recent = [];
  return live[0]?.el ?? null;
}

/** Bọc một lời gọi API: ghi (khác GET) thì khoá nút vừa bấm tới khi xong. Trả lại đúng promise kết quả. */
export function withBusy(method, promise, path = '') {
  trackRequest(path, promise);
  if (method && method !== 'GET' && !PASSIVE.test(path.split('#')[0])) trackWrite(promise);
  if (PASSIVE.test(path.split('#')[0])) return promise;
  const el = !method || method === 'GET' ? readTarget() : target();
  if (!el) return promise;
  const count = Number(el.dataset.busyCount || 0) + 1;
  el.dataset.busyCount = String(count);
  if (count === 1) {
    el.dataset.busy = '1';
    el.dataset.busyWasDisabled = el.disabled ? '1' : '';
    el.dataset.busyAddedClass = el.classList.contains('is-busy') ? '' : '1';
    if ('disabled' in el) el.disabled = true;
    if (el.dataset.busyAddedClass) el.classList.add('is-busy');
    el.setAttribute('aria-busy', 'true');
  }
  const done = () => {
    const left = Number(el.dataset.busyCount || 1) - 1;
    if (left > 0) { el.dataset.busyCount = String(left); return; }
    if ('disabled' in el) el.disabled = el.dataset.busyWasDisabled === '1';
    if (el.dataset.busyAddedClass) el.classList.remove('is-busy');
    el.removeAttribute('aria-busy');
    for (const k of ['busy', 'busyCount', 'busyWasDisabled', 'busyAddedClass']) delete el.dataset[k];
  };
  promise.then(done, done);
  return promise;
}
