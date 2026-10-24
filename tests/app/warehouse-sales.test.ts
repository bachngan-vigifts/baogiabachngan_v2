import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { stockBalances, warehouseSellers } from '../../src/modules/inventory/schema.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
import { deliveries, deliveryLines, packingSlipLines, packingSlips, salesOrderLines } from '../../src/modules/sales/schema.ts';
import { reconcileAutoTasks } from '../../src/modules/tasks/api/auto-tasks.ts';
import { tasks } from '../../src/modules/tasks/schema.ts';

/**
 * Kho bán theo chức vụ (docs/SO-KHO.md): Sale bán KHO VIGIFTS, NVBH bán SR Minh Long - Lock, Kế toán bán kho Hoá đơn (kho riêng);
 * duyệt đơn trừ kho bán, huỷ cộng lại; điều chuyển xin → duyệt → Kho chuyển; lịch sử xuất nhập.
 */
const origin = 'https://trial.test', now = '2026-10-01T00:00:00.000Z';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const pw = await hashPassword(PASSWORD, 1000);
  for (const [id, pos] of [['ketoan', 'accounting'], ['kho', 'warehouse'], ['ml', 'sales-ml']] as const) {
    await d1.sqlite.prepare(`INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES (?,?,?,'0900','employee',?,1,'2026-01-01T00:00:00.000Z')`).run(id, id + '@x.vn', 'Tên ' + id, pos);
    await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run(id, pw);
  }
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const } as never);
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => (await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), { db, passwordIterations: 1000 } as never)).headers.get('set-cookie')!.split(';')[0]!;
  await db.insert(warehouses).values([{ id: 'vig', name: 'KHO VIGIFTS', kind: 'stock' }, { id: 'ml', name: 'SR Minh Long - Lock', kind: 'stock' },
    { id: 'hd', name: 'Hoá đơn Lock', kind: 'stock', stockPrivate: true }]);
  await db.insert(warehouseSellers).values([{ warehouseId: 'vig', positionId: 'sale' }, { warehouseId: 'vig', positionId: 'sale-admin' },
    { warehouseId: 'ml', positionId: 'sales-ml' }, { warehouseId: 'ml', positionId: 'sales-lock' }, { warehouseId: 'hd', positionId: 'accounting' }]);
  await db.insert(products).values([{ sku: 'LY1', name: 'Ly sứ', unit: 'cái', updatedAt: now }]);
  await db.insert(productStock).values([{ sku: 'LY1', warehouseId: 'vig', quantity: 999, updatedAt: now }]);
  // Đã chốt tồn đầu kỳ: sổ kho là tồn chuẩn (tồn Sapo 999 không còn dùng cho các kho này).
  await postMoves(db as never, 'mgr', [{ sku: 'LY1', warehouseId: 'vig', qty: 50, kind: 'opening', refType: 'opening', refId: 'op1' },
    { sku: 'LY1', warehouseId: 'ml', qty: 20, kind: 'opening', refType: 'opening', refId: 'op1' }, { sku: 'LY1', warehouseId: 'hd', qty: 7, kind: 'opening', refType: 'opening', refId: 'op1' }]);
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), kt: await login('ketoan@x.vn'), kho: await login('kho@x.vn'), ml: await login('ml@x.vn') };
}
type S = Awaited<ReturnType<typeof setup>>;
const bal = async (s: S, wh: string) => (await s.db.select({ qty: stockBalances.qty }).from(stockBalances).where(and(eq(stockBalances.sku, 'LY1'), eq(stockBalances.warehouseId, wh))))[0]?.qty ?? 0;
async function quote(s: S, no: string, qty = 10) {
  const q = await s.call('/quotes', s.emp, 'POST', { type: 'B2B', quoteNo: no, customer: 'Khách ' + no, vat: 8, rows: [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty, price: 1000 }] });
  assert.equal(q.status, 201, JSON.stringify(q.data));
  assert.equal((await s.call(`/quotes/${q.data.id}/approve`, s.mgr, 'POST', { revision: 1 })).status, 200);
  return q.data.id as string;
}

test('đơn / HĐKT: chỉ bán từ kho của chức vụ; duyệt trừ kho bán, huỷ cộng lại; đóng gói không trừ lần hai', async () => {
  const s = await setup(), q1 = await quote(s, 'BG_K1');
  assert.equal((await s.call('/orders', s.emp, 'POST', { quoteId: q1, warehouseId: 'ml' })).data.code, 'WAREHOUSE_NOT_ALLOWED', 'Sale không bán từ kho Minh Long');
  const o = await s.call('/orders', s.emp, 'POST', { quoteId: q1 });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  const orderId = o.data.id as string;
  assert.equal((await s.call(`/orders/${orderId}`, s.emp)).data.order.warehouseId, 'vig', 'Sale chỉ bán một kho → tự chọn KHO VIGIFTS');
  const opts = (await s.call(`/orders/${orderId}/warehouses`, s.emp)).data;
  assert.deepEqual(opts.warehouses.map((w: any) => w.id), ['vig']);
  assert.equal(opts.warehouses[0].lines[0].stock, 50, 'tồn theo sổ kho, không theo Sapo');
  assert.equal(await bal(s, 'vig'), 50, 'nháp chưa trừ');
  assert.equal((await s.call(`/orders/${orderId}/packing`, s.emp)).data.soldWarehouseId, null, 'nháp chưa trừ kho → hộp đóng gói tính tồn như thường');
  assert.equal((await s.call(`/orders/${orderId}/status`, s.mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true })).status, 200);
  assert.equal(await bal(s, 'vig'), 40, 'duyệt → trừ 10 ở kho bán');
  assert.equal((await s.call(`/orders/${orderId}/packing`, s.emp)).data.soldWarehouseId, 'vig', 'hộp đóng gói biết hàng của đơn đã trừ ở kho bán (cộng lại, không báo thiếu giả)');
  // Hàng đã trừ lúc duyệt: phiếu đóng gói xuất đúng kho bán, không trừ lần hai.
  const [line] = await s.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));
  await s.db.insert(packingSlips).values({ id: 'ps1', slipNo: 'PĐG1', orderId, status: 'sent', createdBy: 'emp', createdAt: now, updatedAt: now });
  await s.db.insert(packingSlipLines).values({ id: 'psl1', slipId: 'ps1', orderLineId: line!.id, sku: 'LY1', name: 'Ly sứ', unit: 'cái', qty: 10 } as never);
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(200);
  assert.equal((await s.call('/packing/ps1/confirm', s.kho, 'POST', { warehouseId: 'ml', photos: [photo] })).status, 400, 'xuất sai kho bán');
  const ok = await s.call('/packing/ps1/confirm', s.kho, 'POST', { warehouseId: 'vig', photos: [photo] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(await bal(s, 'vig'), 40, 'đóng gói không trừ thêm');
  // Manager đổi kho bán đơn đã duyệt: chuyển phần đã trừ sang kho mới.
  assert.equal((await s.call(`/orders/${orderId}/warehouse`, s.emp, 'PUT', { warehouseId: 'ml' })).status, 403);
  // Huỷ không được vì đã đóng gói? Đơn chưa giao / chưa thu → huỷ được, hàng về lại kho bán.
  assert.equal((await s.call(`/orders/${orderId}/status`, s.mgr, 'PUT', { status: 'cancelled' })).status, 200);
  assert.equal(await bal(s, 'vig'), 50, 'huỷ → cộng lại');
});

