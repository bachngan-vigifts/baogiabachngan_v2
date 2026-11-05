import { customerCreateFixture } from '../helpers/customer-fixture.ts';
import { products } from '../../src/modules/catalog/schema.ts';
import { eq } from 'drizzle-orm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { pricePolicies } from '../../src/modules/catalog/schema.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}

test('khách hàng mới: nhân viên tạo → chờ duyệt (không lập đơn / cấp tài khoản được), Manager duyệt; từ chối = xoá', async () => {
  const { call, emp, mgr } = await setup();
  const k = await call('/customers', emp, 'POST', customerCreateFixture({ name: 'Công ty Mới' }));
  assert.equal(k.data.approvalStatus, 'pending');
  assert.equal((await call('/customers', mgr, 'POST', customerCreateFixture({ name: 'Công ty Manager tạo' }))).data.approvalStatus, 'approved');
  let list = (await call('/customers', emp)).data;
  assert.equal(list.pendingCount, 1);
  assert.deepEqual((await call('/customers?status=pending', emp)).data.customers.map((c: any) => c.name), ['Công ty Mới']);
  assert.deepEqual((await call('/customers?usable=1', emp)).data.customers.map((c: any) => c.name), ['Công ty Manager tạo'], 'chọn khách cho báo giá: chỉ khách đã duyệt');
  // Chưa duyệt: không cấp tài khoản, không tạo đơn.
  assert.equal((await call('/customer-accounts', emp, 'POST', { customerId: k.data.id, name: 'A', email: 'a@moi.vn' })).data.code, 'CUSTOMER_PENDING');
  const q = await call('/quotes', mgr, 'POST', { type: 'B2B', quoteNo: 'B2B_1', customer: 'Công ty Mới', customerId: k.data.id, vat: 8, rows: [{ name: 'Ly', sku: 'L1', unit: 'cái', qty: 1, price: 1000 }] });
  assert.equal((await call('/orders', mgr, 'POST', { quoteId: q.data.id })).data.code, 'CUSTOMER_PENDING');
  // Chỉ Manager duyệt.
  assert.equal((await call(`/customers/${k.data.id}/approve`, emp, 'POST', {})).status, 403);
  assert.equal((await call(`/customers/${k.data.id}/approve`, mgr, 'POST', {})).status, 200);
  assert.equal((await call('/orders', mgr, 'POST', { quoteId: q.data.id })).status, 201);
  assert.equal((await call(`/customers/${k.data.id}`, mgr, 'DELETE')).status, 404, 'đã duyệt thì không xoá ở đây');
  // Từ chối: người tạo hoặc Manager xoá khách đang chờ duyệt.
  const k2 = await call('/customers', emp, 'POST', customerCreateFixture({ name: 'Công ty Bị Từ Chối' }));
  assert.equal((await call(`/customers/${k2.data.id}`, emp, 'DELETE')).status, 200);
  list = (await call('/customers', emp)).data;
  assert.equal(list.pendingCount, 0); assert.ok(!list.customers.some((c: any) => c.name === 'Công ty Bị Từ Chối'));
});

test('sản phẩm mới: Manager thêm có hiệu lực ngay; nhân viên thêm chờ duyệt, ẩn khỏi danh mục báo giá tới khi duyệt', async () => {
  const { db, call, emp, mgr } = await setup();
  await db.insert(pricePolicies).values([{ id: 'le', name: 'Giá bán lẻ', sortOrder: 0 }, { id: 'vat', name: 'Giá lẻ +VAT', sortOrder: 1 }]);
  assert.equal((await call('/products', emp, 'POST', { sku: 'bad sku!', name: 'X' })).status, 400);
  assert.equal((await call('/products', mgr, 'POST', { sku: 'ML-01', name: 'Bộ trà', brand: 'Minh Long', unit: 'bộ', prices: { le: 1_200_000, vat: 1_296_000 } })).data.approvalStatus, 'approved');
  assert.equal((await call('/products', emp, 'POST', { sku: 'ML-01', name: 'Trùng' })).status, 409);
  assert.equal((await call('/products', emp, 'POST', { sku: 'LL-02', name: 'Bình giữ nhiệt', prices: { le: 300000, vat: 324000 } })).data.approvalStatus, 'pending');
  const skus = async () => (await call('/catalog-snapshot', emp)).data.products.map((p: any[]) => p[0]).sort();
  assert.deepEqual(await skus(), ['ML-01'], 'sản phẩm chờ duyệt không có trong danh mục báo giá');
  const pending = (await call('/product-approvals', mgr)).data.products;
  assert.deepEqual(pending.map((p: any) => [p.sku, p.createdByName, p.prices[0].price]), [['LL-02', 'Tên emp', 300000]]);
  assert.equal((await call('/products/LL-02/approve', emp, 'POST', {})).status, 403);
  assert.equal((await call('/products/LL-02/approve', mgr, 'POST', {})).status, 200);
  assert.deepEqual(await skus(), ['LL-02', 'ML-01']);
  assert.equal((await call('/products/LL-02', mgr, 'DELETE')).status, 404, 'đã duyệt thì không xoá ở đây');
  await call('/products', emp, 'POST', { sku: 'XX-9', name: 'Gửi nhầm', prices: { le: 100000, vat: 108000 } });
  assert.equal((await call('/products/XX-9', emp, 'DELETE')).status, 200);
  assert.equal((await call('/product-approvals', mgr)).data.products.length, 0);
});

test('xoá nhân viên: khỏi danh sách, đăng xuất, email tạo lại được; không xoá chính mình / tài khoản khách', async () => {
  const { call, emp, mgr } = await setup();
  assert.equal((await call('/admin/members/mgr', mgr, 'DELETE')).status, 400);
  assert.equal((await call('/admin/members/emp', emp, 'DELETE')).status, 403);
  assert.equal((await call('/admin/members/emp', mgr, 'DELETE')).status, 200);
  assert.ok(!(await call('/admin/members', mgr)).data.members.some((m: any) => m.id === 'emp'));
  assert.equal((await call('/me', emp)).status, 401, 'bị đăng xuất');
  assert.equal((await call('/login', '', 'POST', { email: 'emp@x.vn', password: PASSWORD })).status, 401);
  assert.equal((await call('/admin/members/emp', mgr, 'DELETE')).status, 404);
  const again = await call('/admin/members', mgr, 'POST', { name: 'Nhân viên mới', email: 'emp@x.vn', phone: '0901234567', positionId: 'sale' });
  assert.equal(again.status, 201, 'email cũ dùng lại được');
});

test('số đếm cần duyệt: đủ trên 200 mục, summary không gửi chi tiết và vẫn chặn người không được duyệt',async()=>{
 const s=await setup();
 await s.db.insert(products).values(Array.from({length:205},(_,i)=>({sku:'WAIT-'+i,name:'Hàng chờ '+i,approvalStatus:'pending' as const,createdBy:'emp',updatedAt:'2026-10-23'})));
 assert.equal((await s.call('/approvals?summary=1',s.emp)).status,403);
 const summary=await s.call('/approvals?summary=1',s.mgr);assert.equal(summary.status,200);assert.equal(summary.data.counts.product,205);assert.equal(summary.data.counts.total,205);assert.equal(summary.data.items,undefined);
 const list=await s.call('/approvals',s.mgr);assert.equal(list.data.items.length,200);assert.equal(list.data.counts.total,205);assert.equal(list.data.truncated,true);
 await s.db.update(products).set({approvalStatus:'approved'}).where(eq(products.sku,'WAIT-0'));
 assert.equal((await s.call('/approvals?summary=1',s.mgr)).data.counts.total,204);
});
