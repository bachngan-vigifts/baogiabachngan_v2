import {approveFixtureOrder} from '../helpers/approval-cost-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq,sql } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { pricePolicies, productPrices, products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { deliveries } from '../../src/modules/sales/schema.ts';

/** Rà soát CRM các tài khoản: trả lại báo giá kèm lý do, luồng giao hàng + thông báo, thu tiền đơn nháp, Kho không thấy giá bán, lịch sử đơn đủ sự kiện. */
const origin = 'https://trial.test', now = '2026-10-01T00:00:00.000Z';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const pw = await hashPassword(PASSWORD, 1000);
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('kho','kho@x.vn','Kho','0900','employee','warehouse',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run('kho', pw);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const } as never);
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => (await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), { db, passwordIterations: 1000 } as never)).headers.get('set-cookie')!.split(';')[0]!;
  await db.insert(warehouses).values([{ id: 'k1', name: 'Kho 1', kind: 'stock' }]);
  await db.insert(products).values([{ sku: 'LY1', name: 'Ly sứ', unit: 'cái', updatedAt: now }]);
  await db.insert(productStock).values([{ sku: 'LY1', warehouseId: 'k1', quantity: 100, updatedAt: now }]);
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), kho: await login('kho@x.vn') };
}
type S = Awaited<ReturnType<typeof setup>>;
const notes = async (s: S, cookie: string) => (await s.call('/notifications', cookie)).data.notifications as { eventType: string; body: string }[];
async function quote(s: S, no: string) {
  const q = await s.call('/quotes', s.emp, 'POST', { type: 'B2B', quoteNo: no, customer: 'Khách ' + no, vat: 8, rows: [{ commission: {mode:'percent',value:0}, name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 10, price: 1000 }] });
  assert.equal(q.status, 201, JSON.stringify(q.data));
  return q.data.id as string;
}

test('trả lại báo giá: chỉ người duyệt, phải có lý do, về nháp và báo người lập; gửi duyệt lại được', async () => {
  const s = await setup(), id = await quote(s, 'BG_TL');
  assert.equal((await s.call(`/quotes/${id}/reject`, s.mgr, 'POST', { revision: 1, reason: 'Giá thấp' })).status, 409, 'nháp chưa gửi duyệt');
  assert.equal((await s.call(`/quotes/${id}/submit`, s.emp, 'POST', { revision: 1 })).status, 200);
  assert.equal((await s.call(`/quotes/${id}/reject`, s.emp, 'POST', { revision: 1, reason: 'Tự trả' })).status, 403);
  assert.equal((await s.call(`/quotes/${id}/reject`, s.mgr, 'POST', { revision: 1, reason: '' })).status, 400);
  const r = await s.call(`/quotes/${id}/reject`, s.mgr, 'POST', { revision: 1, reason: 'Giá ly thấp hơn giá sàn' });
  assert.deepEqual([r.status, r.data.approvalStatus], [200, 'draft']);
  const n = (await notes(s, s.emp)).find(x => x.eventType === 'quote_rejected');
  assert.ok(n && n.body.includes('Giá ly thấp hơn giá sàn'), 'người lập nhận lý do');
  assert.equal((await s.call(`/quotes/${id}/submit`, s.emp, 'POST', { revision: 1 })).status, 200, 'sửa xong gửi duyệt lại');
  assert.equal((await s.call('/approvals', s.mgr)).data.counts.quote, 1);
});

test('giao hàng: đi đúng thứ tự trạng thái; giao xong báo người phụ trách; lịch sử đơn có thao tác chuyến giao', async () => {
  const s = await setup(), qid = await quote(s, 'BG_GH');
  assert.equal((await s.call(`/quotes/${qid}/approve`, s.mgr, 'POST', { internalNo: 'ML-FIXTURE', revision: 1 })).status, 200);
  const o = await s.call('/orders', s.emp, 'POST', { quoteId: qid }), orderId = (o.data.order?.id ?? o.data.id) as string;
  // Đơn CRM nháp nay được ghi thu trước khi duyệt (bdd00c8) – kiểm ở tests/app/crm-early-receipts.test.ts.
  assert.equal((await approveFixtureOrder(s,`/orders/${orderId}/status`,s.mgr,'PUT',{ status: 'confirmed', verified: true, costWarningsReviewed: true })).status, 200);
  await s.db.insert(deliveries).values({ id: 'dl1', deliveryNo: 'GH1', orderId, plannedDate: '2026-10-20', status: 'failed', createdBy: 'emp', createdAt: now, updatedAt: now });
  assert.equal((await s.call('/deliveries/dl1/status', s.mgr, 'PUT', { status: 'delivered' })).data.code, 'DELIVERY_STATUS_FLOW', 'thất bại → phải lên lịch lại trước');
  assert.equal((await s.call('/deliveries/dl1/status', s.mgr, 'PUT', { status: 'planned' })).status, 200);
  assert.equal((await s.call('/deliveries/dl1/status', s.mgr, 'PUT', { status: 'delivered' })).status, 200);
  assert.equal((await s.call('/deliveries/dl1/status', s.mgr, 'PUT', { status: 'cancelled' })).status, 409, 'đã giao không huỷ');
  assert.ok((await notes(s, s.emp)).some(x => x.eventType === 'delivery_done'), 'người phụ trách biết đã giao');
  const audit = (await s.call(`/audit?entityType=orders&entityId=${orderId}&related=1`, s.mgr)).data.entries as { action: string; entityId: string }[];
  assert.ok(audit.some(e => e.action === 'PUT /deliveries/:id/status' && e.entityId === 'dl1'), 'lịch sử đơn gồm đổi trạng thái chuyến giao');
  const [d] = await s.db.select({ status: deliveries.status }).from(deliveries).where(eq(deliveries.id, 'dl1'));
  assert.equal(d!.status, 'delivered');
});

