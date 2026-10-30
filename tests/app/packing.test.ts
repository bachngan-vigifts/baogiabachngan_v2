import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
import { suppliers } from '../../src/modules/suppliers/schema.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, warehouses } from '../../src/modules/catalog/schema.ts';
import { memoryFileStore } from '../../src/core/storage/file-store.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('kho','kho@x.vn','Thủ kho','0900','employee','warehouse',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run('kho', await hashPassword(PASSWORD, 1000));
  const router = createAppRouter(), files = memoryFileStore();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, files, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any };
  };
  const login = async (email: string) => {
    const res = await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return res.headers.get('set-cookie')?.split(';')[0] ?? '';
  };
  return { db, call, files, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), kho: await login('kho@x.vn') };
}
const photo = 'data:image/jpeg;base64,' + Buffer.from('anh-hang-da-dong').toString('base64');

test('yêu cầu đóng gói: chia nguồn hàng → mỗi nguồn một phiếu (gợi ý thùng + cân nặng); gửi kho → việc nhóm Kho; kho xác nhận kèm 1–3 ảnh', async () => {
  const { db, call, emp, mgr, kho } = await setup();
  await db.insert(products).values({ sku: 'DIA31', name: 'Dĩa 31 cm', unit: 'cái', perCarton: 24, cartonWeight: 12, cartonLength: 60, cartonWidth: 40, cartonHeight: 30, updatedAt: '2026-10-01' });
  await db.insert(warehouses).values({id:'packing-stock',name:'Kho xuất',kind:'stock'});
  await postMoves(db,'mgr',[{sku:'DIA31',warehouseId:'packing-stock',qty:20,kind:'opening',refType:'opening',refId:'packing-opening'}]);
  const q = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo: 'HRC_P1', customer: 'Khách P', vat: 8, rows: [{ name: 'Dĩa 31 cm', sku: 'DIA31', unit: 'cái', qty: 100, price: 100000 }, { name: 'Hộp quà', unit: 'hộp', qty: 10, price: 5000 }] });
  await call('/quotes/' + q.data.id + '/approve', mgr, 'POST', { revision: 1 });
  const orderId = (await call('/orders', emp, 'POST', { quoteId: q.data.id })).data.id;
  await call(`/orders/${orderId}/status`, mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)
  await db.insert(suppliers).values([
    {id:'choice-ncc',name:'NCC từ danh bạ',nameKey:'ncc tu danh ba',createdAt:'2026-10-21',updatedAt:'2026-10-21',createdBy:'mgr',email:'private@example.test',note:'Nội bộ'},
    {id:'choice-agent',name:'Đại lý từ danh bạ',nameKey:'dai ly tu danh ba',createdAt:'2026-10-21',updatedAt:'2026-10-21',createdBy:'mgr'},
    {id:'choice-off',name:'Đã ngừng',nameKey:'da ngung',active:false,createdAt:'2026-10-21',updatedAt:'2026-10-21',createdBy:'mgr'},
  ]);
  let p = (await call(`/orders/${orderId}/packing`, emp)).data;
  assert.deepEqual(p.supplierChoices.map((s:any)=>s.id).sort(),['choice-agent','choice-ncc']);
  assert.deepEqual(Object.keys(p.supplierChoices[0]).sort(),['id','name'],'chỉ mở tên NCC để chọn nguồn, không mở danh bạ riêng');
  assert.equal((await call('/suppliers',emp)).status,403,'chọn nguồn không mở quyền quản trị NCC');
  assert.equal((await call('/orders/no-order/packing',emp)).status,404,'kiểm phạm vi đơn trước khi trả nguồn');

  const [dia, hop] = p.lines;
  // Chưa lên lịch giao → chưa yêu cầu đóng gói được.
  assert.equal(p.scheduled, false);
  const early = await call(`/orders/${orderId}/packing`, emp, 'POST', { allocations: [{ orderLineId: dia.id, qty: 10, source: 'warehouse' }] });
  assert.equal(early.status, 409); assert.equal(early.data.code, 'NO_DELIVERY_SCHEDULE');
  assert.equal((await call('/deliveries', emp, 'POST', { orderId, plannedDate: '2030-01-15', lines: [{ orderLineId: dia.id, qty: 1 }] })).status, 201);
  assert.equal((await call(`/orders/${orderId}/packing`, emp)).data.scheduled, true);
  assert.deepEqual([dia.left, dia.perCarton, hop.left], [100, 24, 10]);
  // Bản in phiếu đóng gói cả đơn: quy cách gợi ý, kích thước thùng, cân nặng ước tính.
  assert.deepEqual([dia.suggestion, dia.cartonSize, dia.weight, hop.suggestion, hop.weight], ['4 thùng × 24 cái + 4 cái lẻ', '60×40×30 cm', 50, '', null]);
  // Kho có 50 dĩa: 50 kho + 20 NCC + 30 đại lý; hộp quà lấy hết ở kho → 3 phiếu.
  assert.equal((await call(`/orders/${orderId}/packing`, emp, 'POST', { allocations: [{ orderLineId: dia.id, qty: 101, source: 'warehouse' }] })).status, 400, 'vượt số lượng');
  assert.equal((await call(`/orders/${orderId}/packing`, emp, 'POST', { allocations: [{ orderLineId: dia.id, qty: 20, source: 'supplier' }] })).status, 400, 'nguồn ngoài kho phải ghi rõ');
  const made = await call(`/orders/${orderId}/packing`, emp, 'POST', { note: 'Bọc chống sốc', allocations: [
    { orderLineId: dia.id, qty: 50, source: 'warehouse' }, { orderLineId: hop.id, qty: 10, source: 'warehouse' },
    { orderLineId: dia.id, qty: 20, source: 'supplier', sourceNote: 'Minh Long I' }, { orderLineId: dia.id, qty: 30, source: 'agent', sourceNote: 'Đại lý Quận 5' }] });
  assert.equal(made.status, 201, JSON.stringify(made.data)); assert.equal(made.data.slips.length, 3);
  assert.match(made.data.slips[0].slipNo, /^DG_001_\d{8}$/);
  p = (await call(`/orders/${orderId}/packing`, emp)).data;
  assert.deepEqual(p.lines.map((l: any) => l.left), [0, 0], 'đã đưa hết vào phiếu');
  const wh = p.slips.find((s: any) => s.source === 'warehouse');
  assert.deepEqual([wh.shipTo, wh.shipName, wh.carrierName], ['customer', 'Khách P', ''], 'không phí in, không chọn → giao thẳng cho khách');
  assert.equal(p.delivery.hasPrintFee, false);
  assert.deepEqual([wh.status, wh.totalQty, wh.totalWeight, wh.lines.length], ['draft', 60, null, 2], 'hộp quà chưa có quy cách → tổng cân để trống');
  const sup = p.slips.find((s: any) => s.source === 'supplier');
  assert.deepEqual([sup.totalWeight, sup.lines[0].cartonSize, sup.sourceLabel], [10, '60×40×30 cm', 'Nhập từ NCC']);
  assert.equal(sup.lines[0].suggestion, '20 cái lẻ', 'bản in phiếu: quy cách gợi ý từng dòng');
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
  assert.equal(view.order.quoteType, 'HRC', 'bản in của kho: đơn vị bán theo loại báo giá');
  assert.deepEqual([view.canConfirm, view.canOpenOrder, view.order.orderNo], [true, false, (await call(`/orders/${orderId}`, emp)).data.order.orderNo]);
  assert.equal((await call(`/orders/${orderId}`, kho)).status, 403, 'chức vụ Kho không được cấp trang Đơn hàng');
  assert.equal((await call(`/packing/${sup.id}/confirm`, emp, 'POST', { photos: [photo] })).status, 403, 'nhân viên sale không xác nhận thay kho');
  assert.equal((await call(`/packing/${sup.id}/confirm`, kho, 'POST', { photos: [] })).status, 400);
  assert.equal((await call(`/packing/${sup.id}/confirm`, kho, 'POST', { photos: [photo, photo, photo, photo] })).status, 400);
  assert.equal((await call(`/packing/${sup.id}/confirm`, kho, 'POST', { photos: ['data:text/html;base64,PHNjcmlwdD4='] })).status, 400);
  assert.equal((await call(`/packing/${sup.id}/confirm`, kho, 'POST', { warehouseId:'packing-stock',photos: [photo, photo], note: 'Đã dán tem' })).status, 200);
  const done = (await call(`/packing/${sup.id}`, emp)).data;
  assert.deepEqual([done.slip.status, done.slip.packedByName, done.photos.length, done.canConfirm], ['packed', 'Thủ kho', 2, false]);
  assert.equal((await khoTasks()).length, 0, 'việc đóng gói tự hoàn thành');
  // Huỷ phiếu nháp → số lượng trả lại để lập phiếu khác; phiếu đã đóng không huỷ được.
  assert.equal((await call(`/packing/${sup.id}/cancel`, emp, 'POST', {})).status, 409);
  assert.equal((await call(`/packing/${wh.id}/cancel`, emp, 'POST', {})).status, 200);
  p = (await call(`/orders/${orderId}/packing`, emp)).data;
  assert.deepEqual(p.lines.map((l: any) => l.left), [50, 10]);
  assert.equal((await call('/packing?status=packed', kho)).data.slips.length, 1);
  // Bộ lọc danh sách: nguồn hàng + khoảng ngày giao dự kiến; giá trị sai trả 400.
  assert.equal((await call('/packing?status=packed&source=supplier', kho)).data.slips.length, 1);
  assert.equal((await call('/packing?status=packed&source=warehouse', kho)).data.slips.length, 0);
  assert.equal((await call('/packing?status=packed&from=2999-01-01', kho)).data.slips.length, 0);
  assert.equal((await call('/packing?source=bogus', kho)).status, 400);
  assert.equal((await call('/packing?from=2026-10-31&to=2026-10-01', kho)).status, 400);
  // Lịch giao hàng: kho xem / đổi trạng thái mọi chuyến giao nhưng không xem được đơn, công nợ.
  const g = await call('/deliveries', emp, 'POST', { orderId, plannedDate: '2026-10-20', lines:[{orderLineId:dia.id,qty:20}] });
  assert.equal(g.status, 201);
  assert.deepEqual((await call('/deliveries?from=2026-10-01&to=2026-10-31', kho)).data.deliveries.map((x: any) => x.id), [g.data.id]);
  assert.equal((await call(`/deliveries/${g.data.id}/status`, kho, 'PUT', { status: 'in_transit' })).status, 200);
  // Kho không huỷ chuyến (chỉ Sale / Manager); kho bấm "Đã giao" phải kèm 1–3 ảnh (hàng đã giao / biên bản ký nhận).
  const list = (await call('/deliveries?from=2026-10-01&to=2026-10-31', kho)).data;
  assert.equal(list.canCancel, false); assert.equal((await call('/deliveries?from=2026-10-01&to=2026-10-31', emp)).data.canCancel, true);
  assert.equal((await call(`/deliveries/${g.data.id}/status`, kho, 'PUT', { status: 'cancelled' })).status, 403);
  const noProof = await call(`/deliveries/${g.data.id}/status`, kho, 'PUT', { status: 'delivered' });
  assert.equal(noProof.status, 400); assert.match(noProof.data.error, /ảnh/);
  assert.equal((await call(`/deliveries/${g.data.id}/status`, kho, 'PUT', { status: 'delivered', photos: [photo, photo, photo, photo] })).status, 400, 'tối đa 3 ảnh');
  assert.equal((await call(`/deliveries/${g.data.id}/status`, kho, 'PUT', { status: 'delivered', photos: [photo] })).status, 200);
  const shipped = (await call('/deliveries?from=2026-10-01&to=2026-10-31', kho)).data.deliveries[0];
  assert.equal(shipped.status, 'delivered'); assert.equal(shipped.photos.length, 1); assert.match(shipped.photos[0], /^data:image\/jpeg;base64,/);
  assert.equal((await call('/orders/' + orderId, emp)).data.deliveries.find((x: any) => x.id === g.data.id).photos.length, 1, 'nhân viên phụ trách xem ảnh trên đơn');
  assert.equal((await call('/orders', kho)).status, 403, 'chức vụ Kho không được cấp trang Đơn hàng / Công nợ');
  assert.equal((await call('/receivables', kho)).status, 403);
  assert.deepEqual((await call('/packing?q=khach p', emp)).data.slips.map((x: any) => x.status).sort(), ['cancelled', 'draft', 'packed'], 'nhân viên thấy phiếu của đơn mình');
});

