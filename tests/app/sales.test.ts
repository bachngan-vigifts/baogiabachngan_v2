import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { contractNumber, legalCode, nextDocNo, orderLinesFromQuote, receivable, contractSchedules } from '../../src/modules/sales/domain/sales.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), ncc: await login('ncc@x.vn') };
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
  assert.deepEqual(r, { due: 1000, paid: 100, balance: 900, overdue: 200, nextDueDate: null, status: 'overdue' });
  assert.deepEqual(contractSchedules(1000, 30, '2026-10-06').map(s => [s.kind, s.amount, s.dueDate]), [['deposit', 300, '2026-10-06'], ['balance', 700, null]]);
});

test('luồng bán hàng: báo giá → đơn đặt hàng → HĐKT → lịch giao → công nợ, đúng quyền', async () => {
  const { db, call, emp, mgr, ncc } = await setup();
  await db.insert(customers).values({ id: '1001', name: 'Công ty Hoàng Long', contact: 'Chị Lan', phone: '0901', email: '', address: '1 Lê Lợi', search: '', taxCode: '0101234567', customerCode: 'HL01', sourceVersion: 0, syncedAt: '' });
  const doc = { type: 'B2B', quoteNo: 'B2B_BG20261006_001', customer: 'Công ty Hoàng Long', customerId: '1001', contact: 'Chị Lan', phone: '0901', customerAddress: '1 Lê Lợi', vat: 8,
    rows: [{ name: 'Bình giữ nhiệt', sku: 'LHC', unit: 'cái', qty: 100, price: 200000, discount: 10, printFee: 0, taxRate: 8 }, { name: 'Hộp quà', sku: 'HQ', unit: 'hộp', qty: 50, price: 100000, taxRate: 8 }] };
  const quote = await call('/quotes', emp, 'POST', doc); assert.equal(quote.status, 201);

  // Đơn đặt hàng từ báo giá.
  assert.equal((await call('/orders', ncc, 'POST', { quoteId: quote.data.id })).status, 403);
  const o = await call('/orders', emp, 'POST', { quoteId: quote.data.id }); assert.equal(o.status, 201, JSON.stringify(o.data));
  assert.equal((await call('/orders', emp, 'POST', { quoteId: quote.data.id })).data.code, 'ORDER_EXISTS');
  let d = (await call('/orders/' + o.data.id, emp)).data;
  assert.match(d.order.orderNo, /^DH_\d{8}_001$/);
  assert.equal(d.order.customerId, '1001'); assert.equal(d.order.quoteNo, 'B2B_BG20261006_001');
  assert.equal(d.order.subtotal, 23_000_000); assert.equal(d.order.tax, 1_840_000); assert.equal(d.order.total, 24_840_000);
  assert.equal(d.lines.length, 2); assert.equal(d.lines[0].unitPrice, 180000);
  assert.deepEqual(d.receivable, { due: 24_840_000, paid: 0, balance: 24_840_000, overdue: 0, nextDueDate: null, status: 'open' });
  // Người khác (không phụ trách) không thấy; Manager thấy.
  const other = (await call('/login', '', 'POST', { email: 'new@x.vn', password: PASSWORD })).cookie; // chưa kích hoạt → không đăng nhập được
  assert.equal(other, '');
  assert.equal((await call('/orders/' + o.data.id, mgr)).status, 200);

  // HĐKT: cấp số kiểu web cũ, kỳ phải thu = cọc 30% + phần còn lại.
  assert.equal((await call('/contracts', emp, 'POST', { orderId: o.data.id, legalEntity: 'xyz' })).status, 400);
  const k = await call('/contracts', emp, 'POST', { orderId: o.data.id, legalEntity: 'BN', depositRate: 30, paymentDays: 15, signedDate: '2026-10-06' });
  assert.equal(k.status, 201, JSON.stringify(k.data)); assert.match(k.data.contractNo, /^\d{2}-01\/\d{8}\/HĐKT\/BN-HL01$/);
  assert.equal((await call('/contracts', emp, 'POST', { orderId: o.data.id, legalEntity: 'BN' })).data.code, 'CONTRACT_EXISTS');
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
  assert.equal((await call('/orders/' + o.data.id + '/status', emp, 'PUT', { status: 'cancelled' })).status, 409);
  assert.equal((await call('/orders?q=hoang long', emp)).data.orders[0].contract.contractNo, k.data.contractNo);
  assert.equal((await call('/orders', ncc)).status, 403);
});

test('huỷ đơn chưa giao/chưa thu được; huỷ rồi tạo lại đơn từ cùng báo giá', async () => {
  const { call, emp } = await setup();
  const quote = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo: 'HRC_1', customer: 'Khách lẻ A', vat: 8, rows: [{ name: 'Nồi', qty: 2, price: 500000, printFee: 99 }] });
  const o = await call('/orders', emp, 'POST', { quoteId: quote.data.id });
  assert.equal((await call('/orders/' + o.data.id, emp)).data.lines[0].unitPrice, 500000, 'HRC không cộng phí in');
  assert.equal((await call('/contracts', emp, 'POST', { orderId: o.data.id, legalEntity: 'BN' })).status, 400, 'khách chưa có MST/mã KH');
  assert.equal((await call('/orders/' + o.data.id + '/status', emp, 'PUT', { status: 'cancelled' })).status, 200);
  assert.equal((await call('/receivables', emp)).data.receivables.length, 0);
  assert.equal((await call('/orders', emp, 'POST', { quoteId: quote.data.id })).status, 201);
});
