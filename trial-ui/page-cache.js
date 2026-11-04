// BỘ NHỚ ĐỆM TRANG (hiện ngay, cập nhật ở nền). Quay lại một trang đã mở trong vòng 10 phút (kể cả sau khi tải lại trang
// trong cùng tab): hiện ngay dữ liệu lần trước,
// đồng thời tải bản mới ở nền; khác thì trang tự vẽ lại (onChange). Như trang Báo giá vốn giữ danh sách trong bộ nhớ.
//  - Chỉ lệnh ĐỌC của danh sách / trang chi tiết (đơn, HĐKT, khách, việc, kho, NCC, công nợ…). Không áp dụng cho bán hàng
//    nhanh / két tiền, báo giá đang soạn, kiểm tra trước khi ghi (preflight), số đếm menu, chuông, nhịp kiểm tra.
//  - Sau MỌI lệnh ghi (thành công hay lỗi) xoá hết: lần mở sau luôn lấy dữ liệu mới.
//  - Gắn với phiên đăng nhập: đổi tài khoản / đăng xuất không thấy dữ liệu của phiên trước.
//  - Trả bản sao (trang có thể sửa đối tượng nhận được mà không làm hỏng bản đệm).
const TTL_MS = 10 * 60_000, RECENT_MS = 3000, MAX_ENTRIES = 60;
// Thêm (31/10): Hàng sắp về, Lịch nhận hàng NCC, Công nợ NCC, Nguồn mua, thẻ kho, danh sách kho, Việc kế toán trong ngày,
// Khách trùng, Trang kho – đều chỉ để xem; tiền / quầy / chat / thông báo / phân quyền / lương vẫn không đệm.
const LIST = /^\/(orders|contracts|customers|tasks|purchase-orders|purchase-early-requests|purchase-options|suppliers|stock-moves|stock-transfers|stock-holds|stock-requests|deliveries|packing|receivables|payables|cashbook|care|quote-docs|inventory\/(status|compare|adjustments|card)|dashboard\/[\w-]+|flow|purchase-incoming|purchase-receiving-calendar|supplier-payables|purchase-sources|stock-warehouses|tasks\/accounting\/daily|customer-duplicates|warehouse-work)(\?|$)/;
const DETAIL = /^\/(orders|contracts|customers|tasks|purchase-orders|suppliers|stock-transfers|packing)\/[^/?]+(\?|$)/;
// Ô chọn khách (`usable=1`) có bộ nhớ riêng (customer-search.js): không chiếm chỗ của các trang danh sách.
// Số chứng từ kế tiếp (`next-no`) luôn lấy mới: người khác vừa tạo đơn / HĐKT thì số cũ sẽ bị máy chủ báo trùng.
// Danh sách Sản phẩm / Báo giá (có phân trang `offset=`) – chỉ để xem. Ô tra giá / tồn theo mã (`?skus=`), tìm nhanh,
// bán hàng nhanh (`/pos/options`, tồn ở quầy) KHÔNG đệm: luôn phải là số mới nhất.
const PAGED = /^\/(products|quotes)\?(?:.*&)?offset=/;
// Dữ liệu ít đổi (thương hiệu, xưởng in, cấu hình chăm sóc khách, ảnh đại diện): lưu trên máy 24 giờ, giữ qua cả khi
// tải lại trang / mở tab mới. Mở là hiện ngay, đồng thời vẫn tải bản mới ở nền như các trang khác.
const STATIC = /^\/(product-brands|printing-workshops|care\/config|avatars\?keys=)/;
const STATIC_TTL_MS = 24 * 3_600_000, STORE_PREFIX = 'bn-pc:', STORE_MAX_CHARS = 400_000;
export const isLongLived = path => STATIC.test(String(path));
const NEVER = /^\/tasks\/(summary)(\?|$)|preflight|[?&]refresh=1|^\/customers\?(?:.*&)?usable=1|\/next-no(\?|$)/;
// Lệnh POST chỉ tính / tra / đánh dấu đã đọc (cùng nhóm với busy-buttons.js): không đổi dữ liệu trang nên KHÔNG xoá bộ đệm.
// Chat tự đánh dấu đã đọc mỗi khi có tin mới – nếu xoá thì bộ đệm gần như luôn trống khi mở khung chat.
const PASSIVE = /\/(preview|csp-report|read|locations|typing|presence|count-stock|count-candidates)(\?|$)/;
export const isPassiveWrite = path => PASSIVE.test(String(path).split('#')[0]);