test('Manager đổi kho bán đơn đã duyệt; duyệt đơn chưa có kho mà người phụ trách bán nhiều kho → bắt chọn kho', async () => {
  const s = await setup(), q = await quote(s, 'BG_K2', 4);
  const o = await s.call('/orders', s.mgr, 'POST', { quoteId: q, warehouseId: 'vig' });
  assert.equal(o.status, 201);
  assert.equal((await s.call(`/orders/${o.data.id}/status`, s.mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true })).status, 200);
  assert.equal(await bal(s, 'vig'), 46);
  assert.equal((await s.call(`/orders/${o.data.id}/warehouse`, s.mgr, 'PUT', { warehouseId: 'ml' })).status, 200);
  assert.deepEqual([await bal(s, 'vig'), await bal(s, 'ml')], [50, 16], 'chuyển phần đã trừ sang kho mới');
  // Bỏ kho của đơn nháp: Sale chỉ có một kho nên tự chọn khi duyệt.
  const q3 = await quote(s, 'BG_K3', 1), o3 = await s.call('/orders', s.emp, 'POST', { quoteId: q3 });
  assert.equal((await s.call(`/orders/${o3.data.id}/status`, s.mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true, warehouseId: 'hd' })).status, 200, 'Manager chọn mọi kho');
  assert.equal(await bal(s, 'hd'), 6);
});

test('kho Hoá đơn: chỉ Kế toán + Manager thấy tồn; Sale vẫn thấy tồn các kho khác', async () => {
  const s = await setup();
  const stockOf = async (cookie: string) => (await s.call('/products?skus=LY1', cookie)).data.products[0].stock;
  assert.deepEqual(await stockOf(s.emp), { vig: 50, ml: 20 });
  assert.deepEqual(await stockOf(s.kt), { vig: 50, ml: 20, hd: 7 });
  assert.deepEqual(await stockOf(s.mgr), { vig: 50, ml: 20, hd: 7 });
  const lookup = (await s.call('/inventory/lookup?q=LY1', s.emp)).data;
  assert.deepEqual(lookup.warehouses.map((w: any) => w.id).sort(), ['ml', 'vig']);
  const snap = (await s.call('/catalog-snapshot', s.emp)).data;
  assert.ok(!snap.warehouses.some((w: any) => w.id === 'hd'));
});

test('điều chuyển kho: NVBH xin → Manager duyệt → Kho chuyển; tồn không đủ thì không chuyển; việc tự sinh + Cần duyệt', async () => {
  const s = await setup();
  assert.equal((await s.call('/stock-transfers', s.ml, 'POST', { fromWarehouseId: 'vig', toWarehouseId: 'hd', reason: 'Thiếu hàng', lines: [{ sku: 'LY1', qty: 1 }] })).status, 400, 'không thấy kho Hoá đơn');
  const t = await s.call('/stock-transfers', s.ml, 'POST', { fromWarehouseId: 'vig', toWarehouseId: 'ml', reason: 'Khách lẻ cần 30 ly', lines: [{ sku: 'LY1', qty: 30 }] });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  assert.equal((await s.call('/approvals', s.mgr)).data.counts.transfer, 1);
  await reconcileAutoTasks(s.db as never);
  // Kho được xin (KHO VIGIFTS – chức vụ bán: sale, sale-admin): mỗi nhân viên kho đó một việc Cho / Từ chối.
  const [approveTask] = await s.db.select().from(tasks).where(eq(tasks.autoKey, `transfer-approve:${t.data.id}:emp`));
  assert.equal(approveTask?.assigneeId, 'emp');
  assert.equal((await s.call(`/stock-transfers/${t.data.id}/approve`, s.ml, 'POST', {})).status, 403);
  assert.equal((await s.call(`/stock-transfers/${t.data.id}/approve`, s.mgr, 'POST', { revision: 1 })).status, 200);
  assert.equal((await s.call(`/stock-transfers/${t.data.id}/done`, s.ml, 'POST', {})).status, 403, 'NVBH không bấm Đã chuyển');
  await reconcileAutoTasks(s.db as never);
  const [move] = await s.db.select().from(tasks).where(eq(tasks.autoKey, `transfer-move:${t.data.id}`));
  assert.equal(move?.assigneePosition, 'warehouse');
  const done = await s.call(`/stock-transfers/${t.data.id}/done`, s.kho, 'POST', {});
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.deepEqual([await bal(s, 'vig'), await bal(s, 'ml')], [20, 50]);
  assert.equal((await s.call(`/stock-transfers/${t.data.id}/done`, s.kho, 'POST', {})).status, 409, 'chuyển một lần');
  const t2 = await s.call('/stock-transfers', s.ml, 'POST', { fromWarehouseId: 'vig', toWarehouseId: 'ml', reason: 'Thêm nữa', lines: [{ sku: 'LY1', qty: 99 }] });
  await s.call(`/stock-transfers/${t2.data.id}/approve`, s.mgr, 'POST', {});
  assert.equal((await s.call(`/stock-transfers/${t2.data.id}/done`, s.kho, 'POST', {})).data.code, 'TRANSFER_SHORT');
  // Lịch sử xuất nhập: nhóm "Điều chuyển"; NVBH không thấy kho Hoá đơn.
  const hist = (await s.call('/stock-moves?group=transfer', s.ml)).data;
  assert.deepEqual(hist.moves.map((m: any) => [m.warehouseId, m.qty]).sort(), [['ml', 30], ['vig', -30]]);
  assert.ok(!(await s.call('/stock-moves', s.ml)).data.moves.some((m: any) => m.warehouseId === 'hd'));
});

