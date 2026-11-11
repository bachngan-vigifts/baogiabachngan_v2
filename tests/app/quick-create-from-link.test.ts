// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products } from '../../src/modules/catalog/schema.ts';
import { extractTaxCode, taxCodeCheckDigitOk } from '../../src/modules/customers/domain/tax-code-lookup.ts';
import { crmSku, tidyName } from '../../src/modules/catalog/domain/product-link.ts';
import { fakeWeb } from '../helpers/fake-web.ts';

async function setup() {
  const s = await createTestDb(); await seedStaff(s.d1);
  const web = fakeWeb(), router = createAppRouter(), origin = 'https://trial.test';
  const call = async (path: string, cookie = '', method = 'GET', body?: unknown) => {
    const r = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
      { db: s.db, passwordIterations: 1000, sapoOrderPush: 'off', externalFetch: web.fetcher });
    return { status: r.status, data: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (id: string) => (await call('/login', '', 'POST', { email: id + '@x.vn', password: PASSWORD })).cookie;
  return { ...s, web, call, mgr: await login('mgr'), emp: await login('emp'), ncc: await login('ncc') };
}

test('MST: lấy từ link / chữ, kiểm số kiểm tra, chi nhánh, nhiều mã, gõ cách', () => {
  for (const [input, want] of [['0101243150', '0101243150'], ['MST: 0101 243 150', '0101243150'], ['https://masothue.com/0101243150-cong-ty-co-phan-misa', '0101243150'],
    ['https://masothue.com/0101243150-001-van-phong-dai-dien', '0101243150-001'], ['https://thongtindoanhnghiep.co/0101248141', '0101248141'], ['https://x.vn/tra?mst=0302712571', '0302712571']] as const)
    assert.deepEqual(extractTaxCode(input), { taxCode: want }, input);
  assert.match((extractTaxCode('0101243151') as any).error, /sai số kiểm tra/);
  assert.match((extractTaxCode('0101243150 và 0101248141') as any).error, /nhiều mã số thuế/);
  assert.match((extractTaxCode('https://masothue.com/cong-ty-abc') as any).error, /Không thấy mã số thuế/);
  assert.match((extractTaxCode('') as any).error, /Nhập mã số thuế/);
  assert.equal(taxCodeCheckDigitOk('0100109106'), true); assert.equal(taxCodeCheckDigitOk('01001091'), false);
});

test('Tra MST: điền sẵn tên / địa chỉ; ngừng hoạt động được cảnh báo; không tìm thấy / bận / lỗi mạng báo rõ; có bộ nhớ đệm; phân quyền', async () => {
  const f = await setup();
  const ok = await f.call('/customer-tax-lookup', f.emp, 'POST', { input: 'https://masothue.com/0101243150-cong-ty-co-phan-misa' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual([ok.data.taxCode, ok.data.name, ok.data.address, ok.data.active], ['0101243150', 'CÔNG TY CỔ PHẦN MẪU', 'Số 1 Duy Tân, Cầu Giấy, Hà Nội', true]);
  assert.ok(!f.web.calls.some(c => c.startsWith('masothue.com')), 'không tải trang người dùng dán – chỉ lấy số MST');
  const before = f.web.calls.filter(c => c.startsWith('api.vietqr.io')).length;
  assert.equal((await f.call('/customer-tax-lookup', f.mgr, 'POST', { input: '0101243150' })).status, 200);
  assert.equal(f.web.calls.filter(c => c.startsWith('api.vietqr.io')).length, before, 'tra lại cùng MST dùng bộ nhớ đệm');
  const closed = await f.call('/customer-tax-lookup', f.emp, 'POST', { input: '0101248141' });
  assert.equal(closed.data.active, false); assert.match(closed.data.status, /ngừng hoạt động/);
  assert.equal((await f.call('/customer-tax-lookup', f.emp, 'POST', { input: '0302712571' })).status, 404);
  const busy = await f.call('/customer-tax-lookup', f.emp, 'POST', { input: '0100109106' }); assert.equal(busy.status, 429); assert.match(busy.data.error, /đang bận/);
  assert.equal((await f.call('/customer-tax-lookup', f.emp, 'POST', { input: '0304475742' })).status, 504);
  assert.equal((await f.call('/customer-tax-lookup', f.emp, 'POST', { input: '0101243151' })).status, 400);
  assert.equal((await f.call('/customer-tax-lookup', f.ncc, 'POST', { input: '0101243150' })).status, 403);
  assert.equal((await f.call('/customer-tax-lookup', '', 'POST', { input: '0101243150' })).status, 401);
});

test('Tra MST rồi tạo khách: vẫn bắt buộc người liên hệ; nhân viên tạo thì chờ duyệt; trùng MST bị chặn', async () => {
  const f = await setup();
  const r = (await f.call('/customer-tax-lookup', f.emp, 'POST', { input: '0101243150-001' })).data;
  const base = { name: r.name, taxCode: r.taxCode, address: r.address };
  const noContact = await f.call('/customers', f.emp, 'POST', base);
  assert.equal(noContact.status, 400); assert.match(noContact.data.error, /người liên hệ/);
  const created = await f.call('/customers', f.emp, 'POST', { ...base, contact: 'Chị Lan', phone: '0901234567' });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
  const again = await f.call('/customers', f.mgr, 'POST', { ...base, contact: 'Anh Nam', phone: '0907654321' });
  assert.ok(again.status >= 400, 'trùng MST không tạo khách thứ hai');
});

test('Tạo nhanh sản phẩm từ link: JSON-LD / Sapo / Haravan / WooCommerce / og:, cảnh báo giá & mã, báo mã đã có', async () => {
  const f = await setup();
  const ld = await f.call('/product-link-preview', f.emp, 'POST', { url: 'https://ld.example.vn/sp/binh-1.html' });
  assert.equal(ld.status, 200, JSON.stringify(ld.data));
  assert.deepEqual(ld.data.product, { name: 'Bình giữ nhiệt 500ml Shop KS-1', sku: 'KS-1', brand: 'Shop', imageUrl: 'https://ld.example.vn/pic/1.png', price: 450000, currency: 'VND', platform: 'json-ld' });
  assert.deepEqual(ld.data.warnings, []); assert.equal(ld.data.existing, null);
  const sapo = (await f.call('/product-link-preview', f.emp, 'POST', { url: 'https://sapo.example.vn/am-tra-a' })).data.product;
  assert.deepEqual([sapo.sku, sapo.price, sapo.imageUrl, sapo.platform], ['AT-A', 350000, 'https://cdn.example.vn/at.jpg', 'sapo'], 'giá gốc (trước giảm) khi có giá so sánh');
  const hrv = (await f.call('/product-link-preview', f.emp, 'POST', { url: 'https://hrv.example.vn/products/coc-b' })).data.product;
  assert.deepEqual([hrv.name, hrv.sku, hrv.price, hrv.brand, hrv.platform], ['Cốc B', 'CB-1', 120000, 'HRV', 'haravan']);
  const woo = (await f.call('/product-link-preview', f.mgr, 'POST', { url: 'https://woo.example.vn/san-pham/dia-c' })).data.product;
  assert.deepEqual([woo.name, woo.sku, woo.price, woo.platform], ['Đĩa C', 'DC-1', 99000, 'woocommerce']);
  const og = await f.call('/product-link-preview', f.mgr, 'POST', { url: 'https://og.example.vn/binh.html' });
  assert.deepEqual([og.data.product.name, og.data.product.sku, og.data.product.price], ['Bình hoa sứ', 'BH-09', null]); assert.match(og.data.warnings.join(' '), /không công khai giá/);
  const usd = await f.call('/product-link-preview', f.mgr, 'POST', { url: 'https://ld.example.vn/sp/usd.html' });
  assert.equal(usd.data.product.price, null); assert.match(usd.data.warnings.join(' '), /USD/);
  await f.db.insert(products).values({ sku: 'DUP-1', name: 'Sản phẩm cũ', updatedAt: new Date().toISOString() });
  const dup = await f.call('/product-link-preview', f.mgr, 'POST', { url: 'https://ld.example.vn/sp/dup.html' });
  assert.deepEqual([dup.data.existing.sku, dup.data.existing.name], ['DUP-1', 'Sản phẩm cũ']);
  assert.equal((await f.call('/product-link-preview', f.mgr, 'POST', { url: 'https://og.example.vn/empty.html' })).status, 422);
  // Chỉ đọc: chưa có sản phẩm nào được tạo từ link.
  assert.equal((await f.db.select().from(products)).length, 1);
});

test('Link ngoài an toàn: chặn http / IP / localhost / tên miền trỏ IP nội bộ / chuyển hướng vào nội bộ; báo chặn bot, quá lớn; quyền', async () => {
  const f = await setup();
  for (const url of ['http://ld.example.vn/sp/binh-1.html', 'https://127.0.0.1/a', 'https://10.0.0.1/a', 'https://localhost/a', 'https://user:pw@ld.example.vn/a', 'https://ld.example.vn:8443/a', 'https://private.example.vn/a', 'https://redir.example.vn/x.html', 'notaurl'])
    assert.equal((await f.call('/product-link-preview', f.mgr, 'POST', { url })).status, 400, url);
  assert.ok(!f.web.calls.some(c => c.startsWith('private.example.vn')), 'không bao giờ kết nối tới địa chỉ nội bộ');
  const bot = await f.call('/product-link-preview', f.mgr, 'POST', { url: 'https://bot.example.vn/x.html' }); assert.equal(bot.status, 502); assert.match(bot.data.error, /chống bot/);
  assert.equal((await f.call('/product-link-preview', f.mgr, 'POST', { url: 'https://big.example.vn/x.html' })).status, 413);
  assert.equal((await f.call('/product-link-preview', f.ncc, 'POST', { url: 'https://ld.example.vn/sp/binh-1.html' })).status, 403);
  const img = await f.call('/product-link-image', f.mgr, 'POST', { url: 'https://img.example.vn/ok.png' });
  assert.equal(img.status, 200); assert.match(img.data.dataUrl, /^data:image\/png;base64,/);
  assert.equal((await f.call('/product-link-image', f.mgr, 'POST', { url: 'https://img.example.vn/fake.png' })).status, 415);
  assert.equal((await f.call('/product-link-image', f.mgr, 'POST', { url: 'https://private.example.vn/a.png' })).status, 400);
});

test('Chuẩn hoá: tên VIẾT HOA, mã SKU theo luật CRM', () => {
  assert.equal(tidyName('BÌNH GIỮ NHIỆT 600ML SUNHOUSE KS-TU600RE', 'Sunhouse'), 'Bình giữ nhiệt 600ml Sunhouse KS-TU600RE');
  assert.equal(tidyName('Ấm trà Minh Long'), 'Ấm trà Minh Long');
  assert.equal(crmSku(' KS-TU600RE '), 'KS-TU600RE'); assert.equal(crmSku('MÃ#12?'), 'M12'); assert.equal(crmSku('—'), '');
});
