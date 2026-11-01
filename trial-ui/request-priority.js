// ƯU TIÊN TẢI: dữ liệu của trang đang mở đi trước, phần phụ (số đếm trên menu, chuông, nhịp kiểm tra thay đổi, danh mục tải sẵn,
// bản chụp để so sánh thay đổi…) chờ trang chính tải xong mới gửi.
// Lý do: mỗi bản máy chủ (Edge isolate) chỉ có ít kết nối CSDL; mở app mà bắn 15–20 lời gọi cùng lúc thì danh sách của trang
// đang xem phải xếp hàng sau các số đếm. Phần phụ vẫn chạy, chỉ chậm lại một nhịp, và không quá 3 lời gọi phụ cùng lúc.
//  - Lời gọi phụ chờ khi còn lời gọi chính đang chạy (cộng một nhịp ngắn cho lời gọi nối tiếp), tối đa MAX_WAIT_MS.
//  - Đang ở đúng trang của nó (vd. danh mục sản phẩm ở trang Sản phẩm) thì là lời gọi chính.
//  - Lệnh ghi luôn là lời gọi chính.
const QUIET_MS = 150, MAX_WAIT_MS = 4000, BACKGROUND_SLOTS = 3;
/** [mẫu đường dẫn GET phụ, trang mà ở đó nó là dữ liệu chính (tuỳ chọn)]. */
const BACKGROUND = [
  [/^\/pos\/(catalog|stock-snapshot)\?[^#]*&background=1(?:&|$)/],
  [/^\/(pulse|notifications|chat\/unread|navigation-counts|customer-duplicates)(\?|$)/],
  [/^\/tasks\/(summary|people)(\?|$)/, 'tasks'],
  [/^\/approvals(\?|$)/, 'approvals'],
  [/^\/admin\/sapo-sync(\?|$)/],
  [/^\/catalog-snapshot(\?|$)/, 'products'],
  [/^\/stock-requests\?status=open$/, 'stock-requests'],
  [/^\/care\?view=follow-ups&limit=1$/],
  [/^\/quotes\/customer-counts\?/],
  // Bản chụp không tham số để so thay đổi (data-refresh.js); danh sách thật của trang luôn có tham số.
  [/^\/(quotes|orders|contracts)$/],
];
const pageOf = hash => (String(hash || '').replace(/^#\/?/, '').split(/[/?]/)[0] || '');

export function isBackgroundRequest(path, method = 'GET', hash = globalThis.location?.hash) {
  if (String(method).toUpperCase() !== 'GET') return false;
  const page = pageOf(hash);
  return BACKGROUND.some(([re, home]) => re.test(path) && (!home || home !== page));
}

export function createRequestPriority({ now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), slots = BACKGROUND_SLOTS } = {}) {
  let foreground = 0, background = 0, lastForegroundAt = -Infinity;
  const waiting = [];
  let timer = null;
  function pump() {
    if (timer !== null) { clearTimer(timer); timer = null; }
    while (waiting.length && background < slots) {
      const next = waiting[0], t = now();
      const quietFor = t - lastForegroundAt;
      const ready = (foreground === 0 && quietFor >= QUIET_MS) || t - next.since >= MAX_WAIT_MS;
      if (!ready) {
        const wait = foreground === 0 ? QUIET_MS - quietFor : MAX_WAIT_MS - (t - next.since);
        timer = setTimer(() => { timer = null; pump(); }, Math.max(10, Math.min(wait, MAX_WAIT_MS - (t - next.since))));
        return;
      }
      waiting.shift(); background++; next.go();
    }
  }
  /** Chờ tới lượt; trả hàm `done` phải gọi khi lời gọi xong (thành công hay lỗi). */
  function enter(isBackground) {
    if (!isBackground) {
      foreground++;
      let released = false;
      return Promise.resolve(() => { if (released) return; released = true; foreground--; lastForegroundAt = now(); pump(); });
    }
    return new Promise(resolve => {
      let released = false;
      waiting.push({ since: now(), go: () => resolve(() => { if (released) return; released = true; background--; pump(); }) });
      pump();
    });
  }
  /** Chạy `work` theo mức ưu tiên. */
  async function run(isBackground, work) {
    const done = await enter(isBackground);
    try { return await work(); } finally { done(); }
  }
  /** Chờ tới khi lời gọi chính lắng xuống (dùng để hoãn việc tải dữ liệu của trang KHÁC trang đang mở). */
  async function idle() { (await enter(true))(); }
  return { run, enter, idle, stats: () => ({ foreground, background, waiting: waiting.length }) };
}
