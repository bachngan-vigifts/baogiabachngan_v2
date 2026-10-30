import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
// Module trình duyệt (JS thuần) – nạp qua URL để TypeScript không đòi khai báo kiểu.
const { createCustomerSearch, matchesCustomer, fold }: any = await import(new URL('../../trial-ui/customer-search.js', import.meta.url).href);
import { fold as serverFold } from '../../src/core/text/fold.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => (await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), env)).headers.get('set-cookie')!.split(';')[0]!;
  return { call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}

test('ô chọn khách: tìm nhanh không dấu, theo SĐT viết liền / có dấu cách, chỉ khách đã duyệt, không đếm tổng', async () => {
  const { call, emp, mgr } = await setup();
  for (const [name, phone] of [['Công ty Hoa Mai', '0901 234 567'], ['Cửa hàng Đồng Tiến', '0283 111 222'], ['Hoa Sen Group', '']])
    assert.equal((await call('/customers', mgr, 'POST', { name, phone })).status, 201);
  assert.equal((await call('/customers', emp, 'POST', { name: 'Hoa Chờ Duyệt' })).status, 201);
  const pick = async (q: string) => (await call('/customers?limit=8&usable=1&q=' + encodeURIComponent(q), emp)).data;
  const hoa = await pick('hoa');
  assert.equal(hoa.picker, true, 'đi đường tìm nhanh');
  assert.deepEqual(hoa.customers.map((c: any) => c.name).sort(), ['Công ty Hoa Mai', 'Hoa Sen Group'], 'không có khách chờ duyệt');
  assert.equal(hoa.customers[0].search, undefined, 'không trả cột nội bộ');
  assert.deepEqual((await pick('dong tien')).customers.map((c: any) => c.name), ['Cửa hàng Đồng Tiến'], 'không dấu, nhiều từ');
  assert.deepEqual((await pick('0901234567')).customers.map((c: any) => c.name), ['Công ty Hoa Mai'], 'SĐT viết liền khớp SĐT có dấu cách');
  assert.equal((await pick('khong-co-ai')).customers.length, 0);
  const page = (await call('/customers?limit=8&usable=1&q=hoa&offset=8', emp)).data;
  assert.equal(page.picker, undefined, 'phân trang dùng đường đầy đủ');
});

test('bộ tìm khách trên máy: nhớ kết quả, lọc ngay khi gõ thêm nếu kết quả trước đã đủ, cùng cách bỏ dấu với máy chủ', async () => {
  for (const s of ['Đồng Tiến', 'CÔNG TY TNHH Hòa Bình', 'Ưu đãi  Lý']) assert.equal(fold(s), serverFold(s));
  const calls: string[] = [];
  const all = [{ name: 'Công ty Hoa Mai', phone: '0901 234 567' }, { name: 'Hoa Sen Group' }];
  const api = async (path: string) => { calls.push(path); const q = decodeURIComponent(path.split('q=')[1] ?? ''); return { customers: all.filter(c => matchesCustomer(c, q)) }; };
  const s = createCustomerSearch({ api, limit: 8 });
  assert.equal(s.local('ho'), null, 'chưa có gì: phải hỏi máy chủ');
  assert.equal((await s.remote('ho')).length, 2);
  assert.deepEqual(s.local('hoa').map((c: any) => c.name), ['Công ty Hoa Mai', 'Hoa Sen Group'], 'gõ thêm: lọc trên máy');
  assert.deepEqual(s.local('hoa mai').map((c: any) => c.name), ['Công ty Hoa Mai']);
  assert.deepEqual(s.local('hoa 0901234567').map((c: any) => c.name), ['Công ty Hoa Mai'], 'SĐT viết liền');
  assert.deepEqual(s.local('Hoà Mai').map((c: any) => c.name), ['Công ty Hoa Mai'], 'có dấu');
  assert.equal(s.local('mai'), null, 'không phải gõ thêm từ từ khoá cũ: hỏi máy chủ');
  assert.equal(calls.length, 1);
  // Kết quả chưa đủ (bằng giới hạn): không suy ra được, phải hỏi máy chủ.
  const many = createCustomerSearch({ api: async () => ({ customers: Array.from({ length: 8 }, (_, i) => ({ name: 'Hoa ' + i })) }), limit: 8 });
  await many.remote('ho'); assert.equal(many.local('hoa'), null); assert.equal(many.local('ho').length, 8, 'đúng từ khoá thì dùng lại');
  // Hết hạn và xoá sau lệnh ghi.
  let t = 0; const timed = createCustomerSearch({ api, now: () => t, ttl: 1000 });
  await timed.remote('hoa'); t = 2000; assert.equal(timed.local('hoa'), null);
  await timed.remote('hoa'); timed.clear(); assert.equal(timed.local('hoa'), null);
});
