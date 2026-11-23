import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { quotations, quoteLines } from '../../src/modules/quotes/schema.ts';
import { salesOrders, salesOrderLines, salesContracts } from '../../src/modules/sales/schema.ts';
import { vietnamDate } from '../../src/modules/sales/domain/sales.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { incomingShipmentLines, incomingShipments, supplierOrderSources } from '../../src/modules/suppliers/schema.ts';

/** ĐƠN MUA NCC (đợt 2): lập từ chứng từ nguồn, chống mua trùng, chia NCC, duyệt, xác nhận thay NCC, nhận hàng từng đợt, Sapo, thanh toán, huỷ. */
const origin = 'https://trial.test', now = '2026-10-01T00:00:00.000Z';
async function setup(extraEnv: Record<string, unknown> = {}) {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await db.insert(warehouses).values({id:'receipt-wh',name:'Kho nhận kiểm thử',kind:'stock'});
  await postMoves(db,'mgr',[{sku:'FIXTURE-OPENING',warehouseId:'receipt-wh',qty:1,kind:'opening',refType:'opening',refId:'purchase-fixture'}]);
  for (const [id, pos] of [['kho', 'warehouse'], ['kt', 'accounting'], ['sa', 'sale-admin']] as const) {
    await d1.sqlite.prepare(`INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES (?,?,?,'','employee',?,1,'2026-01-01T00:00:00.000Z')`).run(id, id + '@x.vn', 'Tên ' + id, pos);
    await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run(id, await hashPassword(PASSWORD, 1000));
  }
  const files = new Map<string, Uint8Array>();
  const env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const,
    files: { put: async (k: string, b: Uint8Array) => { files.set(k, b); }, remove: async (keys: string[]) => { for (const k of keys) files.delete(k); }, signedUrls: async (keys: string[]) => new Map(keys.map(k => [k, 'https://files.test/' + k])) }, ...extraEnv };
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env as never);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const s = { db, call, files, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), kho: await login('kho@x.vn'), kt: await login('kt@x.vn'), sa: await login('sa@x.vn'), ncc: await login('ncc@x.vn') };
  // Chứng từ nguồn: báo giá của emp (ly 10, đĩa 5) và HĐKT của emp (ly 4).
  await db.insert(quotations).values({ id: 'q1', creatorId: 'emp', quoteNo: 'B2B_1', quoteType: 'B2B', customer: 'Kim Trần Gia', quoteDate: '2026-09-10', data: '{"rows":[]}', createdAt: now, updatedAt: now });
  await db.insert(quoteLines).values([{ id: 'ql1', quoteId: 'q1', lineNo: 1, sku: 'LY1', name: 'Ly sứ', unit: 'cái', qty: 10 }, { id: 'ql2', quoteId: 'q1', lineNo: 2, sku: 'DIA1', name: 'Đĩa', unit: 'cái', qty: 5 }]);
  await db.insert(salesOrders).values({ id: 'o1', orderNo: 'DH1', quoteType: 'B2B', customerName: 'Lys', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-09-10', status: 'confirmed', total: 1, createdAt: now, updatedAt: now });
  await db.insert(salesOrderLines).values({ id: 'ol1', orderId: 'o1', lineNo: 1, sku: 'LY1', name: 'Ly sứ', qty: 4 });
  await db.insert(salesContracts).values({ id: 'c1', orderId: 'o1', contractNo: 'HD-01', status: 'signed', createdBy: 'mgr', value: 1, legalEntity: 'BN', createdAt: now, updatedAt: now });
  const sup = async (name: string) => (await call('/suppliers', s.mgr, 'POST', { name, contacts: [{ kind: 'order', email: name.replace(/\W/g, '').toLowerCase() + '@ncc.vn' }] })).data.supplier.id as string;
  return { ...s, a: await sup('Minh Long'), b: await sup('Lys Ceramics') };
}

test('lập đơn mua: từ báo giá + HĐKT, chia 2 NCC, chống mua trùng, sửa nháp đúng người', async () => {
  const s = await setup(), { call, emp, mgr, kho, ncc, a, b } = s;
  assert.equal((await call('/purchase-orders', ncc)).status, 403, 'tài khoản NCC không vào trang nội bộ');
  // Tồn kho = tổng các kho thật đang dùng (không tính kho NCC / hàng chờ về); mã chưa có số liệu tồn → null.
  const db = (s as any).db;
  await db.insert(products).values({ sku: 'LY1', name: 'Ly sứ', updatedAt: now });
  await db.insert(warehouses).values([{ id: 'w1', name: 'Kho 1', kind: 'stock' }, { id: 'w2', name: 'Kho 2', kind: 'stock' }, { id: 'wn', name: 'Tồn NCC', kind: 'supplier' }]);
  await db.insert(productStock).values([{ sku: 'LY1', warehouseId: 'w1', quantity: 3, updatedAt: now }, { sku: 'LY1', warehouseId: 'w2', quantity: 1, updatedAt: now }, { sku: 'LY1', warehouseId: 'wn', quantity: 99, updatedAt: now }]);
  const src = (await call('/purchase-sources/quote/q1', emp)).data;
  assert.deepEqual(src.lines.map((l: any) => [l.sku, l.quantity, l.stock, l.remaining]), [['LY1', 10, 4, 10], ['DIA1', 5, null, 5]]);
  assert.equal((await call('/purchase-sources?q=HD-01', emp)).data.sources.some((x: any) => x.no === 'HD-01'), true, 'tìm theo số HĐKT');

  // Chia: ly 6 từ Minh Long, ly 4 + đĩa 5 từ Lys; ly của HĐKT đặt Minh Long.
  const created = await call('/purchase-orders', emp, 'POST', { orders: [
    { supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 10, price: 999, sources: [{ type: 'quote', id: 'q1', quantity: 6 }, { type: 'order', id: 'o1', quantity: 4 }] }] },
    { supplierId: b, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 4, sources: [{ type: 'quote', id: 'q1', quantity: 4 }] }, { sku: 'DIA1', quantity: 5, sources: [{ type: 'quote', id: 'q1', quantity: 5 }] }] },
  ] });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const [idA, idB] = created.data.ids;
  const pa = (await call(`/purchase-orders/${idA}`, emp)).data;
  assert.equal(pa.state, 'draft'); assert.equal(pa.priceHidden, true); assert.equal(pa.lines[0].price, null, 'nhân viên không nhập / thấy giá mua');
  assert.equal(pa.lines[0].printFee, null, 'phí in mua cũng ẩn với nhân viên');
  assert.deepEqual([pa.lines[0].name, pa.lines[0].unit], ['Ly sứ', 'cái'], 'tên / ĐVT lấy từ chứng từ nguồn khi để trống');
  assert.deepEqual(pa.lines[0].sources.map((x: any) => [x.no, x.quantity]).sort(), [['B2B_1', 6], ['HD-01', 4]]);
  assert.deepEqual((await call('/purchase-sources/quote/q1', emp)).data.lines.map((l: any) => [l.sku, l.ordered, l.remaining]), [['LY1', 10, 0], ['DIA1', 5, 0]]);

  // Mua trùng bị chặn.
  const dup = await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 1, sources: [{ type: 'quote', id: 'q1', quantity: 1 }] }] }] });
  assert.equal(dup.status, 409); assert.match(dup.data.error ?? dup.data.message, /vượt 1/);
  assert.equal((await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'X', quantity: 1 }] }, { supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'Y', quantity: 1 }] }] })).status, 400, 'một NCC một đơn');
  assert.equal((await call('/purchase-orders', kho, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 1, sources: [{ type: 'quote', id: 'q1', quantity: 1 }] }] }] })).status, 404, 'không thấy báo giá của người khác');

  // Sửa nháp: người tạo được, khoá theo revision; giảm số → trả lại phần còn cần đặt.
  const ed = await call(`/purchase-orders/${idB}`, emp, 'PUT', { supplierId: b, warehouse: '12 Đường Giao Hàng', revision: 1, lines: [{ sku: 'DIA1', quantity: 3, sources: [{ type: 'quote', id: 'q1', quantity: 3 }] }] });
  assert.equal(ed.status, 200, JSON.stringify(ed.data)); assert.equal(ed.data.revision, 2);
  assert.match(ed.data.events[0].summary, /DIA1: 5 → 3/);
  assert.equal((await call(`/purchase-orders/${idB}`, emp, 'PUT', { supplierId: b, warehouse: '12 Đường Giao Hàng', revision: 1, lines: [{ sku: 'DIA1', quantity: 2 }] })).status, 409, 'bản cũ');
  assert.deepEqual((await call('/purchase-sources/quote/q1', emp)).data.lines.map((l: any) => l.remaining), [4, 2]);
  const other = await call('/login', '', 'POST', { email: 'kt@x.vn', password: PASSWORD });
  assert.equal((await call(`/purchase-orders/${idB}`, other.cookie, 'PUT', { supplierId: b, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'DIA1', quantity: 1 }] })).status, 403, 'người khác không sửa nháp');
  assert.equal((await call(`/purchase-orders/${idB}`, kho)).status, 404, 'kho chỉ thấy đơn đã duyệt');

  // Huỷ đơn nháp: cần lý do; huỷ xong phần đã đặt được trả lại.
  assert.equal((await call(`/purchase-orders/${idB}/cancel`, emp, 'POST', { reason: '' })).status, 400);
  const cx = await call(`/purchase-orders/${idB}/cancel`, emp, 'POST', { reason: 'Khách đổi mẫu' });
  assert.equal(cx.data.state, 'cancelled'); assert.equal(cx.data.cancelReason, 'Khách đổi mẫu');
  assert.deepEqual((await call('/purchase-sources/quote/q1', emp)).data.lines.map((l: any) => l.remaining), [4, 5]);
  assert.equal((await call(`/purchase-orders/${idB}/cancel`, mgr, 'POST', { reason: 'lần hai' })).status, 409);
});

