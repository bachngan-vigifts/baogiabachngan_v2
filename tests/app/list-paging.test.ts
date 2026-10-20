import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
// @ts-ignore JS giao diện, chạy bằng Node như các kiểm thử UI khác.
import { pageItems } from '../../trial-ui/pager.js';

/**
 * PHÂN TRANG SỐ (thay nút "Xem thêm"): báo giá, đơn hàng, HĐKT lọc + phân trang trên máy chủ, trả `total`
 * để giao diện hiện "Từ a đến b trên tổng N · ‹ 1 2 3 … ›". Phạm vi xem giữ nguyên.
 */
const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}
const quote = (quoteNo: string, customer: string, price: number, type = 'B2B', date = '2026-10-09') =>
  ({ type, quoteNo, customer, vat: 0, date, rows: [{ name: 'Bộ trà', qty: 1, price }] });

test('ô số trang: ít trang hiện hết; nhiều trang rút gọn bằng "…" quanh trang đang xem', () => {
  assert.deepEqual(pageItems(1, 1), [1]);
  assert.deepEqual(pageItems(3, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pageItems(1, 455), [1, 2, 3, 4, 5, null, 455]);
  assert.deepEqual(pageItems(200, 455), [1, null, 199, 200, 201, null, 455]);
  assert.deepEqual(pageItems(454, 455), [1, null, 451, 452, 453, 454, 455]);
});

test('báo giá: phân trang + lọc + sắp xếp trên máy chủ, kèm tổng / giá trị / tháng; nhân viên chỉ đếm báo giá mình xem được', async () => {
  const { call, emp, mgr } = await setup();
  for (let i = 1; i <= 5; i++) assert.equal((await call('/quotes', mgr, 'POST', quote(`B2B_BG20261009_00${i}`, `Công ty Đông ${i}`, i * 100000))).status, 201);
  assert.equal((await call('/quotes', mgr, 'POST', quote('HRC_BG20260901_001', 'Công ty Tây', 900000, 'HRC', '2026-09-01'))).status, 201);
  assert.equal((await call('/quotes', emp, 'POST', quote('B2B_BG20261009_006', 'Công ty Đông 1', 50000))).status, 201);

  const page1 = (await call('/quotes?limit=3&offset=0&month=2026-10', mgr)).data;
  assert.equal(page1.quotes.length, 3); assert.equal(page1.total, 7); assert.equal(page1.all, 7);
  assert.equal(page1.value, 1500000 + 900000 + 50000, 'giá trị cộng mọi báo giá khớp lọc, không chỉ trang đang xem');
  assert.deepEqual(page1.month, { month: '2026-10', count: 6, value: 1550000 });
  assert.equal(page1.hasOthers, true);
  const page3 = (await call('/quotes?limit=3&offset=6', mgr)).data;
  assert.equal(page3.quotes.length, 1, 'trang cuối');
  const allIds = new Set([...page1.quotes, ...(await call('/quotes?limit=3&offset=3', mgr)).data.quotes, ...page3.quotes].map((q: any) => q.id));
  assert.equal(allIds.size, 7, 'các trang không trùng, không sót');

  // Sắp xếp theo giá trị, lọc loại, tìm không dấu, lọc người tạo.
  assert.deepEqual((await call('/quotes?sort=value&limit=2', mgr)).data.quotes.map((q: any) => q.total), [900000, 500000]);
  assert.deepEqual((await call('/quotes?sort=value&limit=2&offset=2', mgr)).data.quotes.map((q: any) => q.total), [400000, 300000]);
  assert.deepEqual((await call('/quotes?sort=no&limit=1', mgr)).data.quotes.map((q: any) => q.quoteNo), ['B2B_BG20261009_001']);
  const hrc = (await call('/quotes?type=HRC', mgr)).data; assert.deepEqual([hrc.total, hrc.all], [1, 7]);
  assert.equal((await call('/quotes?q=dong%205', mgr)).data.total, 1);
  assert.equal((await call('/quotes?owner=mine', mgr)).data.total, 6);
  assert.equal((await call('/quotes?owner=others', mgr)).data.total, 1);

  // Nhân viên: chỉ báo giá của mình – tổng, giá trị, tháng đều trong phạm vi.
  const e = (await call('/quotes?month=2026-10', emp)).data;
  assert.deepEqual([e.total, e.all, e.value, e.month.count, e.hasOthers], [1, 1, 50000, 1, false]);
  // Đếm báo giá theo khách (cột "Báo giá" ở danh bạ): theo phạm vi người xem, so tên không dấu.
  assert.deepEqual((await call('/quotes/customer-counts?name=C%C3%B4ng%20ty%20%C4%90%C3%B4ng%201&name=C%C3%B4ng%20ty%20T%C3%A2y', mgr)).data.counts, { 'Công ty Đông 1': 2, 'Công ty Tây': 1 });
  assert.deepEqual((await call('/quotes/customer-counts?name=cong%20ty%20dong%201&name=C%C3%B4ng%20ty%20T%C3%A2y', emp)).data.counts, { 'cong ty dong 1': 1, 'Công ty Tây': 0 });
});

test('đơn hàng / HĐKT: phân trang trên máy chủ, trả tổng số', async () => {
  const { call, mgr } = await setup();
  const orders: string[] = [];
  // Dùng tên riêng bằng chữ: từ khóa số có thể khớp ngày trong số đơn tự sinh.
  const customerNames = ['Khách Sen', 'Khách Trúc', 'Khách Đào', 'Khách Lan'];
  for (let i = 1; i <= 4; i++) {
    const q = await call('/quotes', mgr, 'POST', { ...quote(`B2B_BG20261009_00${i}`, customerNames[i - 1]!, 100000), customerTaxCode: `010123456${i}` });
    // Báo giá 1 → HĐKT (luồng riêng), còn lại → đơn hàng.
    const o = i === 1 ? await call('/contracts', mgr, 'POST', { quoteId: q.data.id, legalEntity: 'BN', depositRate: 30, paymentDays: 15, signedDate: '2026-10-09' })
      : await call('/orders', mgr, 'POST', { quoteId: q.data.id });
    assert.equal(o.status, 201, JSON.stringify(o.data)); orders.push(o.data.orderId ?? o.data.id);
  }

  const p1 = (await call('/orders?flow=order&limit=2&offset=0', mgr)).data, p2 = (await call('/orders?flow=order&limit=2&offset=2', mgr)).data;
  assert.deepEqual([p1.total, p1.orders.length, p2.orders.length], [3, 2, 1], 'đơn có HĐKT không nằm ở trang Đơn hàng');
  assert.equal(new Set([...p1.orders, ...p2.orders].map((o: any) => o.id)).size, 3);
  assert.equal((await call('/orders?flow=order&q=khach%20dao', mgr)).data.total, 1);
  assert.equal((await call('/orders?flow=order&source=crm', mgr)).data.total, 3);
  assert.equal((await call('/orders?flow=order&source=pos', mgr)).data.total, 0);
  assert.equal((await call('/orders?flow=order&branch=crm', mgr)).data.total, 3);
  assert.equal((await call('/orders?flow=order&status=draft', mgr)).data.total, 3);
  assert.equal((await call('/orders?flow=order&status=unsubmitted', mgr)).data.total, 0);
  assert.equal((await call('/orders?flow=order&from=2026-01-01&to=2027-01-01', mgr)).data.total, 3);
  assert.equal((await call('/orders?flow=order&from=2027-01-02&to=2026-01-01', mgr)).status, 400);
  assert.ok(p1.filterOptions.owners.some((x: any) => x.name === 'Tên mgr'));
  assert.ok(p1.filterOptions.branches.some((x: any) => x.id === 'crm' && x.name === 'VIGIFTS / CRM'));
  assert.equal(p1.orders.every((x: any) => x.orderSource === 'crm' && x.ownerName === 'Tên mgr' && x.branchName === 'VIGIFTS / CRM'), true);
  const k = (await call('/contracts?limit=1', mgr)).data;
  assert.deepEqual([k.total, k.contracts.length], [1, 1]);
  assert.equal((await call('/contracts?limit=1&offset=1', mgr)).data.contracts.length, 0);
});
