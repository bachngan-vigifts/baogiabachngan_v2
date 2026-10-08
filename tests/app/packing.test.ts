import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products } from '../../src/modules/catalog/schema.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('kho','kho@x.vn','Thủ kho','0900','employee','warehouse',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run('kho', await hashPassword(PASSWORD, 1000));
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => {
    const res = await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), { db, passwordIterations: 1000 });
    return res.headers.get('set-cookie')?.split(';')[0] ?? '';
  };
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), kho: await login('kho@x.vn') };
}
const photo = 'data:image/jpeg;base64,' + Buffer.from('anh-hang-da-dong').toString('base64');

test('yêu cầu đóng gói: chia nguồn hàng → mỗi nguồn một phiếu (gợi ý thùng + cân nặng); gửi kho → việc nhóm Kho; kho xác nhận kèm 1–3 ảnh', async () => {
  const { db, call, emp, mgr, kho } = await setup();
  await db.insert(products).values({ sku: 'DIA31', name: 'Dĩa 31 cm', unit: 'cái', perCarton: 24, cartonWeight: 12, cartonLength: 60, cartonWidth: 40, cartonHeight: 30, updatedAt: '2026-10-01' });
  const q = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo: 'HRC_P1', customer: 'Khách P', vat: 8, rows: [{ name: 'Dĩa 31 cm', sku: 'DIA31', unit: 'cái', qty: 100, price: 100000 }, { name: 'Hộp quà', unit: 'hộp', qty: 10, price: 5000 }] });
  await call('/quotes/' + q.data.id + '/approve', mgr, 'POST', { revision: 1 });
  const orderId = (await call('/orders', emp, 'POST', { quoteId: q.data.id })).data.id;
  let p = (await call(`/orders/${orderId}/packing`, emp)).data;
  const [dia, hop] = p.lines;
  assert.deepEqual([dia.left, dia.perCarton, hop.left], [100, 24, 10]);
  // Kho có 50 dĩa: 50 kho + 20 NCC + 30 đại lý; hộp quà lấy hết ở kho → 3 phiếu.
  assert.equal((await call(`/orders/${orderId}/packing`, emp, 'POST', { allocations: [{ orderLineId: dia.id, qty: 101, source: 'warehouse' }] })).status, 400, 'vượt số lượng');
  assert.equal((await call(`/orders/${orderId}/packing`, emp, 'POST', { allocations: [{ orderLineId: dia.id, qty: 20, source: 'supplier' }] })).status, 400, 'nguồn ngoài kho phải ghi rõ');
  const made = await call(`/orders/${orderId}/packing`, emp, 'POST', { note: 'Bọc chống sốc', allocations: [
    { orderLineId: dia.id, qty: 50, source: 'warehouse' }, { orderLineId: hop.id, qty: 10, source: 'warehouse' },
    { orderLineId: dia.id, qty: 20, source: 'supplier', sourceNote: 'Minh Long I' }, { orderLineId: dia.id, qty: 30, source: 'agent', sourceNote: 'Đại lý Quận 5' }] });
  assert.equal(made.status, 201, JSON.stringify(made.data)); assert.equal(made.data.slips.length, 3);
  assert.match(made.data.slips[0].slipNo, /^DG_\d{8}_001$/);
  p = (await call(`/orders/${orderId}/packing`, emp)).data;
  assert.deepEqual(p.lines.map((l: any) => l.left), [0, 0], 'đã đưa hết vào phiếu');
  const wh = p.slips.find((s: any) => s.source === 'warehouse');
  assert.deepEqual([wh.status, wh.totalQty, wh.totalWeight, wh.lines.length], ['draft', 60, null, 2], 'hộp quà chưa có quy cách → tổng cân để trống');
  const sup = p.slips.find((s: any) => s.source === 'supplier');
  assert.deepEqual([sup.totalWeight, sup.lines[0].cartonSize, sup.sourceLabel], [10, '60×40×30 cm', 'Nhập từ NCC']);
  // Kho chưa thấy việc khi phiếu còn nháp; gửi kho → việc nhóm Kho dẫn tới trang phiếu.
  const khoTasks = async () => (await call('/tasks?view=mine&refresh=1', kho)).data.tasks.filter((t: any) => t.source === 'packing' && t.status !== 'done');
  assert.equal((await khoTasks()).length, 0);
  assert.equal((await call(`/packing/${sup.id}/send`, kho, 'POST', {})).status, 403, 'kho không gửi phiếu');
  assert.equal((await call(`/packing/${sup.id}/send`, emp, 'POST', {})).status, 200);
  assert.equal((await call(`/packing/${sup.id}/send`, emp, 'POST', {})).status, 409);
  let tasks = await khoTasks();
  assert.equal(tasks.length, 1); assert.equal(tasks[0].link, `#/packing/${sup.id}`); assert.match(tasks[0].title, /^Đóng gói DG_/);
  // Kho xem được phiếu (không xem được đơn) và phải chụp 1–3 ảnh.
  const view = (await call(`/packing/${sup.id}`, kho)).data;
  assert.deepEqual([view.canConfirm, view.canOpenOrder, view.order.orderNo], [true, false, (await call(`/orders/${orderId}`, emp)).data.order.orderNo]);
  assert.equal((await call(`/orders/${orderId}`, kho)).status, 404);
  assert.equal((await call(`/packing/${sup.id}/confirm`, emp, 'POST', { photos: [photo] })).status, 403, 'nhân viên sale không xác nhận thay kho');
  assert.equal((await call(`/packing/${sup.id}/confirm`, kho, 'POST', { photos: [] })).status, 400);
  assert.equal((await call(`/packing/${sup.id}/confirm`, kho, 'POST', { photos: [photo, photo, photo, photo] })).status, 400);
  assert.equal((await call(`/packing/${sup.id}/confirm`, kho, 'POST', { photos: ['data:text/html;base64,PHNjcmlwdD4='] })).status, 400);
  assert.equal((await call(`/packing/${sup.id}/confirm`, kho, 'POST', { photos: [photo, photo], note: 'Đã dán tem' })).status, 200);
  const done = (await call(`/packing/${sup.id}`, emp)).data;
  assert.deepEqual([done.slip.status, done.slip.packedByName, done.photos.length, done.canConfirm], ['packed', 'Thủ kho', 2, false]);
  assert.equal((await khoTasks()).length, 0, 'việc đóng gói tự hoàn thành');
  // Huỷ phiếu nháp → số lượng trả lại để lập phiếu khác; phiếu đã đóng không huỷ được.
  assert.equal((await call(`/packing/${sup.id}/cancel`, emp, 'POST', {})).status, 409);
  assert.equal((await call(`/packing/${wh.id}/cancel`, emp, 'POST', {})).status, 200);
  p = (await call(`/orders/${orderId}/packing`, emp)).data;
  assert.deepEqual(p.lines.map((l: any) => l.left), [50, 10]);
  assert.equal((await call('/packing?status=packed', kho)).data.slips.length, 1);
  // Lịch giao hàng: kho xem / đổi trạng thái mọi chuyến giao nhưng không xem được đơn, công nợ.
  const g = await call('/deliveries', emp, 'POST', { orderId, plannedDate: '2026-10-20' });
  assert.equal(g.status, 201);
  assert.deepEqual((await call('/deliveries?from=2026-10-01&to=2026-10-31', kho)).data.deliveries.map((x: any) => x.id), [g.data.id]);
  assert.equal((await call(`/deliveries/${g.data.id}/status`, kho, 'PUT', { status: 'in_transit' })).status, 200);
  assert.equal((await call('/orders', kho)).data.orders.length, 0);
  assert.equal((await call('/receivables', kho)).data.receivables.length, 0);
  assert.deepEqual((await call('/packing?q=khach p', emp)).data.slips.map((x: any) => x.status).sort(), ['cancelled', 'draft', 'packed'], 'nhân viên thấy phiếu của đơn mình');
});
