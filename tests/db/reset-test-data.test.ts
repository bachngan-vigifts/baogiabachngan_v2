import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { products } from '../../src/modules/catalog/schema.ts';
import { reconcileAutoTasks } from '../../src/modules/tasks/api/auto-tasks.ts';

/**
 * scripts/sql/reset-test-data.sql (xoá dữ liệu chạy thử trên Supabase): dựng đủ luồng thật (báo giá → đơn → HĐKT → giao → thu,
 * đóng gói, việc, chăm sóc, chat, thông báo) rồi chạy file SQL → các bảng nghiệp vụ về 0, dữ liệu gốc (nhân viên, khách,
 * sản phẩm) giữ nguyên, và hệ thống vẫn tạo báo giá / đơn mới với số chứng từ bắt đầu lại.
 */
const origin = 'https://trial.test';
const SQL = readFileSync(join(import.meta.dirname, '../../scripts/sql/reset-test-data.sql'), 'utf8');
const CLEARED = ['staff_quotations', 'quote_lines', 'quote_revisions', 'sales_orders', 'sales_order_lines', 'sales_contracts', 'contract_counters',
  'payment_schedules', 'customer_payments', 'deliveries', 'delivery_lines', 'packing_slips', 'packing_slip_lines', 'tasks', 'task_comments', 'customer_activities',
  'staff_web_notifications', 'chat_conversations', 'chat_members', 'chat_messages'];
const KEPT = ['staff_members', 'staff_credentials', 'sapo_customers', 'products', 'customer_staff'];

test('file SQL xoá dữ liệu chạy thử: xoá đúng bảng, giữ dữ liệu gốc, hệ thống chạy lại bình thường', async () => {
  const { db, d1, client: pg } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const emp = await login('emp@x.vn'), mgr = await login('mgr@x.vn');
  await db.insert(customers).values({ id: '1001', name: 'Công ty Hoàng Long', contact: 'Chị Lan', phone: '0901', email: '', address: '1 Lê Lợi', search: '', taxCode: '0101', customerCode: 'HL01', sourceVersion: 0, syncedAt: '' });
  await db.insert(products).values({ sku: 'LHC', name: 'Bình giữ nhiệt', unit: 'cái', perCarton: 24, cartonWeight: 12, updatedAt: '2026-10-01' });
  await call('/customers/1001/staff', mgr, 'PUT', { ownerId: 'emp' });

  // Dựng dữ liệu ở mọi bảng sẽ xoá.
  const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: 'B2B_BG20261006_001', customer: 'Công ty Hoàng Long', customerId: '1001', vat: 8,
    rows: [{ name: 'Bình giữ nhiệt', sku: 'LHC', unit: 'cái', qty: 100, price: 200000, taxRate: 8 }] });
  assert.equal(q.status, 201);
  assert.equal((await call(`/quotes/${q.data.id}`, emp, 'PUT', { revision: 1, data: { type: 'B2B', quoteNo: 'B2B_BG20261006_001', customer: 'Công ty Hoàng Long', customerId: '1001', vat: 8,
    rows: [{ name: 'Bình giữ nhiệt', sku: 'LHC', unit: 'cái', qty: 120, price: 200000, taxRate: 8 }] } })).status, 200);
  assert.equal((await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 2 })).status, 200);
  const k = await call('/contracts', emp, 'POST', { quoteId: q.data.id, legalEntity: 'BN', depositRate: 30, paymentDays: 15, signedDate: '2026-10-06' }); assert.equal(k.status, 201, JSON.stringify(k.data));
  const o = { data: { id: k.data.orderId as string } };
  await call(`/orders/${o.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true }); // Manager duyệt HĐKT (tạo ra luôn là nháp)
  const line = (await call(`/orders/${o.data.id}`, emp)).data.lines[0];
  assert.equal((await call('/deliveries', emp, 'POST', { orderId: o.data.id, plannedDate: '2026-10-10', lines: [{ orderLineId: line.id, qty: 50 }] })).status, 201);
  assert.equal((await call('/payments', emp, 'POST', { orderId: o.data.id, amount: 1_000_000, paidAt: '2026-10-06', method: 'transfer' })).status, 201);
  const pk = await call(`/orders/${o.data.id}/packing`, emp, 'POST', { allocations: [{ orderLineId: line.id, qty: 50, source: 'warehouse' }] }); assert.equal(pk.status, 201);
  assert.equal((await call('/tasks', emp, 'POST', { title: 'Việc thử', assigneeId: 'mgr' })).status, 201);
  await reconcileAutoTasks(db);
  const t = (await call('/tasks?view=mine', mgr)).data.tasks[0];
  await call(`/tasks/${t.id}/comments`, mgr, 'POST', { body: 'Đã xem' });
  assert.equal((await call('/care', emp, 'POST', { customerId: '1001', type: 'call', content: 'Gọi thử', contactName: 'Chị Lan', result: 'consulting', nextAt: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), remindBefore: '1d' })).status, 201);
  const chat = await call('/chat/direct', emp, 'POST', { memberId: 'mgr' });
  await call(`/chat/${chat.data.id}/messages`, emp, 'POST', { body: 'Chào anh' });

  const count = async (table: string) => Number((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0]!.n);
  const before = Object.fromEntries(await Promise.all([...CLEARED, ...KEPT].map(async x => [x, await count(x)] as const)));
  for (const x of CLEARED) assert.ok(before[x]! > 0, `chưa dựng được dữ liệu cho ${x} – test không chứng minh được thứ tự xoá`);

  // Chạy đúng file SQL như trên Supabase.
  await pg.exec(SQL);
  for (const x of CLEARED) assert.equal(await count(x), 0, `${x} chưa xoá hết`);
  for (const x of KEPT) assert.equal(await count(x), before[x], `${x} bị đụng tới`);

  // Hệ thống chạy lại bình thường, số chứng từ bắt đầu lại.
  const q2 = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: 'B2B_BG20261006_001', customer: 'Công ty Hoàng Long', customerId: '1001', vat: 8, rows: [{ name: 'Bình', qty: 1, price: 1 }] });
  assert.equal(q2.status, 201, 'số báo giá cũ dùng lại được');
  await call(`/quotes/${q2.data.id}/approve`, mgr, 'POST', { revision: 1 });
  const o2 = await call('/orders', emp, 'POST', { quoteId: q2.data.id });
  await call(`/orders/${o2.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)
  assert.match((await call(`/orders/${o2.data.id}`, emp)).data.order.orderNo, /_001$/);
});