test('yêu cầu đóng gói - giao hàng: đơn có phí in → giao về xưởng in; nhà xe / xưởng mới gõ trong ô tự vào danh sách', async () => {
  const { call, emp, mgr } = await setup();
  const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: 'B2B_P2', customer: 'Khách In', customerAddress: '12 Lê Lợi, Cần Thơ', vat: 8,
    rows: [{ name: 'Ly sứ in logo', sku: 'LY1', unit: 'cái', qty: 50, price: 50000, printFee: 5000 }] });
  const source = (await call('/quotes/' + q.data.id, mgr)).data;
  await call('/quotes/' + q.data.id, mgr, 'PUT', {revision:source.revision,data:{...source.data,printing:{totalCost:10000}}});
  await call('/quotes/' + q.data.id + '/approve', mgr, 'POST', { revision: 2 });
  const orderId = (await call('/orders', emp, 'POST', { quoteId: q.data.id })).data.id;
  await call(`/orders/${orderId}/status`, mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true });
  assert.equal((await call('/deliveries', emp, 'POST', { orderId, plannedDate: '2030-01-15' })).status, 201);
  const p = (await call(`/orders/${orderId}/packing`, emp)).data;
  assert.equal(p.delivery.hasPrintFee, true, 'có phí in logo');
  assert.ok(p.delivery.workshops.some((w: any) => w.name === 'Trọng Tín'), 'xưởng in mặc định');
  assert.deepEqual(p.delivery.customer, { name: 'Khách In', address: '12 Lê Lợi, Cần Thơ', receiverName: '', receiverPhone: '', phone: '' });
  const line = p.lines[0];
  assert.equal((await call(`/orders/${orderId}/packing`, emp, 'POST', { allocations: [{ orderLineId: line.id, qty: 50, source: 'warehouse' }], delivery: { to: 'workshop' } })).status, 400, 'giao xưởng phải chọn xưởng');
  const made = await call(`/orders/${orderId}/packing`, emp, 'POST', { allocations: [{ orderLineId: line.id, qty: 50, source: 'warehouse' }],
    delivery: { to: 'workshop', name: 'Xưởng in Phúc Lộc', address: '5 Trần Phú, Q.5', phone: '0909 111 222', carrierName: 'Nhà xe Phương Trang', carrierPhone: '1900 6067' } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const slip = (await call(`/packing/${made.data.slips[0].id}`, emp)).data.slip;
  assert.deepEqual([slip.shipTo, slip.shipName, slip.shipAddress, slip.shipPhone, slip.carrierName, slip.carrierPhone],
    ['workshop', 'Xưởng in Phúc Lộc', '5 Trần Phú, Q.5', '0909 111 222', 'Nhà xe Phương Trang', '1900 6067']);
  // Xưởng / nhà xe mới đã vào danh sách chọn nhanh.
  const again = (await call(`/orders/${orderId}/packing`, emp)).data.delivery;
  assert.ok(again.workshops.some((w: any) => w.name === 'Xưởng in Phúc Lộc' && w.address === '5 Trần Phú, Q.5'));
  assert.deepEqual((await call('/shipping-carriers', emp)).data.carriers, [{ name: 'Nhà xe Phương Trang', phone: '1900 6067' }]);
});

