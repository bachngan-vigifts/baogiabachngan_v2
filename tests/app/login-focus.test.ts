import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
// @ts-ignore browser transport
import { createApiTransport } from '../../trial-ui/api-transport.js';
const {requestWithRegion}=await import(new URL('../../trial-ui/api-region.js',import.meta.url).href);

const source = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');
const apiSource = source.slice(source.indexOf('class ApiError'), source.indexOf('// CSP chỉ báo cáo'));
const logoutSource = source.slice(source.indexOf("$('#logout').addEventListener('click'"), source.indexOf('function showOwnAvatar('));
const authSource = source.slice(source.indexOf('function showAuth('), source.indexOf('function setupActivationForm('));

function harness() {
  const timers: Array<() => void> = [];
  const pending: Array<(response: unknown) => void> = [];
  const document = { activeElement: null as unknown };
  const elements: Record<string, any> = {};
  for (const id of ['auth', 'workspace', 'chat-launcher', 'reminder-launcher', 'auth-error', 'auth-title', 'email', 'password', 'logout', 'auth-note']) {
    elements['#' + id] = { hidden: true, value: '', textContent: '', focus() { document.activeElement = this; } };
  }
  elements['#logout'].addEventListener = (_event: string, fn: Function) => elements['#logout'].click = fn;
  elements['#auth'].contains = (el: unknown) => el === elements['#email'] || el === elements['#password'];
  const ctx: any = {
    requestWithRegion,
    withBusy: (_method: string, promise: Promise<unknown>) => promise,
    requestPriority: { run: (_bg: boolean, work: () => unknown) => work() }, isBackgroundRequest: () => false, recordApi() {}, performance,
    regionCanary: { headers: () => ({}), observe() {}, failed() {} }, managerPoolHeaders: () => ({}),
    isCacheable: () => false, isPassiveWrite: () => false, pageCache: { clear() {} }, customerSearch: { clear() {} },
    toggleAccountMenu() {}, editor: { dirty: false }, quoteDeviceDraft: { logout() {} },
    token: 'old-session', state: { user: {} }, activation: null, chatUi: null, approvalUi: null, API: '/api',
    homeUi: null, homeReminderUi: null, homeNotifications: null, notifier: null, tasksUi: null, stocktakeUi: null,
    location: { hash: '#/quotes' },
    dataRefresh: { stop() {}, observe() {}, saved() {}, tick() {} },
    queueMicrotask: (fn: () => void) => timers.push(fn),
    document, $: (id: string) => elements[id],
    setTimeout: (fn: () => void) => timers.push(fn),
    fetch: () => new Promise(resolve => pending.push(resolve)),
  };
  ctx.apiFetch = createApiTransport({ fetcher: (...args: unknown[]) => ctx.fetch(...args) });
  ctx.saveToken = (value: string) => { ctx.token = value || ''; };
  runInNewContext(apiSource + '\n' + authSource + '\n' + logoutSource + '\nthis.api = api; this.showAuth = showAuth;', ctx);
  const respond = (status: number, data = {}) => pending.shift()!({
    status, ok: status < 400, json: async () => data,
  });
  return { ctx, elements, document, respond, flush: () => { while (timers.length) timers.shift()!(); } };
}

test('repeated expiry does not steal email focus', () => {
  const h = harness();
  h.elements['#email'].value = 'info@example.com';
  h.ctx.showAuth();
  h.flush();
  assert.equal(h.document.activeElement, h.elements['#password']);
  h.elements['#email'].focus();
  h.ctx.showAuth('expired again');
  h.flush();
  assert.equal(h.document.activeElement, h.elements['#email']);
});

test('clicking email before queued autofocus keeps the chosen field', () => {
  const h = harness();
  h.elements['#email'].value = 'info@example.com';
  h.ctx.showAuth();
  h.elements['#email'].focus();
  h.flush();
  assert.equal(h.document.activeElement, h.elements['#email']);
});

test('queued autofocus cannot focus a hidden login form', () => {
  const h = harness();
  h.ctx.showAuth();
  h.elements['#auth'].hidden = true;
  h.flush();
  assert.equal(h.document.activeElement, null);
});

test('empty email receives initial autofocus', () => {
  const h = harness();
  h.ctx.showAuth();
  h.flush();
  assert.equal(h.document.activeElement, h.elements['#email']);
});

test('returning to login clears an initialized private shift-report screen', () => {
  const h = harness(); let cleared = 0;
  h.ctx.shiftReportsUi = { close() { cleared++; } };
  h.ctx.showAuth();
  assert.equal(cleared, 1);
  assert.equal(h.ctx.state.user, null);
  assert.equal(h.elements['#workspace'].hidden, true);
});

test('returning to login clears private Home and notification state for expired and explicit logout', () => {
  for (const keepToken of [false, true]) {
    const h = harness(), cleared: string[] = [];
    h.ctx.homeUi = { reset() { cleared.push('home'); } };
    h.ctx.homeReminderUi = { reset() { cleared.push('care-reminder'); } };
    h.ctx.homeNotifications = { clear() { cleared.push('feed'); } };
    h.ctx.notifier = { reset() { cleared.push('bell'); } };
    h.ctx.tasksUi = { resetQuick() { cleared.push('quick-task'); } };
    h.elements['#reminder-launcher'].hidden=false;
    h.ctx.showAuth('expired', { keepToken });
    assert.equal(h.elements['#reminder-launcher'].hidden,true);
    assert.deepEqual(cleared, ['home', 'care-reminder', 'feed', 'bell', 'quick-task']);
    assert.equal(h.ctx.state.user, null);
    assert.equal(h.ctx.token, keepToken ? 'old-session' : '');
    assert.equal(h.elements['#workspace'].hidden, true);
    assert.equal(h.elements['#auth'].hidden, false);
  }
});

