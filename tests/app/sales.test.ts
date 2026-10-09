import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { syncSapoDocs } from '../../src/modules/integrations/api/sapo-pull.ts';
import { contractNumber, legalCode, nextDocNo, orderLinesFromQuote, receivable, contractSchedules } from '../../src/modules/sales/domain/sales.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  // Kế toán (chức vụ "accounting" = nhóm Kế toán).
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('kt','kt@x.vn','Kế toán','0900','employee','accounting',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run('kt', await hashPassword(PASSWORD, 1000));
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), ncc: await login('ncc@x.vn'), kt: await login('kt@x.vn') };
}

test('quy tắc: số chứng từ, pháp nhân, số HĐKT kiểu web cũ, dòng đơn từ báo giá, công nợ', () => {
  assert.equal(nextDocNo('DH', '2026-10-06', []), 'DH_20261006_001');
  assert.equal(nextDocNo('DH', '2026-10-06', ['DH_20261006_001', 'DH_20261006_007', 'DH_20261005_009']), 'DH_20261006_008');
  assert.equal(legalCode('Công ty Bách Ngân'), 'BN'); assert.equal(legalCode('vg'), 'VG'); assert.equal(legalCode('khác'), null);
  assert.equal(contractNumber('BN', 'kh-01', 3, new Date('2026-10-06T03:00:00Z')), '10-03/06102026/HĐKT/BN-KH01');
  // B2B: giá sau CK + phí in; HRC bỏ phí in; dòng trống/số lượng 0 bị bỏ.
  const lines = orderLinesFromQuote({ type: 'B2B', vat: 8, rows: [
    { name: 'Ly', sku: 'L1', unit: 'cái', qty: 10, price: 100000, discount: 10, discountType: 'percent', printFee: 5000, taxRate: 10 },
    { name: '', qty: 3, price: 1 }, { name: 'Hộp', qty: 0, price: 9 },
  ] } as any);
  assert.deepEqual(lines, [{ lineNo: 1, sku: 'L1', name: 'Ly', unit: 'cái', qty: 10, unitPrice: 95000, taxRate: 10, amount: 950000 }]);
  // Phiếu thu trừ vào kỳ đến hạn sớm nhất; phần chưa thu của kỳ đã qua hạn là quá hạn.
  const r = receivable([{ amount: 300, dueDate: '2026-10-01' }, { amount: 700, dueDate: null }], [{ amount: 100 }], '2026-10-06');
  assert.deepEqual(r, { due: 1000, paid: 100, balance: 900, overdue: 200, nextDueDate: null, status: 'overdue', deposit: 0, depositPaid: 0, payState: 'overdue' });
  assert.deepEqual(contractSchedules(1000, 30, '2026-10-06').map(s => [s.kind, s.amount, s.dueDate]), [['deposit', 300, '2026-10-06'], ['balance', 700, null]]);
});

