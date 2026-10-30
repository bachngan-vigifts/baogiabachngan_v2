// Theo dõi dữ liệu đang xem và các chứng từ chính, kể cả thay đổi không phát sinh thông báo.
export function setupDataRefresh({ read, refresh, enabled, blocked, routeKey, primaryPaths, onDeferred = () => {}, interval = 10000, wakeOnFocus = true,
  doc = document, win = window, schedule = setInterval, cancel = clearInterval }) {
  let generation = 0;
  let key = routeKey(), records = new Map(), checking = new Set(), busy = false, pending = false, warned = false, draft = false, timer;
  const watched = path => /^\/(cash|pos|quotes|orders|contracts|deliveries|receivables|stock-requests|packing|customers|products|tasks|care|customer-care|admin\/members|hr|payroll)(\/|\?|$)/.test(path);
  const normalize = path => {
    const url = new URL(path, 'https://local.invalid');
    url.searchParams.delete('refresh');
    return url.pathname + url.search;
  };
  const signature = data => {
    const { sessionToken, ...content } = data || {};
    return JSON.stringify(content);
  };
  function syncRoute() {
    if (key !== routeKey()) { key = routeKey(); records = new Map(); pending = false; warned = false; draft = false; }
  }
  function observe(path, data, requestRoute) {
    syncRoute();
    if (requestRoute !== key || !watched(path)) return;
    path = normalize(path);
    if (!checking.has(path)) { records.delete(path); records.set(path, signature(data)); }
  }
  async function flush() {
    if (!pending || !enabled() || doc.hidden) return;
    if (blocked() || draft) {
      if (!warned) { warned = true; onDeferred(); }
      return;
    }
    pending = false; warned = false;
    await refresh();
  }
  function request() { syncRoute(); pending = true; }
  function saved() { draft = false; request(); }
  /**
   * Sau khi chính người dùng ghi dữ liệu: biết chắc có thay đổi nên KHÔNG đọc lại từng đường dẫn để so sánh,
   * chỉ làm mới một lần, chờ một nhịp để thao tác vừa xong tự tải lại màn hình của nó trước (không tranh kết nối).
   */
  let afterWriteTimer;
  function afterWrite(delay = 1200) { saved(); clearTimeout(afterWriteTimer); afterWriteTimer = setTimeout(() => { flush(); }, delay); }
  /**
   * `baseline`: chỉ chụp mốc để lần sau so sánh (lúc mở app) – bỏ qua đường dẫn trang vừa tải xong (đã có mốc qua observe),
   * không đọc lại danh sách của trang đang mở.
   */
  async function tick({ baseline = false } = {}) {
    if (busy || !enabled() || doc.hidden) return;
    syncRoute();
    busy = true;
    const requestGeneration = generation, requestKey = key, paths = [...new Set([...primaryPaths(), ...[...records.keys()].reverse()])]
      .filter(path => !baseline || !records.has(normalize(path))).slice(0, 20);
    try {
      // Đọc song song tối đa 4 đường dẫn một lúc (trước đây tuần tự: 7–20 lượt gọi nối đuôi nhau sau mỗi lần lưu).
      const queue = [...paths];
      const worker = async () => {
        for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
          if (requestGeneration !== generation || requestKey !== routeKey() || !enabled()) return;
          const previous = records.get(path);
          checking.add(path);
          try {
            const data = await read(path);
            if (requestGeneration !== generation || requestKey !== routeKey() || !enabled()) continue;
            const next = signature(data);
            records.set(path, next);
            if (previous !== undefined && previous !== next) pending = true;
          } catch { /* Lỗi mạng không được coi là dữ liệu bị xoá; kiểm tra lại ở lượt sau. */ }
          finally { checking.delete(path); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, paths.length) }, worker));
      if (requestGeneration === generation && requestKey === routeKey()) await flush();
    } finally { busy = false; }
  }
  const onInput = e => {
    // Ô tìm kiếm / lọc không phải bản nháp. Các form, ghi chú và nội dung sửa tay cần được lưu trước.
    if (e.target.matches?.('input[type="search"]')) return;
    if (e.target.closest?.('form, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) draft = true;
  };
  const wake = () => { tick(); };
  doc.addEventListener('input', onInput);
  // wakeOnFocus = false: nơi gọi tự quyết lúc nào kiểm tra (trial-ui/pulse.js chỉ gọi tick() khi máy chủ báo có thay đổi).
  if (wakeOnFocus) {
    doc.addEventListener('visibilitychange', wake);
    win.addEventListener('focus', wake);
    win.addEventListener('online', wake);
  }
  win.addEventListener('hashchange', syncRoute);
  function start() { draft = false; if (!timer) timer = schedule(tick, interval); }
  function stop() { generation++; cancel(timer); timer = undefined; records.clear(); pending = false; draft = false; warned = false; }
  /** Dữ liệu trang vừa đổi (bộ nhớ đệm trang thấy bản mới): làm mới một lần, chờ nếu đang có bản nháp / hộp thoại mở. */
  function changed() { syncRoute(); pending = true; return flush(); }
  return { observe, request, saved, afterWrite, tick, start, stop, changed };
}
