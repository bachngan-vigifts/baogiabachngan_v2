import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router, json, readJson } from '../../src/core/http/router.ts';
import { AppError, forbidden } from '../../src/core/errors.ts';

const req = (path: string, init: RequestInit = {}) => new Request(`https://x.test${path}`, init);

test('khớp route có tham số, bỏ qua dấu / cuối, giải mã tham số', async () => {
  const r = new Router().get('/quotes/:id/lines/:n', ({ params }) => json(params));
  assert.deepEqual(await (await r.handle(req('/quotes/a%20b/lines/3/'))).json(), { id: 'a b', n: '3' });
});

test('404 khi không có route; 405 kèm Allow khi sai phương thức', async () => {
  const r = new Router().get('/q', () => json({})).post('/q', () => json({}));
  assert.equal((await r.handle(req('/khong-co'))).status, 404);
  const res = await r.handle(req('/q', { method: 'DELETE' }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, POST');
});

test('ký tự đặc biệt trong pattern không bị hiểu thành regex', async () => {
  const r = new Router().get('/a.b', () => json({ ok: true }));
  assert.equal((await r.handle(req('/a.b'))).status, 200);
  assert.equal((await r.handle(req('/axb'))).status, 404);
});

test('AppError trả đúng mã và thông điệp; lỗi lạ trả 500 và không lộ chi tiết', async () => {
  const r = new Router()
    .get('/forbid', () => { throw forbidden(); })
    .get('/code', () => { throw new AppError(409, 'Trùng', 'dup'); })
    .get('/boom', () => { throw new Error('mật khẩu DB là hunter2'); });
  const orig = console.error; console.error = () => {};
  try {
    assert.equal((await r.handle(req('/forbid'))).status, 403);
    const c = await r.handle(req('/code'));
    assert.deepEqual([c.status, await c.json()], [409, { error: 'Trùng', code: 'dup' }]);
    const b = await r.handle(req('/boom'));
    assert.equal(b.status, 500);
    assert.ok(!(await b.text()).includes('hunter2'));
  } finally { console.error = orig; }
});

const post = (body: BodyInit | null, headers: Record<string, string> = { 'content-type': 'application/json' }) => new Request('https://x.test/', { method: 'POST', body, headers });

test('readJson (giữ mã lỗi & thông báo bản cũ): chỉ nhận JSON object; 415 sai kiểu, 400 hỏng/không phải object, 413 quá lớn', async () => {
  assert.deepEqual(await readJson(post('{"a":1}')), { a: 1 });
  const code = async (p: Promise<unknown>) => p.then(() => 0, (e: AppError) => `${e.status}:${e.message}`);
  assert.equal(await code(readJson(post('{"a":1}', { 'content-type': 'text/plain' }))), '415:Yêu cầu phải dùng JSON.');
  assert.equal(await code(readJson(post('{"a":1}', {}))), '415:Yêu cầu phải dùng JSON.');
  assert.equal(await code(readJson(new Request('https://x.test/', { method: 'POST', headers: { 'content-type': 'application/json' } }))), '400:Thiếu nội dung.');
  for (const bad of ['{bad', '[1,2]', '"x"', 'null', '7']) assert.equal(await code(readJson(post(bad))), '400:Nội dung không hợp lệ.', bad);
  assert.equal(await code(readJson(post('x'.repeat(200)), 100)), '413:Nội dung quá lớn.');
  assert.equal(await code(readJson(post('{"a":"' + 'x'.repeat(200) + '"}'), 100)), '413:Nội dung quá lớn.');
  // không tin Content-Length: thân thật lớn hơn khai báo vẫn bị chặn
  assert.equal(await code(readJson(post('{"a":"' + 'x'.repeat(200) + '"}', { 'content-type': 'application/json', 'content-length': '5' }), 100)), '413:Nội dung quá lớn.');
});

test('phản hồi JSON mang header an toàn như bản cũ', async () => {
  const r = json({ ok: true });
  assert.equal(r.headers.get('cache-control'), 'no-store, private');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('prefix: route chỉ khớp dưới tiền tố, ngoài tiền tố là 404', async () => {
  const r = new Router({ prefix: '/api/staff' }).get('/me', () => json({ ok: true }));
  assert.equal((await r.handle(req('/api/staff/me'))).status, 200);
  assert.equal((await r.handle(req('/me'))).status, 404);
  assert.equal((await r.handle(req('/api/staffx/me'))).status, 404);
});

test('requireMeta: route thiếu khu vực truy cập không đăng ký được; đăng ký trùng cũng bị chặn', () => {
  const r = new Router({ requireMeta: true });
  assert.throws(() => r.get('/a', () => json({})), /chưa khai báo khu vực/);
  r.get('/a', () => json({}), 'public');
  assert.throws(() => r.get('/a', () => json({}), 'public'), /hai lần/);
  assert.deepEqual(r.list().map(x => x.meta), ['public']);
});

test('authorize chạy trước handler với meta của route; từ chối thì handler không chạy; kết quả chuyền qua state', async () => {
  let ran = 0;
  const r = new Router<{ user: string }>({ authorize: ctx => { if (ctx.meta === 'private' && ctx.env.user !== 'ok') throw new AppError(401, 'Cần đăng nhập'); ctx.state.who = ctx.env.user; } });
  r.get('/open', ({ state }) => json({ who: state.who }), 'public').get('/secret', () => { ran++; return json({}); }, 'private');
  assert.equal((await r.handle(req('/secret'), { user: 'anon' })).status, 401);
  assert.equal(ran, 0);
  assert.equal((await r.handle(req('/secret'), { user: 'ok' })).status, 200);
  assert.deepEqual(await (await r.handle(req('/open'), { user: 'ok' })).json(), { who: 'ok' });
});

test('beforeAll chạy cả khi không có route (chặn sớm), và lỗi của nó trả đúng mã', async () => {
  const r = new Router({ beforeAll: () => { throw new AppError(403, 'Chặn'); } }).get('/a', () => json({}));
  assert.equal((await r.handle(req('/a'))).status, 403);
  assert.equal((await r.handle(req('/khong-co'))).status, 403);
});