test('luồng bán hàng: báo giá → đơn đặt hàng → HĐKT → lịch giao → công nợ, đúng quyền', async () => {
  const { db, call, emp, mgr, ncc } = await setup();
  await db.insert(customers).values({ id: '1001', name: 'Công ty Hoàng Long', contact: 'Chị Lan', phone: '0901', email: '', address: '1 Lê Lợi', search: '', taxCode: '0101234567', customerCode: 'HL01', sourceVersion: 0, syncedAt: '' });
  const doc = { type: 'B2B', quoteNo: 'B2B_BG20261006_001', customer: 'Công ty Hoàng Long', customerId: '1001', contact: 'Chị Lan', phone: '0901', customerAddress: '1 Lê Lợi', vat: 8,
    rows: [{ name: 'Bình giữ nhiệt', sku: 'LHC', unit: 'cái', qty: 100, price: 200000, discount: 10, printFee: 0, taxRate: 8 }, { name: 'Hộp quà', sku: 'HQ', unit: 'hộp', qty: 50, price: 100000, taxRate: 8 }] };
  const quote = await call('/quotes', emp, 'POST', doc); assert.equal(quote.status, 201);

  // Đơn đặt hàng từ báo giá: phải được Manager duyệt trước.
  assert.equal((await call('/orders', ncc, 'POST', { quoteId: quote.data.id })).status, 403);
  assert.equal((await call('/orders', emp, 'POST', { quoteId: quote.data.id })).data.code, 'QUOTE_NOT_APPROVED');
  assert.equal((await call('/quotes/' + quote.data.id + '/approve', mgr, 'POST', { revision: 1 })).status, 200);
  // HĐKT lập THẲNG từ báo giá (luồng độc lập với Đơn hàng): cấp số kiểu web cũ, kỳ phải thu = cọc 30% + phần còn lại.
  assert.equal((await call('/contracts', emp, 'POST', { quoteId: quote.data.id, legalEntity: 'xyz' })).status, 400);
  const k = await call('/contracts', emp, 'POST', { quoteId: quote.data.id, legalEntity: 'BN', depositRate: 30, paymentDays: 15, signedDate: '2026-10-06' });
  assert.equal(k.status, 201, JSON.stringify(k.data)); assert.match(k.data.contractNo, /^\d{2}-01\/\d{8}\/HĐKT\/BN-HL01$/);
  const o = { data: { id: k.data.orderId as string } };
  assert.equal((await call('/contracts', emp, 'POST', { quoteId: quote.data.id, legalEntity: 'BN' })).data.code, 'ORDER_EXISTS');
  const dup = await call('/orders', emp, 'POST', { quoteId: quote.data.id });
  assert.equal(dup.data.code, 'ORDER_EXISTS'); assert.match(dup.data.error ?? dup.data.message ?? JSON.stringify(dup.data), /đã có HĐKT/, 'báo giá đã lập HĐKT thì không sinh đơn hàng');
  await call(`/orders/${o.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true }); // Manager duyệt HĐKT (tạo ra luôn là nháp)
  assert.equal((await call(`/contracts/${k.data.id}`, mgr, 'PUT', { status: 'signed', signedDate: '2026-10-06' })).status, 200);
  let d = (await call('/orders/' + o.data.id, emp)).data;
  // Bản in đơn đặt hàng: người phụ trách / người soạn kèm theo đơn.
  assert.ok(d.order.ownerName && d.order.createdByName !== undefined && d.order.createdByCustomer === false && typeof d.order.customerCode === 'string');
  assert.match(d.order.orderNo, /^DH_\d{8}_001$/);
  assert.equal(d.order.customerId, '1001'); assert.equal(d.order.quoteNo, 'B2B_BG20261006_001');
  assert.equal(d.order.subtotal, 23_000_000); assert.equal(d.order.tax, 1_840_000); assert.equal(d.order.total, 24_840_000);
  assert.equal(d.lines.length, 2); assert.equal(d.lines[0].unitPrice, 180000);
  // HĐKT có kỳ cọc 30% đến hạn ngày ký (06/10, đã qua) → quá hạn cọc.
  assert.deepEqual(d.receivable, { due: 24_840_000, paid: 0, balance: 24_840_000, overdue: 7_452_000, nextDueDate: null, status: 'overdue', deposit: 7_452_000, depositPaid: 0, payState: 'overdue' });
  // Người khác (không phụ trách) không thấy; Manager thấy.
  const other = (await call('/login', '', 'POST', { email: 'new@x.vn', password: PASSWORD })).cookie; // chưa kích hoạt → không đăng nhập được
  assert.equal(other, '');
  assert.equal((await call('/orders/' + o.data.id, mgr)).status, 200);

  d = (await call('/orders/' + o.data.id, emp)).data;
  assert.equal(d.contract.status, 'signed');
  assert.deepEqual(d.schedules.map((s: any) => [s.kind, s.amount, s.dueDate]).sort(), [['balance', 17_388_000, null], ['deposit', 7_452_000, '2026-10-06']]);
  assert.equal((await call('/contracts', emp)).data.contracts[0].orderNo, d.order.orderNo);

  // Lịch giao: giao một phần, không vượt phần còn lại.
  const [ly, hop] = d.lines;
  assert.equal((await call('/deliveries', emp, 'POST', { orderId: o.data.id, plannedDate: '2026-10-10', lines: [{ orderLineId: ly.id, qty: 101 }] })).status, 400);
  const g1 = await call('/deliveries', emp, 'POST', { orderId: o.data.id, plannedDate: '2026-10-10', timeSlot: 'Sáng', lines: [{ orderLineId: ly.id, qty: 60 }] });
  assert.equal(g1.status, 201, JSON.stringify(g1.data));
  assert.equal((await call('/deliveries', emp, 'POST', { orderId: o.data.id, plannedDate: '2026-10-11', lines: [{ orderLineId: ly.id, qty: 41 }] })).status, 400, 'chuyến đang chờ cũng tính');
  const cal = (await call('/deliveries?from=2026-10-01&to=2026-10-31', emp)).data.deliveries;
  assert.equal(cal.length, 1); assert.match(cal[0].deliveryNo, /^GH_20261010_001$/); assert.equal(cal[0].receiverName, 'Chị Lan'); assert.equal(cal[0].address, '1 Lê Lợi');
  assert.equal((await call('/deliveries/' + g1.data.id + '/status', emp, 'PUT', { status: 'delivered', deliveredOn: '2026-10-10' })).status, 200);
  assert.equal((await call('/deliveries/' + g1.data.id + '/status', emp, 'PUT', { status: 'cancelled' })).status, 409);
  d = (await call('/orders/' + o.data.id, emp)).data;
  assert.equal(d.order.status, 'delivering'); assert.equal(d.lines[0].deliveredQty, 60);
  // Không chỉ định dòng = giao hết phần còn lại; giao xong thì kỳ còn lại có hạn = ngày giao + 15 ngày.
  const g2 = await call('/deliveries', emp, 'POST', { orderId: o.data.id, plannedDate: '2026-10-12' }); assert.equal(g2.status, 201);
  assert.deepEqual((await call('/orders/' + o.data.id, emp)).data.deliveries[1].lines.map((l: any) => l.qty).sort(), [40, 50]);
  await call('/deliveries/' + g2.data.id + '/status', emp, 'PUT', { status: 'delivered', deliveredOn: '2026-10-12' });
  d = (await call('/orders/' + o.data.id, emp)).data;
  assert.equal(d.order.status, 'delivered');
  assert.equal(d.schedules.find((s: any) => s.kind === 'balance').dueDate, '2026-10-27');
  assert.equal(hop.qty, 50);

  // Công nợ: thu cọc, không thu vượt, đơn đã thu thì không huỷ được.
  assert.equal((await call('/payments', emp, 'POST', { orderId: o.data.id, amount: 0 })).status, 400);
  assert.equal((await call('/payments', emp, 'POST', { orderId: o.data.id, amount: 7_452_000, paidAt: '2026-10-06', method: 'transfer', reference: 'UNC 123' })).status, 201);
  assert.equal((await call('/payments', emp, 'POST', { orderId: o.data.id, amount: 99_000_000 })).status, 400);
  const debts = (await call('/receivables', emp)).data;
  assert.equal(debts.receivables.length, 1);
  assert.equal(debts.receivables[0].paid, 7_452_000); assert.equal(debts.receivables[0].balance, 17_388_000);
  assert.equal(debts.totals.balance, 17_388_000);
  // Danh sách đơn / HĐKT hiện trạng thái thanh toán + đặt cọc.
  const listed = (await call('/orders', emp)).data.orders.find((x: any) => x.id === o.data.id);
  assert.deepEqual([listed.debtCounts, listed.receivable.payState, listed.receivable.deposit, listed.receivable.depositPaid], [true, 'deposit_paid', 7_452_000, 7_452_000]);
  const kList = (await call('/contracts', emp)).data.contracts.find((x: any) => x.orderId === o.data.id);
  assert.deepEqual([kList.debtCounts, kList.receivable.payState, kList.receivable.balance], [true, 'deposit_paid', 17_388_000]);
  assert.equal((await call('/orders/' + o.data.id + '/status', emp, 'PUT', { status: 'cancelled' })).status, 403);
  assert.equal((await call('/orders/' + o.data.id + '/status', mgr, 'PUT', { status: 'cancelled' })).status, 409, 'Manager cũng không huỷ được đơn đã giao / thu tiền');
  assert.equal((await call('/orders?q=hoang long', emp)).data.orders[0].contract.contractNo, k.data.contractNo);
  assert.equal((await call('/orders', ncc)).status, 403);
});

test('huỷ đơn chưa giao/chưa thu được; huỷ rồi tạo lại đơn từ cùng báo giá', async () => {
  const { call, emp, mgr } = await setup();
  const quote = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo: 'HRC_1', customer: 'Khách lẻ A', vat: 8, rows: [{ name: 'Nồi', qty: 2, price: 500000, printFee: 99 }] });
  await call('/quotes/' + quote.data.id + '/approve', mgr, 'POST', { revision: 1 });
  const o = await call('/orders', emp, 'POST', { quoteId: quote.data.id });
  await call(`/orders/${o.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)
  assert.equal((await call('/orders/' + o.data.id, emp)).data.lines[0].unitPrice, 500000, 'HRC không cộng phí in');
  assert.equal((await call('/contracts', emp, 'POST', { orderId: o.data.id, legalEntity: 'BN' })).status, 400, 'khách chưa có MST/mã KH');
  assert.equal((await call('/orders/' + o.data.id + '/status', emp, 'PUT', { status: 'cancelled' })).status, 403);
  assert.equal((await call('/orders/' + o.data.id + '/status', mgr, 'PUT', { status: 'cancelled' })).status, 200);
  assert.equal((await call('/receivables', emp)).data.receivables.length, 0);
  assert.equal((await call('/orders', emp, 'POST', { quoteId: quote.data.id })).status, 201);
});

test('lịch sử sản phẩm: bán, xuất kho giao hàng, chứng từ kho Sapo; giữ 20 giao dịch gần nhất mỗi mã; huỷ đơn thì bỏ', async () => {
  const { db, call, emp, mgr } = await setup();
  await db.insert(customers).values({ id: '1001', name: 'Công ty Hoàng Long', contact: '', phone: '', email: '', address: '1 Lê Lợi', search: '', taxCode: '', customerCode: '', sourceVersion: 0, syncedAt: '' });
  const order = async (i: number) => {
    const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: `B2B_H${i}`, customer: 'Công ty Hoàng Long', customerId: '1001', vat: 8,
      rows: [{ name: 'Bộ trà', sku: 'ML-TRA', unit: 'bộ', qty: i, price: 100000 + i * 1000, taxRate: 8 }, { name: 'Không mã', qty: 1, price: 5 }] });
    await call('/quotes/' + q.data.id + '/approve', mgr, 'POST', { revision: 1 });
    const id = (await call('/orders', emp, 'POST', { quoteId: q.data.id })).data.id as string;
    await call(`/orders/${id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)
    return id;
  };
  const first = await order(1);
  // Xuất kho giao hàng.
  const g = await call('/deliveries', emp, 'POST', { orderId: first, plannedDate: '2026-10-07' });
  await call('/deliveries/' + g.data.id + '/status', emp, 'PUT', { status: 'delivered', deliveredOn: '2026-10-07' });
  // Chứng từ kho Sapo: nhập hàng, cân bằng kho (chênh lệch có dấu), điều chuyển.
  await syncSapoDocs(db, 'purchase_order', [{ id: 9, code: 'PON0009', status: 'completed', supplier: { name: 'Minh Long I' }, created_on: '2026-10-01T02:00:00Z', line_items: [{ sku: 'ML-TRA', quantity: 50, price: 80000 }] }], new Map());
  await syncSapoDocs(db, 'stock_adjustment', [{ id: 3, code: 'KH0003', created_on: '2026-10-02T02:00:00Z', location_id: 1, line_items: [{ sku: 'ML-TRA', actual_quantity: 48, adjustment_quantity: -2 }] }], new Map([['1', 'Kho Cần Thơ']]));
  await syncSapoDocs(db, 'stock_transfer', [{ id: 4, code: 'TRN0004', created_on: '2026-10-03T02:00:00Z', source_location_id: 1, destination_location_id: 2, line_items: [{ sku: 'ML-TRA', quantity: 5 }] }], new Map([['1', 'Kho Cần Thơ'], ['2', 'Kho Vigifts']]));
  let h = (await call('/products/ML-TRA/history', emp)).data;
  const kinds = h.history.map((x: any) => x.kind);
  assert.deepEqual([...kinds].sort(), ['adjustment', 'delivery', 'purchase', 'sale', 'transfer']);
  const by = (k: string) => h.history.find((x: any) => x.kind === k);
  // Giá nhập (giá vốn) và tên nhà cung cấp: nhân viên KHÔNG thấy, chỉ Manager thấy.
  assert.deepEqual([by('purchase').qty, by('purchase').partner, by('purchase').refCode, by('purchase').unitPrice], [50, '', 'PON0009', null]);
  const mh = (await call('/products/ML-TRA/history', mgr)).data.history.find((x: any) => x.kind === 'purchase');
  assert.deepEqual([mh.partner, mh.unitPrice], ['Minh Long I', 80000]);
  assert.deepEqual([by('adjustment').qty, by('adjustment').location], [-2, 'Kho Cần Thơ']);
  assert.equal(by('transfer').location, 'Kho Cần Thơ → Kho Vigifts');
  assert.deepEqual([by('delivery').qty, by('delivery').partner, by('delivery').link], [1, 'Công ty Hoàng Long', '#/orders/' + first]);
  assert.deepEqual([by('sale').unitPrice, h.sales.last], [101000, 101000]);
  // Đồng bộ lại cùng phiếu Sapo (đổi trạng thái) → cập nhật, không nhân đôi.
  await syncSapoDocs(db, 'purchase_order', [{ id: 9, code: 'PON0009', status: 'cancelled', created_on: '2026-10-01T02:00:00Z', line_items: [{ sku: 'ML-TRA', quantity: 50 }] }], new Map());
  h = (await call('/products/ML-TRA/history', emp)).data;
  assert.deepEqual([h.history.filter((x: any) => x.kind === 'purchase').length, by('purchase') && h.history.find((x: any) => x.kind === 'purchase').status], [1, 'cancelled']);
  // Nhiều đơn: chỉ giữ 20 giao dịch gần nhất; đơn huỷ bị bỏ khỏi lịch sử.
  const ids: string[] = [];
  for (let i = 2; i <= 20; i++) ids.push(await order(i));
  h = (await call('/products/ML-TRA/history', emp)).data;
  assert.equal(h.history.length, 20);
  assert.equal(h.history[0].unitPrice, 120000, 'mới nhất đứng đầu');
  assert.equal(h.history.some((x: any) => x.kind === 'purchase'), false, 'giao dịch cũ nhất bị bỏ');
  assert.equal((await call('/products/' + encodeURIComponent('Không mã') + '/history', emp)).data.history.length, 0);
  assert.equal((await call('/orders/' + ids.at(-1) + '/status', mgr, 'PUT', { status: 'cancelled' })).status, 200);
  h = (await call('/products/ML-TRA/history', emp)).data;
  assert.deepEqual([h.history.length, h.history[0].unitPrice], [19, 119000]);
});

test('xuất hoá đơn: giao xong tự yêu cầu / nhân viên bấm yêu cầu → việc cho nhóm Kế toán; kế toán nhập số hoá đơn thì việc xong', async () => {
  const { call, emp, mgr, kt } = await setup();
  const order = async (no: string) => {
    const q = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo: no, customer: 'Khách ' + no, vat: 8, rows: [{ name: 'Nồi', sku: 'N1', qty: 2, price: 500000 }] });
    await call('/quotes/' + q.data.id + '/approve', mgr, 'POST', { revision: 1 });
    const id = (await call('/orders', emp, 'POST', { quoteId: q.data.id })).data.id as string;
    await call(`/orders/${id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)
    return id;
  };
  const a = await order('HRC_A'), b = await order('HRC_B');
  // Đơn A: giao xong → tự yêu cầu xuất hoá đơn.
  const g = await call('/deliveries', emp, 'POST', { orderId: a, plannedDate: '2026-10-07' });
  await call('/deliveries/' + g.data.id + '/status', emp, 'PUT', { status: 'delivered', deliveredOn: '2026-10-07' });
  let A = (await call('/orders/' + a, emp)).data.order;
  assert.deepEqual([A.invoiceStatus, A.invoiceRequestedBy], ['requested', null]);
  assert.equal(A.canIssueInvoice, false);
  // Đơn B: nhân viên phụ trách bấm yêu cầu (chưa giao).
  assert.equal((await call('/orders/' + b + '/invoice-request', emp, 'POST', { email: 'sai-email', note: 'x' })).status, 400);
  assert.equal((await call('/orders/' + b + '/invoice-request', emp, 'POST', { email: 'kt@khach.vn', mode: 'hack' })).status, 400);
  assert.equal((await call('/orders/' + b + '/invoice-request', emp, 'POST', { note: 'Khách cần hoá đơn trước khi giao', email: 'kt@khach.vn; sep@khach.vn', mode: 'draft' })).status, 200);
  let B = (await call('/orders/' + b, emp)).data.order;
  assert.deepEqual([B.invoiceStatus, B.invoiceRequestNote, B.invoiceRequestedByName, B.invoiceEmail, B.invoiceMode], ['requested', 'Khách cần hoá đơn trước khi giao', 'Tên emp', 'kt@khach.vn, sep@khach.vn', 'draft']);
  // Đã yêu cầu rồi: gửi lại = sửa email / cách xuất / ghi chú.
  assert.equal((await call('/orders/' + b + '/invoice-request', emp, 'POST', { note: 'Phát hành luôn', email: 'kt@khach.vn', mode: 'issue' })).data.updated, true);
  B = (await call('/orders/' + b, emp)).data.order;
  assert.deepEqual([B.invoiceEmail, B.invoiceMode, B.invoiceRequestNote], ['kt@khach.vn', 'issue', 'Phát hành luôn']);
  // Việc "Xuất hoá đơn" cho nhóm Kế toán: kế toán thấy, nhân viên sale không.
  let team = (await call('/tasks?view=mine&refresh=1', kt)).data.tasks.filter((t: any) => t.source === 'invoice');
  assert.equal(team.length, 2); assert.ok(team.every((t: any) => t.assigneePosition === 'accounting' && /^#\/orders\//.test(t.link)));
  // Kế toán xem được mọi đơn (dù không phụ trách) và là người duy nhất (cùng Manager) nhập số hoá đơn.
  assert.equal((await call('/orders/' + a, kt)).status, 200);
  assert.equal((await call('/orders/' + a + '/invoice', emp, 'PUT', { invoiceNo: '0000123' })).status, 403);
  assert.equal((await call('/orders/' + a + '/invoice', kt, 'PUT', { invoiceNo: '' })).status, 400);
  assert.equal((await call('/orders/' + a + '/invoice', kt, 'PUT', { invoiceNo: '0000123', invoiceDate: '2026-10-08' })).status, 200);
  A = (await call('/orders/' + a, emp)).data.order;
  assert.deepEqual([A.invoiceStatus, A.invoiceNo, A.invoiceDate, A.invoiceIssuedByName], ['issued', '0000123', '2026-10-08', 'Kế toán']);
  assert.equal((await call('/orders/' + a + '/invoice-request', emp, 'POST', {})).data.code, 'INVOICE_ISSUED');
  team = (await call('/tasks?view=mine&refresh=1', kt)).data.tasks.filter((t: any) => t.source === 'invoice' && t.status !== 'done');
  assert.deepEqual(team.map((t: any) => t.sourceId), [b], 'việc của đơn đã có số hoá đơn tự hoàn thành');
  assert.deepEqual((await call('/orders?invoice=requested', kt)).data.orders.map((o: any) => o.id), [b]);
});

test('đơn hàng và HĐKT là 2 luồng: trang Đơn hàng (flow=order) bỏ đơn đã có HĐKT; ＋ tạo nhanh chọn báo giá đã duyệt chưa có đơn', async () => {
  const { db, call, emp, mgr } = await setup();
  await db.insert(customers).values({ id: '1001', name: 'Công ty Hoàng Long', contact: '', phone: '', email: '', address: '', search: '', taxCode: '0101234567', customerCode: 'HL01', sourceVersion: 0, syncedAt: '' });
  const quote = async (no: string, approve = true) => {
    const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: no, customer: 'Công ty Hoàng Long', customerId: '1001', vat: 8, rows: [{ name: 'Ly', qty: 1, price: 100 }] });
    if (approve) await call('/quotes/' + q.data.id + '/approve', mgr, 'POST', { revision: 1 });
    return q.data.id as string;
  };
  const q1 = await quote('B2B_1'), q2 = await quote('B2B_2'); await quote('B2B_3', false);
  assert.deepEqual((await call('/order-quote-candidates', emp)).data.quotes.map((q: any) => q.quoteNo).sort(), ['B2B_1', 'B2B_2'], 'chỉ báo giá đã duyệt');
  // Báo giá 1 → đơn hàng; báo giá 2 → HĐKT thẳng (không qua đơn hàng).
  const o1 = (await call('/orders', emp, 'POST', { quoteId: q1 })).data.id;
  const k2 = await call('/contracts', emp, 'POST', { quoteId: q2, legalEntity: 'BN' }); assert.equal(k2.status, 201, JSON.stringify(k2.data));
  const o2 = k2.data.orderId;
  await call(`/orders/${o1}/status`, mgr, 'PUT', { status: 'confirmed', verified: true }); // Manager duyệt đơn (đơn tạo ra luôn là nháp)
  await call(`/orders/${o2}/status`, mgr, 'PUT', { status: 'confirmed', verified: true });
  assert.deepEqual((await call('/order-quote-candidates?q=b2b', emp)).data.quotes, [], 'báo giá đã có đơn / HĐKT thì không hiện');
  assert.deepEqual((await call('/orders?flow=order', emp)).data.orders.map((o: any) => o.id), [o1]);
  assert.equal((await call('/orders', emp)).data.orders.length, 2);
  const k = (await call('/contracts', emp)).data.contracts;
  assert.deepEqual([k.length, k[0].orderId, k[0].invoiceStatus], [1, o2, 'none']);
});

