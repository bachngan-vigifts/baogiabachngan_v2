import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { memoryFileStore } from '../../src/core/storage/file-store.ts';

/**
 * SỔ KHO giai đoạn 1 (chạy song song Sapo): chốt tồn đầu kỳ = tồn Sapo; phiếu nhận NCC tự cộng, huỷ phiếu tự trừ lại;
 * phiếu điều chỉnh của Manager; đối chiếu sổ kho ↔ Sapo; thẻ kho có tồn luỹ kế. Quyền: Manager + Kho.
 */
const origin = 'https://trial.test', now = '2026-10-01T00:00:00.000Z';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await d1.sqlite.prepare(`INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('kho','kho@x.vn','Thủ kho','','employee','warehouse',1,'2026-01-01T00:00:00.000Z')`).run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run('kho', await hashPassword(PASSWORD, 1000));
  await db.insert(warehouses).values([{ id: 'ct', name: 'Kho Cần Thơ', kind: 'stock', sortOrder: 0 }, { id: 'vg', name: 'Kho Vigifts', kind: 'stock', sortOrder: 1 }, { id: 'ncc', name: 'Kho NCC/ĐL', kind: 'supplier', sortOrder: 9 }]);
  await db.insert(products).values([{ sku: 'LY1', name: 'Ly sứ', unit: 'cái', updatedAt: now }, { sku: '031106000', name: 'Chén cơm', unit: 'cái', updatedAt: now }]);
  await db.insert(productStock).values([{ sku: 'LY1', warehouseId: 'ct', quantity: 10, updatedAt: now }, { sku: '031106000', warehouseId: 'vg', quantity: 5, updatedAt: now }, { sku: 'LY1', warehouseId: 'ncc', quantity: 99, updatedAt: now }]);
  const router = createAppRouter(), files = memoryFileStore();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, files, passwordIterations: 1000, sapoOrderPush: 'off' as const } as never);
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => {
    const res = await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), { db, passwordIterations: 1000 } as never);
    return res.headers.get('set-cookie')?.split(';')[0] ?? '';
  };
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), kho: await login('kho@x.vn') };
}

