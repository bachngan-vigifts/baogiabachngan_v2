/** Receive a single explicitly requested session from the optional Chrome connector. */
export function initSapoBrowserConnect({dialog, api, isManager, sessionKey, connected, busyChanged}) {
  const button = dialog.querySelector('#sapo-browser-connect'), status = dialog.querySelector('#sapo-browser-status');
  let pending = null, saving = false, timer;
  const busy = () => !!pending || saving;
  function sync() { button.disabled = busy(); busyChanged(busy()); }
  function cancel() { pending = null; clearTimeout(timer); delete button.dataset.sapoRequest; sync(); }
  button.addEventListener('click', () => {
    if (busy() || !isManager()) return;
    if (document.documentElement.dataset.bnSapoConnector !== '1') {
      status.textContent = 'Cần cài tiện ích Chrome ở hướng dẫn bên dưới rồi tải lại CRM. Trên điện thoại, dùng cách dán phiên thủ công.';
      return;
    }
    pending = {id: crypto.randomUUID(), session: sessionKey()};
    button.dataset.sapoRequest = pending.id;
    status.textContent = 'Đang lấy phiên Sapo trên trình duyệt này…'; sync();
    timer = setTimeout(() => { cancel(); status.textContent = 'Chưa nhận được phiên. Kiểm tra tiện ích và đăng nhập Sapo, sau đó bấm lại.'; }, 15000);
  });
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'BN_SAPO_RESULT'
      || !pending || event.data.requestId !== pending.id) return;
    const sameSession = pending.session === sessionKey(), result = event.data.result;
    cancel();
    if (!dialog.open || !sameSession || !isManager()) return;
    if (result?.ok !== true || typeof result.cookie !== 'string' || result.cookie.length > 30000
      || /[\r\n]/.test(result.cookie) || !/(^|;\s*)(sapo-admin|_admin_session_id)=[^;\s]+/.test(result.cookie)) {
      status.textContent = 'Chưa lấy được phiên Sapo. Mở Sapo, đăng nhập xong rồi quay lại bấm Kết nối phiên vào CRM.';
      return;
    }
    saving = true; sync(); status.textContent = 'CRM đang kiểm tra phiên Sapo…';
    try {
      // Existing API performs Manager authorization, tests Sapo and encrypts before saving.
      await api('/admin/sapo-session', 'POST', {cookie: result.cookie});
      result.cookie = ''; await connected();
    } catch (error) { status.textContent = error.message || 'Chưa kết nối được. Vui lòng kiểm tra rồi thử lại.'; }
    finally { result.cookie = ''; saving = false; sync(); }
  });
  dialog.addEventListener('close', cancel);
  return {busy, reset() { cancel(); status.textContent = ''; }};
}
