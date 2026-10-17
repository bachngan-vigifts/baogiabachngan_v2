import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');
const apiSource = source.slice(source.indexOf('class ApiError'), source.indexOf('// CSP chỉ báo cáo'));
const authSource = source.slice(source.indexOf('function showAuth('), source.indexOf('function setupActivationForm('));

function harness() {
  const timers: Array<() => void> = [];
  const pending: Array<(response: unknown) => void> = [];
  const requests: Array<{ url: string; init: any }> = [];
  const document = { activeElement: null as unknown };
  const elements: Record<string, any> = {};
  for (const id of ['auth', 'workspace', 'chat-launcher', 'auth-error', 'auth-title', 'email', 'password']) {
    elements['#' + id] = { hidden: true, value: '', textContent: '', focus() { document.activeElement = this; } };
  }
  elements['#auth'].contains = (el: unknown) => el === elements['#email'] || el === elements['#password'];
  const ctx: any = {
    signedIn: true, sessionGen: 0, legacyToken: '', state: { user: {} }, activation: null, chatUi: null, API: '/api',
    location: { hash: '#/quotes' },
    dataRefresh: { stop() {}, observe() {}, saved() {}, tick() {} },
    queueMicrotask: (fn: () => void) => timers.push(fn),
    document, $: (id: string) => elements[id],
    setTimeout: (fn: () => void) => timers.push(fn),
    fetch: (url: string, init: any) => { requests.push({ url, init }); return new Promise(resolve => pending.push(resolve)); },
  };
  ctx.setSession = (on: boolean) => { ctx.signedIn = on; ctx.sessionGen++; };
  /** Đăng nhập lại ở thiết bị này trong lúc yêu cầu cũ còn đang chờ. */
  const relogin = () => ctx.setSession(true);
  runInNewContext(apiSource + '\n' + authSource + '\nthis.api = api; this.showAuth = showAuth;', ctx);
  const respond = (status: number, data = {}) => pending.shift()!({
    status, ok: status < 400, json: async () => data,
  });
  return { ctx, elements, document, respond, requests, relogin, flush: () => { while (timers.length) timers.shift()!(); } };
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

test('concurrent expired requests show expiry once; later response preserves email focus', async () => {
  const h = harness();
  const first = h.ctx.api('/me').catch((e: any) => e);
  const second = h.ctx.api('/notifications').catch((e: any) => e);
  h.respond(401);
  assert.equal((await first).status, 401);
  assert.equal(h.ctx.signedIn, false);
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
  h.relogin();
  h.respond(401);
  await result;
  assert.equal(h.ctx.signedIn, true);
  assert.equal(h.elements['#auth'].hidden, true);
});

test('delayed logout response cannot clear a new session', async () => {
  const h = harness();
  const result = h.ctx.api('/logout', 'POST', {});
  h.relogin();
  const gen = h.ctx.sessionGen;
  h.respond(200, { ok: true });
  await result;
  assert.equal(h.ctx.signedIn, true);
  assert.equal(h.ctx.sessionGen, gen);
});

test('logout ends the session', async () => {
  const h = harness();
  const result = h.ctx.api('/logout', 'POST', {});
  h.respond(200, { ok: true });
  await result;
  assert.equal(h.ctx.signedIn, false);
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

test('successful login starts a cookie session: no token in JSON, no Authorization header, no Web Storage', async () => {
  const h = harness();
  h.ctx.signedIn = false;
  const result = h.ctx.api('/login', 'POST', {});
  h.respond(200, { user: {} });
  await result;
  assert.equal(h.ctx.signedIn, true);
  assert.equal(h.requests[0]!.init.credentials, 'same-origin');
  assert.equal(h.requests[0]!.init.headers.authorization, undefined);
});

test('token cũ ở localStorage: gửi Bearer đúng một lần để máy chủ đổi sang cookie', async () => {
  const h = harness();
  h.ctx.legacyToken = 'a'.repeat(64);
  const first = h.ctx.api('/me');
  h.respond(200, { user: {} });
  await first;
  const second = h.ctx.api('/me');
  h.respond(200, { user: {} });
  await second;
  assert.equal(h.requests[0]!.init.headers.authorization, 'Bearer ' + 'a'.repeat(64));
  assert.equal(h.requests[1]!.init.headers.authorization, undefined);
  assert.equal(h.ctx.legacyToken, '');
});

test('giao diện không lưu token phiên vào Web Storage và không đọc sessionToken từ JSON', () => {
  for (const file of ['app.js', 'customer.js', 'auto-refresh.js', 'demo-api.js']) {
    const code = readFileSync(new URL('../../trial-ui/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(code, /sessionToken/, file);
    assert.doesNotMatch(code, /(localStorage|sessionStorage)\.setItem\(SESSION_KEY/, file);
  }
  assert.match(source, /const API = document\.querySelector\('meta\[name="bn-api"\]'\)\?\.content \|\| '\/api\/staff';/, 'API cùng tên miền giao diện');
});