test('đơn đã giao xong → phiếu đóng gói còn treo tự hoàn tất (đã gửi kho → đã đóng, nháp → huỷ); lọc Đã đóng / Chưa đóng', async () => {
  const { call, emp, mgr, kho } = await setup();
  const make = async (quoteNo: string) => {
    const q = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo, customer: 'Khách G', contact: 'Chị Lan', phone: '0901234567', customerTaxCode: '0312345678', customerAddress: '1 Lê Lợi, Q1', vat: 8, rows: [{ name: 'Ly', unit: 'cái', qty: 10, price: 1000 }, { name: 'Đĩa', unit: 'cái', qty: 5, price: 1000 }] });
    await call('/quotes/' + q.data.id + '/approve', mgr, 'POST', { revision: 1 });
    const orderId = (await call('/orders', emp, 'POST', { quoteId: q.data.id })).data.id as string;
    await call(`/orders/${orderId}/status`, mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true });
    const lines = (await call(`/orders/${orderId}/packing`, emp)).data.lines;
    const dv = await call('/deliveries', emp, 'POST', { orderId, plannedDate: '2030-01-15', lines: [{ orderLineId: lines[0].id, qty: 10 }, { orderLineId: lines[1].id, qty: 5 }] });
    assert.equal(dv.status, 201, JSON.stringify(dv.data));
    const delivery = dv.data.id as string;
    const made = await call(`/orders/${orderId}/packing`, emp, 'POST', { allocations: [
      { orderLineId: lines[0].id, qty: 10, source: 'warehouse' }, { orderLineId: lines[1].id, qty: 5, source: 'agent', sourceNote: 'Đại lý' }] });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const slips = (await call(`/orders/${orderId}/packing`, emp)).data.slips;
    const wh = slips.find((s: any) => s.source === 'warehouse'), ag = slips.find((s: any) => s.source === 'agent');
    await call(`/packing/${wh.id}/send`, emp, 'POST', {});
    return { orderId, delivery, wh, ag };
  };
  // 1) Chuyến giao "Đã giao" (giao đủ) → đơn giao xong → phiếu tự hoàn tất.
  const a = await make('HRC_G1');
  // Kho không xem được danh bạ khách nhưng phiếu / lịch giao vẫn đủ thông tin liên hệ giao hàng.
  const kv = (await call(`/packing/${a.wh.id}`, kho)).data.order;
  assert.deepEqual([kv.contact, kv.phone, kv.address, kv.taxCode], ['Chị Lan', '0901234567', '1 Lê Lợi, Q1', '0312345678']);
  const trip = (await call('/deliveries?from=2030-01-01&to=2030-01-31', kho)).data.deliveries.find((x: any) => x.id === a.delivery);
  assert.deepEqual([trip.customerContact, trip.customerPhone, trip.customerAddress], ['Chị Lan', '0901234567', '1 Lê Lợi, Q1']);
  assert.ok((await call('/packing', kho)).data.slips.some((s: any) => s.id === a.wh.id), 'đang chờ đóng');
  assert.equal((await call(`/deliveries/${a.delivery}/status`, emp, 'PUT', { status: 'delivered' })).status, 200);
  assert.equal((await call(`/orders/${a.orderId}`, emp)).data.order.status, 'delivered');
  let wh = (await call(`/packing/${a.wh.id}`, kho)).data.slip;
  assert.deepEqual([wh.status, wh.packedNote], ['packed', 'Tự động hoàn tất: đơn đã giao.']);
  assert.equal((await call(`/packing/${a.ag.id}`, kho)).data.slip.status, 'cancelled', 'phiếu nháp chưa gửi kho → huỷ');
  assert.ok(!(await call('/packing', kho)).data.slips.some((s: any) => s.id === a.wh.id), 'không còn trong "Chưa đóng"');
  assert.ok((await call('/packing?status=packed', kho)).data.slips.some((s: any) => s.id === a.wh.id), 'nằm trong "Đã đóng"');
  // 2) Manager bấm hoàn thành tiến trình (đã giao hàng) → phiếu cũng tự hoàn tất.
  const b = await make('HRC_G2');
  assert.equal((await call(`/orders/${b.orderId}/progress`, mgr, 'POST', { stage: 'all' })).status, 200);
  wh = (await call(`/packing/${b.wh.id}`, kho)).data.slip;
  assert.equal(wh.status, 'packed');
  // Việc "Đóng gói" của kho không còn mở.
  assert.ok(!(await call('/tasks?refresh=1', kho)).data.tasks.some((t: any) => t.status !== 'done' && String(t.link || '').includes(b.wh.id)));
});