test('duyệt → xác nhận thay NCC → nhận từng đợt → Sapo → thanh toán nhiều lần', async () => {
  const { db, call, emp, mgr, kho, kt, a, files } = await setup();
  const id = (await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 10, sources: [{ type: 'quote', id: 'q1', quantity: 10 }] }, { sku: 'DIA1', quantity: 5 }] }] })).data.ids[0];
  let v = (await call(`/purchase-orders/${id}`, mgr)).data;
  assert.equal((await call(`/purchase-orders/${id}/approve`, emp, 'POST', {})).status, 403, 'chỉ Manager duyệt');
  assert.equal((await call(`/purchase-orders/${id}/receipts`, mgr, 'POST', { clientKey: 'k-00000001', warehouse: 'Kho nhận kiểm thử', lines: [{ lineId: v.lines[0].id, goodQty: 1 }] })).status, 409, 'chưa duyệt chưa nhận');
  assert.equal((await call(`/purchase-orders/${id}/approve`, mgr, 'POST', { internalNo: 'ML-FIXTURE', lines: [{ lineId: v.lines[0].id, price: 100 }] })).status, 400, 'thiếu giá đĩa');
  const ap = await call(`/purchase-orders/${id}/approve`, mgr, 'POST', { internalNo: 'ML-FIXTURE', lines: [{ lineId: v.lines[0].id, price: 100, purchaseDiscount: 10 }, { lineId: v.lines[1].id, price: 200 }],
    payment: { deposit: { mode: 'percent', value: 30, dueDate: '2026-01-05' }, balanceDueDate: '2099-01-01' } });
  assert.equal(ap.status, 200, JSON.stringify(ap.data)); v = ap.data;
  assert.equal(v.state, 'awaiting_confirmation'); assert.equal(v.totals.total, 1900);
  // Tra tồn (kho): đơn đã duyệt hiện ở "Hàng đang về" – số còn chờ, số đơn, NCC; không cộng vào tổng tồn, không có giá.
  await db.insert(products).values({ sku: v.lines[0].sku, name: 'Ly sứ', unit: 'cái', updatedAt: now }).onConflictDoNothing();
  const look = (await call('/inventory/lookup?q=' + v.lines[0].sku, kho)).data.products[0];
  assert.equal(look.incoming.qty, v.lines[0].quantity);
  assert.deepEqual(look.incoming.orders.map((o: any) => [o.ticketNumber, o.qty]), [[v.ticketNumber, v.lines[0].quantity]]);
  assert.equal(JSON.stringify(look.incoming).includes('price'), false);
  assert.deepEqual(v.schedules.map((s: any) => [s.kind, s.amount]), [['deposit', 570], ['balance', 1330]]);
  assert.equal(v.supplierEmail, 'minhlong@ncc.vn', 'người nhận mặc định từ danh bạ');
  assert.equal(v.debt.status, 'overdue', 'cọc quá hạn');
  const ve = (await call(`/purchase-orders/${id}`, emp)).data;
  assert.equal(ve.totals, null); assert.equal(ve.debt, null); assert.deepEqual(ve.actions, ['reference'], 'người tạo chỉ bổ sung mã NCC, không được duyệt/nhận hàng/xem giá');
  assert.equal((await call(`/purchase-orders/${id}`, kho)).data.lines[0].price, null, 'kho không thấy giá');
  assert.equal((await call(`/purchase-orders/${id}`, emp, 'PUT', { supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 1 }] })).status, 409, 'đã duyệt không sửa nháp');

  // Manager ghi nhận NCC xác nhận + ngày hẹn.
  assert.equal((await call(`/purchase-orders/${id}/confirm`, emp, 'POST', {})).status, 403);
  v = (await call(`/purchase-orders/${id}/confirm`, mgr, 'POST', { arrivalDate: '2026-10-20', internalNo: 'ML-77', lines: [{ lineId: v.lines[0].id, promisedDate: '2026-10-20' }] })).data;
  assert.equal(v.state, 'confirmed'); assert.equal(v.confirmedOnBehalf, true); assert.equal(v.internalNo, 'ML-77');
  assert.match(v.events[0].summary, /thay|ghi nhận NCC/i);

  // Nhận đợt 1 (kho): ly đạt 6 hỏng 1; bấm lặp cùng clientKey không tạo phiếu thứ hai.
  // Có hàng hỏng: bắt buộc 1–3 ảnh (lưu kho file, Manager xem trên phiếu nhận).
  const lines1 = [{ lineId: v.lines[0].id, goodQty: 6, damagedQty: 1 }], photo = 'data:image/jpeg;base64,' + Buffer.from('anh-hong').toString('base64');
  const noPhoto = await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'rcv-000009', warehouse: 'Kho nhận kiểm thử', lines: lines1 });
  assert.equal(noPhoto.status, 400); assert.match(noPhoto.data.error, /ảnh/);
  assert.equal((await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'rcv-000008', warehouse: 'Kho nhận kiểm thử', lines: lines1, photos: ['data:text/html;base64,PGI+'] })).status, 400, 'chỉ nhận ảnh');
  const r1 = await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'rcv-000001', warehouse: 'Kho nhận kiểm thử', lines: lines1, photos: [photo] });
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  assert.equal(r1.data.receipts[0].photos.length, 1); assert.match(r1.data.receipts[0].photos[0], /^https:\/\/files\.test\/warehouse-photos\/supplier_receipt\//);
  const again = await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'rcv-000001', warehouse: 'Kho nhận kiểm thử', lines: lines1, photos: [photo] });
  assert.equal(again.data.duplicate, true); assert.equal(again.data.receipts.length, 1);
  assert.equal(files.size, 1, 'gửi lặp: ảnh tải lại được dọn, không để file rác');
  v = again.data; assert.equal(v.state, 'partially_received');
  assert.deepEqual(v.lines.map((l: any) => [l.good, l.damaged, l.missing]), [[6, 1, 4], [0, 0, 5]]);
  assert.equal(v.receipts[0].sapoStatus, 'failed', 'chưa cấu hình webhook: giữ phiếu, báo lỗi giao job; không coi là đã nhập Sapo');
  assert.equal((await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'rcv-000002', warehouse: 'Kho nhận kiểm thử', lines: [{ lineId: v.lines[0].id, goodQty: 5 }] })).status, 400, 'vượt số thiếu');
  const overBad = await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'rcv-000012', warehouse: 'Kho nhận kiểm thử', lines: [{ lineId: v.lines[0].id, goodQty: 4, damagedQty: 1 }], photos: [photo] });
  assert.equal(overBad.status, 400, 'còn thiếu 4: đạt 4 + hỏng 1 → không ghi nhận đủ'); assert.equal(overBad.data.code, 'RECEIPT_OVER');
  assert.equal(files.size, 1, 'phiếu bị từ chối trong giao dịch: ảnh đã tải được dọn');
  const hist = (await call('/products/' + encodeURIComponent(v.lines[0].sku) + '/history', mgr)).data.history;
  assert.deepEqual(hist.map((h: any) => [h.kind, h.qty, h.status]), [['purchase', 6, 'Đạt 6 · hỏng 1 (NCC giao bù)']], 'phiếu nhận ghi vào lịch sử sản phẩm');
  assert.match(hist[0].refCode, /^PNH_/); assert.equal(hist[0].link, `#/purchases/${id}`);
  assert.equal((await call(`/purchase-orders/${id}/receipts`, emp, 'POST', { clientKey: 'rcv-000003', warehouse: 'Kho nhận kiểm thử', lines: [{ lineId: v.lines[0].id, goodQty: 1 }] })).status, 403, 'sale không nhận kho');

  // Sapo: lỗi giữ phiếu; nhập xong cần mã; không nhập lần hai; chỉ Manager mở lại.
  const rid = v.receipts[0].id;
  assert.equal((await call(`/supplier-receipts/${rid}/sapo`, kho, 'PUT', { status: 'failed' })).status, 400, 'lỗi phải ghi chú');
  assert.equal((await call(`/supplier-receipts/${rid}/sapo`, kho, 'PUT', { status: 'failed', note: 'Sapo 500' })).data.receipts[0].sapoStatus, 'failed');
  assert.equal((await call(`/supplier-receipts/${rid}/sapo`, kho, 'PUT', { status: 'done' })).status, 409, 'không đánh dấu hoàn tất thủ công');
  assert.equal((await call(`/supplier-receipts/${rid}/sapo`, kho, 'PUT', { status: 'done', code: 'PN001' })).status, 409, 'chỉ callback đã xác minh mới hoàn tất');
  assert.equal((await call(`/purchase-orders/${id}/cancel`, mgr, 'POST', { reason: 'Đổi NCC' })).status, 409, 'đã nhận hàng không huỷ đơn');

  // Nhận đợt 2 đủ → đã nhận.
  v = (await call(`/purchase-orders/${id}/receipts`, mgr, 'POST', { clientKey: 'rcv-000004', createSapo:false, warehouse: 'Kho nhận kiểm thử', lines: [{ lineId: v.lines[0].id, goodQty: 4 }, { lineId: v.lines[1].id, goodQty: 5 }] })).data;
  assert.equal(v.state, 'received'); assert.equal(v.receipts.length, 2);
  assert.match(v.receipts.map((r: any) => r.receiptNo).join(','), /PNH_\d{8}_/);
  // Huỷ phiếu chưa nhập Sapo (chỉ Manager) → quay lại nhận một phần.
  const r2 = v.receipts.find((r: any) => r.id !== rid).id;
  assert.equal((await call(`/supplier-receipts/${r2}/cancel`, kho, 'POST', { reason: 'Nhầm' })).status, 403);
  v = (await call(`/supplier-receipts/${r2}/cancel`, mgr, 'POST', { reason: 'Đếm nhầm' })).data;
  assert.equal(v.state, 'partially_received');
  assert.equal((await call('/products/' + encodeURIComponent(v.lines[1].sku) + '/history', mgr)).data.history.length, 0, 'huỷ phiếu nhận: bỏ khỏi lịch sử sản phẩm');

  // Thanh toán: Manager + kế toán; clientKey; không vượt công nợ; chứng từ; Manager huỷ khoản trả.
  assert.equal((await call(`/purchase-orders/${id}/payments`, kho, 'POST', { clientKey: 'pay-000001', warehouse: 'Kho nhận kiểm thử', amount: 100 })).status, 403);
  const pay = { clientKey: 'pay-000001', warehouse: 'Kho nhận kiểm thử', amount: 570, paidDate: vietnamDate().iso, reference: 'UNC 12', attachment: { name: 'unc.png', mime: 'image/png', data: Buffer.from('png').toString('base64') } };
  const p1 = await call(`/purchase-orders/${id}/payments`, kt, 'POST', pay);
  assert.equal(p1.status, 201, JSON.stringify(p1.data));
  assert.equal((await call(`/purchase-orders/${id}/payments`, kt, 'POST', pay)).data.payments.length, 1, 'bấm lặp không trả hai lần');
  assert.equal(files.size, 2, '1 ảnh hàng hỏng + 1 chứng từ thanh toán');
  assert.equal((await call(`/purchase-orders/${id}/payments`, kt, 'POST', { clientKey: 'pay-000002', warehouse: 'Kho nhận kiểm thử', amount: 2000 })).status, 409, 'vượt công nợ');
  v = (await call(`/purchase-orders/${id}`, kt)).data;
  assert.deepEqual([v.debt.paid, v.debt.balance, v.debt.status], [570, 1330, 'open']);
  assert.match((await call(`/supplier-payments/${v.payments[0].id}/attachment`, kt)).data.url, /supplier-payments/);
  assert.equal((await call(`/supplier-payments/${v.payments[0].id}/attachment`, kho)).status, 403);
  assert.equal((await call(`/supplier-payments/${v.payments[0].id}/void`, kt, 'POST', { reason: 'Sai số' })).status, 403, 'chỉ Manager huỷ khoản trả');
  v = (await call(`/supplier-payments/${v.payments[0].id}/void`, mgr, 'POST', { reason: 'Sai số tiền' })).data;
  assert.equal(v.debt.paid, 0); assert.ok(v.payments[0].voidedAt, 'giữ lịch sử khoản đã huỷ');
  // Đổi lịch trả (không cọc, trả 2 đợt).
  v = (await call(`/purchase-orders/${id}/schedules`, kt, 'PUT', { payment: { installments: [{ amount: 900, dueDate: '2099-01-01' }], balanceDueDate: '2099-02-01' } })).data;
  assert.deepEqual(v.schedules.map((s: any) => [s.kind, s.amount]), [['installment', 900], ['balance', 1000]]);

  // Lọc danh sách.
  const list = async (state: string, who = mgr) => (await call('/purchase-orders?state=' + state, who)).data.orders.map((o: any) => o.id);
  assert.deepEqual(await list('partially_received'), [id]);
  assert.deepEqual(await list('sapo'), [id], 'phiếu còn lại chưa có callback xác minh, vẫn cần xử lý Sapo');
  assert.deepEqual(await list('draft'), []);
  assert.ok(v.events.length >= 8, 'có lịch sử thao tác');
});

