import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { quotations, quoteLines } from '../../src/modules/quotes/schema.ts';
import { salesOrders, salesOrderLines, salesContracts } from '../../src/modules/sales/schema.ts';
import { vietnamDate } from '../../src/modules/sales/domain/sales.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';

/** ĐƠN MUA NCC (đợt 2): lập từ chứng từ nguồn, chống mua trùng, chia NCC, duyệt, xác nhận thay NCC, nhận hàng từng đợt, Sapo, thanh toán, huỷ. */
const origin = 'https://trial.test', now = '2026-10-01T00:00:00.000Z';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  for (const [id, pos] of [['kho', 'warehouse'], ['kt', 'accounting']] as const) {
    await d1.sqlite.prepare(`INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES (?,?,?,'','employee',?,1,'2026-01-01T00:00:00.000Z')`).run(id, id + '@x.vn', 'Tên ' + id, pos);
    await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run(id, await hashPassword(PASSWORD, 1000));
  }
  const files = new Map<string, Uint8Array>();
  const env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const,
    files: { put: async (k: string, b: Uint8Array) => { files.set(k, b); }, signedUrls: async (keys: string[]) => new Map(keys.map(k => [k, 'https://files.test/' + k])) } };
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env as never);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const s = { db, call, files, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), kho: await login('kho@x.vn'), kt: await login('kt@x.vn'), ncc: await login('ncc@x.vn') };
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
    { supplierId: a, lines: [{ sku: 'LY1', quantity: 10, price: 999, sources: [{ type: 'quote', id: 'q1', quantity: 6 }, { type: 'order', id: 'o1', quantity: 4 }] }] },
    { supplierId: b, lines: [{ sku: 'LY1', quantity: 4, sources: [{ type: 'quote', id: 'q1', quantity: 4 }] }, { sku: 'DIA1', quantity: 5, sources: [{ type: 'quote', id: 'q1', quantity: 5 }] }] },
  ] });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const [idA, idB] = created.data.ids;
  const pa = (await call(`/purchase-orders/${idA}`, emp)).data;
  assert.equal(pa.state, 'draft'); assert.equal(pa.priceHidden, true); assert.equal(pa.lines[0].price, null, 'nhân viên không nhập / thấy giá mua');
  assert.deepEqual([pa.lines[0].name, pa.lines[0].unit], ['Ly sứ', 'cái'], 'tên / ĐVT lấy từ chứng từ nguồn khi để trống');
  assert.deepEqual(pa.lines[0].sources.map((x: any) => [x.no, x.quantity]).sort(), [['B2B_1', 6], ['HD-01', 4]]);
  assert.deepEqual((await call('/purchase-sources/quote/q1', emp)).data.lines.map((l: any) => [l.sku, l.ordered, l.remaining]), [['LY1', 10, 0], ['DIA1', 5, 0]]);

  // Mua trùng bị chặn.
  const dup = await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, lines: [{ sku: 'LY1', quantity: 1, sources: [{ type: 'quote', id: 'q1', quantity: 1 }] }] }] });
  assert.equal(dup.status, 409); assert.match(dup.data.error ?? dup.data.message, /vượt 1/);
  assert.equal((await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, lines: [{ sku: 'X', quantity: 1 }] }, { supplierId: a, lines: [{ sku: 'Y', quantity: 1 }] }] })).status, 400, 'một NCC một đơn');
  assert.equal((await call('/purchase-orders', kho, 'POST', { orders: [{ supplierId: a, lines: [{ sku: 'LY1', quantity: 1, sources: [{ type: 'quote', id: 'q1', quantity: 1 }] }] }] })).status, 404, 'không thấy báo giá của người khác');

  // Sửa nháp: người tạo được, khoá theo revision; giảm số → trả lại phần còn cần đặt.
  const ed = await call(`/purchase-orders/${idB}`, emp, 'PUT', { supplierId: b, revision: 1, lines: [{ sku: 'DIA1', quantity: 3, sources: [{ type: 'quote', id: 'q1', quantity: 3 }] }] });
  assert.equal(ed.status, 200, JSON.stringify(ed.data)); assert.equal(ed.data.revision, 2);
  assert.match(ed.data.events[0].summary, /DIA1: 5 → 3/);
  assert.equal((await call(`/purchase-orders/${idB}`, emp, 'PUT', { supplierId: b, revision: 1, lines: [{ sku: 'DIA1', quantity: 2 }] })).status, 409, 'bản cũ');
  assert.deepEqual((await call('/purchase-sources/quote/q1', emp)).data.lines.map((l: any) => l.remaining), [4, 2]);
  const other = await call('/login', '', 'POST', { email: 'kt@x.vn', password: PASSWORD });
  assert.equal((await call(`/purchase-orders/${idB}`, other.cookie, 'PUT', { supplierId: b, lines: [{ sku: 'DIA1', quantity: 1 }] })).status, 403, 'người khác không sửa nháp');
  assert.equal((await call(`/purchase-orders/${idB}`, kho)).status, 404, 'kho chỉ thấy đơn đã duyệt');

  // Huỷ đơn nháp: cần lý do; huỷ xong phần đã đặt được trả lại.
  assert.equal((await call(`/purchase-orders/${idB}/cancel`, emp, 'POST', { reason: '' })).status, 400);
  const cx = await call(`/purchase-orders/${idB}/cancel`, emp, 'POST', { reason: 'Khách đổi mẫu' });
  assert.equal(cx.data.state, 'cancelled'); assert.equal(cx.data.cancelReason, 'Khách đổi mẫu');
  assert.deepEqual((await call('/purchase-sources/quote/q1', emp)).data.lines.map((l: any) => l.remaining), [4, 5]);
  assert.equal((await call(`/purchase-orders/${idB}/cancel`, mgr, 'POST', { reason: 'lần hai' })).status, 409);
});

