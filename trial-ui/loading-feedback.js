// HIỆU ỨNG ĐANG TẢI – áp dụng chung cho mọi trang (không sửa từng màn hình). Bổ sung cho busy-buttons.js (nút gửi lệnh ghi).
// Mỗi thao tác của người dùng (bấm link / dòng / chip lọc, đổi ô lọc, gõ ô tìm, bấm Back) mở một "lượt chờ":
//  - Lời gọi API bắt đầu trong lúc lượt còn mở thuộc về lượt đó; lượt đóng khi các lời gọi xong (chờ thêm một nhịp
//    cho lời gọi nối tiếp), hoặc không có lời gọi nào sau một khoảng ngắn (thao tác không cần tải), hoặc quá 20 giây.
//  - Thanh tiến trình ở đầu màn hình hiện khi lượt chờ quá 300 ms (lượt nhanh không nháy); quá 1,2 giây có thêm chữ "Đang tải…". Lời gọi chạy nền
//    (tự làm mới, thông báo…) không thuộc lượt nào nên không hiện thanh.
//  - Link / dòng vừa bấm: mờ đi + vòng xoay, bấm lại vào chính nó trong lúc chờ bị bỏ qua (chống bấm trùng).
//  - Bộ lọc: chip vừa bấm có vòng xoay, vùng kết quả mờ đi (kết quả cũ vẫn thấy); bộ lọc KHÔNG khoá – đổi tiếp được.
//  - Mạng chậm, đang thử lại lệnh đọc (api-transport.js phát sự kiện 'api-retry'): thanh hiện chữ báo.
//  - Mất mạng (sự kiện offline): dải đỏ "Mất kết nối" ở đầu màn hình tới khi có mạng lại.
//  - Đang gửi lệnh ghi mà đóng tab / tải lại: trình duyệt hỏi lại (tránh mất dữ liệu mà không biết đã lưu chưa).
//  - Phần tử không muốn hiệu ứng: đặt data-no-busy.
const SHOW_AFTER_MS = 300, LABEL_AFTER_MS = 1200, CLICK_WINDOW_MS = 350, TYPE_WINDOW_MS = 1000, GRACE_MS = 150, MAX_MS = 20_000;
/** Lời gọi tính / đánh dấu đã đọc / gõ… chạy theo thao tác nhưng không phải "tải" (như PASSIVE của busy-buttons.js). */
const PASSIVE = /\/(preview|csp-report|read|locations|typing|presence)(\?|$)/;
const FILTERS = '.toolbar,.filter-bar,.ledger-bar,.chips,[role=tablist],[role=radiogroup],.crm-filter-sheet,.orders-filter-grid,.task-filterbar,.search,.search-box,[data-filter]';
const REGIONS = '.panel,.sup-page,.view,main';
const SKIP = '[data-no-busy],#view-pos,.pos-modal,.pos-shell,dialog[open] form';

let pendingWrites = 0, offline = null;
let doc = null, win = null, bar = null, label = null, active = null, showTimer = 0, labelTimer = 0, slow = false, retrying = false;

/** Phần tử bấm được dẫn tới tải dữ liệu: link trong app, dòng / thẻ có con trỏ bàn tay. Nút do busy-buttons.js lo. */
function clickTarget(target) {
  if (!target?.closest || target.closest(SKIP)) return null;
  if (target.closest('button,input,select,textarea,label,summary')) return null;
  const link = target.closest('a[href]');
  if (link) {
    const href = link.getAttribute('href') || '';
    if (link.classList.contains('btn') || link.target === '_blank' || link.hasAttribute('download') || href === '#' || /^(tel|mailto|sms|zalo):/i.test(href)) return null;
    return href.startsWith('#/') || href.startsWith('?') ? link : null;
  }
  for (let el = target; el && el !== doc.body; el = el.parentElement) {
    if (el.matches('tr,li,article,[role=button],[role=link],.crm-list-card,[data-href]') && win.getComputedStyle(el).cursor === 'pointer') return el;
  }
  return null;
}
const filterChip = target => target?.closest?.('.chip,[role=tab]') && !target.closest(SKIP) ? target.closest('.chip,[role=tab]') : null;
const inFilter = el => !!el?.closest?.(FILTERS) && !el.closest(SKIP);
/** Vùng kết quả cần làm mờ: khung gần nhất chứa bộ lọc (thường là .panel), không thì cả trang đang mở. */
const regionOf = el => el.closest(REGIONS);

