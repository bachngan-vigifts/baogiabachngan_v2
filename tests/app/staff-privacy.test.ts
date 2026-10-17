import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { keepCosts, withoutCosts } from '../../src/modules/quotes/domain/cost-privacy.ts';

/**
 * QUYỀN RIÊNG TƯ NỘI BỘ:
 *  - chỉ nhân viên phụ trách khách (hoặc Manager) sửa được thông tin khách / người liên hệ;
 *  - giá vốn (giá nhập, CK mua vào, chi phí in gia công, CK khách) chỉ Manager thấy, nhân viên lưu báo giá không làm mất / đổi giá vốn;
 *  - kho không xem được danh bạ khách hàng.
 */
const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('kho','kho@x.vn','Thủ kho','0900','employee','warehouse',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('emp2','emp2@x.vn','Sale 2','0900','employee','sale',1,'2026-01-01T00:00:00.000Z')").run();
  for (const id of ['kho', 'emp2']) await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run(id, await hashPassword(PASSWORD, 1000));
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { call, emp: await login('emp@x.vn'), emp2: await login('emp2@x.vn'), mgr: await login('mgr@x.vn'), kho: await login('kho@x.vn') };
}

test('khách hàng: chỉ người phụ trách hoặc Manager sửa thông tin / người liên hệ', async () => {
  const { call, emp, emp2, mgr } = await setup();
  const id = (await call('/customers', emp, 'POST', { name: 'Công ty Mẫu' })).data.id as string;
  // emp2 được chia sẻ (xem được) nhưng không phụ trách → không sửa được.
  assert.equal((await call(`/customers/${id}/staff`, mgr, 'PUT', { sharedIds: ['emp2'] })).status, 200);
  assert.equal((await call(`/customers/${id}`, emp2)).data.access.canEdit, false);
  assert.equal((await call(`/customers/${id}`, emp2, 'PUT', { name: 'Đổi tên' })).status, 403);
  assert.equal((await call(`/customers/${id}/contacts`, emp2, 'POST', { name: 'Anh A' })).status, 403);

  assert.equal((await call(`/customers/${id}`, emp)).data.access.canEdit, true);
  assert.equal((await call(`/customers/${id}`, emp, 'PUT', { name: 'Công ty Mẫu 2' })).status, 200);
  const contact = await call(`/customers/${id}/contacts`, emp, 'POST', { name: 'Anh A' });
  assert.equal(contact.status, 201, JSON.stringify(contact.data));
  const contactId = contact.data.id;
  assert.equal((await call(`/customers/${id}/contacts/${contactId}`, emp2, 'PUT', { name: 'Anh B' })).status, 403);
  assert.equal((await call(`/customers/${id}/contacts/${contactId}`, emp2, 'DELETE')).status, 403);
  assert.equal((await call(`/customers/${id}`, mgr, 'PUT', { name: 'Công ty Mẫu 3' })).status, 200);
  assert.equal((await call(`/customers/${id}/contacts/${contactId}`, mgr, 'DELETE')).status, 200);
});

test('kho không xem được danh bạ khách hàng', async () => {
  const { call, mgr, kho } = await setup();
  const id = (await call('/customers', mgr, 'POST', { name: 'Công ty Mẫu' })).data.id as string;
  assert.equal((await call('/customers', kho)).status, 403);
  assert.equal((await call(`/customers/${id}`, kho)).status, 403);
  assert.equal((await call('/customers', mgr)).status, 200);
});

test('giá vốn: hàm thuần bỏ / giữ giá vốn theo id dòng', () => {
  const old = { printing: { total: 5 }, rows: [{ id: 'a', name: 'A', costPrice: 10, purchaseDiscount: 20, commission: { mode: 'amount', value: 1 } }] };
  assert.deepEqual(withoutCosts(old), { rows: [{ id: 'a', name: 'A' }] });
  const next = keepCosts({ printing: { total: 99 }, rows: [{ id: 'a', name: 'A2', costPrice: 1 }, { id: 'b', name: 'B', costPrice: 7 }] }, old);
  assert.deepEqual(next, { printing: { total: 5 }, rows: [{ id: 'a', name: 'A2', costPrice: 10, purchaseDiscount: 20, commission: { mode: 'amount', value: 1 } }, { id: 'b', name: 'B' }] });
});

