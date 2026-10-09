import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { publicImageUrl } from '../../src/modules/quotes/api/image-fetch.ts';

const origin = 'https://trial.test';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

test('link ảnh: chỉ https tới tên miền công khai', () => {
  assert.ok(publicImageUrl('https://sapo.dktcdn.net/100/a.jpg'));
  assert.ok(publicImageUrl('http://sapo.dktcdn.net/a.jpg'), 'http cũng được (máy chủ tải, không bị chặn mixed content)');
  for (const bad of ['ftp://sapo.dktcdn.net/a.jpg', 'https://127.0.0.1/a.png', 'https://[::1]/a.png', 'https://localhost/a.png', 'https://intranet/a.png',
    'https://printer.local/a.png', 'https://u:p@x.vn/a.png', 'https://x.vn:8443/a.png', 'file:///etc/passwd', 'không phải link']) assert.equal(publicImageUrl(bad), null, bad);
});

test('máy chủ tải hộ ảnh báo giá cho PDF / Excel (ảnh ngoài không bật CORS)', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), seen: string[] = [];
  const imageFetch = (async (input: string | URL | Request) => {
    const url = String(input); seen.push(url);
    if (url.endsWith('/redirect')) return new Response(null, { status: 302, headers: { location: '/img.png' } });
    if (url.endsWith('/to-local')) return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/x.png' } });
    if (url.endsWith('/page')) return new Response('<html>', { headers: { 'content-type': 'text/html' } });
    if (url.endsWith('/big.png')) return new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } });
    // CDN trả Content-Type sai: nhận theo nội dung file.
    if (url.endsWith('/sai-loai.jpg')) return new Response(JPG, { headers: { 'content-type': 'application/octet-stream' } });
    if (url.endsWith('/img.png')) return new Response(PNG, { headers: { 'content-type': 'image/png; charset=binary' } });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const call = async (body: object, cookie = '') => {
    const res = await router.handle(new Request(origin + '/api/staff/images/fetch', { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }), { db, imageFetch, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const emp = (await (async () => {
    const res = await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'emp@x.vn', password: PASSWORD }) }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return res.headers.get('set-cookie')?.split(';')[0] ?? '';
  })());

  assert.equal((await call({ url: 'https://cdn.example.vn/img.png' })).status, 401, 'phải đăng nhập');
  const ok = await call({ url: 'https://cdn.example.vn/img.png' }, emp);
  assert.equal(ok.status, 200); assert.equal(ok.data.dataUrl, 'data:image/png;base64,' + Buffer.from(PNG).toString('base64'));
  assert.equal((await call({ url: 'https://cdn.example.vn/redirect' }, emp)).data.dataUrl.slice(0, 22), 'data:image/png;base64,', 'theo chuyển hướng');
  assert.equal((await call({ url: 'https://cdn.example.vn/to-local' }, emp)).status, 502, 'không theo chuyển hướng vào IP nội bộ');
  assert.ok(!seen.some(u => u.includes('127.0.0.1')));
  assert.equal((await call({ url: 'https://cdn.example.vn/page' }, emp)).status, 415, 'không phải ảnh');
  assert.equal((await call({ url: 'https://cdn.example.vn/big.png' }, emp)).status, 413, 'quá 5 MB');
  assert.equal((await call({ url: 'https://cdn.example.vn/missing.png' }, emp)).status, 502);
  assert.equal((await call({ url: 'https://cdn.example.vn/sai-loai.jpg' }, emp)).data.dataUrl, 'data:image/jpeg;base64,' + Buffer.from(JPG).toString('base64'), 'nhận theo nội dung file');
  assert.equal((await call({ url: 'http://cdn.example.vn/img.png' }, emp)).status, 200, 'link http');
  assert.equal((await call({ url: 'ftp://cdn.example.vn/img.png' }, emp)).status, 400);
});