test('duyệt → xác nhận thay NCC → nhận từng đợt → Sapo → thanh toán nhiều lần', async () => {
  const { call, emp, mgr, kho, kt, a, files } = await setup();
  const id = (await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, lines: [{ sku: 'LY1', quantity: 10, sources: [{ type: 'quote', id: 'q1', quantity: 10 }] }, { sku: 'DIA1', quantity: 5 }] }] })).data.ids[0];
  let v = (await call(`/purchase-orders/${id}`, mgr)).data;
  assert.equal((await call(`/purchase-orders/${id}/approve`, emp, 'POST', {})).status, 403, 'chỉ Manager duyệt');
  assert.equal((await call(`/purchase-orders/${id}/receipts`, mgr, 'POST', { clientKey: 'k-00000001', lines: [{ lineId: v.lines[0].id, goodQty: 1 }] })).status, 409, 'chưa duyệt chưa nhận');
  assert.equal((await call(`/purchase-orders/${id}/approve`, mgr, 'POST', { lines: [{ lineId: v.lines[0].id, price: 100 }] })).status, 400, 'thiếu giá đĩa');
  const ap = await call(`/purchase-orders/${id}/approve`, mgr, 'POST', { lines: [{ lineId: v.lines[0].id, price: 100, purchaseDiscount: 10 }, { lineId: v.lines[1].id, price: 200 }],
    payment: { deposit: { mode: 'percent', value: 30, dueDate: '2026-01-05' }, balanceDueDate: '2099-01-01' } });
  assert.equal(ap.status, 200, JSON.stringify(ap.data)); v = ap.data;
  assert.equal(v.state, 'awaiting_confirmation'); assert.equal(v.totals.total, 1900);
  assert.deepEqual(v.schedules.map((s: any) => [s.kind, s.amount]), [['deposit', 570], ['balance', 1330]]);
  assert.equal(v.supplierEmail, 'minhlong@ncc.vn', 'người nhận mặc định từ danh bạ');
  assert.equal(v.debt.status, 'overdue', 'cọc quá hạn');
  const ve = (await call(`/purchase-orders/${id}`, emp)).data;
  assert.equal(ve.totals, null); assert.equal(ve.debt, null); assert.deepEqual(ve.actions, []);
  assert.equal((await call(`/purchase-orders/${id}`, kho)).data.lines[0].price, null, 'kho không thấy giá');
  assert.equal((await call(`/purchase-orders/${id}`, emp, 'PUT', { supplierId: a, lines: [{ sku: 'LY1', quantity: 1 }] })).status, 409, 'đã duyệt không sửa nháp');

  // Manager ghi nhận NCC xác nhận + ngày hẹn.
  assert.equal((await call(`/purchase-orders/${id}/confirm`, kt, 'POST', {})).status, 403);
  v = (await call(`/purchase-orders/${id}/confirm`, mgr, 'POST', { arrivalDate: '2026-10-20', internalNo: 'ML-77', lines: [{ lineId: v.lines[0].id, promisedDate: '2026-10-20' }] })).data;
  assert.equal(v.state, 'confirmed'); assert.equal(v.confirmedOnBehalf, true); assert.equal(v.internalNo, 'ML-77');
  assert.match(v.events[0].summary, /thay|ghi nhận NCC/);

  // Nhận đợt 1 (kho): ly đạt 6 hỏng 1; bấm lặp cùng clientKey không tạo phiếu thứ hai.
  const lines1 = [{ lineId: v.lines[0].id, goodQty: 6, damagedQty: 1 }];
  const r1 = await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'rcv-000001', lines: lines1 });
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  const again = await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'rcv-000001', lines: lines1 });
  assert.equal(again.data.duplicate, true); assert.equal(again.data.receipts.length, 1);
  v = again.data; assert.equal(v.state, 'partially_received');
  assert.deepEqual(v.lines.map((l: any) => [l.good, l.damaged, l.missing]), [[6, 1, 4], [0, 0, 5]]);
  assert.equal(v.receipts[0].sapoStatus, 'pending', 'đã nhận ≠ đã nhập Sapo');
  assert.equal((await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'rcv-000002', lines: [{ lineId: v.lines[0].id, goodQty: 5 }] })).status, 400, 'vượt số thiếu');
  assert.equal((await call(`/purchase-orders/${id}/receipts`, emp, 'POST', { clientKey: 'rcv-000003', lines: [{ lineId: v.lines[0].id, goodQty: 1 }] })).status, 403, 'sale không nhận kho');

  // Sapo: lỗi giữ phiếu; nhập xong cần mã; không nhập lần hai; chỉ Manager mở lại.
  const rid = v.receipts[0].id;
  assert.equal((await call(`/supplier-receipts/${rid}/sapo`, kho, 'PUT', { status: 'failed' })).status, 400, 'lỗi phải ghi chú');
  assert.equal((await call(`/supplier-receipts/${rid}/sapo`, kho, 'PUT', { status: 'failed', note: 'Sapo 500' })).data.receipts[0].sapoStatus, 'failed');
  assert.equal((await call(`/supplier-receipts/${rid}/sapo`, kho, 'PUT', { status: 'done' })).status, 400, 'thiếu mã phiếu');
  assert.equal((await call(`/supplier-receipts/${rid}/sapo`, kho, 'PUT', { status: 'done', code: 'PN001' })).data.receipts[0].sapoReceiptCode, 'PN001');
  assert.equal((await call(`/supplier-receipts/${rid}/sapo`, kho, 'PUT', { status: 'done', code: 'PN001' })).status, 200, 'gửi lại cùng mã: không đổi');
  assert.equal((await call(`/supplier-receipts/${rid}/sapo`, kho, 'PUT', { status: 'done', code: 'PN002' })).status, 409, 'không nhập Sapo hai lần');
  assert.equal((await call(`/supplier-receipts/${rid}/sapo`, kho, 'PUT', { status: 'pending' })).status, 403, 'kho không mở lại');
  assert.equal((await call(`/supplier-receipts/${rid}/cancel`, mgr, 'POST', { reason: 'Nhầm' })).status, 409, 'đã nhập Sapo không huỷ phiếu');
  assert.equal((await call(`/purchase-orders/${id}/cancel`, mgr, 'POST', { reason: 'Đổi NCC' })).status, 409, 'đã nhận hàng không huỷ đơn');

  // Nhận đợt 2 đủ → đã nhận.
  v = (await call(`/purchase-orders/${id}/receipts`, mgr, 'POST', { clientKey: 'rcv-000004', lines: [{ lineId: v.lines[0].id, goodQty: 4 }, { lineId: v.lines[1].id, goodQty: 5 }] })).data;
  assert.equal(v.state, 'received'); assert.equal(v.receipts.length, 2);
  assert.match(v.receipts.map((r: any) => r.receiptNo).join(','), /PNH_\d{8}_/);
  // Huỷ phiếu chưa nhập Sapo (chỉ Manager) → quay lại nhận một phần.
  const r2 = v.receipts.find((r: any) => r.sapoStatus === 'pending').id;
  assert.equal((await call(`/supplier-receipts/${r2}/cancel`, kho, 'POST', { reason: 'Nhầm' })).status, 403);
  v = (await call(`/supplier-receipts/${r2}/cancel`, mgr, 'POST', { reason: 'Đếm nhầm' })).data;
  assert.equal(v.state, 'partially_received');

  // Thanh toán: Manager + kế toán; clientKey; không vượt công nợ; chứng từ; Manager huỷ khoản trả.
  assert.equal((await call(`/purchase-orders/${id}/payments`, kho, 'POST', { clientKey: 'pay-000001', amount: 100 })).status, 403);
  const pay = { clientKey: 'pay-000001', amount: 570, paidDate: vietnamDate().iso, reference: 'UNC 12', attachment: { name: 'unc.png', mime: 'image/png', data: Buffer.from('png').toString('base64') } };
  const p1 = await call(`/purchase-orders/${id}/payments`, kt, 'POST', pay);
  assert.equal(p1.status, 201, JSON.stringify(p1.data));
  assert.equal((await call(`/purchase-orders/${id}/payments`, kt, 'POST', pay)).data.payments.length, 1, 'bấm lặp không trả hai lần');
  assert.equal(files.size, 1);
  assert.equal((await call(`/purchase-orders/${id}/payments`, kt, 'POST', { clientKey: 'pay-000002', amount: 2000 })).status, 409, 'vượt công nợ');
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
  assert.deepEqual(await list('sapo'), [], 'phiếu còn lại đã nhập Sapo');
  assert.deepEqual(await list('draft'), []);
  assert.ok(v.events.length >= 8, 'có lịch sử thao tác');
});

