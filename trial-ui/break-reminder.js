/** Nhắc nghỉ khi thao tác liên tục trên CRM (Madam Sen).
 *  1 giờ liên tục: popup nhắc uống nước, tự đóng sau 2 phút. 2 giờ liên tục: chọn 1 trong 2 bài thở, tập 2 phút.
 *  Chỉ chạy trên trình duyệt: không gọi API, không lưu lịch sử nghỉ, không đụng dữ liệu form đang nhập. */
export const BREAK_DEFAULTS = { idleMs: 5 * 60e3, firstMs: 60 * 60e3, secondMs: 120 * 60e3, restMs: 120e3, snoozeMs: 5 * 60e3, throttleMs: 2000 };
export const freshState = now => ({ start: now, last: now, first: false, snooze1: false, snooze2: false, snoozeUntil: 0, popupUntil: 0 });
const valid = s => s && Number.isFinite(s.start) && Number.isFinite(s.last);
/** Ghi nhận một thao tác. Nghỉ từ idleMs trở lên (hoặc đồng hồ máy bị lùi) thì tính lại từ đầu. */
export function recordActivity(state, now, cfg = BREAK_DEFAULTS) {
  if (!valid(state) || now < state.last || now - state.last >= cfg.idleMs) return freshState(now);
  return { ...state, last: now };
}
/** Mốc cần nhắc lúc này: null | 'first' (1 giờ) | 'second' (2 giờ). */
export function dueReminder(state, now, cfg = BREAK_DEFAULTS) {
  if (!valid(state) || now < (state.snoozeUntil || 0) || now < (state.popupUntil || 0)) return null;
  const worked = now - state.start;
  if (worked >= cfg.secondMs) return 'second';
  return worked >= cfg.firstMs && !state.first ? 'first' : null;
}
export const canSnooze = (state, kind) => !state?.[kind === 'first' ? 'snooze1' : 'snooze2'];
export const snoozed = (state, kind, now, cfg = BREAK_DEFAULTS) => ({ ...state, [kind === 'first' ? 'snooze1' : 'snooze2']: true, snoozeUntil: now + cfg.snoozeMs, popupUntil: 0, last: now });
/** Sau popup 1 giờ đồng hồ chạy tiếp tới mốc 2 giờ; sau bài thở 2 giờ tính lại từ đầu. */
export const afterFirst = (state, now) => ({ ...state, first: true, popupUntil: 0, last: now });
export const afterSecond = now => freshState(now);
export const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const KEY = 'bn-break-v1', RING = 163.4;
const ring = '<svg class="break-ring" viewBox="0 0 60 60" aria-hidden="true"><circle class="break-ring-track" cx="30" cy="30" r="26"/><circle class="break-ring-bar" cx="30" cy="30" r="26" stroke-dasharray="163.4" stroke-dashoffset="0"/></svg>';