test('việc tự sinh + sơ đồ: chờ duyệt → chờ xác nhận → nhận hàng (kho) → nhập Sapo (kho) → trả NCC (kế toán)', async () => {
  const { RULES } = await import('../../src/modules/tasks/api/auto-tasks.ts');
  const s = await setup(), { call, emp, mgr, kho, a } = s;
  const today = vietnamDate().iso;
  const id = (await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', arrivalDate: today, lines: [{ sku: 'LY1', quantity: 2 }] }] })).data.ids[0];
  const db = (s as any).db;
  const keys = async () => (await RULES.supplierPurchases!(db, today)).map(t => [t.autoKey.split(':')[0], t.assigneeId ?? t.assigneePosition ?? 'manager']);
  assert.deepEqual(await keys(), [], 'nháp chưa gửi duyệt: chưa giao việc cho Manager');
  let v = (await call(`/purchase-orders/${id}`, mgr)).data;
  await call(`/purchase-orders/${id}/submit`, emp, 'POST', { revision: v.revision });
  assert.deepEqual(await keys(), [['po-approve', 'manager']]);
  v = (await call(`/purchase-orders/${id}`, mgr)).data;
  await call(`/purchase-orders/${id}/approve`, mgr, 'POST', { internalNo: 'ML-FIXTURE', lines: [{ lineId: v.lines[0].id, price: 100 }], payment: { balanceDueDate: today } });
  assert.deepEqual(await keys(), [['po-confirm', 'manager'], ['po-pay', 'accounting']]);
  await call(`/purchase-orders/${id}/confirm`, mgr, 'POST', {});
  assert.deepEqual((await keys()).map(k => k[0]).sort(), ['po-pay'] /* Nhắc nhận hàng đã chuyển sang receivingReminders lúc 08:00, có test riêng. */);
  v = (await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'rcv-flow-1', warehouse: 'Kho nhận kiểm thử', lines: [{ lineId: v.lines[0].id, goodQty: 2 }] })).data;
  assert.deepEqual((await keys()).sort(), [['po-pay', 'accounting'], ['po-sapo', 'warehouse']]);
  const flow = (await call('/flow', kho)).data;
  const node = flow.nodes?.purchase ?? flow.purchase;
  assert.equal(node.metrics.find((m: any) => m.key === 'sapo').value, 1, 'sơ đồ: phiếu chờ nhập Sapo');
  assert.equal(node.items[0].hash, '#/purchases/' + id);
});

test('giao diện đơn mua: không chèn HTML thô', () => {
  for (const f of ['purchases.js', 'purchase-pdf.js']) assert.doesNotMatch(readFileSync(new URL('../../trial-ui/' + f, import.meta.url), 'utf8'), /innerHTML|insertAdjacentHTML/);
});