export const isCacheable = (path, method = 'GET') =>
  String(method).toUpperCase() === 'GET' && !NEVER.test(path) && (LIST.test(path) || DETAIL.test(path) || PAGED.test(path) || STATIC.test(path));

const copy = data => (typeof structuredClone === 'function' ? structuredClone(data) : JSON.parse(JSON.stringify(data)));

/** Mã ngắn của phiên (không lưu nguyên mã đăng nhập vào bộ đệm trên máy). */
const sessionTag = session => { let h = 5381; for (const ch of String(session)) h = (h * 33 + ch.charCodeAt(0)) >>> 0; return h.toString(36); };

/**
 * storage (tuỳ chọn): { local, session } – Storage của trình duyệt. Có thì bản đệm còn giữ sau khi tải lại trang:
 * dữ liệu ít đổi ở localStorage (24 giờ), danh sách / chi tiết ở sessionStorage (chỉ tab đang mở, đóng tab là mất).
 */
export function createPageCache({ now = () => Date.now(), ttl = TTL_MS, recent = RECENT_MS, storage = null } = {}) {
  const entries = new Map();
  const ttlOf = path => (STATIC.test(path) ? Math.max(ttl, STATIC_TTL_MS) : ttl);
  const storeOf = path => (STATIC.test(path) ? storage?.local?.() : storage?.session?.()) || null;
  const safe = fn => { try { return fn(); } catch { return null; } }; // trình duyệt chặn / đầy bộ nhớ: chạy như không lưu
  const persist = (path, e) => safe(() => {
    const st = storeOf(path); if (!st) return;
    const raw = JSON.stringify({ s: sessionTag(e.session), at: e.at, d: e.signature });
    if (raw.length > STORE_MAX_CHARS) { st.removeItem(STORE_PREFIX + path); return; } // trang quá lớn: chỉ giữ trong bộ nhớ
    st.setItem(STORE_PREFIX + path, raw);
  });
  const unpersist = path => safe(() => storeOf(path)?.removeItem(STORE_PREFIX + path));
  const restore = (path, session) => safe(() => {
    const raw = storeOf(path)?.getItem(STORE_PREFIX + path); if (!raw) return null;
    const o = JSON.parse(raw);
    if (o.s !== sessionTag(session)) return null;
    return { data: JSON.parse(o.d), session, at: o.at, signature: o.d };
  });
  return {
    /** Bản đệm còn dùng được (cùng phiên, chưa quá hạn): { data (bản sao), recent (vừa lấy < 3 giây – khỏi tải lại) }. */
    get(path, session) {
      let e = entries.get(path);
      if (!e && storage) { e = restore(path, session); if (e) entries.set(path, e); }
      if (!e || e.session !== session || now() - e.at > ttlOf(path)) { if (e) { entries.delete(path); unpersist(path); } return null; }
      return { data: copy(e.data), recent: now() - e.at < recent, signature: e.signature };
    },
    /** Lưu bản mới; trả true nếu khác bản đang có (để trang vẽ lại). */
    set(path, session, data) {
      const signature = JSON.stringify(data), prev = entries.get(path) || (storage ? restore(path, session) : null);
      const e = { data: copy(data), session, at: now(), signature };
      entries.delete(path); entries.set(path, e); persist(path, e);
      while (entries.size > MAX_ENTRIES) { const k = entries.keys().next().value; entries.delete(k); unpersist(k); }
      return !!prev && prev.session === session && prev.signature !== signature;
    },
    /** Xoá hết (sau lệnh ghi, đổi tài khoản, đăng xuất) – cả bản lưu trên máy. */
    clear() {
      entries.clear();
      for (const st of [storage?.local?.(), storage?.session?.()]) safe(() => {
        if (!st) return;
        for (let i = st.length - 1; i >= 0; i--) { const k = st.key(i); if (k?.startsWith(STORE_PREFIX)) st.removeItem(k); }
      });
    },
    /** Bỏ một trang (tải nền gặp 401 / 403 / 404: mất quyền hoặc bản ghi đã xoá – không hiện bản cũ nữa). */
    drop(path) { entries.delete(path); unpersist(path); },
    size: () => entries.size,
  };
}