async function combinedFixture() {
  const s = await setup();
  await s.db.insert(warehouses).values({ id: 'combined-warehouse', name: 'Kho thử đóng gói', kind: 'stock', active: true });
  await postMoves(s.db,'mgr',[{sku:'COMBINED',warehouseId:'combined-warehouse',qty:10,kind:'opening',refType:'opening',refId:'packing-fixture'}]);
  const q = await s.call('/quotes', s.emp, 'POST', { type: 'HRC', quoteNo: 'HRC_COMBINED', customer: 'Khách gộp', contact: 'Chị Lan', phone: '0901234567', customerAddress: '12 Lê Lợi', vat: 8, rows: [{ sku: 'COMBINED', name: 'Ly', unit: 'cái', qty: 10, price: 1000 }] });
  assert.equal(q.status, 201, JSON.stringify(q.data));
  await s.call('/quotes/' + q.data.id + '/approve', s.mgr, 'POST', { revision: 1 });
  const made = await s.call('/orders', s.emp, 'POST', { quoteId: q.data.id });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.id;
  const packing = (await s.call(`/orders/${id}/packing`, s.emp)).data;
  const lineId = packing.lines[0].id as string;
  return { ...s, id, lineId, approve: () => s.call(`/orders/${id}/status`, s.mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true }) };
}