test('email NCC: hỏi tồn (ai xem đơn cũng gửi, không kèm giá) / gửi đơn (Manager – Kế toán, đơn đã duyệt); ghi lịch sử', async () => {
  const { call, emp, mgr, kho, a } = await setup();
  const id = (await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 2 }] }] })).data.ids[0];
  const stock = await call(`/purchase-orders/${id}/mail`, emp, 'POST', { kind: 'stock' });
  assert.equal(stock.status, 200, JSON.stringify(stock.data)); assert.equal(stock.data.to, 'minhlong@ncc.vn');
  assert.equal((await call(`/purchase-orders/${id}/mail`, emp, 'POST', { kind: 'order' })).status, 403, 'nhân viên không gửi đơn (có giá)');
  assert.equal((await call(`/purchase-orders/${id}/mail`, mgr, 'POST', { kind: 'order' })).status, 409, 'chưa duyệt chưa gửi đơn');
  const v = (await call(`/purchase-orders/${id}`, mgr)).data;
  await call(`/purchase-orders/${id}/approve`, mgr, 'POST', { internalNo: 'ML-FIXTURE', lines: [{ lineId: v.lines[0].id, price: 100 }], supplierEmail: 'chot@ncc.vn' });
  const order = await call(`/purchase-orders/${id}/mail`, mgr, 'POST', { kind: 'order' });
  assert.equal(order.data.to, 'chot@ncc.vn', 'dùng người nhận Manager chốt khi duyệt');
  assert.equal((await call(`/purchase-orders/${id}/mail`, kho, 'POST', { kind: 'order' })).status, 403);
  const events = (await call(`/purchase-orders/${id}`, mgr)).data.events.map((e: any) => e.summary);
  assert.ok(events.some((x: string) => x.startsWith('Gửi email hỏi tồn tới minhlong@ncc.vn')) && events.some((x: string) => x.startsWith('Gửi email đơn đặt hàng tới chot@ncc.vn')));
});

test('gửi email đơn đặt hàng từ máy chủ (Resend): kèm PDF, người nhận theo đơn, quyền, lỗi dịch vụ, chưa cấu hình', async () => {
  const sent: any[] = []; let fail = 0;
  const mailer = { apiKey: 're_test_key_123', from: 'Bách Ngân <don@bn.vn>', alwaysCc: ['luu@bn.test', 'KT@ncc.vn'], fetch: (async (url: string, init: RequestInit) => {
    if (fail) return new Response(JSON.stringify({ message: 'bad' }), { status: fail });
    sent.push({ url, auth: (init.headers as Record<string, string>).authorization, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ id: 'mail-1' }), { status: 200 });
  }) as unknown as typeof fetch };
  const { call, emp, mgr, kt, a } = await setup({ mailer });
  const pdf = Buffer.from('%PDF-1.7 thử').toString('base64');
  const id = (await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 2 }] }] })).data.ids[0];
  assert.equal((await call(`/purchase-orders/${id}/send-email`, emp, 'POST', { pdf })).status, 403, 'nhân viên không gửi đơn có giá');
  assert.equal((await call(`/purchase-orders/${id}/send-email`, mgr, 'POST', { pdf })).status, 409, 'chưa duyệt chưa gửi');
  const v = (await call(`/purchase-orders/${id}`, mgr)).data;
  await call(`/purchase-orders/${id}/approve`, mgr, 'POST', { internalNo: 'ML-FIXTURE', lines: [{ lineId: v.lines[0].id, price: 100 }], supplierEmail: 'chot@ncc.vn', cc: ['kt@ncc.vn'] });
  assert.equal((await call(`/purchase-orders/${id}/send-email`, mgr, 'POST', { pdf: Buffer.from('<html>').toString('base64') })).status, 400, 'không phải PDF');
  assert.equal((await call(`/purchase-orders/${id}/send-email`, mgr, 'POST', {})).status, 400);
  const r = await call(`/purchase-orders/${id}/send-email`, kt, 'POST', { pdf, to: 'ke-gian@evil.test' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.to, 'chot@ncc.vn');
  assert.equal(sent.length, 1); const m = sent[0];
  assert.equal(m.url, 'https://api.resend.com/emails'); assert.equal(m.auth, 'Bearer re_test_key_123');
  assert.deepEqual(m.body.to, ['chot@ncc.vn'], 'người nhận do máy chủ quyết, bỏ qua "to" từ trình duyệt'); assert.deepEqual(m.body.cc, ['kt@ncc.vn', 'emp@x.vn', 'mgr@x.vn', 'luu@bn.test'], 'CC: danh bạ/Manager chốt + nhân viên phụ trách (người lập đơn mua) + Manager + CC chung (MAIL_CC), bỏ trùng');
  assert.equal(m.body.from, 'Bách Ngân <don@bn.vn>'); assert.equal(m.body.reply_to, 'kt@x.vn', 'NCC trả lời về người bấm gửi');
  assert.match(m.body.subject, /^Đơn đặt hàng DMH_/); assert.match(m.body.text, /1\. LY1 - .*: 2/);
  assert.equal(m.body.attachments.length, 1); assert.match(m.body.attachments[0].filename, /^Don-dat-hang-DMH_\w+\.pdf$/); assert.equal(m.body.attachments[0].content, pdf);
  const events = (await call(`/purchase-orders/${id}`, mgr)).data.events.map((e: any) => e.summary);
  assert.ok(events.some((x: string) => x.startsWith('Đã gửi email đơn đặt hàng (kèm PDF) tới chot@ncc.vn (CC kt@ncc.vn, emp@x.vn, mgr@x.vn, luu@bn.test)')));
  // Manager lập đơn từ HĐKT do emp phụ trách → CC cả Manager (người lập) và emp (người phụ trách chứng từ).
  const id3 = (await call('/purchase-orders', mgr, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 4, sources: [{ type: 'order', id: 'o1', quantity: 4 }] }] }] })).data.ids[0];
  const v3 = (await call(`/purchase-orders/${id3}`, mgr)).data;
  await call(`/purchase-orders/${id3}/approve`, mgr, 'POST', { internalNo: 'ML-FIXTURE', lines: [{ lineId: v3.lines[0].id, price: 100 }] });
  assert.equal((await call(`/purchase-orders/${id3}/send-email`, mgr, 'POST', { pdf })).status, 200);
  assert.deepEqual(sent[1].body.cc, ['mgr@x.vn', 'emp@x.vn', 'luu@bn.test', 'KT@ncc.vn']);
  fail = 401;
  const bad = await call(`/purchase-orders/${id}/send-email`, mgr, 'POST', { pdf });
  assert.equal(bad.status, 502); assert.doesNotMatch(JSON.stringify(bad.data), /re_test_key/, 'không lộ mã API');
  // Chưa cấu hình: 503 + mã để giao diện quay về soạn mail ở máy.
  const none = await setup();
  const id2 = (await none.call('/purchase-orders', none.mgr, 'POST', { orders: [{ supplierId: none.a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 1 }] }] })).data.ids[0];
  const v2 = (await none.call(`/purchase-orders/${id2}`, none.mgr)).data;
  await none.call(`/purchase-orders/${id2}/approve`, none.mgr, 'POST', { internalNo: 'ML-FIXTURE', lines: [{ lineId: v2.lines[0].id, price: 100 }] });
  const nc = await none.call(`/purchase-orders/${id2}/send-email`, none.mgr, 'POST', { pdf });
  assert.equal(nc.status, 503); assert.equal(nc.data.code, 'mail_not_configured');
});

