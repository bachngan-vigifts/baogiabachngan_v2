const CRM = 'https://crm.minhlongonline.com';
const SAPO = 'https://bachngankiengiang.mysapogo.com/admin';
const NAMES = new Set(['sapo-admin', '_admin_session_id', '.AspNetCore.Session']);

export function allowedSender(sender, extensionId) {
  try {
    const url = new URL(sender.tab?.url);
    return sender.id === extensionId && sender.frameId === 0 && Number.isInteger(sender.tab.id)
      && url.origin === CRM && url.pathname === '/' && url.hash === '#/staff';
  } catch { return false; }
}

export function sessionHeader(cookies, now = Date.now() / 1000) {
  const jar = new Map();
  for (const c of cookies) {
    if (!NAMES.has(c.name) || c.partitionKey || c.expirationDate <= now) continue;
    if (!['bachngankiengiang.mysapogo.com', '.bachngankiengiang.mysapogo.com', 'mysapogo.com', '.mysapogo.com'].includes(c.domain)) continue;
    if (typeof c.value !== 'string' || !/^[\x21-\x3a\x3c-\x7e]+$/.test(c.value)) throw Error('INVALID');
    if (jar.has(c.name) && jar.get(c.name) !== c.value) throw Error('AMBIGUOUS');
    jar.set(c.name, c.value);
  }
  if (!jar.has('sapo-admin') && !jar.has('_admin_session_id')) throw Error('MISSING');
  const cookie = [...jar].map(([name, value]) => name + '=' + value).join('; ');
  if (cookie.length > 30000) throw Error('INVALID');
  return cookie;
}

export async function captureSession(chromeApi, message, sender) {
  if (!allowedSender(sender, chromeApi.runtime.id) || message?.type !== 'BN_SAPO_CAPTURE'
    || !/^[a-f0-9-]{36}$/.test(message.requestId || '')) return {ok: false, code: 'FORBIDDEN'};
  try {
    // Read only the cookie store containing the requesting CRM tab, never another profile/store.
    const stores = await chromeApi.cookies.getAllCookieStores();
    const store = stores.find(s => s.tabIds.includes(sender.tab.id));
    if (!store) return {ok: false, code: 'NO_STORE'};
    const cookies = await chromeApi.cookies.getAll({url: SAPO, storeId: store.id});
    return {ok: true, cookie: sessionHeader(cookies)};
  } catch {
    // Browser/permission errors may include sensitive details: never forward their text.
    return {ok: false, code: 'NO_SESSION'};
  }
}

if (globalThis.chrome?.runtime?.onMessage) chrome.runtime.onMessage.addListener((message, sender, respond) => {
  captureSession(chrome, message, sender).then(respond, () => respond({ok: false, code: 'NO_SESSION'}));
  return true;
});