test('Sổ kho (như Sapo): tồn sau giao dịch tính trước khi lọc, dòng tổng theo bộ lọc, phân trang, lọc nhãn hiệu / trạng thái, link chứng từ', async () => {
  const s = await setup();
  await s.db.insert(products).values({ sku: 'BT1', name: 'Bình giữ nhiệt', unit: 'cái', brand: 'Lock&Lock', active: false, updatedAt: now });
  // Fixture hợp lệ: tồn đầu 10 → xuất 8 còn 2 → nhập 8 trở lại 10; không dùng tồn âm để kiểm thẻ kho.
  await postMoves(s.db as never, 'mgr', [{ sku: 'BT1', warehouseId: 'vig', qty: 10, kind: 'opening', refType: 'opening', refId: 'op2', refNo: 'ĐK' }], '2026-10-18T01:00:00.000Z');
  await postMoves(s.db as never, 'mgr', [{ sku: 'BT1', warehouseId: 'vig', qty: -8, kind: 'sale', refType: 'sales_order', refId: 'o1#ab12', refNo: 'DH_002' }], '2026-10-22T08:15:00.000Z');
  await postMoves(s.db as never, 'mgr', [{ sku: 'BT1', warehouseId: 'vig', qty: 8, kind: 'receipt', refType: 'supplier_receipt', refId: 'r-none', refNo: 'PNH_004' }], '2026-10-22T09:50:00.000Z');
  const get = async (q: string, who = s.mgr) => (await s.call('/stock-moves?' + q, who)).data;
  const all = await get('q=BT1');
  assert.equal(all.total, 3); assert.deepEqual(all.totals, { inQty: 18, outQty: 8 });
  assert.deepEqual(all.moves.map((m: any) => [m.refNo, m.inQty, m.outQty, m.balanceAfter, m.warehouse]), [['PNH_004', 8, 0, 10, 'KHO VIGIFTS'], ['DH_002', 0, 8, 2, 'KHO VIGIFTS'], ['ĐK', 10, 0, 10, 'KHO VIGIFTS']]);
  assert.deepEqual(all.moves.map((m: any) => m.description), ['Nhập hàng vào kho', 'Xuất kho bán hàng (duyệt đơn / HĐKT)', 'Chốt tồn đầu kỳ']);
  assert.equal(all.moves[1].link, '#/orders/o1', 'dòng sửa đơn (refId có hậu tố #) vẫn mở đơn gốc');
  assert.equal(all.moves[0].link, '', 'phiếu nhận không còn → không có link');
  assert.equal(all.moves[0].active, false); assert.equal(all.moves[0].brand, 'Lock&Lock');
  const today = await get('q=BT1&from=2026-10-22&to=2026-10-22');
  assert.equal(today.total, 2); assert.deepEqual(today.moves.map((m: any) => m.balanceAfter), [10, 2], 'lọc ngày không làm sai tồn sau giao dịch');
  assert.deepEqual(today.totals, { inQty: 8, outQty: 8 });
  assert.equal((await get('q=BT1&to=2026-10-21')).moves[0].balanceAfter, 10);
  assert.deepEqual((await get('q=BT1&group=in')).moves.map((m: any) => m.refNo), ['PNH_004']);
  assert.deepEqual((await get('q=BT1&group=sale')).moves.map((m: any) => m.refNo), ['DH_002']);
  const p2 = await get('q=BT1&page=2&size=20'); assert.equal(p2.total, 3); assert.equal(p2.moves.length, 0);
  assert.equal((await get('q=BT1&size=7')).size, 20, 'cỡ trang lạ → 20');
  // Lịch sử sản phẩm (thẻ sản phẩm): đúng một mã, tồn trước → +/− → tồn sau.
  const bySku = await get('sku=BT1');
  assert.deepEqual(bySku.moves.map((m: any) => [m.balanceBefore, m.qty, m.balanceAfter]), [[2, 8, 10], [10, -8, 2], [0, 10, 10]]);
  assert.equal((await get('sku=BT')).total, 0, 'sku lọc đúng mã, không tìm gần đúng');
  assert.ok(all.brands.includes('Lock&Lock'));
  assert.deepEqual([...new Set((await get('brand=' + encodeURIComponent('Lock&Lock'))).moves.map((m: any) => m.sku))], ['BT1']);
  assert.deepEqual([...new Set((await get('status=inactive')).moves.map((m: any) => m.sku))], ['BT1']);
  assert.equal((await get('q=BT1&status=active')).total, 0);
  // Kho riêng (Hoá đơn) không lộ qua Sổ kho với người không bán kho đó; tổng cũng không tính kho đó.
  const ml = await get('', s.ml);
  assert.ok(!ml.warehouses.some((w: any) => w.id === 'hd')); assert.ok(!ml.moves.some((m: any) => m.warehouseId === 'hd'));
  assert.equal((await get('warehouseId=hd', s.ml)).total, 0);
  // Ngày theo giờ Việt Nam: 22/10 05:00 (VN) = 21/10 22:00 UTC vẫn thuộc ngày 22/10.
  await postMoves(s.db as never, 'mgr', [{ sku: 'BT1', warehouseId: 'vig', qty: 1, kind: 'adjust', refType: 'adjustment', refId: 'adj-early', refNo: 'ĐC-SOM' }], '2026-10-21T22:00:00.000Z');
  assert.ok((await get('q=BT1&from=2026-10-22&to=2026-10-22')).moves.some((m: any) => m.refNo === 'ĐC-SOM'));
  assert.ok(!(await get('q=BT1&from=2026-10-21&to=2026-10-21')).moves.some((m: any) => m.refNo === 'ĐC-SOM'));
});

