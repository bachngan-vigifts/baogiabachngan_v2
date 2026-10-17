import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { PERMISSIONS, can, routePermission } from '../../src/modules/staff/domain/permissions.ts';

/** PHÂN QUYỀN THEO CHỨC VỤ (docs/PHAN-QUYEN.md): mặc định giữ đúng quyền cũ; Manager / người được cấp sửa bảng quyền, có hiệu lực ngay. */
const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const pw = await hashPassword(PASSWORD, 1000);
  for (const [id, pos] of [['kho', 'warehouse'], ['ketoan', 'accounting'], ['ml', 'sales-ml']] as const) {
    await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES (?,?,?,'0900','employee',?,1,'2026-01-01T00:00:00.000Z')").run(id, id + '@x.vn', 'Tên ' + id, pos);
    await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run(id, pw);
  }
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const } as never);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, call, login, mgr: await login('mgr@x.vn'), emp: await login('emp@x.vn'), kho: await login('kho@x.vn'), ketoan: await login('ketoan@x.vn') };
}

test('quyền mặc định sau migration = đúng quyền cũ: /me trả quyền; kho không vào báo giá / khách; sale không vào sổ kho', async () => {
  const { call, mgr, emp, kho, ketoan } = await setup();
  const me = async (c: string) => (await call('/me', c)).data.user;
  assert.equal((await me(mgr)).perms.length, PERMISSIONS.length, 'Manager có mọi quyền');
  const sale = await me(emp), wh = await me(kho), acc = await me(ketoan);
  assert.ok(sale.perms.includes('page.quotes') && !sale.perms.includes('page.packing') && !sale.perms.includes('inventory.view'));
  assert.deepEqual([...wh.perms].sort(), ['page.deliveries', 'page.packing', 'page.purchases', 'page.stock-lookup', 'purchases.receive']);
  assert.ok(acc.perms.includes('suppliers.edit') && acc.perms.includes('purchases.pay'));
  assert.equal(sale.dataScope, 'position'); assert.equal(sale.departmentId, 'kinh-doanh');
  // Mặc định khớp đúng danh mục (đối tượng không có `perms` dùng mặc định theo chức vụ).
  for (const [pos, u] of [['sale', sale], ['warehouse', wh], ['accounting', acc]] as const)
    for (const p of PERMISSIONS) assert.equal(can({ role: 'employee', positionId: pos }, p.key), u.perms.includes(p.key), `${pos} ${p.key}`);
  assert.equal((await call('/quotes', kho)).status, 403);
  assert.equal((await call('/customers', kho)).status, 403);
  assert.equal((await call('/inventory/lookup?q=ab', kho)).status, 200);
  assert.equal((await call('/quotes', emp)).status, 200);
  assert.equal((await call('/inventory/status', emp)).status, 403);
  assert.equal((await call('/permissions', emp)).status, 403, 'chưa được cấp thì không vào trang phân quyền');
});

test('ô chọn khách ở báo giá vẫn dùng được khi tắt trang Khách hàng; danh bạ thì không', () => {
  const q = (s: string) => new URLSearchParams(s);
  assert.deepEqual(routePermission('GET', '/api/staff/customers', q('limit=50&offset=0&q=')), ['page.customers']);
  assert.ok(routePermission('GET', '/api/staff/customers', q('limit=8&usable=1&q=an'))!.includes('page.quotes'));
  assert.ok(routePermission('GET', '/api/staff/customers/9001', q(''))!.includes('page.quotes'));
  assert.deepEqual(routePermission('GET', '/api/staff/customers/9001/overview', q('')), ['page.customers']);
  assert.equal(routePermission('GET', '/api/staff/tasks', q('')), null, 'Công việc luôn có');
  assert.equal(routePermission('GET', '/api/staff/inventory/lookup', q('q=ly')), null, 'tra tồn mọi nhân viên');
});