test('Kho: danh sách / chi tiết sản phẩm không có giá bán; nhân viên kinh doanh vẫn thấy', async () => {
  const s = await setup();
  await s.db.insert(pricePolicies).values({ id: 'pl1', name: 'Giá bán lẻ' });
  await s.db.insert(productPrices).values({ sku: 'LY1', policyId: 'pl1', price: 25000 });
  const prices = async (cookie: string) => ((await s.call('/products', cookie)).data.products ?? []).find((p: any) => p.sku === 'LY1')?.prices ?? [];
  assert.ok((await prices(s.emp)).length > 0, 'sale thấy giá');
  assert.deepEqual(await prices(s.kho), [], 'kho không thấy giá');
  assert.deepEqual((await s.call('/products/LY1', s.kho)).data.prices ?? [], []);
});

test('đơn mua NCC: gửi duyệt vào hộp Cần duyệt + báo người duyệt; duyệt / huỷ báo người lập', async () => {
  const s = await setup();await s.db.execute(sql`update staff_members set position_id='sale-admin' where id='emp'`);const qid=await quote(s,'BG_MUA');
  const sup = (await s.call('/suppliers', s.mgr, 'POST', { name: 'Minh Long',saleAdminBrand:'minhlong', contacts: [{ kind: 'order', email: 'ml@ncc.vn' }] })).data.supplier.id as string;
  const po = async () => {
    const r = await s.call('/purchase-orders', s.emp, 'POST', { orders: [{ supplierId: sup, warehouse: 'Kho 1', lines: [{ sku: 'LY1', quantity: 2, sources: [{ type: 'quote', id: qid, quantity: 2 }] }] }] });
    assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.ids[0] as string;
  };
  const a = await po();
  assert.equal((await s.call('/approvals', s.mgr)).data.counts.purchase, 0, 'nháp chưa gửi không vào hộp duyệt');
  assert.equal((await s.call(`/purchase-orders/${a}/submit`, s.emp, 'POST', { revision: 1 })).status, 200);
  const box = (await s.call('/approvals', s.mgr)).data;
  assert.equal(box.counts.purchase, 1);
  assert.equal(box.items.find((i: any) => i.kind === 'purchase').link, `#/purchases/${a}`);
  assert.ok((await notes(s, s.mgr)).some(x => x.eventType === 'purchase_pending'));
  const rev = (await s.call(`/purchase-orders/${a}`, s.mgr)).data.revision;
  const ok = await s.call(`/purchase-orders/${a}/approve`, s.mgr, 'POST', { internalNo: 'ML-FIXTURE', revision: rev, lines: [] });
  assert.equal(ok.status, 400, 'chưa nhập giá mua thì chưa duyệt được');
  const lineId = (await s.call(`/purchase-orders/${a}`, s.mgr)).data.lines[0].id;
  assert.equal((await s.call(`/purchase-orders/${a}/approve`, s.mgr, 'POST', { internalNo: 'ML-FIXTURE', revision: rev, lines: [{ lineId, price: 500 }] })).status, 200);
  assert.equal((await s.call('/approvals', s.mgr)).data.counts.purchase, 0, 'duyệt xong rời hộp');
  assert.ok((await notes(s, s.emp)).some(x => x.eventType === 'purchase_approved'));
  const b = await po(), revB = (await s.call(`/purchase-orders/${b}`, s.mgr)).data.revision;
  assert.equal((await s.call(`/purchase-orders/${b}/cancel`, s.mgr, 'POST', { revision: revB, reason: 'Khách đổi mẫu' })).status, 200);
  assert.ok((await notes(s, s.emp)).some(x => x.eventType === 'purchase_cancelled' && x.body.includes('Khách đổi mẫu')));
});