test('gộp lịch giao + phiếu: một lần lưu, một nguồn gửi kho ngay, đúng quyền và không tạo lại khi bấm lặp', async () => {
  const s = await combinedFixture(), { call, emp, mgr, kho, id, lineId } = s;
  const request = { allocations: [{ orderLineId: lineId, qty: 10, source: 'warehouse' }], schedule: { plannedDate: '2030-01-15', timeSlot: 'Sáng', receiverName: 'Chị Lan' }, sendToWarehouse: true };
  assert.equal((await call(`/orders/${id}/packing`, emp, 'POST', request)).status, 409, 'chưa duyệt không thể dùng luồng gộp để lên lịch');
  await s.approve();
  assert.equal((await call(`/orders/${id}/packing`, kho, 'POST', request)).status, 403, 'kho không lập/gửi phiếu thay sale (chức vụ Kho không có trang Đơn hàng)');
  assert.equal((await call(`/orders/${id}/packing`, '', 'POST', request)).status, 401);
  const made = await call(`/orders/${id}/packing`, emp, 'POST', request);
  assert.equal(made.status, 201, JSON.stringify(made.data)); assert.ok(made.data.deliveryId); assert.equal(made.data.sentToWarehouse, true);
  const p = (await call(`/orders/${id}/packing`, emp)).data;
  assert.equal(p.slips.length, 1); assert.equal(p.slips[0].status, 'sent'); assert.equal(p.slips[0].sentBy, 'emp'); assert.equal(p.schedules.length, 1);
  const detail = (await call(`/orders/${id}`, emp)).data;
  assert.deepEqual(detail.deliveries[0].lines.map((l: any) => l.qty), [10]);
  assert.equal((await call('/tasks?refresh=1', kho)).data.tasks.filter((t: any) => t.source === 'packing' && t.sourceId === made.data.slips[0].id).length, 1);
  assert.equal((await call(`/orders/${id}/packing`, emp, 'POST', request)).status, 400, 'bấm lặp không tạo lịch/phiếu trùng');
  assert.equal((await call(`/orders/${id}`, emp)).data.deliveries.length, 1);
  assert.equal((await call(`/packing/${made.data.slips[0].id}/confirm`, kho, 'POST', { photos: [] })).status, 400, 'vẫn bắt ảnh xác nhận kho');
  assert.equal((await call(`/packing/${made.data.slips[0].id}/confirm`, kho, 'POST', { photos: [photo], warehouseId: 'combined-warehouse' })).status, 200);
  assert.equal((await call(`/deliveries/${made.data.deliveryId}/status`, emp, 'PUT', { status: 'delivered' })).status, 200, 'không bắt buộc bước Đang giao');
  assert.equal((await call(`/orders/${id}`, mgr)).data.order.invoiceStatus, 'requested', 'vẫn tự yêu cầu hoá đơn');
});

