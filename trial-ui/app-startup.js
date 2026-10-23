// Independent of the module graph: a failed JS download must leave a usable screen.
(() => {
  const startup = document.getElementById('app-startup');
  const message = document.getElementById('app-startup-message');
  const retry = document.getElementById('app-startup-retry');
  const auth = document.getElementById('auth'), workspace = document.getElementById('workspace');
  let timer;
  const ready = () => !auth.hidden || !workspace.hidden;
  function finish() {
    if (!ready()) return false;
    startup.hidden = true;
    clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener('error', failed, true);
    window.removeEventListener('unhandledrejection', failed);
    return true;
  }
  function failed() {
    if (finish()) return;
    clearTimeout(timer);
    message.textContent = 'Chưa tải được CRM. Vui lòng thử tải lại trang.';
    retry.hidden = false;
  }
  const observer = new MutationObserver(finish);
  for (const element of [auth, workspace]) observer.observe(element, { attributes: true, attributeFilter: ['hidden'] });
  retry.addEventListener('click', () => location.reload());
  window.addEventListener('error', failed, true);
  window.addEventListener('unhandledrejection', failed);
  timer = setTimeout(() => {
    if (finish()) return;
    message.textContent = 'Kết nối đang chậm. Anh/chị có thể tải lại trang để thử kết nối lại.';
    retry.hidden = false;
  }, 15000);
  finish();
})();
