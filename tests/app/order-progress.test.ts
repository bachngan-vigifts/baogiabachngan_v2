import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { orderProgress, stagesUpTo } from '../../src/modules/sales/domain/progress.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
import { warehouses } from '../../src/modules/catalog/schema.ts';

/**
 * TIẾN TRÌNH SẢN PHẨM: Duyệt → Xuất kho → In mẫu → Sản xuất → Giao hàng (đơn không in bỏ In mẫu / Sản xuất).
 * Tự xong theo chứng từ / công việc (kho xác nhận đóng gói, việc "In mẫu", "Sản xuất"); Manager bấm xong nhanh / hoàn thành tất cả.
 */
const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('kho','kho@x.vn','Thủ kho','0900','employee','warehouse',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run('kho', await hashPassword(PASSWORD, 1000));
  await db.insert(warehouses).values({ id: 'ct', name: 'Kho Cần Thơ', kind: 'stock' });
  await postMoves(db,'mgr',[{sku:'LY1',warehouseId:'ct',qty:100,kind:'opening',refType:'opening',refId:'progress-fixture'}]);
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const emp = await login('emp@x.vn'), mgr = await login('mgr@x.vn'), kho = await login('kho@x.vn');
  const order = async (quoteNo: string, printFee: number) => {
    const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo, customer: 'Khách in logo', vat: 8, rows: [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 10, price: 100000, printFee }] });
    if (printFee > 0) {
      const source = (await call(`/quotes/${q.data.id}`, mgr)).data;
      await call(`/quotes/${q.data.id}`, mgr, 'PUT', {revision:source.revision,data:{...source.data,printing:{totalCost:10000}}});
    }
    await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: printFee > 0 ? 2 : 1 });
    return (await call('/orders', emp, 'POST', { quoteId: q.data.id })).data.id as string;
  };
  const progress = async (id: string) => (await call(`/orders/${id}`, emp)).data.progress;
  return { call, emp, mgr, kho, order, progress };
}
const photo = 'data:image/jpeg;base64,' + Buffer.from('anh').toString('base64');

test('tiến trình: hàm thuần – bước theo đơn có / không in, bước hiện tại, lối tắt', () => {
  const p = orderProgress({ status: 'confirmed', packed: true, printing: true, marks: { sample: { source: 'task', at: '2026-10-09T00:00:00Z' } } });
  assert.deepEqual(p.stages.map(s => [s.key, s.done]), [['approve', true], ['export', true], ['sample', true], ['production', false], ['delivered', false]]);
  assert.deepEqual([p.current, p.label], ['production', 'Đang sản xuất']);
  assert.deepEqual(orderProgress({ status: 'draft', packed: false, printing: false, marks: {} }).stages.map(s => s.key), ['approve', 'export', 'delivered'], 'đơn không in bỏ In mẫu / SX');
  assert.equal(orderProgress({ status: 'delivered', packed: false, printing: false, marks: {} }).current, 'export', 'xuất kho chưa xác nhận thì vẫn ở bước xuất kho');
  assert.equal(orderProgress({ status: 'cancelled', packed: false, printing: true, marks: {} }).label, 'Đã huỷ');
  assert.deepEqual(stagesUpTo(true, 'sample'), ['approve', 'export', 'sample']);
  assert.deepEqual(stagesUpTo(false, 'all'), ['approve', 'export', 'delivered']);
});

