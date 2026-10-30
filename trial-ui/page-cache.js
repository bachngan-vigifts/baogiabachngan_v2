// BỘ NHỚ ĐỆM TRANG (hiện ngay, cập nhật ở nền). Quay lại một trang đã mở trong vòng 10 phút: hiện ngay dữ liệu lần trước,
// đồng thời tải bản mới ở nền; khác thì trang tự vẽ lại (onChange). Như trang Báo giá vốn giữ danh sách trong bộ nhớ.
//  - Chỉ lệnh ĐỌC của danh sách / trang chi tiết (đơn, HĐKT, khách, việc, kho, NCC, công nợ…). Không áp dụng cho bán hàng
//    nhanh / két tiền, báo giá đang soạn, kiểm tra trước khi ghi (preflight), số đếm menu, chuông, nhịp kiểm tra.
//  - Sau MỌI lệnh ghi (thành công hay lỗi) xoá hết: lần mở sau luôn lấy dữ liệu mới.
//  - Gắn với phiên đăng nhập: đổi tài khoản / đăng xuất không thấy dữ liệu của phiên trước.
//  - Trả bản sao (trang có thể sửa đối tượng nhận được mà không làm hỏng bản đệm).
const TTL_MS = 10 * 60_000, RECENT_MS = 3000, MAX_ENTRIES = 60;
const LIST = /^\/(orders|contracts|customers|tasks|purchase-orders|purchase-early-requests|purchase-options|suppliers|stock-moves|stock-transfers|stock-holds|stock-requests|deliveries|packing|receivables|payables|cashbook|care|quote-docs|inventory\/(status|compare|adjustments)|dashboard\/[\w-]+|flow)(\?|$)/;
const DETAIL = /^\/(orders|contracts|customers|tasks|purchase-orders|suppliers|stock-transfers|packing)\/[^/?]+(\?|$)/;
// Ô chọn khách (`usable=1`) có bộ nhớ riêng (customer-search.js): không chiếm chỗ của các trang danh sách.
// Số chứng từ kế tiếp (`next-no`) luôn lấy mới: người khác vừa tạo đơn / HĐKT thì số cũ sẽ bị máy chủ báo trùng.
const NEVER = /^\/tasks\/(summary)(\?|$)|preflight|[?&]refresh=1|^\/customers\?(?:.*&)?usable=1|\/next-no(\?|$)/;
// Lệnh POST chỉ tính / tra / đánh dấu đã đọc (cùng nhóm với busy-buttons.js): không đổi dữ liệu trang nên KHÔNG xoá bộ đệm.
// Chat tự đánh dấu đã đọc mỗi khi có tin mới – nếu xoá thì bộ đệm gần như luôn trống khi mở khung chat.
const PASSIVE = /\/(preview|csp-report|read|locations|typing|presence|count-stock|count-candidates)(\?|$)/;
export const isPassiveWrite = path => PASSIVE.test(String(path).split('#')[0]);

export const isCacheable = (path, method = 'GET') =>
  String(method).toUpperCase() === 'GET' && !NEVER.test(path) && (LIST.test(path) || DETAIL.test(path));

const copy = data => (typeof structuredClone === 'function' ? structuredClone(data) : JSON.parse(JSON.stringify(data)));

export function createPageCache({ now = () => Date.now(), ttl = TTL_MS, recent = RECENT_MS } = {}) {
  const entries = new Map();
  return {
    /** Bản đệm còn dùng được (cùng phiên, chưa quá hạn): { data (bản sao), recent (vừa lấy < 3 giây – khỏi tải lại) }. */
    get(path, session) {
      const e = entries.get(path);
      if (!e || e.session !== session || now() - e.at > ttl) { if (e) entries.delete(path); return null; }
      return { data: copy(e.data), recent: now() - e.at < recent, signature: e.signature };
    },
    /** Lưu bản mới; trả true nếu khác bản đang có (để trang vẽ lại). */
    set(path, session, data) {
      const signature = JSON.stringify(data), prev = entries.get(path);
      entries.delete(path); entries.set(path, { data: copy(data), session, at: now(), signature });
      while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
      return !!prev && prev.session === session && prev.signature !== signature;
    },
    clear() { entries.clear(); },
    /** Bỏ một trang (tải nền gặp 401 / 403 / 404: mất quyền hoặc bản ghi đã xoá – không hiện bản cũ nữa). */
    drop(path) { entries.delete(path); },
    size: () => entries.size,
  };
}