test('cấu hình kho bán: chỉ Manager / quyền phân quyền', async () => {
  const s = await setup();
  assert.equal((await s.call('/warehouse-sellers', s.emp)).status, 403);
  const r = await s.call('/warehouse-sellers', s.mgr, 'PUT', { warehouses: [{ id: 'ml', positions: ['sales-ml', 'sales-lock', 'sale'], stockPrivate: false }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.warehouses.find((w: any) => w.id === 'ml').positions.sort(), ['sale', 'sales-lock', 'sales-ml']);
});

test('lịch sử kiểu thẻ kho: tồn sau phát sinh tính toàn lịch sử trước bộ lọc, tách từng mã/kho, giữ kín kho riêng', async () => {
  const s = await setup();
  const { stockMoves } = await import('../../src/modules/inventory/schema.ts');
  await s.db.update(stockMoves).set({ createdAt: '2026-10-01T00:00:00.000Z' });
  await postMoves(s.db as never, 'mgr', [
    { sku: 'LY1', warehouseId: 'vig', qty: 8, kind: 'receipt', refType: 'supplier_receipt', refId: 'history-in', refNo: 'PNH-history' },
    { sku: 'OTHER', warehouseId: 'vig', qty: 900, kind: 'opening', refType: 'opening', refId: 'history-other' },
  ], '2026-10-02T00:00:00.000Z');
  // Equal timestamps use the same deterministic id order as the displayed history.
  await s.db.insert(stockMoves).values([
    { id: 'history-a', sku: 'LY1', warehouseId: 'vig', qty: -3, kind: 'sale', refType: 'sales_order', refId: 'history-sale-a', refNo: 'DH-history-a', createdBy: 'mgr', createdAt: '2026-10-03T00:00:00.000Z' },
    { id: 'history-b', sku: 'LY1', warehouseId: 'vig', qty: -2, kind: 'sale', refType: 'sales_order', refId: 'history-sale-b', refNo: 'DH-history-b', createdBy: 'mgr', createdAt: '2026-10-03T00:00:00.000Z' },
  ]);
  const all = await s.call('/stock-moves?q=LY1', s.ml);
  assert.equal(all.status, 200, JSON.stringify(all.data));
  assert.deepEqual(all.data.moves.filter((m: any) => m.id.startsWith('history-')).map((m: any) => [m.id, m.balanceAfter]), [['history-b', 53], ['history-a', 55]]);
  assert.ok(!all.data.moves.some((m: any) => m.warehouseId === 'hd'));
  assert.equal(all.data.moves.find((m: any) => m.warehouseId === 'ml').balanceAfter, 20);
  const filtered = await s.call('/stock-moves?warehouseId=vig&group=sale&from=2026-10-03&to=2026-10-03&q=DH-history-b', s.ml);
  assert.equal(filtered.status, 200, JSON.stringify(filtered.data));
  assert.deepEqual(filtered.data.moves.map((m: any) => [m.qty, m.balanceAfter, m.link]), [[-2, 53, '#/orders/history-sale-b']]);
  assert.equal((await s.call('/stock-moves?warehouseId=hd', s.ml)).data.moves.length, 0);
  assert.equal((await s.call('/stock-moves?warehouseId=hd', s.mgr)).data.moves[0].balanceAfter, 7);
  await s.db.insert(stockMoves).values(Array.from({ length: 1001 }, (_, i) => ({
    id: 'history-limit-' + String(i).padStart(4, '0'), sku: 'LIMIT', warehouseId: 'vig', qty: 1,
    kind: 'adjust' as const, refType: 'adjustment' as const, refId: 'limit-' + i, createdBy: 'mgr', createdAt: '2026-10-04T00:00:00.000Z',
  })));
  // Sổ kho phân trang: trang đầu vẫn cộng cả các dòng nằm ở trang sau; trang cuối là dòng cũ nhất.
  const first = (await s.call('/stock-moves?warehouseId=vig&q=LIMIT&size=200', s.ml)).data;
  assert.equal(first.moves.length, 200); assert.equal(first.total, 1001);
  assert.equal(first.moves[0].balanceAfter, 1001, 'cộng cả dòng nằm ngoài trang trả về');
  const last = (await s.call('/stock-moves?warehouseId=vig&q=LIMIT&size=200&page=6', s.ml)).data.moves;
  assert.equal(last.length, 1); assert.equal(last[0].balanceAfter, 1);
  await postMoves(s.db as never, 'mgr', [{ sku: 'TZ', warehouseId: 'vig', qty: 2, kind: 'adjust', refType: 'adjustment', refId: 'tz-inside' }], '2026-10-02T18:00:00.000Z');
  await postMoves(s.db as never, 'mgr', [{ sku: 'TZ', warehouseId: 'vig', qty: 5, kind: 'adjust', refType: 'adjustment', refId: 'tz-outside' }], '2026-10-03T18:00:00.000Z');
  const vietnamDay = await s.call('/stock-moves?q=TZ&from=2026-10-03&to=2026-10-03', s.ml);
  assert.deepEqual(vietnamDay.data.moves.map((m: any) => [m.qty, m.balanceAfter]), [[2, 2]], 'lọc ngày theo giờ Việt Nam giống ngày trên bảng');
  assert.equal((await s.call('/stock-moves?from=2026-02-30', s.ml)).status, 400);

});

test('kho riêng ẩn trên compare, card, status và stock-warehouses; Manager thấy đủ',async()=>{
  const s=await setup();
  assert.equal((await s.call('/permissions/positions/sales-ml',s.mgr,'PUT',{perms:['inventory.view']})).status,200);
  const visible=(await s.call('/inventory/status',s.ml)).data;
  assert.ok(!visible.warehouses.some((w:any)=>w.id==='hd'));assert.equal(visible.moveCount,2);
  assert.ok(!(await s.call('/stock-warehouses',s.ml)).data.warehouses.some((w:any)=>w.id==='hd'));
  assert.ok(!(await s.call('/inventory/compare?diff=0',s.ml)).data.rows.some((w:any)=>w.warehouseId==='hd'));
  assert.equal((await s.call('/inventory/compare?warehouseId=hd',s.ml)).status,403);
  assert.equal((await s.call('/inventory/card?sku=LY1&warehouseId=hd',s.ml)).status,403);
  assert.equal((await s.call('/inventory/card?sku=LY1&warehouseId=hd',s.mgr)).data.balance,7);
  assert.equal((await s.call('/inventory/status',s.mgr)).data.warehouses.length,3);
  assert.equal((await s.call('/stock-warehouses',s.mgr)).data.warehouses.length,3);
  assert.equal((await s.call('/inventory/compare?diff=0',s.mgr)).data.rows.find((w:any)=>w.warehouseId==='hd').ledger,7);
});

test('kế hoạch báo giá: duyệt trước, xuất từng phần; thiếu nguồn bổ sung không làm âm kho', async () => {
  const s=await setup(), q=await quote(s,'BG_PLAN',70);
  const options=await s.call(`/quotes/${q}/stock-plan`,s.emp);
  assert.equal(options.status,200,JSON.stringify(options.data));
  assert.equal(options.data.lines[0].stock.vig,50);
  assert.equal(options.data.warehouses.some((w:any)=>w.id==='hd'),false,'kho riêng bị ẩn');
  const plan=[{sku:'LY1',qty:50,type:'stock',note:'KHO VIGIFTS'},{sku:'LY1',qty:20,type:'transfer',note:'SR Minh Long - Lock'}];
  const created=await s.call('/orders',s.emp,'POST',{quoteId:q,warehouseId:'vig',stockPlan:plan});
  assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.id;
  let slips=await s.db.select().from(packingSlips).where(eq(packingSlips.orderId,id));
  assert.equal(slips.length,2);assert.equal(slips.reduce((n,x)=>n+x.totalQty,0),70);
  assert.equal(await bal(s,'vig'),50);
  assert.equal((await s.call(`/packing/${slips[0]!.id}/send`,s.emp,'POST',{})).status,409,'không gửi kho khi chưa duyệt');
  const wrongWarehouse=await s.call(`/orders/${id}/status`,s.mgr,'PUT',{status:'confirmed',warehouseId:'ml',verified:true,costWarningsReviewed:true});
  assert.equal(wrongWarehouse.data.code,'STOCK_PLAN_IN_USE');
  const approved=await s.call(`/orders/${id}/status`,s.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true});
  assert.equal(approved.status,200,JSON.stringify(approved.data));assert.equal(await bal(s,'vig'),50,'duyệt kế hoạch chưa ghi xuất');
  const change=await s.call(`/orders/${id}/warehouse`,s.mgr,'PUT',{warehouseId:'ml'});
  assert.equal(change.data.code,'STOCK_PLAN_IN_USE');
  const [line]=await s.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,id));
  // Approval now creates the initial full trip; cancel it explicitly to exercise two partial trips.
  const [initialTrip]=await s.db.select().from(deliveries).where(eq(deliveries.orderId,id));
  assert.ok(initialTrip);
  assert.equal((await s.call(`/deliveries/${initialTrip.id}/status`,s.emp,'PUT',{status:'cancelled'})).status,200);
  const scheduled=await s.call('/deliveries',s.emp,'POST',{orderId:id,plannedDate:'2026-10-24',lines:[{orderLineId:line!.id,qty:50}]});
  assert.equal(scheduled.status,201,JSON.stringify(scheduled.data));
  const second=await s.call('/deliveries',s.emp,'POST',{orderId:id,plannedDate:'2026-10-25',lines:[{orderLineId:line!.id,qty:20}]});
  assert.equal(second.status,201,JSON.stringify(second.data));
  const premature=await s.call(`/deliveries/${scheduled.data.id}/status`,s.emp,'PUT',{status:'delivered'});
  assert.equal(premature.status,409);assert.equal(premature.data.code,'STOCK_NOT_PACKED');
  const photo='data:image/jpeg;base64,'+'A'.repeat(200);
  const stockSlip=slips.find(x=>x.totalQty===50)!, waiting=slips.find(x=>x.totalQty===20)!;
  for(const slip of [stockSlip,waiting])assert.equal((await s.call(`/packing/${slip.id}/send`,s.emp,'POST',{})).status,200);
  const confirm=await s.call(`/packing/${stockSlip.id}/confirm`,s.kho,'POST',{warehouseId:'vig',photos:[photo]});
  assert.equal(confirm.status,200,JSON.stringify(confirm.data));assert.equal(await bal(s,'vig'),0);
  assert.equal((await s.call(`/deliveries/${scheduled.data.id}/status`,s.emp,'PUT',{status:'in_transit'})).status,200);
  const tooSoon=await s.call(`/deliveries/${second.data.id}/status`,s.emp,'PUT',{status:'in_transit'});assert.equal(tooSoon.data.code,'STOCK_NOT_PACKED');
  const short=await s.call(`/packing/${waiting.id}/confirm`,s.kho,'POST',{warehouseId:'vig',photos:[photo]});
  assert.equal(short.status,409);assert.equal(short.data.code,'STOCK_SHORT');
  assert.equal((await s.db.select().from(packingSlips).where(eq(packingSlips.id,waiting.id)))[0]!.status,'sent');
  await postMoves(s.db,'mgr',[{sku:'LY1',warehouseId:'vig',qty:20,kind:'adjust',refType:'adjustment',refId:'replenished'}]);
  assert.equal((await s.call(`/packing/${waiting.id}/confirm`,s.kho,'POST',{warehouseId:'vig',photos:[photo]})).status,200);
  assert.equal(await bal(s,'vig'),0);
  assert.equal((await s.call(`/deliveries/${second.data.id}/status`,s.emp,'PUT',{status:'in_transit'})).status,200);
  const cancelling=await s.call(`/orders/${id}/status`,s.mgr,'PUT',{status:'cancelled'});
  assert.equal(cancelling.status,409);assert.equal(cancelling.data.code,'RETURN_REQUIRED');
  assert.equal(await bal(s,'vig'),0,'hàng đang vận chuyển không tự trở về kho');
});

