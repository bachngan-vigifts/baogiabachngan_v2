import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sapoClient } from '../../src/modules/integrations/api/sapo-client.ts';

function fixture(authValid = true, apiValid = true) {
  const seen: { path: string; method: string; cookie: string }[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const cookie = String((init?.headers as Record<string, string>).cookie);
    seen.push({ path, cookie, method: init?.method || 'GET' });
    if (path === '/admin') {
      assert.doesNotMatch(cookie, /_admin_session_id=|\.AspNetCore\.Session=/, 'không dùng phiên API cũ để khôi phục');
      if (!authValid) return new Response('', { status: 302, headers: { location: '/admin/login' } });
      const headers = new Headers(); headers.append('set-cookie', '_admin_session_id=new; path=/');
      headers.append('set-cookie', '.AspNetCore.Session=fresh; path=/');
      return new Response('<html>OK</html>', { headers });
    }
    return apiValid && cookie.includes('_admin_session_id=new') ? Response.json({ accounts: [{ id: 1 }] }) : new Response('', { status: 401 });
  }) as typeof fetch;
  const client = sapoClient({ cookie: 'lang=vi; sapo-admin=valid; _admin_session_id=old; .AspNetCore.Session=old', fetch: fake });
  return { seen, client };
}
test('phiên API Sapo cũ: phục hồi từ cookie đăng nhập còn hiệu lực, GET thử lại một lần', async () => {
  const s = fixture(); assert.equal((await s.client.get('/accounts.json')).accounts[0].id, 1);
  assert.deepEqual(s.seen.map(x => x.path), ['/admin/accounts.json', '/admin', '/admin/accounts.json']);
  assert.equal(s.client.refreshed(), true);
  assert.match(s.client.cookie(), /_admin_session_id=new/);
  assert.match(s.client.cookie(), /\.AspNetCore.Session=fresh/);
});
test('cookie đăng nhập cũng hết hạn: dừng sau một lần phục hồi, trả lỗi yêu cầu kết nối lại', async () => {
  const s = fixture(false);
  await assert.rejects(s.client.get('/accounts.json'), (e: any) => e.code === 'SAPO_SESSION_EXPIRED');
  assert.deepEqual(s.seen.map(x => x.path), ['/admin/accounts.json', '/admin']);
  assert.equal(s.client.refreshed(), false);
});
test('Sapo cấp cookie mới nhưng vẫn từ chối API: không lặp phục hồi', async () => {
  const s = fixture(true, false);
  await assert.rejects(s.client.get('/accounts.json'), (e: any) => e.code === 'SAPO_SESSION_EXPIRED');
  assert.equal(s.seen.length, 3);
  assert.equal(s.client.refreshed(), false, 'không lưu phiên chưa kiểm chứng');
});
test('POST tạo đơn bị 401: không tự phục hồi rồi gửi lại POST', async () => {
  const s = fixture();
  await assert.rejects(s.client.send('POST', '/orders.json', { order: {} }), (e: any) => e.code === 'SAPO_SESSION_EXPIRED');
  assert.deepEqual(s.seen.map(x => x.method), ['POST']);
});


test('POST nhận 401 kèm cookie mới: vẫn không gửi lại lệnh tạo đơn', async () => {
  let calls = 0;
  const client = sapoClient({ cookie: 'sapo-admin=valid; _admin_session_id=old', fetch: (async () => {
    calls++; return new Response('', { status: 401, headers: { 'set-cookie': '_admin_session_id=new; path=/' } });
  }) as typeof fetch });
  await assert.rejects(client.send('POST', '/orders.json', { order: {} }), (e: any) => e.code === 'SAPO_SESSION_EXPIRED');
  assert.equal(calls, 1);
});