test('lưu giá nhập khi chưa duyệt: chỉ Manager, đơn vẫn nháp, ô giá trống = chưa có giá, chống ghi đè bản cũ', async () => {
  const { call, emp, mgr, kt, a } = await setup();
  const id = (await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 2 }, { sku: 'DIA1', quantity: 3 }] }] })).data.ids[0];
  const v = (await call(`/purchase-orders/${id}`, mgr)).data, [l1, l2] = v.lines;
  const body = { revision: v.revision, lines: [{ lineId: l1.id, price: 74000, purchaseDiscount: 19, taxRate: 8 }, { lineId: l2.id, price: null, purchaseDiscount: 25, taxRate: 10 }] };
  assert.equal((await call(`/purchase-orders/${id}/prices`, emp, 'POST', body)).status, 403, 'nhân viên không lưu giá');
  assert.equal((await call(`/purchase-orders/${id}/prices`, kt, 'POST', body)).status, 403, 'kế toán xem giá nhưng không duyệt/lưu giá');
  assert.equal((await call(`/purchase-orders/${id}/prices`, mgr, 'POST', { ...body, lines: [{ lineId: l1.id, price: -1 }] })).status, 400);
  const r = await call(`/purchase-orders/${id}/prices`, mgr, 'POST', body);
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.state, 'draft', 'vẫn là nháp');
  const s1 = r.data.lines.find((l: any) => l.id === l1.id), s2 = r.data.lines.find((l: any) => l.id === l2.id);
  assert.equal(s1.price, 74000); assert.equal(s1.purchaseDiscount, 19); assert.equal(s1.taxRate, 8);
  assert.equal(s2.price, null); assert.equal(s2.purchaseDiscount, 25);
  assert.equal((await call(`/purchase-orders/${id}/prices`, mgr, 'POST', body)).status, 409, 'revision cũ bị từ chối');
  assert.ok(r.data.events.some((e: any) => e.summary === 'Lưu giá nhập 1/2 dòng (chưa duyệt)'));
  // Duyệt sau đó dùng giá đã lưu cho dòng không gửi lại giá.
  const ok = await call(`/purchase-orders/${id}/approve`, mgr, 'POST', { internalNo: 'ML-FIXTURE', revision: r.data.revision, lines: [{ lineId: l2.id, price: 1000, purchaseDiscount: 25, taxRate: 10 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.equal(ok.data.lines.find((l: any) => l.id === l1.id).price, 74000); assert.equal(ok.data.lines.find((l: any) => l.id === l1.id).purchaseDiscount, 19);
});


test('địa chỉ giao hàng bắt buộc: tạo nhiều NCC nguyên tử và sửa nháp không xoá địa chỉ', async () => {
  const { call, emp, mgr, a, b } = await setup();
  const order = { supplierId: a, lines: [{ sku: 'LY1', name: 'Ly sứ', quantity: 1 }] };
  for (const warehouse of [undefined, null, '', ' \n\t ', 123, 'x'.repeat(121)]) {
    const res = await call('/purchase-orders', emp, 'POST', { orders: [{ ...order, warehouse: '12 Đường Giao Hàng' }, { ...order, supplierId: b, warehouse }] });
    assert.equal(res.status, 400);
    assert.match(res.data.error ?? res.data.message, /địa chỉ giao hàng/i);
  }
  // Một NCC hợp lệ, một NCC thiếu địa chỉ: không tạo dở đơn của NCC đầu tiên.
  const partial = await call('/purchase-orders', emp, 'POST', { orders: [{ ...order, warehouse: '12 Đường Giao Hàng' }, { ...order, supplierId: b }] });
  assert.equal(partial.status, 400);
  assert.equal((await call('/purchase-orders', mgr)).data.orders.length, 0);
  const created = await call('/purchase-orders', emp, 'POST', { orders: [{ ...order, warehouse: '  12 Đường Giao Hàng  ' }] });
  assert.equal(created.status, 201);
  const id = created.data.ids[0];
  const before = (await call(`/purchase-orders/${id}`, emp)).data;
  assert.equal(before.warehouse, '12 Đường Giao Hàng');
  for (const warehouse of [undefined, '', '   ']) {
    const edited = await call(`/purchase-orders/${id}`, emp, 'PUT', { ...order, revision: before.revision, warehouse });
    assert.equal(edited.status, 400);
    const after = (await call(`/purchase-orders/${id}`, emp)).data;
    assert.equal(after.warehouse, before.warehouse);
    assert.equal(after.revision, before.revision);
    assert.equal(after.lines[0].quantity, 1);
  }
  const edited = await call(`/purchase-orders/${id}`, emp, 'PUT', { ...order, revision: before.revision, warehouse: '  34 Đường Mới  ' });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.warehouse, '34 Đường Mới');
});

test('đơn mua của nhân viên là nháp, chỉ vào hàng chờ duyệt khi bấm "Gửi duyệt"; Manager lập thì vào thẳng', async () => {
  const { call, emp, mgr, kt, a } = await setup();
  const id = (await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'LY1', quantity: 2 }] }] })).data.ids[0];
  let v = (await call(`/purchase-orders/${id}`, emp)).data;
  assert.equal(v.submittedAt, null); assert.equal(v.stateLabel, 'Nháp – chưa gửi duyệt'); assert.ok(v.actions.includes('submit'));
  assert.equal((await call(`/purchase-orders/${id}/submit`, kt, 'POST', { revision: v.revision })).status, 403, 'người khác không gửi thay');
  const r = await call(`/purchase-orders/${id}/submit`, emp, 'POST', { revision: v.revision });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.ok(r.data.submittedAt); assert.equal(r.data.stateLabel, 'Nháp – chờ Manager duyệt');
  assert.ok(!r.data.actions.includes('submit')); assert.ok(r.data.events.some((e: any) => e.summary === 'Gửi Manager duyệt đơn mua'));
  assert.equal((await call(`/purchase-orders/${id}/submit`, emp, 'POST', { revision: r.data.revision })).status, 409, 'không gửi lần hai');
  const mid = (await call('/purchase-orders', mgr, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'DIA1', quantity: 1 }] }] })).data.ids[0];
  v = (await call(`/purchase-orders/${mid}`, mgr)).data;
  assert.ok(v.submittedAt, 'Manager lập = đã gửi'); assert.ok(!v.actions.includes('submit'));
});

test('badge đơn mua: đếm toàn bộ tìm kiếm trên server, độc lập trạng thái/giới hạn, đúng quyền và tiến độ', async () => {
  const s = await setup(), { call, mgr, emp, kho, ncc, a, db } = s;
  const { incomingShipments: po, incomingShipmentLines: ln, supplierReceipts: rec, supplierReceiptLines: rln, supplierPayments: pay } = await import('../../src/modules/suppliers/schema.ts');
  const base = { source: 'supplier-order' as const, warehouse: '12 Đường Giao Hàng', supplierId: a, supplierName: 'NCC COUNT%', createdAt: now, updatedAt: now, createdBy: 'emp' };
  await db.insert(po).values([
    ...Array.from({ length: 310 }, (_, i) => ({ ...base, id: `bulk-${i}`, ticketNumber: `BULK-${i}`, approvalStatus: 'pending' as const })),
    { ...base, id: 'other-draft', ticketNumber: 'OTHER', approvalStatus: 'pending', createdBy: 'mgr' },
    { ...base, id: 'wait', ticketNumber: 'COUNT-wait', approvalStatus: 'approved', arrivalDate: '2099-01-01' },
    { ...base, id: 'confirmed', ticketNumber: 'COUNT-confirmed', approvalStatus: 'approved', supplierStatus: 'confirmed', arrivalDate: '2020-01-01' },
    { ...base, id: 'partial', ticketNumber: 'COUNT-partial', approvalStatus: 'approved' },
    { ...base, id: 'full', ticketNumber: 'COUNT-full', approvalStatus: 'approved' },
    { ...base, id: 'cancelled', ticketNumber: 'COUNT-cancelled', approvalStatus: 'approved', cancelledAt: now },
    { ...base, id: 'empty', ticketNumber: 'COUNT-empty', approvalStatus: 'approved' },
  ]);
  await db.insert(ln).values(['wait', 'confirmed', 'partial', 'full', 'cancelled'].map(id => ({ id: `line-${id}`, shipmentId: id, lineNo: 1, sku: id, quantity: 10, price: 100, printFee: 5, taxRate: 8, purchaseDiscount: 50, confirmedPurchaseDiscount: 10, promisedDate: id === 'wait' ? '2020-01-01' : '' })));
  await db.insert(rec).values(['partial', 'full', 'wait'].map(id => ({ id: `rec-${id}`, receiptNo: `RC-${id}`, shipmentId: id, receivedDate: '2026-10-01', receivedBy: 'mgr', clientKey: id, createdAt: now, sapoStatus: id === 'full' ? 'done' as const : 'pending' as const, cancelledAt: id === 'wait' ? now : null })));
  await db.insert(rln).values(['partial', 'full', 'wait'].map(id => ({ receiptId: `rec-${id}`, lineId: `line-${id}`, sku: id, goodQty: id === 'full' ? 10 : id === 'wait' ? 10 : 0, damagedQty: id === 'partial' ? 1 : 0 })));
  await db.insert(pay).values({ id: 'paid-full', shipmentId: 'full', amount: 1026, paidDate: '2026-10-01', method: 'cash', clientKey: 'paid-full', createdBy: 'mgr', createdAt: now });
  const all = await call('/purchase-orders', mgr);
  assert.equal(all.status, 200, JSON.stringify(all.data));
  assert.equal(all.data.orders.length, 300);
  assert.deepEqual(all.data.counts, { all: 317, draft: 311, awaiting_confirmation: 2, confirmed: 1, partially_received: 1, received: 1, cancelled: 1, late: 2, sapo: 1, debt: 3 }, 'còn nợ NCC: đơn đã huỷ không tính');
  const sapoOnly = await call('/purchase-orders?state=sapo', mgr);
  assert.equal(sapoOnly.data.orders.length,1,'lọc Sapo trước giới hạn không làm mất phiếu cũ sau hơn 300 đơn mới');
  assert.ok(sapoOnly.data.orders[0].sapoPending>0);
  assert.deepEqual(sapoOnly.data.counts,all.data.counts);
  const selected = await call('/purchase-orders?state=confirmed', mgr);
  assert.deepEqual(selected.data.counts, all.data.counts, 'chọn thẻ không làm các thẻ khác về 0');
  const searched = await call('/purchase-orders?q=COUNT-', mgr);
  assert.equal(searched.data.counts.all, 6);
  assert.equal((await call('/purchase-orders?q=%25', mgr)).data.counts.all, 317, 'ký tự % tìm theo nghĩa đen');
  const warehouse = (await call('/purchase-orders', kho)).data;
  assert.equal(warehouse.counts.all, 6); assert.equal(warehouse.counts.draft, 0); assert.equal(warehouse.counts.debt, 0, 'không lộ công nợ cho kho');
  assert.equal((await call('/purchase-orders', emp)).data.counts.all, 316, 'không thấy nháp của người khác');
  assert.equal((await call('/purchase-orders', ncc)).status, 403);
  assert.equal((await call('/purchase-orders')).status, 401);
});

