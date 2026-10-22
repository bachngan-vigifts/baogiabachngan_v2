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
 * phiếu điều chỉnh của Manager; đối chiếu sổ kho ↔ Sapo; thẻ kho có tồn luỹ kế. Quyền: Manager + chức vụ được cấp "Sổ kho – xem" (trang Phân quyền).
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
  assert.equal((await call('/inventory/status', kho)).status, 403, 'mặc định chỉ Manager xem sổ kho (trang Phân quyền)');
  assert.equal((await call('/permissions/positions/warehouse', mgr, 'PUT', { perms: ['page.deliveries', 'page.purchases', 'page.packing', 'page.stock-lookup', 'purchases.receive', 'inventory.view'] })).status, 200, 'Manager cấp "Sổ kho – xem" cho Kho');
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
  const resetAfterReceipt = await call('/inventory/opening',mgr,'POST',{confirm:true});
  assert.equal(resetAfterReceipt.status,409);assert.match(resetAfterReceipt.data.error,/supplier_receipt.*Dùng phiếu điều chỉnh để sửa lệch/);
  assert.deepEqual((await call('/inventory/compare', kho)).data.rows, [], 'Kho chỉ xem Vigifts, không lẫn nhận vào kho cửa hàng');
  cmp = (await call('/inventory/compare', mgr)).data;
  assert.deepEqual(cmp.rows.map((r: any) => [r.sku, r.warehouse, r.ledger, r.sapo, r.diff]), [['LY1', 'Kho Cần Thơ', 14, 10, 4]], 'chỉ cộng hàng đạt, chưa nhập Sapo nên lệch +4');
  let card = (await call('/inventory/card?sku=LY1&warehouseId=ct', mgr)).data;
  assert.deepEqual(card.lines.map((l: any) => [l.kind, l.qty, l.balance]), [['receipt', 4, 14], ['opening', 10, 10]], 'mới nhất trước, tồn luỹ kế');
  assert.match(card.lines[0].refNo, /^PNH/);
  // Sổ kho: dòng nhập NCC mở đơn mua của phiếu (link tra qua hook suppliers → inventory); huỷ phiếu ghi "Huỷ phiếu nhập hàng".
  const rcMove = (await call('/stock-moves?group=in&warehouseId=ct', mgr)).data.moves[0];
  assert.equal(rcMove.link, `#/purchases/${encodeURIComponent(id)}`); assert.equal(rcMove.description, 'Nhập hàng vào kho'); assert.equal(rcMove.balanceAfter, 14);
  assert.equal((await call(`/supplier-receipts/${rc.data.receiptId}/cancel`, mgr, 'POST', { reason: 'Nhập nhầm' })).status, 200);
  card = (await call('/inventory/card?sku=LY1&warehouseId=ct', mgr)).data;
  assert.equal(card.balance, 10); assert.equal(card.lines[0].kind, 'reverse');
  assert.equal((await call('/stock-moves?group=reverse&warehouseId=ct', mgr)).data.moves[0].description, 'Huỷ phiếu nhập hàng');
  // Kho nhận không hợp lệ phải từ chối toàn phiếu; địa chỉ giao trên đơn không phải kho nhận.
  const rc2 = await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'k-87654321', warehouse: 'Kho lạ', receivedDate: '2026-10-01', lines: [{ lineId: v.lines[0].id, goodQty: 1 }] });
  assert.equal(rc2.status, 400); assert.match(rc2.data.error, /kho nhận hàng/);
  assert.equal((await call('/inventory/card?sku=LY1&warehouseId=ct', mgr)).data.balance, 10);

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


test('sổ kho: tài khoản Kho chỉ có Vigifts; không thể sửa query để đọc kho khác; Manager vẫn thấy mọi kho', async () => {
  const { db, call, kho, mgr } = await setup();
  assert.equal((await call('/permissions/positions/warehouse', mgr, 'PUT', { perms: ['inventory.view', 'inventory.manage'] })).status, 200);
  const st = (await call('/inventory/status', kho)).data;
  assert.deepEqual(st.warehouses.map((w: any) => w.id), ['vg']);
  assert.equal(st.defaultWarehouseId, 'vg'); assert.equal(st.warehouseRestricted, true);
  assert.deepEqual((await call('/inventory/compare?diff=0', kho)).data.rows.map((r: any) => r.warehouseId), ['vg']);
  assert.equal((await call('/inventory/compare?warehouseId=ct', kho)).status, 403);
  assert.equal((await call('/inventory/card?sku=LY1&warehouseId=ct', kho)).status, 403);
  assert.equal((await call('/inventory/adjustments', kho, 'POST', { warehouseId: 'ct', reason: 'Kiểm kê', lines: [{sku:'LY1',qty:1}] })).status, 403);
  assert.equal((await call('/inventory/opening', kho, 'POST', {confirm:true})).data.lines, 1, 'nếu được cấp chốt tồn, vẫn chỉ chốt Vigifts');
  assert.equal((await call('/inventory/card?sku=LY1&warehouseId=ct', mgr)).data.balance, 0, 'không ghi vào kho ngoài phạm vi');
  assert.deepEqual((await call('/inventory/status', mgr)).data.warehouses.map((w: any) => w.id), ['ct','vg']);
  // Inactive Vigifts must not silently expand the scope back to all warehouses.
  await db.update(warehouses).set({active:false}).where((await import('drizzle-orm')).eq(warehouses.id,'vg'));
  const empty = (await call('/inventory/status', kho)).data;
  assert.deepEqual(empty.warehouses, []); assert.equal(empty.defaultWarehouseId, null);
  assert.deepEqual((await call('/inventory/compare?diff=0', kho)).data.rows, []);
});