test('returning to login closes an initialized stocktake editor', () => {
  const h = harness(); let closed = 0;
  h.ctx.stocktakeUi = { close() { closed++; } };
  h.ctx.showAuth('expired');
  assert.equal(closed, 1);
  assert.equal(h.ctx.token, '');
  assert.equal(h.ctx.state.user, null);
  assert.equal(h.elements['#auth'].hidden, false);
});

test('canceling stocktake draft confirmation keeps the session without sending logout', async () => {
  const h = harness(); let confirmed = 0;
  h.ctx.stocktakeUi = { hasDraft: () => true, async beforeLeave() { confirmed++; return false; } };
  h.ctx.fetch = () => { throw new Error('Logout must not be sent after canceling'); };
  await h.elements['#logout'].click();
  assert.equal(confirmed, 1);
  assert.equal(h.ctx.token, 'old-session');
  assert.equal(h.elements['#auth'].hidden, true);
});

test('concurrent expired requests show expiry once; later response preserves email focus', async () => {
  const h = harness();
  const first = h.ctx.api('/me').catch((e: any) => e);
  const second = h.ctx.api('/notifications').catch((e: any) => e);
  h.respond(401);
  assert.equal((await first).status, 401);
  assert.equal(h.ctx.token, '');
  assert.match(h.elements['#auth-error'].textContent, /hết hạn/);
  h.flush();
  h.elements['#email'].focus();
  h.elements['#auth-error'].textContent = 'user message';
  h.respond(401);
  await second;
  h.flush();
  assert.equal(h.document.activeElement, h.elements['#email']);
  assert.equal(h.elements['#auth-error'].textContent, 'user message');
});

test('old session 401 cannot sign out a new session', async () => {
  const h = harness();
  const result = h.ctx.api('/notifications').catch((e: any) => e);
  h.ctx.token = 'new-session';
  h.respond(401);
  await result;
  assert.equal(h.ctx.token, 'new-session');
  assert.equal(h.elements['#auth'].hidden, true);
});

test('delayed logout response cannot clear a new session', async () => {
  const h = harness();
  const result = h.ctx.api('/logout', 'POST', {});
  h.ctx.token = 'new-session';
  h.respond(200, { sessionToken: '' });
  // Phản hồi của phiên cũ: báo STALE_SESSION (mã 409 – không bị coi là "chưa rõ đã lưu" để gửi lại), không xoá phiên mới.
  const error = await result.then(() => null, (e: any) => e);
  assert.equal(error?.code, 'STALE_SESSION'); assert.equal(error?.status, 409);
  assert.equal(h.ctx.token, 'new-session');
});

test('requests without a session do not overwrite the logged-out form', async () => {
  const h = harness();
  h.ctx.showAuth();
  h.elements['#auth-error'].textContent = 'logged out';
  const result = h.ctx.api('/notifications').catch((e: any) => e);
  h.respond(401);
  await result;
  assert.equal(h.elements['#auth-error'].textContent, 'logged out');
});

test('successful login stores the new session token', async () => {
  const h = harness();
  h.ctx.token = '';
  const result = h.ctx.api('/login', 'POST', {});
  h.respond(200, { sessionToken: 'new-session' });
  await result;
  assert.equal(h.ctx.token, 'new-session');
});


test('logout button ignores an old response after another account logs in', async () => {
  for (const status of [200, 401]) {
    const h = harness(), pending = h.elements['#logout'].click();
    const currentUser = { id: 'new-user' }, quotes = [{ id: 'new-account-quote' }];
    h.ctx.token = 'new-session'; h.ctx.state.user = currentUser; h.ctx.state.quotes = quotes;
    h.respond(status, { sessionToken: '' }); await pending;
    assert.equal(h.ctx.token, 'new-session'); assert.equal(h.ctx.state.user, currentUser);
    assert.equal(h.ctx.state.quotes, quotes); assert.equal(h.elements['#auth'].hidden, true);
    assert.equal(h.elements['#auth-note'].textContent, '');
  }
});

test('logout button still signs out the current account on success or a server error', async () => {
  for (const status of [200, 503]) {
    const h = harness(), pending = h.elements['#logout'].click();
    h.respond(status, status === 200 ? { sessionToken: '' } : { error: 'Temporarily unavailable' }); await pending;
    assert.equal(h.ctx.token, ''); assert.equal(h.ctx.state.user, null);
    assert.equal(h.elements['#auth'].hidden, false); assert.equal(h.elements['#auth-note'].textContent, 'Đã đăng xuất.');
  }
});

test('changing account while the logout confirmation is open does not send logout for the new account', async () => {
  const h = harness(); let confirm!: (yes: boolean) => void;
  h.ctx.editor.dirty = true; h.ctx.confirmBox = () => new Promise(resolve => { confirm = resolve; });
  const pending = h.elements['#logout'].click(); h.ctx.token = 'new-session'; h.ctx.state.user = { id: 'new-user' };
  confirm(true); await pending;
  assert.equal(h.ctx.token, 'new-session'); assert.equal(h.ctx.editor.dirty, true); assert.equal(h.elements['#auth'].hidden, true);
});