test('tiến trình: duyệt → kho xác nhận đóng gói → việc In mẫu → việc Sản xuất → Manager hoàn thành nhanh / bỏ đánh dấu', async () => {
  const { call, emp, mgr, kho, order, progress } = await setup();
  const id = await order('B2B_IN1', 5000);
  let p = await progress(id);
  assert.deepEqual([p.current, p.label, p.printing], ['approve', 'Đợi duyệt', true]);

  await call(`/orders/${id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true });
  assert.equal((await progress(id)).current, 'export');
  // Kho xác nhận đóng gói xong → bước Xuất kho tự xong → việc "In mẫu" cho người phụ trách.
  const line = (await call(`/orders/${id}`, emp)).data.lines[0];
  await call('/deliveries', emp, 'POST', { orderId: id, plannedDate: '2030-01-15', lines: [{ orderLineId: line.id, qty: 10 }] });
  const slip = (await call(`/orders/${id}/packing`, emp, 'POST', { allocations: [{ orderLineId: line.id, qty: 10, source: 'warehouse' }] })).data.slips?.[0]
    ?? (await call(`/orders/${id}/packing`, emp)).data.slips[0];
  await call(`/packing/${slip.id}/send`, emp, 'POST', {});
  assert.equal((await call(`/packing/${slip.id}/confirm`, kho, 'POST', { photos: [photo] })).status, 400, 'nguồn Kho: phải chọn kho xuất');
  assert.equal((await call(`/packing/${slip.id}/confirm`, kho, 'POST', { photos: [photo], warehouseId: 'ct' })).status, 200);
  const card = (await call('/inventory/card?sku=LY1&warehouseId=ct', mgr)).data;
  assert.deepEqual(card.lines.map((l: any) => [l.kind, l.qty, l.refNo]), [['issue', -10, slip.slipNo], ['opening', 100, '']], 'xác nhận đóng hàng → phiếu xuất vào sổ kho');
  p = await progress(id);
  assert.deepEqual([p.current, p.label, p.stages[1].by], ['sample', 'Đang in mẫu', 'auto']);
  let mine = (await call('/tasks?refresh=1', emp)).data.tasks;
  const sample = mine.find((t: any) => t.title.startsWith('In mẫu'));
  assert.ok(sample && sample.link === `#/orders/${id}`, JSON.stringify(mine.map((t: any) => t.title)));
  // Hoàn thành việc In mẫu → bước In mẫu xong → việc "Sản xuất".
  assert.equal((await call(`/tasks/${sample.id}`, emp, 'PUT', { status: 'done' })).status, 200);
  p = await progress(id);
  assert.deepEqual([p.current, p.stages[2].by, p.stages[2].byName], ['production', 'task', 'Tên emp']);
  mine = (await call('/tasks?refresh=1', emp)).data.tasks;
  assert.ok(mine.some((t: any) => t.title.startsWith('Sản xuất')), 'việc Sản xuất');

  // Chỉ Manager đánh dấu nhanh.
  assert.equal((await call(`/orders/${id}/progress`, emp, 'POST', { stage: 'all' })).status, 403);
  assert.equal((await call(`/orders/${id}/progress`, mgr, 'POST', { stage: 'nope' })).status, 400);
  const all = await call(`/orders/${id}/progress`, mgr, 'POST', { stage: 'all' });
  assert.equal(all.status, 200);
  assert.deepEqual([all.data.progress.done, all.data.progress.label], [true, 'Đã giao hàng']);
  assert.ok(!(await call('/tasks?refresh=1', emp)).data.tasks.some((t: any) => t.title.startsWith('Sản xuất')), 'Manager hoàn thành nhanh → việc Sản xuất tự đóng');
  // Bỏ đánh dấu tay ở "Giao hàng" (bước tự xong / xong theo việc giữ nguyên).
  const undo = await call(`/orders/${id}/progress`, mgr, 'POST', { stage: 'delivered', done: false });
  assert.equal(undo.data.progress.current, 'delivered');
  assert.equal((await call(`/orders/${id}/progress`, mgr, 'POST', { stage: 'approve', done: false })).data.progress.stages[2].by, 'task', 'bỏ dấu tay không xoá bước xong theo việc');
});

test('tiến trình hàng có SKU không được bấm Xong thay duyệt/xuất thực tế', async () => {
  const { call, mgr, order, progress } = await setup();
  const id = await order('B2B_KIN', 0);
  assert.deepEqual((await progress(id)).stages.map((s: any) => s.key), ['approve', 'export', 'delivered']);
  assert.equal((await call(`/orders/${id}/progress`, mgr, 'POST', { stage: 'sample' })).status, 400);
  assert.equal((await call(`/orders/${id}/progress`, mgr, 'POST', { stage: 'export' })).data.code,'ORDER_NOT_APPROVED');
  assert.equal((await call(`/orders/${id}/status`,mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true})).status,200);
  assert.equal((await call(`/orders/${id}/progress`,mgr,'POST',{stage:'export'})).data.code,'STOCK_NOT_PACKED');
  assert.equal((await call(`/orders/${id}/progress`,mgr,'POST',{stage:'all'})).data.code,'STOCK_NOT_PACKED');
  assert.equal((await progress(id)).stages.find((s:any)=>s.key==='export').done,false);
});