test('kế hoạch báo giá: sai tổng rollback cả đơn; HĐKT lưu phiếu nháp và không trừ kho khi duyệt', async()=>{
  const s=await setup(),q=await quote(s,'BG_PLAN_CONTRACT',70);
  const bad=await s.call('/orders',s.emp,'POST',{quoteId:q,warehouseId:'vig',stockPlan:[{sku:'LY1',qty:50,type:'stock'}]});
  assert.equal(bad.status,400);assert.equal(bad.data.code,'STOCK_PLAN_INVALID');
  assert.equal((await s.db.select().from(packingSlips)).length,0);
  const contract=await s.call('/contracts',s.emp,'POST',{quoteId:q,contractNo:'TEST-PLAN',legalEntity:'BN',warehouseId:'vig',stockPlan:[{sku:'LY1',qty:50,type:'stock'},{sku:'LY1',qty:20,type:'incoming',note:'Phiếu xin lấy trước'}]});
  // Contract numbering requires a customer code even for an explicitly supplied number.
  assert.equal(contract.status,400);assert.match(contract.data.error,/mã khách hàng|MST/);
  const {quotations}=await import('../../src/modules/quotes/schema.ts');
  const [qr]=await s.db.select().from(quotations).where(eq(quotations.id,q));const data=JSON.parse(qr!.data);data.customerTaxCode='1800000000';
  await s.db.update(quotations).set({data:JSON.stringify(data)}).where(eq(quotations.id,q));
  const k=await s.call('/contracts',s.emp,'POST',{quoteId:q,contractNo:'TEST-PLAN',legalEntity:'BN',warehouseId:'vig',stockPlan:[{sku:'LY1',qty:50,type:'stock'},{sku:'LY1',qty:20,type:'incoming',note:'Phiếu xin lấy trước'}]});
  assert.equal(k.status,201,JSON.stringify(k.data));
  assert.equal((await s.db.select().from(packingSlips).where(eq(packingSlips.orderId,k.data.orderId))).length,2);
  const approved=await s.call(`/orders/${k.data.orderId}/status`,s.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true});
  assert.equal(approved.status,200,JSON.stringify(approved.data));assert.equal(await bal(s,'vig'),50);
});