function mark(g) {
  for (const el of g.opening) { el.classList.add('is-opening'); el.dataset.opening = '1'; }
  for (const el of g.chips) el.classList.add('is-busy');
  // Không đặt aria-busy cho vùng: style.css làm mờ + chặn bấm mọi [aria-busy] → khoá luôn bộ lọc bên trong.
  if (g.region) g.region.classList.add('is-refreshing');
}
function unmark(g) {
  for (const el of g.opening) { el.classList.remove('is-opening'); delete el.dataset.opening; }
  for (const el of g.chips) el.classList.remove('is-busy');
  if (g.region && !(active && active !== g && active.region === g.region)) g.region.classList.remove('is-refreshing');
}
function end(g) {
  if (g.ended) return;
  g.ended = true; clearTimeout(g.quiet); clearTimeout(g.max); clearTimeout(g.grace);
  unmark(g);
  if (active === g) { active = null; retrying = false; }
  updateBar();
}
function begin({ opening = [], chips = [], region = null, window = CLICK_WINDOW_MS }) {
  if (!doc) return;
  if (active) end(active);
  const g = { opening, chips, region, reqs: 0, ended: false, started: false };
  active = g; mark(g);
  // Không có lời gọi nào trong khoảng ngắn → thao tác không cần tải (mở / gập tại chỗ): bỏ hiệu ứng ngay.
  g.quiet = setTimeout(() => { if (!g.started) end(g); }, window);
  g.max = setTimeout(() => end(g), MAX_MS);
}

function updateBar() {
  if (!bar) return;
  const loading = !!(active && active.reqs > 0);
  if (!loading) { clearTimeout(showTimer); clearTimeout(labelTimer); showTimer = labelTimer = 0; slow = false; bar.hidden = true; label.textContent = ''; return; }
  label.textContent = retrying ? 'Mạng chậm, đang thử lại…' : slow ? 'Đang tải…' : '';
  if (bar.hidden && !showTimer) showTimer = setTimeout(() => { showTimer = 0; if (active?.reqs) bar.hidden = false; }, SHOW_AFTER_MS);
  if (!slow && !labelTimer) labelTimer = setTimeout(() => { labelTimer = 0; if (active?.reqs) { slow = true; updateBar(); } }, LABEL_AFTER_MS);
}

/** Gắn một lời gọi API vào lượt chờ đang mở (nếu có). Gọi từ withBusy (busy-buttons.js) – mọi lời gọi API đều qua đó. */
export function trackRequest(path, promise) {
  const g = active;
  if (!g || g.ended || PASSIVE.test(String(path).split('#')[0])) return promise;
  g.reqs++; g.started = true; clearTimeout(g.grace); updateBar();
  const done = () => {
    g.reqs--;
    // Trang hay gọi nối tiếp (tải danh sách rồi tải số đếm): chờ thêm một nhịp trước khi bỏ hiệu ứng.
    if (!g.reqs) g.grace = setTimeout(() => { if (!g.reqs) end(g); }, GRACE_MS);
    updateBar();
  };
  promise.then(done, done);
  return promise;
}

/** Lệnh ghi đang chạy (đóng tab lúc này thì hỏi lại). Gọi từ withBusy cho mọi lệnh khác GET. */
export function trackWrite(promise) {
  pendingWrites++;
  const done = () => { pendingWrites--; };
  promise.then(done, done);
  return promise;
}
export const pendingWriteCount = () => pendingWrites;

export function installLoadingFeedback(d = globalThis.document, w = globalThis.window) {
  if (doc || !d?.addEventListener || !w) return;
  doc = d; win = w;
  bar = d.createElement('div'); bar.className = 'net-progress'; bar.hidden = true;
  bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Đang tải');
  label = d.createElement('span'); label.className = 'net-progress-label'; label.setAttribute('aria-live', 'polite');
  bar.append(label); d.body.append(bar);

  d.addEventListener('click', e => {
    const chip = filterChip(e.target);
    if (chip) { begin({ chips: [chip], region: regionOf(chip) }); return; }
    const el = clickTarget(e.target);
    if (!el) return;
    // Bấm lại vào link / dòng đang mở: bỏ qua (không gửi trùng, không mở hai lần).
    if (el.dataset.opening === '1') { e.preventDefault(); e.stopImmediatePropagation(); return; }
    begin({ opening: [el] });
  }, true);
  d.addEventListener('change', e => {
    const el = e.target;
    if (!el?.matches?.('select,input') || !inFilter(el)) return;
    begin({ region: regionOf(el) });
  }, true);
  d.addEventListener('input', e => {
    const el = e.target;
    if (!el?.matches?.('input[type=search],input[type=text],input:not([type])') || !inFilter(el)) return;
    // Ô tìm thường chờ 250–300 ms sau khi gõ mới tải: cửa sổ dài hơn để bắt được lời gọi đó.
    begin({ region: regionOf(el), window: TYPE_WINDOW_MS });
  }, true);
  // Back / Forward / link do code đổi hash: lượt chờ không gắn phần tử (chỉ thanh tiến trình).
  w.addEventListener('hashchange', () => { if (!active) begin({}); });
  w.addEventListener('api-retry', () => { if (active) { retrying = true; updateBar(); } });
  offline = d.createElement('div'); offline.className = 'net-offline'; offline.setAttribute('role', 'status'); offline.hidden = true;
  offline.textContent = 'Mất kết nối mạng – thao tác chưa gửi được. Thông tin đang nhập vẫn giữ nguyên, có mạng lại thì bấm gửi.';
  d.body.append(offline);
  const net = () => { offline.hidden = w.navigator?.onLine !== false; };
  w.addEventListener('offline', net); w.addEventListener('online', net); net();
  w.addEventListener('beforeunload', e => { if (pendingWrites > 0) { e.preventDefault(); e.returnValue = ''; } });
}