test('chốt đầu kỳ: Sapo âm hoặc kho không có dòng chốt đều rollback toàn bộ, không tự tạo marker', async()=>{
  const {db,call,mgr}=await setup();
  const {eq}=await import('drizzle-orm'); const {stockMoves,stockBalances}=await import('../../src/modules/inventory/schema.ts');
  await db.update(productStock).set({quantity:-2}).where(eq(productStock.warehouseId,'ct'));
  const negative=await call('/inventory/opening',mgr,'POST',{confirm:true});
  assert.equal(negative.status,409);assert.equal(negative.data.code,'OPENING_NEGATIVE_STOCK');assert.match(negative.data.error,/LY1/);
  assert.equal((await db.select().from(stockMoves)).length,0);assert.equal((await db.select().from(stockBalances)).length,0);
  await db.update(productStock).set({quantity:0}).where(eq(productStock.warehouseId,'ct'));
  const empty=await call('/inventory/opening',mgr,'POST',{confirm:true});
  assert.equal(empty.status,409);assert.equal(empty.data.code,'WAREHOUSE_OPENING_EMPTY');assert.match(empty.data.error,/marker/);
  assert.equal((await db.select().from(stockMoves)).length,0);assert.equal((await db.select().from(stockBalances)).length,0);
  assert.equal((await call('/inventory/status',mgr)).data.openedAt,null);
});

test('chốt lần đầu có phát sinh cũ và chốt lại sau điều chỉnh đều bị chặn, không ghi thêm',async()=>{
  const {db,call,mgr}=await setup();const {stockMoves}=await import('../../src/modules/inventory/schema.ts');
  // Historical invalid data is seeded directly; no new application write may create this state.
  await db.insert(stockMoves).values({id:'legacy',sku:'LY1',warehouseId:'ct',qty:1,kind:'adjust',refType:'adjustment',refId:'legacy',createdBy:'mgr',createdAt:now});
  let r=await call('/inventory/opening',mgr,'POST',{confirm:true});assert.equal(r.status,409);assert.match(r.data.error,/chưa chốt.*adjustment/);
  assert.equal((await db.select().from(stockMoves)).length,1);
  await db.delete(stockMoves);assert.equal((await call('/inventory/opening',mgr,'POST',{confirm:true})).status,200);
  assert.equal((await call('/inventory/adjustments',mgr,'POST',{warehouseId:'ct',reason:'Kiểm kê',lines:[{sku:'LY1',qty:1}]})).status,201);
  const before=await db.select().from(stockMoves);r=await call('/inventory/opening',mgr,'POST',{confirm:true});
  assert.equal(r.status,409);assert.match(r.data.error,/Dùng phiếu điều chỉnh để sửa lệch/);assert.deepEqual(await db.select().from(stockMoves),before);
});

test('thẻ kho lấy đủ hơn 1005 dòng, mới nhất và luỹ kế khớp số dư hiện tại',async()=>{
  const {db,call,mgr}=await setup();const {eq}=await import('drizzle-orm');const {stockMoves,stockBalances}=await import('../../src/modules/inventory/schema.ts');
  assert.equal((await call('/inventory/opening',mgr,'POST',{confirm:true})).status,200);
  await db.insert(stockMoves).values(Array.from({length:1005},(_,i)=>({id:'card-'+String(i).padStart(4,'0'),sku:'LY1',warehouseId:'ct',qty:1,kind:'adjust' as const,refType:'adjustment' as const,refId:'card-'+i,refNo:'DC-'+i,createdBy:'mgr',createdAt:'2090-10-01T00:00:00.000Z'})));
  await db.update(stockBalances).set({qty:1015}).where(eq(stockBalances.warehouseId,'ct'));
  const r=await call('/inventory/card?sku=LY1&warehouseId=ct',mgr);assert.equal(r.status,200);
  assert.equal(r.data.lines.length,1006);assert.equal(r.data.lines[0].refNo,'DC-1004');assert.equal(r.data.balance,1015);assert.equal(r.data.lines[0].balance,r.data.balance);
});