test('đơn / HĐKT sinh từ báo giá luôn là nháp chờ Manager duyệt; còn nháp thì sửa báo giá tự cập nhật đơn + HĐKT; đã duyệt thì chỉ Manager sửa và đồng bộ báo giá', async () => {
  const { db, call, emp, mgr } = await setup();
  await db.insert(customers).values({ id: '2001', name: 'Công ty An Phú', contact: 'Anh Phú', phone: '0902', email: '', address: 'Cần Thơ', search: '', taxCode: '0309999999', customerCode: 'AP01', sourceVersion: 0, syncedAt: '' });
  const doc = (qty: number, price: number) => ({ type: 'HRC', quoteNo: 'HRC_BG20261008_001', customer: 'Công ty An Phú', customerId: '2001', vat: 8,
    rows: [{ name: 'Bộ trà 0.8 L', sku: '01803808903', unit: 'Bộ', qty, price, taxRate: 8 }] });
  const q = await call('/quotes', mgr, 'POST', doc(140, 2_130_000)); assert.equal(q.status, 201);
  // Manager lập HĐKT cũng là nháp.
  const k = await call('/contracts', mgr, 'POST', { quoteId: q.data.id, legalEntity: 'BN', depositRate: 30, paymentDays: 15, signedDate: '2026-10-08' });
  assert.equal(k.status, 201, JSON.stringify(k.data));
  const o = { data: { id: k.data.orderId as string } };
  let d = (await call(`/orders/${o.data.id}`, mgr)).data;
  assert.equal(d.order.status, 'draft'); assert.equal(d.order.total, 322_056_000);
  assert.equal(d.contract.status, 'draft', 'đơn chưa duyệt: HĐKT giữ nháp dù gửi ngày ký');
  assert.equal((await call(`/contracts/${k.data.id}`, mgr, 'PUT', { status: 'signed' })).data.code, 'ORDER_NOT_APPROVED');
  assert.equal((await call('/deliveries', mgr, 'POST', { orderId: o.data.id, plannedDate: '2026-10-10' })).data.code, 'ORDER_NOT_APPROVED');

  // Còn nháp: khách đổi số lượng / giá → sửa báo giá → đơn + HĐKT + lịch thu cập nhật theo.
  const rev = (await call(`/quotes/${q.data.id}`, mgr)).data.revision;
  assert.equal((await call(`/quotes/${q.data.id}`, mgr, 'PUT', { revision: rev, data: doc(144, 1_704_000) })).status, 200);
  d = (await call(`/orders/${o.data.id}`, mgr)).data;
  assert.deepEqual(d.lines.map((l: any) => [l.qty, l.unitPrice]), [[144, 1_704_000]]);
  assert.equal(d.order.total, 265_006_080);
  assert.equal(d.contract.value, 265_006_080); assert.equal(d.contract.depositAmount, Math.round(265_006_080 * 0.3));
  assert.equal(d.schedules.reduce((s: number, x: any) => s + x.amount, 0), 265_006_080, 'lịch thu theo tổng mới');

  // Chỉ Manager duyệt.
  assert.equal((await call(`/orders/${o.data.id}/status`, emp, 'PUT', { status: 'confirmed', verified: true })).status, 404, 'nhân viên không phụ trách không thấy đơn');
  assert.equal((await call(`/orders/${o.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true })).status, 200);
  // Đã duyệt: Manager vẫn sửa báo giá và đồng bộ HĐKT; nhân viên bị chặn.
  const rev2 = (await call(`/quotes/${q.data.id}`, mgr)).data.revision;
  const locked = await call(`/quotes/${q.data.id}`, mgr, 'PUT', { revision: rev2, data: doc(150, 1_704_000) });
  assert.equal(locked.status, 200, JSON.stringify(locked.data));
  const updated = (await call(`/orders/${o.data.id}`, mgr)).data;
  assert.equal(updated.lines[0].qty, 150);
  assert.equal(updated.order.status, 'confirmed');
  assert.equal(updated.contract.value, updated.order.total);
  assert.equal(updated.schedules.reduce((sum: number, x: any) => sum + x.amount, 0), updated.order.total);
  assert.equal((await call(`/contracts/${k.data.id}`, mgr, 'PUT', { status: 'signed', signedDate: '2026-10-09' })).status, 200);
});


