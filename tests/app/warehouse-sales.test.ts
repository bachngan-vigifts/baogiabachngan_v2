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
import { packingSlipLines, packingSlips, salesOrderLines } from '../../src/modules/sales/schema.ts';
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
  assert.ok((await s.db.select().from(tasks).where(eq(tasks.autoKey, `transfer-approve:${t.data.id}`))).length);
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
  const capped = (await s.call('/stock-moves?warehouseId=vig&q=LIMIT', s.ml)).data.moves;
  assert.equal(capped.length, 1000);
  assert.equal(capped[0].balanceAfter, 1001, 'cộng cả dòng nằm ngoài giới hạn trả về');
  assert.equal(capped.at(-1).balanceAfter, 2);
  await postMoves(s.db as never, 'mgr', [{ sku: 'TZ', warehouseId: 'vig', qty: 2, kind: 'adjust', refType: 'adjustment', refId: 'tz-inside' }], '2026-10-02T18:00:00.000Z');
  await postMoves(s.db as never, 'mgr', [{ sku: 'TZ', warehouseId: 'vig', qty: 5, kind: 'adjust', refType: 'adjustment', refId: 'tz-outside' }], '2026-10-03T18:00:00.000Z');
  const vietnamDay = await s.call('/stock-moves?q=TZ&from=2026-10-03&to=2026-10-03', s.ml);
  assert.deepEqual(vietnamDay.data.moves.map((m: any) => [m.qty, m.balanceAfter]), [[2, 2]], 'lọc ngày theo giờ Việt Nam giống ngày trên bảng');
  assert.equal((await s.call('/stock-moves?from=2026-02-30', s.ml)).status, 400);

});
