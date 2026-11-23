import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { salesOrders } from '../../src/modules/sales/schema.ts';
import { customerStockRequests } from '../../src/modules/portal/schema.ts';
import { incomingShipments, suppliers } from '../../src/modules/suppliers/schema.ts';

/**
 * Sale Admin (tạm thời, yêu cầu 17/10/2026): xem toàn công ty CHỈ ở báo giá, khách hàng, đơn hàng / HĐKT; khách hỏi tồn theo phạm vi thường.
 * #801: đơn mua NCC chỉ xem hãng được Manager cấu hình, kể cả khi đã có quyền giá; Sale thường bị chặn.
 */
const origin = 'https://trial.test', now = '2026-10-01T00:00:00.000Z';
test('Sale Admin thấy toàn bộ đơn / HĐKT, đơn mua chỉ hãng cấu hình, không thấy khách hỏi tồn của người khác', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  for (const [id, pos] of [['sa', 'sale-admin'], ['s2', 'sales-ml']] as const) {
    await d1.sqlite.prepare(`INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES (?,?,?,'','employee',?,1,'2026-01-01T00:00:00.000Z')`).run(id, id + '@x.vn', 'Tên ' + id, pos);
    await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run(id, await hashPassword(PASSWORD, 1000));
  }
  const router = createAppRouter();
  const call = async (path: string, cookie = '') => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { headers: { origin, cookie } }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => {
    const res = await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return res.headers.get('set-cookie')?.split(';')[0] ?? '';
  };
  const sa = await login('sa@x.vn'), s2 = await login('s2@x.vn');
  await db.insert(customers).values({ id: 'K1', name: 'Khách của emp', contact: '', phone: '', email: '', address: '', search: '', taxCode: '', customerCode: '', sourceVersion: 0, syncedAt: '' });
  await db.insert(salesOrders).values({ id: 'o1', orderNo: 'DH1', quoteType: 'B2B', customerId: 'K1', customerName: 'Khách của emp', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-10-01', status: 'confirmed', total: 1, createdAt: now, updatedAt: now });
  await db.insert(customerStockRequests).values({ id: 'r1', memberId: 'emp', customerId: 'K1', ownerId: 'emp', items: '[{"sku":"A","name":"A","qty":1}]', createdAt: now });
  await db.insert(suppliers).values({ id: 'n1', name: 'NCC 1', nameKey: 'ncc 1', saleAdminBrand:'minhlong', createdAt: now, createdBy: 'mgr', updatedAt: now, updatedBy: 'mgr' } as never);
  await db.insert(incomingShipments).values({ id: 'p1', supplierId: 'n1', supplierName: 'NCC 1', warehouse: '', ticketNumber: 'DMH_1', source: 'supplier-order', approvalStatus: 'pending', createdAt: now, createdBy: 'emp', updatedAt: now, updatedBy: 'emp' });

  assert.equal((await call('/orders/o1', sa)).status, 200, 'Sale Admin xem đơn của người khác');
  assert.equal((await call('/orders/o1', s2)).status, 404, 'sale phòng khác không xem được');
  assert.deepEqual((await call('/stock-requests', sa)).data.requests, [], 'khách hỏi tồn không thuộc nhóm xem toàn công ty');
  assert.deepEqual((await call('/stock-requests', s2)).data.requests, []);
  assert.equal((await call('/purchase-orders/p1', sa)).status, 200, 'Sale Admin xem cả đơn mua nháp của người khác');
  assert.equal((await call('/purchase-orders/p1', sa)).data.priceHidden, false, 'Sale Admin có quyền Kế toán: thấy giá mua');
  assert.equal((await call('/purchase-orders/p1', s2)).status, 403);
  await db.insert(suppliers).values({id:'n2',name:'NCC chưa phân hãng',nameKey:'ncc 2',createdAt:now,createdBy:'mgr',updatedAt:now,updatedBy:'mgr'});
  await db.insert(incomingShipments).values({id:'p2',supplierId:'n2',supplierName:'NCC chưa phân hãng',warehouse:'',ticketNumber:'DMH_2',source:'supplier-order',approvalStatus:'pending',createdAt:now,createdBy:'emp',updatedAt:now,updatedBy:'emp'});
  assert.equal((await call('/purchase-orders/p2',sa)).status,404,'có quyền giá không vượt hãng NCC chưa được phân');
  assert.equal((await call('/customers/K1/overview', sa)).data.orders.length, 1, 'chi tiết khách: thấy đơn của mọi người');
});