test('việc tự sinh + sơ đồ: chờ duyệt → chờ xác nhận → nhận hàng (kho) → nhập Sapo (kho) → trả NCC (kế toán)', async () => {
  const { RULES } = await import('../../src/modules/tasks/api/auto-tasks.ts');
  const s = await setup(), { call, emp, mgr, kho, a } = s;
  const today = vietnamDate().iso;
  const id = (await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, arrivalDate: today, lines: [{ sku: 'LY1', quantity: 2 }] }] })).data.ids[0];
  const db = (s as any).db;
  const keys = async () => (await RULES.supplierPurchases!(db, today)).map(t => [t.autoKey.split(':')[0], t.assigneeId ?? t.assigneePosition ?? 'manager']);
  assert.deepEqual(await keys(), [['po-approve', 'manager']]);
  let v = (await call(`/purchase-orders/${id}`, mgr)).data;
  await call(`/purchase-orders/${id}/approve`, mgr, 'POST', { lines: [{ lineId: v.lines[0].id, price: 100 }], payment: { balanceDueDate: today } });
  assert.deepEqual(await keys(), [['po-confirm', 'manager'], ['po-pay', 'accounting']]);
  await call(`/purchase-orders/${id}/confirm`, mgr, 'POST', {});
  assert.deepEqual((await keys()).map(k => k[0]).sort(), ['po-pay', 'po-receive']);
  v = (await call(`/purchase-orders/${id}/receipts`, kho, 'POST', { clientKey: 'rcv-flow-1', lines: [{ lineId: v.lines[0].id, goodQty: 2 }] })).data;
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
  const id = (await call('/purchase-orders', emp, 'POST', { orders: [{ supplierId: a, lines: [{ sku: 'LY1', quantity: 2 }] }] })).data.ids[0];
  const stock = await call(`/purchase-orders/${id}/mail`, emp, 'POST', { kind: 'stock' });
  assert.equal(stock.status, 200, JSON.stringify(stock.data)); assert.equal(stock.data.to, 'minhlong@ncc.vn');
  assert.equal((await call(`/purchase-orders/${id}/mail`, emp, 'POST', { kind: 'order' })).status, 403, 'nhân viên không gửi đơn (có giá)');
  assert.equal((await call(`/purchase-orders/${id}/mail`, mgr, 'POST', { kind: 'order' })).status, 409, 'chưa duyệt chưa gửi đơn');
  const v = (await call(`/purchase-orders/${id}`, mgr)).data;
  await call(`/purchase-orders/${id}/approve`, mgr, 'POST', { lines: [{ lineId: v.lines[0].id, price: 100 }], supplierEmail: 'chot@ncc.vn' });
  const order = await call(`/purchase-orders/${id}/mail`, mgr, 'POST', { kind: 'order' });
  assert.equal(order.data.to, 'chot@ncc.vn', 'dùng người nhận Manager chốt khi duyệt');
  assert.equal((await call(`/purchase-orders/${id}/mail`, kho, 'POST', { kind: 'order' })).status, 403);
  const events = (await call(`/purchase-orders/${id}`, mgr)).data.events.map((e: any) => e.summary);
  assert.ok(events.some((x: string) => x.startsWith('Gửi email hỏi tồn tới minhlong@ncc.vn')) && events.some((x: string) => x.startsWith('Gửi email đơn đặt hàng tới chot@ncc.vn')));
});
