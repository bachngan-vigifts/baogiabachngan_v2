// MÃ CHỐNG GHI TRÙNG THEO NỘI DUNG – cho thao tác ghi tiền / hàng (thu tiền khách, trả NCC, nhận hàng NCC, phiếu két).
// Cùng một nội dung → cùng một mã cho tới khi thấy máy chủ báo thành công. Nhờ vậy:
//  - mạng rớt sau khi máy chủ đã lưu, người dùng đóng hộp rồi mở lại nhập đúng như cũ → máy chủ nhận ra mã cũ, trả lại
//    phiếu đã lưu (không ghi lần hai);
//  - tải lại trang (sessionStorage) vẫn giữ mã;
//  - nội dung khác (số tiền, đơn, kho…) → mã mới; ghi thành công rồi nhập lại y hệt (vd. hai kỳ cùng số tiền) → mã mới.
// Máy chủ vẫn so nội dung khi gặp lại mã (khác nội dung → 409), nên mã ở đây chỉ để gửi lại an toàn, không thay kiểm tra.
const STORE = 'bn-request-keys', TTL_MS = 6 * 3600_000;
let memory = null;
const id = (scope, content) => scope + '|' + JSON.stringify(content);
function load(storage) {
  if (memory) return memory;
  memory = {};
  try { memory = JSON.parse(storage()?.getItem(STORE) || '{}') || {}; } catch { /* chế độ riêng tư: chỉ nhớ trong lượt này */ }
  return memory;
}
function save(storage) {
  const now = Date.now();
  for (const [k, v] of Object.entries(memory)) if (!(now - v.at < TTL_MS)) delete memory[k];
  try { storage()?.setItem(STORE, JSON.stringify(memory)); } catch { /* bỏ qua */ }
}
const session = () => globalThis.sessionStorage;

/** Mã cho nội dung này (tạo mới nếu chưa có hoặc đã quá 6 giờ). */
export function keyFor(scope, content, storage = session) {
  const all = load(storage), k = id(scope, content), hit = all[k];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.key;
  all[k] = { key: crypto.randomUUID(), at: Date.now() }; save(storage);
  return all[k].key;
}
/** Máy chủ đã báo thành công: bỏ mã, lần nhập y hệt sau là một phiếu mới. */
export function settleKey(scope, content, storage = session) {
  const all = load(storage), k = id(scope, content);
  if (k in all) { delete all[k]; save(storage); }
}
/** Gửi một lệnh ghi với mã theo nội dung; thành công thì bỏ mã. Lỗi (kể cả mạng) giữ mã để gửi lại an toàn. */
export async function sendOnce(scope, content, send, storage = session) {
  const result = await send(keyFor(scope, content, storage));
  settleKey(scope, content, storage);
  return result;
}
/** Chỉ cho test: quên bộ nhớ đã nạp. */
export function resetRequestKeys() { memory = null; }