test('số đỏ menu: việc chưa hoàn tất, phạm vi đơn, cập nhật ngay khi hoàn tất và không đếm trùng', async () => {
  const { db, call, mgr, emp, kho, ncc, a } = await setup();
  const { packingSlips, deliveries } = await import('../../src/modules/sales/schema.ts');
  await db.insert(salesOrders).values({ id: 'other-order', orderNo: 'OTHER-ORDER', quoteType: 'B2B', customerName: 'Khác', ownerId: 'mgr', createdBy: 'mgr', orderDate: '2026-10-01', createdAt: now, updatedAt: now });
  await db.insert(packingSlips).values([
    { id: 'pack-own', slipNo: 'PACK-OWN', orderId: 'o1', status: 'sent', createdBy: 'emp', createdAt: now, updatedAt: now },
    { id: 'pack-other', slipNo: 'PACK-OTHER', orderId: 'other-order', status: 'sent', createdBy: 'mgr', createdAt: now, updatedAt: now },
    { id: 'pack-done', slipNo: 'PACK-DONE', orderId: 'o1', status: 'packed', createdBy: 'emp', createdAt: now, updatedAt: now },
  ]);
  await db.insert(deliveries).values((['planned', 'in_transit', 'delivered', 'cancelled', 'failed'] as const).map((status, i) => ({ id: `delivery-${i}`, deliveryNo: `DEL-${i}`, orderId: i === 1 ? 'other-order' : 'o1', plannedDate: '2026-10-01', status, createdBy: 'mgr', createdAt: now, updatedAt: now })));
  const created = await call('/purchase-orders', mgr, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [{ sku: 'TEST', quantity: 1 }] }] });
  assert.equal(created.status, 201);
  assert.deepEqual((await call('/navigation-counts', mgr)).data, { transfers: 0, cash: 0, packing: 2, deliveries: 3, purchases: 1, receiving: 0 });
  assert.deepEqual((await call('/navigation-counts', kho)).data, { transfers: 0, cash: 0, packing: 2, deliveries: 3, purchases: 0, receiving: 0 });
  assert.deepEqual((await call('/navigation-counts', emp)).data, { transfers: 0, cash: 0, packing: 1, deliveries: 2, purchases: 0, receiving: 0 });
  const { eq } = await import('drizzle-orm');
  await db.update(salesOrders).set({ status: 'delivered' }).where(eq(salesOrders.id, 'o1'));
  assert.equal((await call('/navigation-counts', mgr)).data.packing, 1, 'phiếu còn treo của đơn đã giao không còn là việc chờ đóng');
  await db.update(packingSlips).set({ status: 'packed' }).where(eq(packingSlips.id, 'pack-other'));
  assert.equal((await call('/navigation-counts', mgr)).data.packing, 0);
  assert.equal((await call('/navigation-counts', ncc)).status, 403);
  assert.equal((await call('/navigation-counts')).status, 401);
});

