/** A voluntary break. No API calls, health history or CRM form mutations. */
export function initBreathingLauncher({doc = document, win = window, fetchPage = (...args) => win.fetch(...args)} = {}) {
  const button = doc.getElementById('breathing-open');
  const workspace = doc.getElementById('workspace');
  if (!button || !workspace) return null;
  const dialog = doc.createElement('dialog');
  dialog.className = 'breathing-dialog';
  dialog.setAttribute('aria-labelledby', 'breathing-dialog-title');
  dialog.innerHTML = '<div class="breathing-dialog-head"><h2 id="breathing-dialog-title">Khoảng nghỉ · Bài tập thở</h2><a class="breathing-external" href="breathing.html" target="_blank" rel="noopener">Mở trang riêng</a><button type="button" class="btn ghost" data-breath-close>Đóng · Dừng bài</button></div><p class="breathing-load-status" role="status"></p><div class="breathing-frame-host"></div>';
  doc.body.append(dialog);
  const status = dialog.querySelector('[role="status"]');
  const host = dialog.querySelector('.breathing-frame-host');
  const closeButton = dialog.querySelector('[data-breath-close]');
  let generation = 0, abort = null;
  function cleanup() {
    generation++;
    abort?.abort(); abort = null;
    // Removing the browsing context stops every animation, AudioContext and audio track.
    host.replaceChildren();
  }
  function close() { cleanup(); if (dialog.open) dialog.close(); }
  async function open() {
    if (workspace.hidden || dialog.open) return;
    const token = ++generation;
    abort = new AbortController();
    status.hidden = false; status.textContent = 'Đang mở bài tập thở…';
    dialog.showModal(); closeButton.focus();
    try {
      const url = new URL('breathing.html', doc.baseURI);
      if (url.origin !== win.location.origin) throw new Error('Invalid origin');
      const response = await fetchPage(url.href, {signal: abort.signal, cache: 'no-cache', credentials: 'same-origin'});
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Cannot load breathing page');
      const html = await response.text();
      if (token !== generation || !dialog.open || workspace.hidden) return;
      const frame = doc.createElement('iframe');
      frame.title = 'Bài tập thở nhẹ và Wim Hof';
      // Trusted, repository-owned HTML only. srcdoc avoids altering CRM's DENY framing headers.
      // Base is the CRM origin; no private demo URL or credentials are embedded.
      const parsed = new win.DOMParser().parseFromString(html, 'text/html');
      const base = parsed.createElement('base'); base.href = url.href;
      parsed.head.prepend(base);
      frame.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML;
      frame.addEventListener('load', () => {
        if (token !== generation) return;
        frame.contentDocument?.addEventListener('keydown', event => {
          if (event.key === 'Escape' && !frame.contentDocument.querySelector('dialog[open]')) close();
        });
      });
      host.replaceChildren(frame); status.hidden = true;
    } catch (error) {
      if (token !== generation || error?.name === 'AbortError') return;
      status.textContent = 'Chưa mở được bài tập. Đóng rồi thử lại; công việc CRM vẫn được giữ nguyên.';
    }
  }
  // A real link remains usable before/without JS. Touch browsers use a dedicated
  // tab instead of relying on nested srcdoc/dialog support; CRM drafts stay put.
  function activate(event) {
    if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (win.matchMedia?.('(hover: none), (pointer: coarse)').matches || typeof dialog.showModal !== 'function') return;
    const opening = open();
    // showModal runs before the first await. Cancel native navigation ONLY after
    // the dialog really opened; unsupported/failed opening keeps the link alive.
    if (dialog.open) event.preventDefault();
    opening.catch(() => { if (!dialog.open) cleanup(); });
  }
  button.addEventListener('click', activate);
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (dialog.open) return; cleanup(); if (!workspace.hidden) button.focus(); });
  const onNavigation = () => close();
  win.addEventListener('hashchange', onNavigation);
  win.addEventListener('popstate', onNavigation);
  win.addEventListener('pagehide', onNavigation);
  const observer = new win.MutationObserver(() => { if (workspace.hidden) close(); });
  observer.observe(workspace, {attributes: true, attributeFilter: ['hidden']});
  return {open, close, destroy() { close(); observer.disconnect(); button.removeEventListener('click', activate); for (const event of ['hashchange', 'popstate', 'pagehide']) win.removeEventListener(event, onNavigation); dialog.remove(); }};
}
if (typeof document !== 'undefined') initBreathingLauncher();