test('kế hoạch đã đóng nhưng chưa bàn giao: huỷ hoàn đúng các phần đã xuất tại kho, không cộng hai lần',async()=>{
 const s=await setup(),q=await quote(s,'BG_PLAN_CANCEL',10);
 const o=await s.call('/orders',s.emp,'POST',{quoteId:q,warehouseId:'vig',stockPlan:[{sku:'LY1',qty:5,type:'stock'},{sku:'LY1',qty:5,type:'purchase',note:'NCC đã bổ sung'}]});assert.equal(o.status,201);
 const id=o.data.id;assert.equal((await s.call(`/orders/${id}/status`,s.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true})).status,200);
 // #266: duyệt đơn có kế hoạch đóng gói tự tạo chuyến giao đầu cho cả 10 (không lập tay thêm được).
 const {deliveries}=await import('../../src/modules/sales/schema.ts');
 assert.equal((await s.db.select().from(deliveries).where(eq(deliveries.orderId,id))).length,1);
 for(const p of await s.db.select().from(packingSlips).where(eq(packingSlips.orderId,id))){
  assert.equal((await s.call(`/packing/${p.id}/send`,s.emp,'POST',{})).status,200);
  assert.equal((await s.call(`/packing/${p.id}/confirm`,s.kho,'POST',{warehouseId:'vig',photos:['data:image/jpeg;base64,'+'A'.repeat(200)]})).status,200);
 }
 assert.equal(await bal(s,'vig'),40);
 assert.equal((await s.call(`/orders/${id}/status`,s.mgr,'PUT',{status:'cancelled'})).status,200);assert.equal(await bal(s,'vig'),50);
 const again=await s.call(`/orders/${id}/status`,s.mgr,'PUT',{status:'cancelled'});assert.equal(again.status,403);assert.equal(await bal(s,'vig'),50);
});

test('đơn bán hiển thị đơn mua theo báo giá nguồn; không nhân đôi liên kết cho nhiều mã và bỏ đơn mua đã huỷ',async()=>{
 const s=await setup(),qid=await quote(s,'BG_PO_LINK',10);
 const supplier=await s.call('/suppliers',s.mgr,'POST',{name:'NCC kiểm thử liên kết'});assert.equal(supplier.status,201,JSON.stringify(supplier.data));
 const po=await s.call('/purchase-orders',s.emp,'POST',{orders:[{supplierId:supplier.data.supplier.id,warehouse:'KHO VIGIFTS',lines:[{sku:'LY1',quantity:10,sources:[{type:'quote',id:qid,quantity:10}]}]}]});assert.equal(po.status,201,JSON.stringify(po.data));
 const order=await s.call('/orders',s.emp,'POST',{quoteId:qid,stockPlan:[{sku:'LY1',qty:10,type:'purchase',note:'NCC kiểm thử liên kết · #/purchases/'+po.data.ids[0]}]});assert.equal(order.status,201,JSON.stringify(order.data));
 let detail=await s.call('/orders/'+order.data.id,s.emp);assert.equal(detail.status,200,JSON.stringify(detail.data));assert.equal(detail.data.purchases.length,1);assert.equal(detail.data.purchases[0].id,po.data.ids[0]);
 const cancel=await s.call('/purchase-orders/'+po.data.ids[0]+'/cancel',s.emp,'POST',{reason:'Kiểm thử huỷ nháp'});assert.equal(cancel.status,200,JSON.stringify(cancel.data));
 detail=await s.call('/orders/'+order.data.id,s.emp);assert.equal(detail.data.purchases.length,0);
});

