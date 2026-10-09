import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { memoryFileStore } from '../../src/core/storage/file-store.ts';
import { products } from '../../src/modules/catalog/schema.ts';
import { resetLegacySession } from '../../src/modules/integrations/api/legacy-site.ts';
import { eq } from 'drizzle-orm';

const origin = 'https://trial.test', BASE = 'https://baogia.minhlongonline.com';
const K1 = 'a'.repeat(64), K2 = 'b'.repeat(64), GONE = 'c'.repeat(64);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
const media = (k: string) => `${BASE}/api/staff/media-file?key=${k}`;

/** Web cũ giả: ảnh chỉ trả khi có cookie phiên; đăng nhập cần Origin của chính web cũ. */
function fakeLegacy() {
  const log = { logins: 0, gets: 0 };
  let valid = 'sess-1';
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), h = new Headers(init?.headers);
    if (url === `${BASE}/api/staff/login`) {
      log.logins++;
      const b = JSON.parse(String(init?.body));
      if (h.get('origin') !== BASE || b.email !== 'kho-anh@x.vn' || b.password !== 'dung') return new Response('{"error":"sai"}', { status: 401 });
      valid = 'sess-' + log.logins;
      return new Response('{}', { headers: { 'set-cookie': `__Host-bn-session=${valid}; Path=/; Secure; HttpOnly; SameSite=Strict` } });
    }
    log.gets++;
    if (h.get('cookie') !== `__Host-bn-session=${valid}`) return new Response('{"error":"Vui lòng đăng nhập bằng email công ty."}', { status: 401 });
    if (url === media(K1)) return new Response(JPG, { headers: { 'content-type': 'image/jpeg' } });
    if (url === media(K2)) return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;
  return { f, log, expire: () => { valid = 'het-han'; } };
}

async function setup(legacyPassword = 'dung') {
  resetLegacySession();
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const fake = fakeLegacy(), productImages = memoryFileStore(), router = createAppRouter();
  const env = { db, passwordIterations: 1000, productImages, legacySite: { base: BASE, email: 'kho-anh@x.vn', password: legacyPassword, fetch: fake.f } };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const now = '2026-10-01T00:00:00.000Z';
  await db.insert(products).values([
    { sku: 'A1', name: 'Ly A1', unit: 'cái', imageUrl: media(K1), updatedAt: now }, { sku: 'A2', name: 'Ly A2 (chung ảnh A1)', unit: 'cái', imageUrl: media(K1), updatedAt: now },
    { sku: 'B1', name: 'Dĩa B1', unit: 'cái', imageUrl: media(K2), updatedAt: now }, { sku: 'C1', name: 'Mất ảnh', unit: 'cái', imageUrl: media(GONE), updatedAt: now },
    { sku: 'S1', name: 'Ảnh Sapo', unit: 'cái', imageUrl: 'https://sapo.dktcdn.net/100/a.jpg', updatedAt: now },
  ]);
  return { db, call, fake, env, productImages, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}

test('ảnh web cũ (cần đăng nhập): /images/fetch tải bằng phiên web cũ, hết phiên tự đăng nhập lại', async () => {
  const { call, fake, emp } = await setup();
  const r = await call('/images/fetch', emp, 'POST', { url: media(K1) });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.dataUrl, 'data:image/jpeg;base64,' + Buffer.from(JPG).toString('base64'));
  await call('/images/fetch', emp, 'POST', { url: media(K2) });
  assert.equal(fake.log.logins, 1, 'giữ phiên, không đăng nhập lại mỗi ảnh');
  fake.expire();
  assert.equal((await call('/images/fetch', emp, 'POST', { url: media(K1) })).status, 200, 'phiên hết hạn → đăng nhập lại');
  assert.equal(fake.log.logins, 2);
  assert.equal((await call('/images/fetch', emp, 'POST', { url: media(GONE) })).status, 404);
});