export function initBreakReminder({ doc = document, win = window, config = {}, fetchPage = (...a) => win.fetch(...a) } = {}) {
  const cfg = { ...BREAK_DEFAULTS, ...config }, workspace = doc.getElementById('workspace');
  if (!workspace) return null;
  const now = () => Date.now();
  let memory = null, popup = null, lastSeen = 0;
  const load = () => { try { return JSON.parse(win.localStorage.getItem(KEY)) || memory; } catch { return memory; } };
  const save = state => { memory = state; try { win.localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* chế độ riêng tư: dùng bộ nhớ của tab */ } };
  // Không cắt ngang: đang thanh toán POS, đang tập thở tự nguyện, hoặc có thao tác đang chạy.
  const blocked = () => !!doc.querySelector('dialog.pos-payment-modal[open],dialog.breathing-dialog[open],dialog[open] [aria-busy="true"]');
  const onPos = () => win.location.hash.startsWith('#/pos');

  function closePopup() {
    if (!popup) return;
    win.clearInterval(popup.timer); win.clearInterval(popup.beat); popup.abort?.abort();
    const dlg = popup.dlg; popup = null;
    dlg.querySelector('.break-frame')?.replaceChildren(); // gỡ iframe = dừng nhạc và hoạt ảnh
    if (dlg.open) dlg.close(); dlg.remove();
  }
  function openPopup(kind) {
    const dlg = doc.createElement('dialog'); dlg.className = 'break-dialog'; dlg.setAttribute('aria-labelledby', 'break-title');
    dlg.innerHTML = '<img class="break-sen" src="break-assets/madam-sen.jpg" alt=""><div class="break-body"></div>';
    dlg.addEventListener('cancel', e => e.preventDefault()); // không tắt bằng Esc
    doc.body.append(dlg); dlg.showModal();
    popup = { dlg, kind, body: dlg.querySelector('.break-body') };
    // Báo cho các tab CRM khác biết popup đang hiện ở tab này để không hiện trùng.
    const beat = () => save({ ...(load() || freshState(now())), popupUntil: now() + 8000, last: now() });
    beat(); popup.beat = win.setInterval(beat, 4000);
    return popup;
  }
  function countdown(p, ms, onDone) {
    const end = now() + ms, clockEl = p.dlg.querySelector('.break-clock'), bar = p.dlg.querySelector('.break-ring-bar');
    const paint = () => {
      const left = end - now();
      if (clockEl) clockEl.textContent = clock(left);
      if (bar) bar.style.strokeDashoffset = String(RING * (1 - Math.max(0, left) / ms));
      if (left <= 0) { win.clearInterval(p.timer); onDone(); }
    };
    win.clearInterval(p.timer); paint(); if (popup === p) p.timer = win.setInterval(paint, 250);
  }
  const snoozeButton = kind => canSnooze(load(), kind) ? '<button type="button" class="break-snooze" data-break-snooze data-mobile-inline>Đang xử lý việc gấp · nhắc lại sau 5 phút</button>' : '';
  function wireSnooze(p) {
    p.body.querySelector('[data-break-snooze]')?.addEventListener('click', () => { const s = snoozed(load() || freshState(now()), p.kind, now(), cfg); closePopup(); save(s); });
  }
  function showFirst() {
    const p = openPopup('first');
    p.body.innerHTML = '<span class="break-eyebrow">Bạn đã làm việc liên tục 1 giờ</span><h2 id="break-title" tabindex="-1">Suỵt… nghỉ một chút nào</h2>' +
      '<p>Uống một ngụm nước và đi nhẹ một vòng rồi làm tiếp nhé.</p><p class="break-quote">Việc vẫn ở đó, Sen giữ chỗ cho.</p>' +
      `<div class="break-timer">${ring}<div><div class="break-clock" role="timer" aria-live="off"></div><small>Tự đóng khi hết giờ · công việc đang nhập được giữ nguyên</small></div></div>` + snoozeButton('first');
    p.body.querySelector('h2').focus(); wireSnooze(p);
    countdown(p, cfg.restMs, () => { closePopup(); save(afterFirst(load() || freshState(now()), now())); });
  }
  function showSecond() {
    const p = openPopup('second');
    p.body.innerHTML = '<span class="break-eyebrow">Bạn đã làm việc liên tục 2 giờ</span><h2 id="break-title" tabindex="-1">Thư giãn 2 phút cùng Sen</h2>' +
      '<p>Chọn một bài thở. Hết 2 phút bạn quay lại làm việc.</p><div class="break-choices">' +
      '<button type="button" class="break-choice" data-break-mode="gentle" data-mobile-inline><b>Thở nhẹ</b><span>Hít vào chậm, thở ra dài. Không giữ hơi, hợp với mọi người.</span></button>' +
      '<button type="button" class="break-choice" data-break-mode="wim" data-mobile-inline><b>Wim Hof</b><span>Thở sâu, giữ hơi tuỳ sức. Không tập nếu có bệnh tim mạch, huyết áp, động kinh hoặc đang mang thai.</span></button></div>' + snoozeButton('second');
    p.body.querySelector('h2').focus(); wireSnooze(p);
    p.body.querySelectorAll('[data-break-mode]').forEach(b => b.addEventListener('click', () => exercise(p, b.dataset.breakMode)));
  }
  async function exercise(p, mode) {
    const gentle = mode !== 'wim';
    p.dlg.classList.add('break-exercise');
    p.body.innerHTML = `<div class="break-bar"><div><span class="break-eyebrow">${gentle ? 'Thở nhẹ' : 'Wim Hof'} · 2 phút</span><h2 id="break-title" tabindex="-1">Tập theo hướng dẫn bên dưới</h2></div>` +
      `<div class="break-timer">${ring}<div class="break-clock" role="timer" aria-live="off"></div></div></div>` +
      '<p class="break-status" role="status">Đang mở bài tập thở…</p><div class="break-frame"></div><div class="break-done" hidden><p>Xong 2 phút. Tốt lắm!</p><button type="button" class="btn primary" data-break-done data-mobile-inline>Quay lại làm việc</button></div>';
    p.body.querySelector('h2').focus();
    const status = p.body.querySelector('.break-status'), host = p.body.querySelector('.break-frame');
    countdown(p, cfg.restMs, () => {
      const done = p.body.querySelector('.break-done'); done.hidden = false;
      done.querySelector('button').addEventListener('click', () => { closePopup(); save(afterSecond(now())); });
      done.querySelector('button').focus();
    });
    try {
      p.abort = new AbortController();
      const url = new URL('breathing.html', doc.baseURI);
      if (url.origin !== win.location.origin) throw new Error('Invalid origin');
      const response = await fetchPage(url.href, { signal: p.abort.signal, cache: 'no-cache', credentials: 'same-origin' });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Cannot load breathing page');
      const html = await response.text();
      if (popup !== p) return;
      // Cùng cách với nút "Bài tập thở": HTML của chính CRM, nạp qua srcdoc để giữ nguyên header chặn nhúng khung.
      const parsed = new win.DOMParser().parseFromString(html, 'text/html'), base = parsed.createElement('base');
      base.href = url.href; parsed.head.prepend(base);
      const frame = doc.createElement('iframe'); frame.title = gentle ? 'Bài thở nhẹ' : 'Bài thở Wim Hof';
      frame.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML;
      frame.addEventListener('load', () => {
        // Chọn sẵn bài và thời lượng 2 phút; nhân viên tự bấm Bắt đầu (Wim Hof vẫn phải đọc hướng dẫn an toàn).
        const pick = (tries = 0) => {
          const d = frame.contentDocument; if (!d || popup !== p) return;
          if (!gentle) d.querySelector('[data-mode="wim"]')?.click();
          const duration = d.querySelector(gentle ? '[data-g="duration-120"]' : '[data-b="duration-120"]');
          if (duration) duration.click(); else if (tries < 20) win.setTimeout(() => pick(tries + 1), 150);
        };
        pick();
      });
      host.replaceChildren(frame); status.hidden = true;
    } catch (error) {
      if (popup !== p || error?.name === 'AbortError') return;
      status.textContent = gentle ? 'Chưa mở được bài tập. Hãy tự thở nhẹ: hít vào 4 giây, thở ra 6 giây, không giữ hơi, cho tới khi hết giờ.'
        : 'Chưa mở được bài tập. Hãy thở nhẹ theo nhịp tự nhiên cho tới khi hết giờ.';
    }
  }
  /** POS: chỉ nhắc nhẹ, không khoá màn hình để khách không phải chờ. */
  function nudge(kind) {
    doc.querySelector('.break-nudge')?.remove();
    const box = doc.createElement('div'); box.className = 'break-nudge'; box.setAttribute('role', 'status');
    box.innerHTML = `<span>${kind === 'first' ? 'Bạn đã bán hàng liên tục 1 giờ. Lúc vắng khách, uống ngụm nước và đi nhẹ một vòng nhé.' : 'Bạn đã bán hàng liên tục 2 giờ. Lúc vắng khách, hãy nghỉ 2 phút với bài tập thở.'}</span>` +
      (kind === 'second' ? '<button type="button" class="btn secondary small" data-break-open data-mobile-inline>Mở bài tập thở</button>' : '') + '<button type="button" class="icon-btn" data-break-x data-mobile-inline aria-label="Đóng nhắc nhở">×</button>';
    box.querySelector('[data-break-x]').addEventListener('click', () => box.remove());
    box.querySelector('[data-break-open]')?.addEventListener('click', () => { box.remove(); doc.getElementById('breathing-open')?.click(); });
    doc.body.append(box); win.setTimeout(() => box.remove(), 30000);
    save(kind === 'first' ? afterFirst(load() || freshState(now()), now()) : afterSecond(now()));
  }
  function activity() {
    const t = now();
    if (t - lastSeen < cfg.throttleMs || workspace.hidden || popup) return;
    lastSeen = t;
    const state = recordActivity(load(), t, cfg); save(state);
    const due = dueReminder(state, t, cfg);
    if (!due || blocked()) return;
    if (onPos()) nudge(due); else if (due === 'first') showFirst(); else showSecond();
  }
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
  for (const e of events) doc.addEventListener(e, activity, { capture: true, passive: true });
  // Đăng xuất: gỡ popup, không tính tiếp.
  const observer = new win.MutationObserver(() => { if (workspace.hidden) closePopup(); });
  observer.observe(workspace, { attributes: true, attributeFilter: ['hidden'] });
  return { activity, close: closePopup, isOpen: () => !!popup, destroy() { closePopup(); observer.disconnect(); for (const e of events) doc.removeEventListener(e, activity, { capture: true }); } };
}
if (typeof document !== 'undefined') initBreakReminder({ config: globalThis.__bnBreakConfig });
