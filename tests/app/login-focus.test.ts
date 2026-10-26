import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
// @ts-ignore browser transport
import { createApiTransport } from '../../trial-ui/api-transport.js';

const source = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');
const apiSource = source.slice(source.indexOf('class ApiError'), source.indexOf('// CSP chỉ báo cáo'));
const authSource = source.slice(source.indexOf('function showAuth('), source.indexOf('function setupActivationForm('));

function harness() {
  const timers: Array<() => void> = [];
  const pending: Array<(response: unknown) => void> = [];
  const document = { activeElement: null as unknown };
  const elements: Record<string, any> = {};
  for (const id of ['auth', 'workspace', 'chat-launcher', 'auth-error', 'auth-title', 'email', 'password']) {
    elements['#' + id] = { hidden: true, value: '', textContent: '', focus() { document.activeElement = this; } };
  }
  elements['#auth'].contains = (el: unknown) => el === elements['#email'] || el === elements['#password'];
  const ctx: any = {
    withBusy: (_method: string, promise: Promise<unknown>) => promise,
    token: 'old-session', state: { user: {} }, activation: null, chatUi: null, approvalUi: null, API: '/api',
    location: { hash: '#/quotes' },
    dataRefresh: { stop() {}, observe() {}, saved() {}, tick() {} },
    queueMicrotask: (fn: () => void) => timers.push(fn),
    document, $: (id: string) => elements[id],
    setTimeout: (fn: () => void) => timers.push(fn),
    fetch: () => new Promise(resolve => pending.push(resolve)),
  };
  ctx.apiFetch = createApiTransport({ fetcher: (...args: unknown[]) => ctx.fetch(...args) });
  ctx.saveToken = (value: string) => { ctx.token = value || ''; };
  runInNewContext(apiSource + '\n' + authSource + '\nthis.api = api; this.showAuth = showAuth;', ctx);
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
  await result;
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