test('chuyển ảnh web cũ sang kho mới: theo đợt, dùng chung file, ảnh lỗi giữ link cũ, chỉ Manager', async () => {
  const { db, call, productImages, emp, mgr } = await setup();
  assert.equal((await call('/catalog/legacy-images', emp)).status, 403);
  assert.deepEqual((await call('/catalog/legacy-images', mgr)).data, { remaining: 4, configured: true });
  assert.equal((await call('/catalog/legacy-images/migrate', emp, 'POST', {})).status, 403);

  const r1 = (await call('/catalog/legacy-images/migrate', mgr, 'POST', { limit: 2 })).data;
  assert.deepEqual([r1.migrated, r1.failed, r1.next, r1.finished, r1.remaining], [2, [], 'A2', false, 2]);
  const r2 = (await call('/catalog/legacy-images/migrate', mgr, 'POST', { limit: 2, after: r1.next })).data;
  assert.deepEqual([r2.migrated, r2.failed.map((f: any) => f.sku), r2.next, r2.remaining], [1, ['C1'], 'C1', 1]);
  const r3 = (await call('/catalog/legacy-images/migrate', mgr, 'POST', { limit: 2, after: r2.next })).data;
  assert.deepEqual([r3.migrated, r3.finished], [0, true]);

  const url = async (sku: string) => (await db.select({ u: products.imageUrl }).from(products).where(eq(products.sku, sku)))[0]!.u;
  assert.equal(await url('A1'), `https://files.test/public/legacy/${K1}.jpg`);
  assert.equal(await url('A2'), await url('A1'), 'hai mã chung ảnh dùng chung một file');
  assert.equal(await url('B1'), `https://files.test/public/legacy/${K2}.png`);
  assert.equal(await url('C1'), media(GONE), 'ảnh lỗi giữ link cũ');
  assert.equal(await url('S1'), 'https://sapo.dktcdn.net/100/a.jpg', 'ảnh không thuộc web cũ không đụng tới');
  assert.deepEqual([...productImages.files.keys()].sort(), [`legacy/${K1}.jpg`, `legacy/${K2}.png`]);
  assert.deepEqual(productImages.files.get(`legacy/${K1}.jpg`)!.bytes, JPG);
});

test('sai tài khoản web cũ: dừng ngay, báo rõ cần sửa secret, không đổi link nào', async () => {
  const { call, mgr } = await setup('sai');
  const r = await call('/catalog/legacy-images/migrate', mgr, 'POST', {});
  assert.equal(r.status, 502); assert.match(r.data.error, /LEGACY_STAFF_EMAIL/);
  assert.equal((await call('/catalog/legacy-images', mgr)).data.remaining, 4);
});

test('nhiều ảnh tải song song dùng chung phiên web cũ, hết hạn chỉ đăng nhập lại một lần', async () => {
  const { call, fake, emp } = await setup();
  const batch = () => Promise.all([K1, K2, K1, K2, K1, K2].map(key =>
    call('/images/fetch', emp, 'POST', { url: media(key) })));
  const first = await batch();
  assert.ok(first.every(r => r.status === 200), JSON.stringify(first.map(r => r.data)));
  assert.equal(fake.log.logins, 1, 'không đăng nhập cạnh tranh từng ảnh');
  fake.expire();
  const again = await batch();
  assert.ok(again.every(r => r.status === 200), JSON.stringify(again.map(r => r.data)));
  assert.equal(fake.log.logins, 2, 'sáu yêu cầu cùng hết phiên chỉ làm mới một lần');
});

test('429 mid-batch returns progress and retries the blocked product without skipping it', async () => {
  const { call, fake, env, mgr } = await setup();
  let blocked = false;
  env.legacySite.fetch = (async (input, init) => {
    if (String(input) === media(K2) && !blocked) {
      blocked = true; fake.expire();
      return new Response('', { status: 401 });
    }
    if (String(input).endsWith('/login') && blocked) return new Response('', { status: 429, headers: { 'retry-after': '120' } });
    return fake.f(input, init);
  }) as typeof fetch;
  const r = await call('/catalog/legacy-images/migrate', mgr, 'POST', { limit: 3 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.migrated, r.data.next, r.data.remaining, r.data.paused, r.data.retryAfter], [2, 'A2', 2, true, 120]);
  env.legacySite.fetch = fake.f;
  const resumed = await call('/catalog/legacy-images/migrate', mgr, 'POST', { limit: 2, after: r.data.next, legacySession: r.data.legacySession });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.migrated, 1, 'B1 is retried after cooldown');
  assert.deepEqual(resumed.data.failed.map((x: any) => x.sku), ['C1']);
  assert.equal(resumed.data.remaining, 1);
});