test('nhập đơn mua từ file NCC: mỗi số đơn một đơn "đã duyệt + NCC đã xác nhận", số đã giao thành phiếu nhận không cần Sapo, nhập lại không trùng', async () => {
  const { db, call, emp, mgr, kho, a } = await setup();
  await db.insert(products).values([{ sku: 'LY1', name: 'Ly sứ', updatedAt: now }, { sku: 'DIA1', name: 'Đĩa', updatedAt: now }]);
  const orders = [
    { internalNo: 'DDLT0001/1026', arrivalDate: '2026-10-22', lines: [{ sku: 'LY1', name: 'Ly sứ', quantity: 500, price: 187000, discount: 25, promisedDate: '2026-10-22' }, { sku: '030937000', name: 'Chén chấm', quantity: 100, price: 15000, discount: 25 }] },
    { internalNo: 'DDLT0002/1026', arrivalDate: '2026-11-05', lines: [{ sku: 'DIA1', name: 'Đĩa', quantity: 300, price: 1000, discount: 0, received: 100 }] },
  ];
  const body = { supplierId: a, warehouse: 'Kho Cần Thơ', taxRate: 8, orders };
  assert.equal((await call('/purchase-orders/import', emp, 'POST', body)).status, 403, 'chỉ Manager');
  assert.equal((await call('/purchase-orders/import', mgr, 'POST', { ...body, warehouse: '' })).status, 400, 'bắt buộc địa chỉ giao');
  assert.equal((await call('/purchase-orders/import', mgr, 'POST', { ...body, orders: [{ ...orders[1], lines: [{ ...orders[1]!.lines[0], received: 301 }] }] })).status, 400, 'đã giao vượt số đặt');
  const r = await call('/purchase-orders/import', mgr, 'POST', body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(r.data.created.map((x: any) => x.internalNo), ['DDLT0001/1026', 'DDLT0002/1026']);
  let v = (await call(`/purchase-orders/${r.data.created[0].id}`, mgr)).data;
  assert.deepEqual([v.state, v.internalNo, v.warehouse, v.arrivalDate, v.confirmedOnBehalf], ['confirmed', 'DDLT0001/1026', 'Kho Cần Thơ', '2026-10-22', true]);
  assert.deepEqual(v.lines.map((l: any) => [l.sku, l.quantity, l.price, l.purchaseDiscount, l.taxRate, l.promisedDate]), [['LY1', 500, 187000, 25, 8, '2026-10-22'], ['030937000', 100, 15000, 25, 8, '2026-10-22']]);
  assert.equal(v.totals.subtotal, 500 * 187000 * 0.75 + 100 * 15000 * 0.75);
  v = (await call(`/purchase-orders/${r.data.created[1].id}`, mgr)).data;
  assert.equal(v.state, 'partially_received'); assert.equal(v.progress.missing, 200);
  assert.deepEqual([v.receipts.length, v.receipts[0].sapoStatus, v.receipts[0].lines[0].goodQty], [1, 'not_needed', 100]);
  assert.ok((await call('/purchase-orders', kho)).data.orders.some((o: any) => o.id === r.data.created[0].id), 'kho thấy ngay để nhận hàng');
  // Tồn "Hàng chờ về" = số còn thiếu của đơn mua đã duyệt (mã có trong danh mục); nhận hàng thì giảm.
  const incoming = async () => Object.fromEntries((await db.select({ sku: productStock.sku, qty: productStock.quantity }).from(productStock).innerJoin(warehouses, eq(warehouses.id, productStock.warehouseId)).where(eq(warehouses.kind, 'incoming'))).map(r => [r.sku, r.qty]));
  assert.deepEqual(await incoming(), { LY1: 500, DIA1: 200 });
  const v1 = (await call(`/purchase-orders/${r.data.created[0].id}`, kho)).data;
  assert.equal((await call(`/purchase-orders/${v1.id}/receipts`, kho, 'POST', { clientKey: 'imp-rcv-001', warehouse: 'Kho nhận kiểm thử', lines: [{ lineId: v1.lines[0].id, goodQty: 120 }] })).status, 201);
  assert.deepEqual(await incoming(), { LY1: 380, DIA1: 200 });
  const found = (await call('/purchase-orders?q=' + encodeURIComponent('ddlt0002/1026'), mgr)).data.orders;
  assert.deepEqual(found.map((o: any) => [o.id, o.internalNo]), [[r.data.created[1].id, 'DDLT0002/1026']], 'tìm theo số đơn NCC');
  assert.equal((await call('/purchase-orders?q=' + encodeURIComponent('ddlt0002/1026'), mgr)).data.counts.all, 1, 'số đếm dùng cùng tìm kiếm theo số đơn NCC');
  const again = await call('/purchase-orders/import', mgr, 'POST', body);
  assert.deepEqual([again.data.created.length, again.data.skipped.map((x: any) => x.internalNo)], [0, ['DDLT0001/1026', 'DDLT0002/1026']], 'nhập lại file không tạo trùng');
});


test('Sale Admin/Kế toán: đủ sáu thao tác đơn mua trên API, giữ chặn Sale/Kho/NCC và audit người bấm', async()=>{
  const sent:any[]=[];
  const s=await setup({mailer:{apiKey:'re_test_key_123456',from:'CRM <crm@example.test>',fetch:async(_url:string,init:RequestInit)=>{sent.push(JSON.parse(String(init.body)));return new Response(JSON.stringify({id:'mail-test'}),{status:200});}}});
  for(const cookie of [s.sa,s.kt]) {
    const made=await s.call('/purchase-orders',s.emp,'POST',{orders:[{supplierId:s.a,warehouse:'Kho nhận',lines:[{sku:'LY1',quantity:10}]}]});
    assert.equal(made.status,201,JSON.stringify(made.data));const id=made.data.ids[0];
    const draft=(await s.call('/purchase-orders/'+id,s.mgr)).data;
    assert.equal((await s.call(`/purchase-orders/${id}/approve`,cookie,'POST',{})).status,403);
    const ap=await s.call(`/purchase-orders/${id}/approve`,s.mgr,'POST',{internalNo:'ML-FIXTURE',lines:draft.lines.map((l:any)=>({lineId:l.id,price:100}))});
    assert.equal(ap.status,200,JSON.stringify(ap.data));
    const view=(await s.call('/purchase-orders/'+id,cookie)).data;
    for(const action of ['confirm','receive','pay','schedule','pdf']) assert.ok(view.actions.includes(action),action);
    assert.ok(view.totals);assert.equal(view.priceHidden,false);
    assert.equal((await s.call(`/purchase-orders/${id}/confirm`,s.emp,'POST',{})).status,403);
    assert.equal((await s.call(`/purchase-orders/${id}/confirm`,s.kho,'POST',{})).status,403);
    assert.equal((await s.call(`/purchase-orders/${id}/confirm`,s.ncc,'POST',{})).status,403);
    const confirmed=await s.call(`/purchase-orders/${id}/confirm`,cookie,'POST',{internalNo:'NCC-TEST'});
    assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.confirmedOnBehalf,true);
    assert.ok(confirmed.data.events.some((e:any)=>e.action==='confirm' && e.by===(cookie===s.sa?'Tên sa':'Tên kt')),'audit shows actual employee');
    const received=await s.call(`/purchase-orders/${id}/receipts`,cookie,'POST',{clientKey:crypto.randomUUID(),warehouse:'Kho nhận kiểm thử',lines:[{lineId:view.lines[0].id,goodQty:1}]});
    assert.equal(received.status,201,JSON.stringify(received.data));
    const sched=await s.call(`/purchase-orders/${id}/schedules`,cookie,'PUT',{payment:{installments:[{amount:200,dueDate:'2030-01-01'}]}});
    assert.equal(sched.status,200,JSON.stringify(sched.data));
    const paid=await s.call(`/purchase-orders/${id}/payments`,cookie,'POST',{clientKey:crypto.randomUUID(),amount:100,paidDate:'2026-10-01',method:'transfer'});
    assert.equal(paid.status,201,JSON.stringify(paid.data));
    const mailed=await s.call(`/purchase-orders/${id}/send-email`,cookie,'POST',{pdf:Buffer.from('%PDF-1.4 test').toString('base64')});
    assert.equal(mailed.status,200,JSON.stringify(mailed.data));
    assert.equal((await s.call(`/purchase-orders/${id}/cancel`,cookie,'POST',{reason:'không có quyền'})).status,409);
  }
  assert.equal(sent.length,2,'mail test double only; no real supplier email');
});

test('purchase source pages include all quotes without duplicates, retain search and reject invalid offsets', async () => {
  const { db, call, emp, ncc, mgr, a } = await setup();
  await db.insert(quotations).values(Array.from({ length: 19 }, (_, i) => ({ id: `page-q-${i.toString().padStart(2, '0')}`, creatorId: 'emp', quoteNo: `PAGE-${i}`, quoteType: 'B2B' as const, customer: 'Page customer', quoteDate: '2026-09-10', data: '{"rows":[]}', createdAt: now, updatedAt: now })));
  const ids: string[] = [];
  let offset: number | null = 0;
  while (offset != null) {
    const response = await call(`/purchase-sources?q=PAGE-&offset=${offset}`, emp);
    assert.equal(response.status, 200); ids.push(...response.data.sources.map((s: any) => s.id)); offset = response.data.nextOffset;
  }
  assert.equal(ids.length, 19); assert.equal(new Set(ids).size, 19);
  assert.equal((await call('/purchase-sources?offset=-1', emp)).status, 400);
  assert.equal((await call('/purchase-sources?offset=1.5', emp)).status, 400);
  assert.equal((await call('/purchase-sources?offset=0', ncc)).status, 403);
  const created = await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, warehouse: 'Kho bổ sung', lines: [{ sku: '031106000', name: 'Chén', unit: 'Cái', quantity: 7, sources: [] }] }] });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const detail = (await call('/purchase-orders/' + created.data.ids[0], mgr)).data;
  assert.equal(detail.state, 'draft'); assert.equal(detail.lines[0].sku, '031106000'); assert.equal(detail.lines[0].quantity, 7);
});

test('tên hàng trên đơn mua NCC luôn là tên đầy đủ trong danh mục (dòng báo giá gõ gọn "Bộ trà 0.5" không làm thiếu tên)', async () => {
  const s = await setup(), { call, emp, a } = s, db = (s as any).db;
  const full = 'Bộ trà 0.5 L Came VCV (01503801403)';
  await db.insert(products).values({ sku: '01503801403', name: full, unit: 'bộ', updatedAt: now });
  await db.insert(quotations).values({ id: 'q2', creatorId: 'emp', quoteNo: 'B2B_2', quoteType: 'B2B', customer: 'Khách trà', quoteDate: '2026-09-10', data: '{"rows":[]}', createdAt: now, updatedAt: now });
  await db.insert(quoteLines).values([{ id: 'ql3', quoteId: 'q2', lineNo: 1, sku: '01503801403', name: 'Bộ trà 0.5', unit: 'bộ', qty: 3 }, { id: 'ql4', quoteId: 'q2', lineNo: 2, sku: 'NGOAI-DM', name: 'Hàng ngoài danh mục', unit: 'cái', qty: 1 }]);
  const src = (await call('/purchase-sources/quote/q2', emp)).data;
  assert.deepEqual(src.lines.map((l: any) => l.name), [full, 'Hàng ngoài danh mục'], 'form lập đơn hiện tên danh mục; mã ngoài danh mục giữ tên dòng');
  // Giao diện gửi tên gọn của dòng báo giá → máy chủ vẫn lưu tên danh mục.
  const made = await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, warehouse: '12 Đường Giao Hàng', lines: [
    { sku: '01503801403', name: 'Bộ trà 0.5', quantity: 3, sources: [{ type: 'quote', id: 'q2', quantity: 3 }] },
    { sku: 'NGOAI-DM', name: 'Hàng ngoài danh mục', quantity: 1, sources: [{ type: 'quote', id: 'q2', quantity: 1 }] }] }] });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.ids[0];
  assert.deepEqual((await call(`/purchase-orders/${id}`, emp)).data.lines.map((l: any) => l.name), [full, 'Hàng ngoài danh mục']);
  // Đơn cũ đã lưu tên gọn: xem / in / gửi NCC vẫn ra tên đầy đủ.
  await db.update(incomingShipmentLines).set({ name: 'Bộ trà 0.5' }).where(eq(incomingShipmentLines.sku, '01503801403'));
  assert.equal((await call(`/purchase-orders/${id}`, emp)).data.lines[0].name, full);
});