test('giá vốn: nhân viên không thấy, lưu lại không mất; Manager thấy đủ', async () => {
  const { call, emp, mgr } = await setup();
  const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: 'B2B_GV1', customer: 'Khách', vat: 8, rows: [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 10, price: 100000, costPrice: 1, purchaseDiscount: 50 }] });
  assert.equal(q.status, 201);
  assert.equal((await call(`/quotes/${q.data.id}`, mgr)).data.data.rows[0].costPrice, undefined, 'nhân viên không tự đặt giá vốn');
  // Manager nhập giá vốn.
  const mq = (await call(`/quotes/${q.data.id}`, mgr)).data;
  mq.data.rows[0] = { ...mq.data.rows[0], costPrice: 60000, purchaseDiscount: 40, commission: { mode: 'amount', value: 2000 } };
  const ms = await call(`/quotes/${q.data.id}`, mgr, 'PUT', { revision: mq.revision, data: mq.data });
  assert.equal(ms.status, 200, JSON.stringify(ms.data));
  assert.equal(ms.data.data.rows[0].costPrice, 60000);

  const eq = (await call(`/quotes/${q.data.id}`, emp)).data;
  const row = eq.data.rows[0];
  for (const k of ['costPrice', 'purchaseDiscount', 'printing', 'commission']) assert.equal(row[k], undefined, k);
  // Nhân viên sửa số lượng + thêm dòng, cố gửi giá vốn → giá vốn dòng cũ giữ nguyên, dòng mới không có.
  eq.data.rows[0] = { ...row, qty: 20, costPrice: 1 };
  eq.data.rows.push({ id: 'moi', name: 'Hộp', sku: 'HOP', unit: 'cái', qty: 1, price: 5000, costPrice: 4000 });
  const es = await call(`/quotes/${q.data.id}`, emp, 'PUT', { revision: eq.revision, data: eq.data });
  assert.equal(es.status, 200, JSON.stringify(es.data));
  assert.equal(es.data.data.rows[0].costPrice, undefined, 'phản hồi cho nhân viên cũng không có giá vốn');
  const after = (await call(`/quotes/${q.data.id}`, mgr)).data.data.rows;
  assert.deepEqual(after.map((r: any) => [r.qty, r.costPrice, r.purchaseDiscount, r.commission?.value]), [[20, 60000, 40, 2000], [1, undefined, undefined, undefined]]);
});

test('giá nhập thủ công và chế độ CK chỉ Manager sửa, nhân viên lưu không ghi đè mode hoặc giá nhập', async () => {
  const { call, mgr, emp } = await setup();
  const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: 'B2B_GV_MODE', customer: 'Khách', vat: 8,
    rows: [{ name: 'Bình', price: 400000, qty: 2, costMode: 'manual', costPrice: 1 }] });
  assert.equal(q.status, 201);
  const before = (await call(`/quotes/${q.data.id}`, mgr)).data;
  assert.equal(before.data.rows[0].costMode, undefined, 'nhân viên không tự gán mode');
  Object.assign(before.data.rows[0], { costMode: 'manual', costPrice: 160000, purchaseDiscount: 58 });
  const saved = await call(`/quotes/${q.data.id}`, mgr, 'PUT', { revision: before.revision, data: before.data });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.data.rows[0].purchaseDiscount, undefined);
  const employee = (await call(`/quotes/${q.data.id}`, emp)).data;
  assert.equal(employee.data.rows[0].costMode, undefined); assert.equal(employee.data.rows[0].costPrice, undefined);
  Object.assign(employee.data.rows[0], { qty: 3, costMode: 'discount', purchaseDiscount: 99, costPrice: 1 });
  const resaved = await call(`/quotes/${q.data.id}`, emp, 'PUT', { revision: employee.revision, data: employee.data });
  assert.equal(resaved.status, 200, JSON.stringify(resaved.data));
  const after = (await call(`/quotes/${q.data.id}`, mgr)).data.data.rows[0];
  assert.equal(after.qty, 3); assert.equal(after.costMode, 'manual'); assert.equal(after.costPrice, 160000);
  assert.equal(after.purchaseDiscount, undefined);
});