test('điều chuyển chờ duyệt: sửa đúng quyền/revision, rollback lỗi; clientKey chống tạo trùng không ghi sổ',async()=>{
  const s=await setup();
  const {stockTransfers,stockTransferLines,stockMoves}=await import('../../src/modules/inventory/schema.ts');
  const before=JSON.stringify(await s.db.select().from(stockBalances));const beforeMoves=(await s.db.select().from(stockMoves)).length;
  const body={clientKey:'f35aa278-5a96-4fca-b00f-1d30db677698',fromWarehouseId:'vig',toWarehouseId:'ml',reason:'Cần hàng',lines:[{sku:'LY1',qty:10}]};
  const concurrent=await Promise.all([s.call('/stock-transfers',s.emp,'POST',body),s.call('/stock-transfers',s.emp,'POST',body)]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,201]);
  const made=concurrent.find(r=>r.status===201)!;const id=made.data.id,path='/stock-transfers/'+id;
  const retry=await s.call('/stock-transfers',s.emp,'POST',body);assert.equal(retry.status,200);assert.equal(retry.data.replayed,true);assert.equal(retry.data.id,id);
  assert.equal((await s.db.select().from(stockTransfers)).length,1);
  assert.equal((await s.call('/stock-transfers',s.emp,'POST',{...body,lines:[{sku:'LY1',qty:11}]})).status,409);
  assert.equal(made.data.actions.edit,true);
  const edit={...body,revision:made.data.revision,reason:'Sửa số lượng',lines:[{sku:'LY1',qty:12}]};
  assert.equal((await s.call(path,s.kho,'PUT',edit)).status,403);
  assert.equal((await s.call(path,s.emp,'PUT',{...edit,revision:undefined})).status,400);
  const changed=await s.call(path,s.emp,'PUT',edit);assert.equal(changed.status,200);assert.equal(changed.data.transferNo,made.data.transferNo);assert.equal(changed.data.status,'pending');assert.equal(changed.data.lines[0].qty,12);assert.equal(changed.data.revision,made.data.revision+1);
  assert.equal((await s.call(path,s.emp,'PUT',edit)).status,409);
  const revision=changed.data.revision;
  for(const bad of [{lines:[{sku:'BAD',qty:1}]},{lines:[{sku:'LY1',qty:0}]},{toWarehouseId:'hd'},{toWarehouseId:'vig'}])assert.equal((await s.call(path,s.emp,'PUT',{...edit,revision,...bad})).status,400);
  const stored=await s.call(path,s.emp);assert.equal(stored.data.revision,revision);assert.equal(stored.data.lines[0].qty,12);
  const manager=await s.call(path,s.mgr,'PUT',{...edit,revision,lines:[{sku:'LY1',qty:15}]});assert.equal(manager.status,200);
  assert.equal((await s.db.select().from(stockTransferLines)).length,1);
  assert.equal(JSON.stringify(await s.db.select().from(stockBalances)),before);assert.equal((await s.db.select().from(stockMoves)).length,beforeMoves);
  await s.call(path+'/approve',s.mgr,'POST',{revision:manager.data.revision});
  assert.equal((await s.call(path,s.emp,'PUT',{...edit,revision:manager.data.revision+1})).status,409);
  assert.equal((await s.call(path,s.emp)).data.actions.edit,false);
});

test('kế hoạch nguồn hàng: duyệt tự có lịch; gửi phiếu cũ bổ sung lịch thiếu một lần và không nhân đôi phiếu/tồn',async()=>{
  const s=await setup(),q=await quote(s,'BG_PLAN_SCHEDULE',50);
  const made=await s.call('/orders',s.emp,'POST',{quoteId:q,warehouseId:'vig',deliveryDate:'2026-10-28',stockPlan:[{sku:'LY1',qty:30,type:'stock'},{sku:'LY1',qty:20,type:'transfer',note:'SR'}]});
  assert.equal(made.status,201,JSON.stringify(made.data));const id=made.data.id;
  assert.equal((await s.db.select().from(deliveries).where(eq(deliveries.orderId,id))).length,0,'chưa duyệt không lên lịch');
  assert.equal((await s.call(`/orders/${id}/status`,s.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true})).status,200);
  const trips=await s.db.select().from(deliveries).where(eq(deliveries.orderId,id));assert.equal(trips.length,1);assert.equal(trips[0]!.plannedDate,'2026-10-28');
  assert.equal((await s.db.select().from(deliveryLines).where(eq(deliveryLines.deliveryId,trips[0]!.id))).reduce((n,l)=>n+l.qty,0),50);
  const slips=await s.db.select().from(packingSlips).where(eq(packingSlips.orderId,id));assert.equal(slips.length,2);
  const packing=await s.call(`/orders/${id}/packing`,s.emp);assert.equal(packing.data.scheduled,true);assert.equal(packing.data.lines.every((l:any)=>l.left===0),true);
  // Simulate legacy quote stock plans created without a trip, as reported in production.
  await s.db.delete(deliveryLines).where(eq(deliveryLines.deliveryId,trips[0]!.id));await s.db.delete(deliveries).where(eq(deliveries.id,trips[0]!.id));
  const before=await bal(s,'vig');
  const sent=await Promise.all(slips.map(slip=>s.call(`/packing/${slip.id}/send`,s.emp,'POST',{})));
  sent.forEach(r=>assert.equal(r.status,200,JSON.stringify(r.data)));
  assert.equal((await s.db.select().from(deliveries).where(eq(deliveries.orderId,id))).length,1);
  assert.equal((await s.db.select().from(packingSlips).where(eq(packingSlips.orderId,id))).length,2);assert.equal(await bal(s,'vig'),before);
  assert.equal((await s.call(`/packing/${slips[0]!.id}/send`,s.emp,'POST',{})).status,409,'gửi lại không sinh thêm lịch');
});