test('Sale Admin thiếu purchases.prices: đủ nút trên đơn đã duyệt, không mở giá/duyệt nháp; huỷ đơn giữ điều kiện nhận/trả', async () => {
  const sent:any[]=[];
  const s=await setup({mailer:{apiKey:'re_test_key_123456',from:'CRM <crm@example.test>',fetch:async(_url:string,init:RequestInit)=>{sent.push(JSON.parse(String(init.body)));return Response.json({id:'mail-test'});}}});
  await s.db.execute(sql`delete from staff_position_permissions where position_id='sale-admin' and permission='purchases.prices'`);
  const make=async()=>{
    const made=await s.call('/purchase-orders',s.emp,'POST',{orders:[{supplierId:s.a,warehouse:'Kho nhận',lines:[{sku:'LY1',quantity:2}]}]});
    assert.equal(made.status,201,JSON.stringify(made.data));return made.data.ids[0];
  };
  const approve=async(id:string)=>{const d=(await s.call('/purchase-orders/'+id,s.mgr)).data;const r=await s.call(`/purchase-orders/${id}/approve`,s.mgr,'POST',{internalNo:'ML-FIXTURE',lines:d.lines.map((l:any)=>({lineId:l.id,price:100}))});assert.equal(r.status,200,JSON.stringify(r.data));};
  const id=await make();
  const draft=(await s.call('/purchase-orders/'+id,s.sa)).data;
  assert.equal(draft.priceHidden,true);assert.equal(draft.totals,null);assert.equal(draft.actions.includes('approve'),false);assert.equal(draft.actions.includes('pdf'),false);
  assert.equal((await s.call(`/purchase-orders/${id}/approve`,s.sa,'POST',{})).status,403);
  assert.equal((await s.call(`/purchase-orders/${id}/cancel`,s.sa,'POST',{reason:'Không được huỷ nháp của người khác'})).status,403);
  await approve(id);
  const view=(await s.call('/purchase-orders/'+id,s.sa)).data;
  assert.equal(view.priceHidden,false);assert.ok(view.totals);assert.ok(view.debt);
  for(const a of ['confirm','receive','pay','schedule','pdf','cancel'])assert.ok(view.actions.includes(a),a);
  const mail=await s.call(`/purchase-orders/${id}/send-email`,s.sa,'POST',{pdf:Buffer.from('%PDF-1.4 test').toString('base64')});assert.equal(mail.status,200,JSON.stringify(mail.data));assert.equal(sent.length,1);
  const paid=await s.call(`/purchase-orders/${id}/payments`,s.sa,'POST',{clientKey:crypto.randomUUID(),amount:50,paidDate:'2026-10-01',method:'transfer',attachment:{name:'test.pdf',mime:'application/pdf',data:Buffer.from('%PDF-1.4 test').toString('base64')}});
  assert.equal(paid.status,201,JSON.stringify(paid.data));
  const payment=paid.data.payments[0];const attachment=await s.call(`/supplier-payments/${payment.id}/attachment`,s.sa);assert.equal(attachment.status,200,JSON.stringify(attachment.data));
  assert.equal((await s.call(`/supplier-payments/${payment.id}/void`,s.sa,'POST',{reason:'Không có quyền huỷ khoản trả'})).status,403);
  assert.equal((await s.call(`/purchase-orders/${id}/cancel`,s.sa,'POST',{reason:'Không được huỷ đơn đã trả'})).status,409);
  const cancelId=await make();await approve(cancelId);
  const cancelled=await s.call(`/purchase-orders/${cancelId}/cancel`,s.sa,'POST',{reason:'Đổi kế hoạch mua hàng'});assert.equal(cancelled.status,200,JSON.stringify(cancelled.data));assert.equal(cancelled.data.state,'cancelled');assert.ok(cancelled.data.events.some((e:any)=>e.action==='cancel'&&e.by==='Tên sa'));
  const receivedId=await make();await approve(receivedId);const ready=(await s.call('/purchase-orders/'+receivedId,s.sa)).data;
  const received=await s.call(`/purchase-orders/${receivedId}/receipts`,s.sa,'POST',{clientKey:crypto.randomUUID(),warehouse:'Kho nhận kiểm thử',lines:[{lineId:ready.lines[0].id,goodQty:1}]});assert.equal(received.status,201,JSON.stringify(received.data));
  assert.equal((await s.call(`/purchase-orders/${receivedId}/cancel`,s.sa,'POST',{reason:'Không được huỷ đơn đã nhận'})).status,409);
});

test('quote converted to order/HĐKT shares one purchasing budget in both directions and across a batch',async()=>{
 const {db,call,emp,a,b}=await setup();
 await db.update(salesOrders).set({quoteId:'q1'}).where(eq(salesOrders.id,'o1'));
 await db.update(salesOrderLines).set({qty:10}).where(eq(salesOrderLines.id,'ol1'));
 const order=(supplierId:string,type:string,quantity:number)=>({supplierId,warehouse:'Kho nhận kiểm thử',lines:[{sku:'LY1',quantity,sources:[{type,id:type==='quote'?'q1':'o1',quantity}]}]});
 const create=(orders:object[])=>call('/purchase-orders',emp,'POST',{orders});
 const first=await create([order(a,'quote',10)]);assert.equal(first.status,201,JSON.stringify(first.data));
 let source=(await call('/purchase-sources/order/o1',emp)).data;assert.equal(source.lines.find((l:any)=>l.sku==='LY1').ordered,10);assert.equal(source.lines.find((l:any)=>l.sku==='LY1').remaining,0);
 assert.equal((await create([order(b,'order',1)])).status,409,'cannot buy again from the converted order');
 await call('/purchase-orders/'+first.data.ids[0]+'/cancel',emp,'POST',{reason:'Huỷ kiểm thử'});
 const second=await create([order(a,'order',10)]);assert.equal(second.status,201);
 source=(await call('/purchase-sources/quote/q1',emp)).data;assert.equal(source.lines.find((l:any)=>l.sku==='LY1').ordered,10);
 assert.equal((await create([order(b,'quote',1)])).status,409,'reverse direction shares the same budget');
 await call('/purchase-orders/'+second.data.ids[0]+'/cancel',emp,'POST',{reason:'Huỷ kiểm thử'});
 const tooMany=await create([order(a,'quote',6),order(b,'order',5)]);assert.equal(tooMany.status,409,'cannot split a duplicate across sources within one request');
 source=(await call('/purchase-sources/quote/q1',emp)).data;assert.equal(source.lines.find((l:any)=>l.sku==='LY1').ordered,0,'failed batch writes nothing');
 const split=await create([order(a,'quote',6),order(b,'order',4)]);assert.equal(split.status,201);
 source=(await call('/purchase-sources/order/o1',emp)).data;assert.equal(source.lines.find((l:any)=>l.sku==='LY1').ordered,10);
 assert.equal((await create([order(a,'order',1)])).status,409);
});

test('warehouse cannot receive more against legacy duplicate quote/order purchases; valid partial receiving stays available',async()=>{
 const {db,call,kho,a}=await setup();await db.update(salesOrders).set({quoteId:'q1'}).where(eq(salesOrders.id,'o1'));
 for(const [id,type,sourceId]of [['legacy-q','quote','q1'],['legacy-o','order','o1']]as const){
  await db.insert(incomingShipments).values({id,ticketNumber:id,source:'supplier-order',supplierId:a,supplierName:'NCC fixture',supplierStatus:'confirmed',approvalStatus:'approved',warehouse:'Kho nhận kiểm thử',createdBy:'mgr',createdAt:now,updatedAt:now});
  await db.insert(incomingShipmentLines).values({id:id+'-line',shipmentId:id,lineNo:1,sku:'LY1',name:'Ly sứ',unit:'cái',quantity:10});
  await db.insert(supplierOrderSources).values({id:id+'-source',shipmentId:id,lineId:id+'-line',sourceType:type,sourceId,sku:'LY1',quantity:10,createdAt:now});
 }
 const receive=()=>call('/purchase-orders/legacy-q/receipts',kho,'POST',{clientKey:'legacy-duplicate-receipt',warehouse:'Kho nhận kiểm thử',createSapo:false,lines:[{lineId:'legacy-q-line',goodQty:1}]});
 const blocked=await receive();assert.equal(blocked.status,409,JSON.stringify(blocked.data));assert.equal(blocked.data.code,'PURCHASE_SOURCE_DUPLICATE');
 await db.update(incomingShipments).set({cancelledAt:now}).where(eq(incomingShipments.id,'legacy-o'));
 const allowed=await receive();assert.equal(allowed.status,201,JSON.stringify(allowed.data));
 const replay=await receive();assert.equal(replay.status,200);assert.equal(replay.data.duplicate,true);
});
