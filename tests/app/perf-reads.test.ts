import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { clearBadgeCache, BADGE_TTL_MS } from '../../src/app/badge-routes.ts';
import { syncAutoTasks } from '../../src/modules/tasks/api/routes.ts';
import { tasks } from '../../src/modules/tasks/schema.ts';
import { products, productBarcodes, productPrices, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { posScanCodes } from '../../src/modules/sales/api/pos-stock-snapshot.ts';
import { salesOrders, salesOrderLines, stockHolds } from '../../src/modules/sales/schema.ts';
import { posRegisters } from '../../src/modules/sales/pos-schema.ts';
import { employees } from '../../src/modules/staff/schema.ts';

/** Đếm truy vấn chạy trên PGlite (cả trong giao dịch) – chỉ đếm, không ghi nội dung. */
function countQueries(client: any) {
  let n = 0, on = false;
  const q = client.query.bind(client), tr = client.transaction.bind(client);
  client.query = (...a: any[]) => { if (on) n++; return q(...a); };
  client.transaction = (cb: any) => tr((tx: any) => { const tq = tx.query.bind(tx); tx.query = (...a: any[]) => { if (on) n++; return tq(...a); }; return cb(tx); });
  return async <T>(work: () => Promise<T>) => { n = 0; on = true; try { const value = await work(); return { value, queries: n }; } finally { on = false; } };
}

test('snapshot POS: hàng giữ không gắn kho chia đúng theo tồn trống kho khác, đơn giữ ở kho quầy chỉ đọc một lần', async () => {
  const f = await setup(), now = new Date().toISOString(), measure = countQueries(f.client);
  await f.db.insert(warehouses).values({ id: 'wh2', name: 'Kho 2', kind: 'stock' });
  await f.db.insert(productStock).values({ sku: '00123', warehouseId: 'wh2', quantity: 1, updatedAt: now }); // tồn trống kho khác: 1
  const q = await f.call('/quotes', f.mgr, 'POST', { type: 'B2B', quoteNo: 'BG-HOLD', customer: 'Khách', vat: 8, rows: [{ sku: '00123', name: 'Ly', unit: 'cái', qty: 2, price: 1 }] });
  await f.db.insert(stockHolds).values({ id: 'hold-1', quoteId: q.data.id, sku: '00123', qty: 2, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdBy: 'mgr', createdAt: now });
  // Đơn CRM cũ đã gắn kho quầy giữ 3.
  await f.db.insert(salesOrders).values({ id: 'ord-here', orderNo: 'DH-HERE', quoteType: 'B2B', customerName: 'K', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-11-01', status: 'confirmed',
    holdMode: 'legacy', channel: 'crm', warehouseId: 'pos-wh', total: 3, subtotal: 3, createdAt: now, updatedAt: now });
  await f.db.insert(salesOrderLines).values({ id: 'ord-here-1', orderId: 'ord-here', lineNo: 1, sku: '00123', name: 'Ly', qty: 3, unitPrice: 1, amount: 3 });
  const { value, queries } = await measure(() => f.call(`/pos/stock-snapshot?registerId=${f.registerId}&pricePolicyId=retail-vat`, f.emp));
  assert.equal(value.status, 200, JSON.stringify(value.data));
  const [row] = value.data.rows.filter((r: any[]) => r[0] === '00123');
  // Giữ = đơn ở kho quầy 3 + phần báo giá kho quầy gánh: 2 − tồn trống kho khác (1 − 0 đơn ở kho khác) = 1 → 4.
  assert.equal(row[2], 10); assert.equal(row[3], 4);
  // 21: mã quét đọc riêng một lượt gộp cho cả danh mục (thay 3 lượt tra chỉ mục cho từng sản phẩm).
  assert.ok(queries <= 21, `snapshot dùng ${queries} truy vấn`);
});

test('snapshot POS: mã quét đọc một lượt cho cả danh mục, cùng kết quả với cách tính từng sản phẩm (kể cả mã trùng)', async () => {
  const f = await setup(), now = new Date().toISOString();
  await f.db.insert(products).values(['A', 'B', 'C', 'OFF'].map(sku => ({ sku, name: 'SP ' + sku, unit: 'cái', updatedAt: now, ...(sku === 'OFF' ? { active: false } : {}) })));
  await f.db.insert(productPrices).values(['A', 'B', 'C'].map(sku => ({ sku, policyId: 'retail-vat', price: 1000 })));
  await f.db.insert(productBarcodes).values([
    { barcode: 'BC-A1', sku: 'A' }, { barcode: 'BC-A2', sku: 'A' },
    { barcode: 'B', sku: 'A' },       // mã vạch của A trùng mã hàng B → bỏ ở cả A lẫn B
    { barcode: 'C', sku: 'C' },       // mã vạch trùng chính mã hàng → giữ một lần
    { barcode: 'OFF', sku: 'C' },     // trùng mã hàng đang ngưng bán vẫn tính là trùng
    { barcode: 'BC-00123', sku: '00123' },
  ]);
  const snap = await f.call(`/pos/stock-snapshot?registerId=${f.registerId}&pricePolicyId=retail-vat`, f.emp);
  assert.equal(snap.status, 200, JSON.stringify(snap.data));
  const got = Object.fromEntries(snap.data.rows.map((r: any[]) => [r[0], [...r[4]].sort()]));
  // Đối chiếu cách cũ – có join như truy vấn snapshot thật (bảng đơn lẻ thì Drizzle viết cột không kèm tên bảng).
  const old = Object.fromEntries((await f.db.select({ sku: products.sku, codes: posScanCodes }).from(products).innerJoin(productPrices, and(eq(productPrices.sku, products.sku), eq(productPrices.policyId, 'retail-vat')))).map(r => [r.sku, [...r.codes].sort()]));
  for (const sku of Object.keys(got)) assert.deepEqual(got[sku], old[sku], sku);
  assert.deepEqual(got, { '00123': ['00123', 'BC-00123'], A: ['A', 'BC-A1', 'BC-A2'], B: [], C: ['C'] });
});

test('snapshot / mở két: quầy lấy từ danh sách vừa kiểm quyền; quầy người khác 403, quầy đã tắt 404', async () => {
  const f = await setup();
  const [base] = await f.db.select().from(posRegisters).where(eq(posRegisters.id, f.registerId));
  await f.db.insert(posRegisters).values({ ...base!, id: 'reg-off', name: 'Quầy Lock tắt', active: false });
  assert.equal((await f.call(`/pos/stock-snapshot?registerId=reg-off&pricePolicyId=retail-vat`, f.mgr)).status, 404);
  assert.equal((await f.call(`/pos/stock-snapshot?registerId=reg-off&pricePolicyId=retail-vat`, f.emp)).status, 403);
  assert.equal((await f.call(`/pos/stock-snapshot?registerId=${f.registerId}&pricePolicyId=khac`, f.emp)).status, 400);
  assert.equal((await f.call(`/pos/catalog?registerId=reg-off&pricePolicyId=retail-vat`, f.emp)).status, 403);
  assert.equal((await f.call(`/pos/catalog?registerId=${f.registerId}&pricePolicyId=retail-vat`, f.emp)).status, 200);
});

test('/badges: lượt trùng trong vài giây dùng lại kết quả, tách theo tài khoản; có lệnh ghi, đổi quyền hoặc hết hạn thì đọc lại', async () => {
  const f = await setup(), measure = countQueries(f.client); clearBadgeCache();
  const path = '/badges?parts=tasks,navigation';
  const first = await measure(() => f.call(path, f.emp));
  assert.equal(first.value.status, 200); assert.ok(first.queries > 0);
  const again = await measure(() => f.call(path, f.emp));
  assert.deepEqual(again.value.data, first.value.data); assert.ok(again.queries <= 3, `lượt trùng chỉ còn kiểm phiên (${again.queries})`);
  // Tài khoản khác: không dùng kết quả của nhân viên.
  const manager = await measure(() => f.call(path, f.mgr));
  assert.ok(manager.queries > again.queries);
  // Lệnh ghi bất kỳ (kể cả bị từ chối) làm mới cache.
  await f.call('/tasks', f.emp, 'POST', {});
  assert.ok((await measure(() => f.call(path, f.emp))).queries > again.queries);
  // Đổi chức vụ / quyền: hồ sơ nạp lại khác → đọc lại.
  await f.call(path, f.emp);
  await f.db.update(employees).set({ canApprove: true }).where(eq(employees.id, 'emp'));
  assert.ok((await measure(() => f.call(path, f.emp))).queries > again.queries);
  // Hết hạn.
  const realNow = Date.now; Date.now = () => realNow() + BADGE_TTL_MS + 1;
  try { assert.ok((await measure(() => f.call(path, f.emp))).queries > again.queries); } finally { Date.now = realNow; }
  clearBadgeCache();
});

test('/badges: gọi đồng thời chỉ đọc một lần; phần lỗi không được giữ lại', async () => {
  const f = await setup(), measure = countQueries(f.client); clearBadgeCache();
  const one = await measure(() => f.call('/badges?parts=tasks', f.emp)); clearBadgeCache();
  const both = await measure(() => Promise.all([f.call('/badges?parts=tasks', f.emp), f.call('/badges?parts=tasks', f.emp)]));
  assert.deepEqual(both.value[0].data, both.value[1].data);
  assert.ok(both.queries < one.queries * 2, `đồng thời ${both.queries} so với một lượt ${one.queries}`);
  // NCC không có quyền xem việc: phần lỗi → không cache, lượt sau vẫn hỏi lại.
  clearBadgeCache();
  const denied = await f.call('/badges?parts=tasks', f.ncc);
  assert.ok(denied.status === 403 || denied.data.parts?.tasks?.error, JSON.stringify(denied));
  clearBadgeCache();
});

test('đồng bộ việc tự sinh: gọi trùng chờ chung một lượt; gọi ép khi đang quét chỉ quét thêm một lượt', async () => {
  const f = await setup(), measure = countQueries(f.client);
  await syncAutoTasks(f.env, true);
  const single = await measure(() => syncAutoTasks(f.env, true));
  const joined = await measure(() => Promise.all([syncAutoTasks(f.env, true), syncAutoTasks(f.env), syncAutoTasks(f.env)]));
  assert.equal(joined.queries, single.queries, 'một lượt ép + hai lượt thường đang chờ = một lượt quét');
  const forced = await measure(() => Promise.all([syncAutoTasks(f.env, true), syncAutoTasks(f.env, true), syncAutoTasks(f.env, true)]));
  assert.equal(forced.queries, single.queries * 2, 'ép trong lúc đang quét → đúng một lượt quét lại');
  // Không ép, vừa quét xong: bỏ qua.
  assert.equal((await measure(() => syncAutoTasks(f.env))).queries, 0);
});

test('lưu báo giá chỉ đồng bộ việc "Duyệt báo giá": tạo việc ngay, không đụng việc tự sinh khác', async () => {
  const f = await setup(), now = new Date().toISOString();
  await f.db.insert(tasks).values({ id: 'other-auto', title: 'Việc tự sinh khác', status: 'todo', priority: 'normal', source: 'stock_request', autoKey: 'stock:khong-con', createdAt: now, updatedAt: now } as any);
  const q = await f.call('/quotes', f.emp, 'POST', { type: 'B2B', quoteNo: 'BG-TASK', customer: 'Khách', vat: 8, rows: [{ sku: '00123', name: 'Ly', unit: 'cái', qty: 1, price: 1 }] });
  assert.equal(q.status, 201, JSON.stringify(q.data));
  assert.equal((await f.call('/quotes/' + q.data.id + '/submit', f.emp, 'POST', { revision: 1 })).status, 200);
  const rows = await f.db.select().from(tasks);
  const approve = rows.find(t => t.autoKey === 'quote-approve:' + q.data.id);
  assert.ok(approve, 'gửi duyệt tạo ngay việc Duyệt báo giá: ' + JSON.stringify(rows.map(t => t.autoKey)));
  assert.equal(approve!.status, 'todo');
  assert.equal(rows.find(t => t.id === 'other-auto')?.status, 'todo', 'việc ngoài nhóm báo giá giữ nguyên tới lượt quét đầy đủ');
});
