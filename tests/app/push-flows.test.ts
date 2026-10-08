import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';

/**
 * Thông báo (chuông + Web Push) cho các luồng duyệt: báo giá mới / duyệt báo giá, đơn / HĐKT mới / duyệt đơn,
 * việc tự sinh mới, nhận việc, hoàn thành việc. Người thao tác không tự nhận thông báo của chính mình.
 */
const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  // Kho (nhóm nhận việc) để kiểm tra nhận việc của nhóm.
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('kho','kho@x.vn','Tên kho','0900','employee','warehouse',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,version) VALUES (?,?,0)').run('kho', await hashPassword(PASSWORD, 1000));
  await db.insert(customers).values({ id: 'K1', name: 'Công ty An Phú', contact: 'Anh Phú', phone: '0902', email: '', address: 'Cần Thơ', search: '', taxCode: '0309', customerCode: 'AP01', sourceVersion: 0, syncedAt: '' });
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), kho: await login('kho@x.vn') };
}

test('đẩy thông báo: báo giá mới → Manager; duyệt → người lập; đơn / HĐKT mới → Manager; duyệt đơn → phụ trách; việc mới / nhận việc / hoàn thành', async () => {
  const { call, emp, mgr, kho } = await setup();
  const events = async (who: string) => (await call('/notifications', who)).data.notifications.map((n: any) => n.eventType as string);
  const has = async (who: string, type: string) => (await events(who)).includes(type);

  // Nhân viên tạo báo giá → Manager nhận "chờ duyệt"; nhân viên không tự nhận.
  const q = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo: 'HRC_N1', customer: 'Công ty An Phú', customerId: 'K1', vat: 8, rows: [{ name: 'Bộ trà', qty: 10, price: 100000 }] });
  assert.equal(q.status, 201);
  assert.ok(await has(mgr, 'quote_pending')); assert.ok(!(await has(emp, 'quote_pending')));
  // Manager duyệt → người lập nhận "đã duyệt".
  await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 1 });
  assert.ok(await has(emp, 'quote_approved')); assert.ok(!(await has(mgr, 'quote_approved')), 'Manager không tự nhận');

  // Sinh đơn hàng + HĐKT → Manager nhận "đơn / HĐKT chờ duyệt"; duyệt đơn → nhân viên phụ trách nhận.
  const o = await call('/orders', emp, 'POST', { quoteId: q.data.id }); assert.equal(o.status, 201);
  assert.ok(await has(mgr, 'order_pending'));
  assert.equal((await call('/contracts', emp, 'POST', { orderId: o.data.id, legalEntity: 'BN', depositRate: 30, paymentDays: 15 })).status, 201);
  assert.ok(await has(mgr, 'contract_pending'));
  await call(`/orders/${o.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true });
  assert.ok(await has(emp, 'order_approved'));

  // Việc giao cho nhóm Kho → kho nhận "việc mới"; kho nhận việc → người giao nhận "đã có người nhận"; hoàn thành → người giao nhận.
  const t = await call('/tasks', emp, 'POST', { title: 'Soạn hàng mẫu', assigneeId: 'team:warehouse' });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  assert.ok(await has(kho, 'task_assigned'));
  await call(`/tasks/${t.data.id}`, kho, 'PUT', { status: 'in_progress' });
  assert.ok(await has(emp, 'task_claimed'), 'nhận việc → người giao việc được báo');
  await call(`/tasks/${t.data.id}`, kho, 'PUT', { status: 'done' });
  assert.ok(await has(emp, 'task_done'));

  // Việc tự sinh mới (đơn đã duyệt chưa lên lịch giao → việc cho người phụ trách) → người nhận được báo.
  const before = (await events(emp)).filter((x: string) => x === 'task_assigned').length;
  await call('/tasks?view=mine&refresh=1', mgr);
  assert.ok((await events(emp)).filter((x: string) => x === 'task_assigned').length > before, 'việc tự sinh mới → báo người nhận');
});