test('sổ kho: chốt đầu kỳ, nhận NCC tự cộng / huỷ tự trừ, điều chỉnh, đối chiếu Sapo, thẻ kho, quyền', async () => {
  const { call, emp, mgr, kho } = await setup();
  assert.equal((await call('/inventory/status', emp)).status, 403, 'sale không xem sổ kho');
  assert.deepEqual((await call('/stock-warehouses', emp)).data.warehouses.map((w: any) => w.id), ['ct', 'vg'], 'chỉ kho thật, không gồm kho NCC');
  let st = (await call('/inventory/status', kho)).data;
  assert.equal(st.openedAt, null); assert.equal(st.canManage, false);
  assert.equal((await call('/inventory/opening', kho, 'POST', { confirm: true })).status, 403, 'kho không chốt đầu kỳ');
  assert.equal((await call('/inventory/opening', mgr, 'POST', {})).status, 400, 'phải xác nhận');
  // Trước khi chốt: lệch toàn bộ so với Sapo.
  assert.equal((await call('/inventory/compare', mgr)).data.diffCount, 2);
  const op = await call('/inventory/opening', mgr, 'POST', { confirm: true });
  assert.equal(op.status, 200, JSON.stringify(op.data)); assert.equal(op.data.lines, 2);
  st = (await call('/inventory/status', mgr)).data; assert.ok(st.openedAt); assert.ok(st.openedBy, 'ghi người chốt');
  let cmp = (await call('/inventory/compare', mgr)).data;
  assert.equal(cmp.diffCount, 0); assert.equal(cmp.rows.length, 0, 'mặc định chỉ hiện dòng lệch');
  assert.equal((await call('/inventory/compare?diff=0', mgr)).data.rows.length, 2);
  // Chốt lại lần 2 khi không có gì đổi → không ghi thêm dòng.
  assert.equal((await call('/inventory/opening', mgr, 'POST', { confirm: true })).data.lines, 0);

  // Phiếu nhận NCC: hàng đạt cộng vào đúng kho theo tên; huỷ phiếu → ghi dòng ngược lại.
  const sup = (await call('/suppliers', mgr, 'POST', { name: 'Minh Long', contacts: [{ kind: 'order', email: 'ml@ncc.vn' }] })).data.supplier.id;
  const po = await call('/purchase-orders', mgr, 'POST', { orders: [{ supplierId: sup, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 6 }] }] }); assert.equal(po.status, 201, JSON.stringify(po.data)); const id = po.data.ids[0];
  const v = (await call(`/purchase-orders/${id}`, mgr)).data;
  await call(`/purchase-orders/${id}/approve`, mgr, 'POST', { lines: [{ lineId: v.lines[0].id, price: 100 }] });
  await call(`/purchase-orders/${id}/confirm`, mgr, 'POST', {});
  const rc = await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'k-12345678', warehouse: ' kho cần thơ ', receivedDate: '2026-10-01', lines: [{ lineId: v.lines[0].id, goodQty: 4, damagedQty: 1 }], photos: ['data:image/jpeg;base64,AAAA'] });
  assert.equal(rc.status, 201, JSON.stringify(rc.data));
  cmp = (await call('/inventory/compare', kho)).data;
  assert.deepEqual(cmp.rows.map((r: any) => [r.sku, r.warehouse, r.ledger, r.sapo, r.diff]), [['LY1', 'Kho Cần Thơ', 14, 10, 4]], 'chỉ cộng hàng đạt, chưa nhập Sapo nên lệch +4');
  let card = (await call('/inventory/card?sku=LY1&warehouseId=ct', kho)).data;
  assert.deepEqual(card.lines.map((l: any) => [l.kind, l.qty, l.balance]), [['receipt', 4, 14], ['opening', 10, 10]], 'mới nhất trước, tồn luỹ kế');
  assert.match(card.lines[0].refNo, /^PNH/);
  assert.equal((await call(`/supplier-receipts/${rc.data.receiptId}/cancel`, mgr, 'POST', { reason: 'Nhập nhầm' })).status, 200);
  card = (await call('/inventory/card?sku=LY1&warehouseId=ct', kho)).data;
  assert.equal(card.balance, 10); assert.equal(card.lines[0].kind, 'reverse');
  // Kho nhận không có trong danh sách kho → phiếu vẫn lưu, sổ kho không ghi, lịch sử đơn báo lại.
  const rc2 = await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'k-87654321', warehouse: 'Kho lạ', receivedDate: '2026-10-01', lines: [{ lineId: v.lines[0].id, goodQty: 1 }] });
  assert.equal(rc2.status, 201); assert.ok(rc2.data.events.some((e: any) => e.summary.includes('chưa ghi sổ kho')));
  assert.equal((await call('/inventory/card?sku=LY1&warehouseId=ct', kho)).data.balance, 10);

  // Phiếu điều chỉnh: chỉ Manager, bắt buộc lý do, mã phải có trong danh mục (giữ số 0 đầu).
  assert.equal((await call('/inventory/adjustments', kho, 'POST', { warehouseId: 'vg', reason: 'Kiểm kê', lines: [{ sku: '031106000', qty: -2 }] })).status, 403);
  assert.equal((await call('/inventory/adjustments', mgr, 'POST', { warehouseId: 'vg', reason: '', lines: [{ sku: '031106000', qty: -2 }] })).status, 400);
  assert.equal((await call('/inventory/adjustments', mgr, 'POST', { warehouseId: 'ncc', reason: 'Kiểm kê', lines: [{ sku: '031106000', qty: -2 }] })).status, 400, 'không điều chỉnh kho NCC');
  assert.equal((await call('/inventory/adjustments', mgr, 'POST', { warehouseId: 'vg', reason: 'Kiểm kê', lines: [{ sku: 'KHONG-CO', qty: 1 }] })).status, 400);
  const adj = await call('/inventory/adjustments', mgr, 'POST', { warehouseId: 'vg', reason: 'Kiểm kê lệch', lines: [{ sku: '031106000', qty: -2 }, { sku: '031106000', qty: -1 }] });
  assert.equal(adj.status, 201, JSON.stringify(adj.data)); assert.equal(adj.data.lines, 1, 'gộp 2 dòng cùng mã');
  card = (await call('/inventory/card?sku=031106000&warehouseId=vg', mgr)).data;
  assert.deepEqual([card.balance, card.sapo, card.lines[0].qty, card.lines[0].note], [2, 5, -3, 'Kiểm kê lệch']);
  assert.equal((await call('/inventory/compare?q=chén', mgr)).data.rows[0].diff, -3, 'tìm theo tên');
});

test('tra tồn: mọi nhân viên tra theo mã / tên, số lượng từng kho thật, không có giá; chốt đầu kỳ rồi thì lấy tồn sổ kho', async () => {
  const { call, emp, mgr } = await setup();
  assert.deepEqual((await call('/inventory/lookup?q=l', emp)).data.products, [], 'ít nhất 2 ký tự');
  let r = (await call('/inventory/lookup?q=ly', emp)).data;
  assert.equal(r.source, 'sapo');
  assert.deepEqual(r.products.map((p: any) => [p.sku, p.total, p.stock.map((s: any) => [s.warehouse, s.qty])]), [['LY1', 10, [['Kho Cần Thơ', 10], ['Kho Vigifts', 0]]]], 'không tính kho NCC');
  assert.ok(!JSON.stringify(r).match(/price/i), 'không có giá');
  r = (await call('/inventory/lookup?q=031106000', emp)).data;
  assert.deepEqual(r.products.map((p: any) => [p.sku, p.name, p.total]), [['031106000', 'Chén cơm', 5]], 'quét đúng mã (giữ số 0 đầu)');
  assert.equal((await call('/inventory/lookup?q=chen com', emp)).data.products[0].sku, '031106000', 'tìm không dấu');
  await call('/inventory/opening', mgr, 'POST', { confirm: true });
  await call('/inventory/adjustments', mgr, 'POST', { warehouseId: 'ct', reason: 'Kiểm kê', lines: [{ sku: 'LY1', qty: -4 }] });
  r = (await call('/inventory/lookup?q=LY1', emp)).data;
  assert.equal(r.source, 'ledger'); assert.equal(r.products[0].total, 6);
});
