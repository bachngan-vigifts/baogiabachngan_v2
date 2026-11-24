// Isolated extension world. Cookie capture requires a real user click in the open CRM dialog.
(() => {
  if (window.top !== window || location.origin !== 'https://crm.minhlongonline.com') return;
  document.documentElement.dataset.bnSapoConnector = '1';
  let busy = false;
  document.addEventListener('click', async event => {
    const button = event.target?.closest?.('#sapo-browser-connect');
    if (!event.isTrusted || busy || !button?.closest('dialog[open]') || location.hash !== '#/staff') return;
    const requestId = button.dataset.sapoRequest;
    if (!/^[a-f0-9-]{36}$/.test(requestId || '')) return;
    busy = true;
    let result;
    try { result = await chrome.runtime.sendMessage({type: 'BN_SAPO_CAPTURE', requestId}); }
    catch { result = {ok: false, code: 'UNAVAILABLE'}; }
    finally { busy = false; }
    // Only send to the same CRM page. No cookies in DOM attributes/storage/logs or third-party origins.
    window.postMessage({type: 'BN_SAPO_RESULT', requestId, result}, location.origin);
  });
})();