test('gộp lịch giao + phiếu: nhiều nguồn giữ nháp, lỗi ngày/xưởng/số lượng không để lại lịch hoặc phiếu dở', async () => {
  const s = await combinedFixture(), { call, emp, mgr, id, lineId } = s; await s.approve();
  const allocations = [{ orderLineId: lineId, qty: 5, source: 'warehouse' }, { orderLineId: lineId, qty: 5, source: 'agent', sourceNote: 'Đại lý' }];
  const base = { allocations, schedule: { plannedDate: '2030-01-15' }, sendToWarehouse: true };
  for (const body of [{ ...base, schedule: { plannedDate: '2030-02-31' } }, { ...base, delivery: { to: 'workshop' } }, { ...base, allocations: [{ orderLineId: lineId, qty: 11, source: 'warehouse' }] }]) {
    assert.equal((await call(`/orders/${id}/packing`, emp, 'POST', body)).status, 400);
    assert.equal((await call(`/orders/${id}`, emp)).data.deliveries.length, 0);
    assert.equal((await call(`/orders/${id}/packing`, emp)).data.slips.length, 0);
  }
  const made = await call(`/orders/${id}/packing`, mgr, 'POST', base);
  assert.equal(made.status, 201, JSON.stringify(made.data)); assert.equal(made.data.sentToWarehouse, false);
  assert.equal((await call(`/orders/${id}`, mgr)).data.order.expectedDeliveryDate, '2030-01-15', 'Manager dùng form gộp cũng cập nhật ngày dự kiến như form lịch riêng');
  const p = (await call(`/orders/${id}/packing`, emp)).data;
  assert.deepEqual(p.slips.map((x: any) => x.status), ['draft', 'draft']);
  assert.deepEqual((await call(`/orders/${id}`, emp)).data.deliveries[0].lines.map((l: any) => l.qty), [10], 'gộp hai nguồn thành một số lượng giao, không nhân đôi');
});