test('lịch mặc định đóng gói: không tự phục hồi chuyến đã huỷ và không tạo lịch khi người gửi thiếu quyền',async()=>{
  const s=await setup(),q=await quote(s,'BG_CANCEL_TRIP',10);
  const made=await s.call('/orders',s.emp,'POST',{quoteId:q,warehouseId:'vig',stockPlan:[{sku:'LY1',qty:10,type:'stock'}]});
  assert.equal(made.status,201);
  assert.equal((await s.call(`/orders/${made.data.id}/status`,s.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true})).status,200);
  const [slip]=await s.db.select().from(packingSlips).where(eq(packingSlips.orderId,made.data.id));
  const [trip]=await s.db.select().from(deliveries).where(eq(deliveries.orderId,made.data.id));
  assert.equal((await s.call(`/deliveries/${trip!.id}/status`,s.emp,'PUT',{status:'cancelled'})).status,200);
  const forbidden=await s.call(`/packing/${slip!.id}/send`,s.ml,'POST',{});assert.ok([403,404].includes(forbidden.status));
  const send=await s.call(`/packing/${slip!.id}/send`,s.emp,'POST',{});assert.equal(send.status,409);assert.equal(send.data.code,'NO_DELIVERY_SCHEDULE');
  const rows=await s.db.select().from(deliveries).where(eq(deliveries.orderId,made.data.id));assert.equal(rows.length,1);assert.equal(rows[0]!.status,'cancelled');
  assert.equal((await s.db.select().from(packingSlips).where(eq(packingSlips.id,slip!.id)))[0]!.status,'draft');
});

test('phiếu xin hàng: nhân viên kho được xin Cho / Từ chối (không tự duyệt phiếu mình xin), tự bấm Đã chuyển; chờ quá 1 giờ thì nhắc mỗi giờ', async () => {
  const s = await setup();
  const { webNotifications } = await import('../../src/modules/notifications/schema.ts');
  const { remindPendingTransfers } = await import('../../src/modules/inventory/api/transfer-routes.ts');
  // NV Minh Long (sales-ml) xin từ KHO VIGIFTS: emp (sale, bán KHO VIGIFTS) được Cho; kế toán (không bán kho này) không được.
  const t = await s.call('/stock-transfers', s.ml, 'POST', { fromWarehouseId: 'vig', toWarehouseId: 'ml', reason: 'Đơn khách A', lines: [{ sku: 'LY1', qty: 5 }] });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  const notes = await s.db.select().from(webNotifications).where(eq(webNotifications.eventType, 'transfer_pending'));
  assert.ok(notes.some(n => n.targetMemberId === 'emp'), 'nhân viên kho được xin nhận thông báo');
  assert.equal((await s.call(`/stock-transfers/${t.data.id}`, s.emp)).data.actions.approve, true);
  assert.equal((await s.call(`/stock-transfers/${t.data.id}`, s.kt)).data.actions.approve, false);
  assert.equal((await s.call(`/stock-transfers/${t.data.id}/approve`, s.kt, 'POST', {})).status, 403);
  assert.equal((await s.call(`/stock-transfers/${t.data.id}/reject`, s.kt, 'POST', { reason: 'không' })).status, 403);
  // Chờ quá 1 giờ: nhắc emp + Manager; cùng giờ không nhắc lại, sang giờ sau nhắc tiếp.
  const created = Date.parse((await s.call(`/stock-transfers/${t.data.id}`, s.emp)).data.createdAt);
  const reminders = async () => (await s.db.select().from(webNotifications).where(eq(webNotifications.eventType, 'transfer_pending_reminder'))).map(n => n.targetMemberId).sort();
  assert.equal(await remindPendingTransfers({ db: s.db } as never, new Date(created + 30 * 60_000)), 0, 'chưa đủ 1 giờ');
  assert.equal(await remindPendingTransfers({ db: s.db } as never, new Date(created + 61 * 60_000)), 1);
  const first = await reminders();
  assert.ok(first.includes('emp') && first.includes('mgr') && !first.includes('ml') && !first.includes('ketoan'), JSON.stringify(first));
  assert.equal(await remindPendingTransfers({ db: s.db } as never, new Date(created + 100 * 60_000)), 0, 'cùng giờ không nhắc lại');
  assert.equal(await remindPendingTransfers({ db: s.db } as never, new Date(created + 125 * 60_000)), 1, 'giờ sau nhắc tiếp');
  // emp Cho → tự bấm Đã chuyển (cửa hàng không có nhóm Kho riêng).
  assert.equal((await s.call(`/stock-transfers/${t.data.id}/approve`, s.emp, 'POST', {})).status, 200);
  const shipped = await s.call(`/stock-transfers/${t.data.id}/done`, s.emp, 'POST', {});
  assert.equal(shipped.status, 200, JSON.stringify(shipped.data));
  assert.deepEqual([await bal(s, 'vig'), await bal(s, 'ml')], [45, 25]);
  assert.equal(await remindPendingTransfers({ db: s.db } as never, new Date(created + 200 * 60_000)), 0, 'đã xử lý thì thôi nhắc');
  // Không tự duyệt phiếu mình xin: emp xin từ VIGIFTS (kho mình bán) phải chờ người khác / Manager.
  const own = await s.call('/stock-transfers', s.emp, 'POST', { fromWarehouseId: 'vig', toWarehouseId: 'ml', reason: 'Tự xin', lines: [{ sku: 'LY1', qty: 1 }] });
  assert.equal((await s.call(`/stock-transfers/${own.data.id}/approve`, s.emp, 'POST', {})).status, 403);
  const rejected = await s.call(`/stock-transfers/${own.data.id}/reject`, s.mgr, 'POST', { reason: 'Kho đang kiểm kê' });
  assert.equal(rejected.status, 200, 'Manager vẫn duyệt / từ chối thay');
});
