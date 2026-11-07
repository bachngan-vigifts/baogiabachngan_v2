import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../trial-ui/customer.js', import.meta.url), 'utf8');
function setup(hash: string, fail?: (path: string) => Error | undefined) {
  const nodes: Record<string, any> = {};
  const node = (key: string) => nodes[key] ||= { value: '', hidden: false, disabled: false, textContent: '', addEventListener(event: string, fn: Function) { this[event] = fn; }, reset() {} };
  const location = { pathname: '/customer', search: '?source=crm', hash };
  const calls: string[] = [];
  let dashboard = false;
  const context: any = { URLSearchParams, $: node, view() {}, location, history: { replaceState(_a: unknown, _b: string, url: string) { location.hash = url.includes('#') ? '#' + url.split('#')[1] : ''; } },
    api: async (path: string) => { calls.push(path); const error = fail?.(path); if (error) throw error; return { email: 'client@example.test' }; },
    boot: async () => { dashboard = true; }, saveToken() {}, loginBot: { token: () => '', reset() {} } };
  const start = source.indexOf('let activation = null;');
  const end = source.indexOf("$('#c-staff-logout')", start);
  runInNewContext(source.slice(start, end) + '\nglobalThis.show = showAuth;', context);
  return { node, location, calls, show: () => context.show(), dashboard: () => dashboard, submit: () => node('#c-login-form').submit({ preventDefault() {} }) };
}
const invalid = () => Object.assign(new Error('Liên kết đã hết hạn, đã sử dụng hoặc đã được thay bằng liên kết mới.'), { status: 400 });
for (const identifier of ['client@example.test', '0901234567']) {
  test(`link cũ: chuyển đăng nhập, giữ định danh ${identifier}, xoá token và giữ query`, async () => {
    const s = setup('#email=' + encodeURIComponent(identifier) + '&token=old', path => path === '/activation-info' ? invalid() : undefined);
    await s.show();
    assert.deepEqual(s.calls, ['/activation-info']);
    assert.equal(s.node('#c-auth-title').textContent, 'Đăng nhập khách hàng');
    assert.equal(s.node('#c-email').value, identifier);
    assert.equal(s.node('#c-email').readOnly, false);
    assert.equal(new URLSearchParams(s.location.hash.slice(1)).has('token'), false);
    assert.equal(s.location.search, '?source=crm');
    assert.match(s.node('#c-auth-note').textContent, /Liên kết đặt mật khẩu này đã dùng hoặc hết hạn/);
    assert.equal(s.node('#c-password2-label').hidden, true);
  });
}
test('link mới: kiểm tra trước, đặt mật khẩu rồi tự đăng nhập dashboard', async () => {
  const s = setup('#email=client@example.test&token=' + 'a'.repeat(64));
  await s.show();
  assert.equal(s.node('#c-email').readOnly, true);
  assert.equal(s.node('#c-password2-label').hidden, false);
  s.node('#c-password').value = s.node('#c-password2').value = 'valid-password';
  await s.submit();
  assert.deepEqual(s.calls, ['/activation-info', '/activate', '/login']);
  assert.equal(s.dashboard(), true);
  assert.equal(s.location.hash, '#new');
});
test('token dùng mất sau khi mở form: activate lỗi thì chuyển đăng nhập và xoá mật khẩu', async () => {
  const s = setup('#email=0901234567&token=' + 'b'.repeat(64), path => path === '/activate' ? invalid() : undefined);
  await s.show(); s.node('#c-password').value = s.node('#c-password2').value = 'valid-password';
  await s.submit();
  assert.equal(s.node('#c-auth-title').textContent, 'Đăng nhập khách hàng');
  assert.equal(s.node('#c-password').value, '');
  assert.deepEqual(s.calls, ['/activation-info', '/activate']);
  assert.equal(s.node('#c-login-button').disabled, false);
});
test('lỗi mạng hoặc mật khẩu: giữ token để thử lại, không giả là hết hạn', async () => {
  for (const [path, status, message] of [['/activation-info', 0, 'Mạng lỗi'], ['/activation-info', 429, 'Quá nhiều lần thử'], ['/activate', 400, 'Mật khẩu không hợp lệ']] as const) {
    const s = setup('#email=client@example.test&token=' + 'c'.repeat(64), p => p === path ? Object.assign(new Error(message), { status }) : undefined);
    await s.show();
    if (path === '/activate') { s.node('#c-password').value = s.node('#c-password2').value = 'valid-password'; await s.submit(); }
    assert.match(s.location.hash, /token=/);
    assert.equal(s.node('#c-auth-title').textContent, 'Đặt mật khẩu tài khoản khách hàng');
    assert.equal(s.node('#c-auth-error').textContent, message);
    assert.equal(s.node('#c-login-button').disabled, false);
  }
});
test('không có token: đăng nhập bình thường, không gọi activation-info', async () => {
  const s = setup(''); await s.show();
  s.node('#c-email').value = 'client@example.test'; s.node('#c-password').value = 'valid-password';
  await s.submit();
  assert.deepEqual(s.calls, ['/login']); assert.equal(s.dashboard(), true);
});