test('Manager sửa bảng quyền → có hiệu lực ngay; cấp "Quản lý phân quyền" cho chức vụ khác; nhật ký ghi lại', async () => {
  const { call, mgr, emp, ketoan } = await setup();
  const view = (await call('/permissions', mgr)).data;
  const sale = view.positions.find((p: any) => p.id === 'sale');
  assert.ok(view.departments.some((d: any) => d.id === 'kinh-doanh') && sale.departmentId === 'kinh-doanh');
  assert.equal(view.positions.find((p: any) => p.id === 'manager').system, true);
  // Bỏ "Báo giá" của Sale → nhân viên Sale bị chặn ngay ở lần gọi kế tiếp.
  const r = await call('/permissions/positions/sale', mgr, 'PUT', { perms: sale.perms.filter((k: string) => k !== 'page.quotes') });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await call('/quotes', emp)).status, 403);
  assert.equal((await call('/me', emp)).data.user.perms.includes('page.quotes'), false);
  // Cấp Sổ kho cho Kế toán: vượt qua cả kiểm tra bên trong route sổ kho.
  const acc = view.positions.find((p: any) => p.id === 'accounting');
  assert.equal((await call('/inventory/status', ketoan)).status, 403);
  await call('/permissions/positions/accounting', mgr, 'PUT', { perms: [...acc.perms, 'inventory.view', 'perm.manage'] });
  assert.equal((await call('/inventory/status', ketoan)).status, 200);
  // Kế toán có "Quản lý phân quyền": vào được trang, sửa được chức vụ khác, KHÔNG sửa được Manager.
  assert.equal((await call('/permissions', ketoan)).status, 200);
  assert.equal((await call('/permissions/positions/sale', ketoan, 'PUT', { perms: sale.perms })).status, 200);
  assert.equal((await call('/quotes', emp)).status, 200, 'trả lại quyền Báo giá');
  assert.equal((await call('/permissions/positions/manager', ketoan, 'PUT', { perms: [] })).status, 400);
  assert.equal((await call('/permissions/positions/sale', mgr, 'PUT', { perms: ['khong-co'] })).status, 400, 'quyền lạ bị từ chối');
  const log = (await call('/permissions', mgr)).data.log;
  assert.ok(log.length >= 3 && log.some((x: any) => /bỏ: Báo giá/.test(x.detail)) && log.some((x: any) => x.by === 'Tên ketoan'));
});

test('phòng ban & chức vụ: thêm chức vụ chép quyền, phạm vi "Cả phòng ban" thấy dữ liệu đồng nghiệp khác chức vụ cùng phòng', async () => {
  const { call, login, mgr, emp } = await setup();
  const d = await call('/permissions/departments', mgr, 'POST', { name: 'Phòng Dự án' });
  assert.equal(d.status, 201);
  assert.equal((await call('/permissions/departments', mgr, 'POST', { name: 'Phòng Dự án' })).status, 409, 'trùng tên');
  const p = await call('/permissions/positions', mgr, 'POST', { name: 'Trưởng phòng KD', departmentId: 'kinh-doanh', copyFrom: 'sale' });
  assert.equal(p.status, 201); assert.equal(p.data.id, 'truong-phong-kd');
  const view = (await call('/permissions', mgr)).data, tp = view.positions.find((x: any) => x.id === 'truong-phong-kd');
  assert.deepEqual([...tp.perms].sort(), [...view.positions.find((x: any) => x.id === 'sale').perms].sort(), 'chép đủ quyền');
  assert.equal((await call('/permissions/departments/kinh-doanh', mgr, 'DELETE')).status, 409, 'phòng còn chức vụ');
  assert.equal((await call('/permissions/positions/sale', mgr, 'DELETE')).status, 400, 'chức vụ có sẵn không xoá');
  // Báo giá của một NVBH ML (cùng phòng Kinh doanh, khác chức vụ với Sale).
  await call('/quotes', await login('ml@x.vn'), 'POST', { type: 'B2B', quoteNo: 'BG_ML_1', customer: 'Khách ML', vat: 8, rows: [{ name: 'Ly', qty: 1, price: 1 }] });
  const seen = async () => (await call('/quotes?limit=50', emp)).data.quotes.some((x: any) => x.quoteNo === 'BG_ML_1');
  assert.equal(await seen(), false, 'cùng chức vụ: không thấy báo giá của NVBH ML');
  assert.equal((await call('/permissions/positions/sale', mgr, 'PUT', { dataScope: 'department' })).status, 200);
  assert.equal(await seen(), true, 'cả phòng ban: thấy');
  await call('/permissions/positions/sale', mgr, 'PUT', { dataScope: 'own' });
  assert.equal(await seen(), false);
  assert.equal((await call('/permissions/positions/truong-phong-kd', mgr, 'DELETE')).status, 200);
});