test('lịch giao dùng chung: cộng mã lặp để chặn vượt số lượng; lịch đã có vẫn lập/gửi phiếu mà không tạo chuyến mới', async () => {
  const s = await combinedFixture(), { call, emp, id, lineId } = s; await s.approve();
  const dup = await call('/deliveries', emp, 'POST', { orderId: id, plannedDate: '2030-01-15', lines: [{ orderLineId: lineId, qty: 6 }, { orderLineId: lineId, qty: 6 }] });
  assert.equal(dup.status, 400); assert.equal((await call(`/orders/${id}`, emp)).data.deliveries.length, 0);
  assert.equal((await call('/deliveries', emp, 'POST', { orderId: id, plannedDate: '2030-01-15' })).status, 201);
  const made = await call(`/orders/${id}/packing`, emp, 'POST', { allocations: [{ orderLineId: lineId, qty: 10, source: 'warehouse' }], sendToWarehouse: true });
  assert.equal(made.status, 201, JSON.stringify(made.data)); assert.equal(made.data.deliveryId, null);
  assert.equal(made.data.sentToWarehouse, true); assert.equal((await call(`/orders/${id}`, emp)).data.deliveries.length, 1);
});

test('người nhận đơn khác người mua: API lịch giao và đóng gói dùng đúng cặp, không ghép SĐT người mua', async () => {
  const { call, emp, mgr, kho } = await setup();
  const q = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo: 'HRC_RECIPIENT', customer: 'Công ty mua', contact: 'Người mua', phone: '0901000001',
    vat: 8, rows: [{ name: 'Hàng kiểm thử', qty: 5, price: 100000 }] });
  assert.equal(q.status, 201);
  await call('/quotes/' + q.data.id + '/approve', mgr, 'POST', { revision: 1 });
  const made = await call('/orders', emp, 'POST', { quoteId: q.data.id, pushSapo: false, receiverName: 'Chị Nhận', receiverPhone: '0902000002' });
  assert.equal(made.status, 201, JSON.stringify(made.data)); const id = made.data.id;
  await call('/orders/' + id + '/status', mgr, 'PUT', { status: 'confirmed', verified: true, costWarningsReviewed: true });
  const detail = (await call('/orders/' + id, emp)).data;
  assert.equal(detail.order.contact, 'Người mua'); assert.equal(detail.order.phone, '0901000001');
  assert.equal(detail.order.receiverName, 'Chị Nhận'); assert.equal(detail.order.receiverPhone, '0902000002');
  const pack = (await call('/orders/' + id + '/packing', emp)).data;
  assert.equal(pack.delivery.customer.receiverName, 'Chị Nhận'); assert.equal(pack.delivery.customer.phone, '0902000002');
  const line = detail.lines[0].id;
  const a = await call('/deliveries', emp, 'POST', { orderId: id, plannedDate: '2030-01-15', lines: [{ orderLineId: line, qty: 1 }] });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  const b = await call('/deliveries', emp, 'POST', { orderId: id, plannedDate: '2030-01-16', receiverName: 'Anh nhận chuyến', receiverPhone: '', lines: [{ orderLineId: line, qty: 1 }] });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  const trips = (await call('/orders/' + id, emp)).data.deliveries;
  assert.deepEqual(trips.map((d:any)=>[d.receiverName,d.receiverPhone]), [['Chị Nhận','0902000002'],['Anh nhận chuyến','']]);
  assert.equal((await call('/orders/' + id)).status, 401);
  assert.equal((await call('/orders/' + id, kho)).status, 403);
});
