import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { salesContracts, salesOrders } from '../../src/modules/sales/schema.ts';
import { buildSapoOrder, isSapoOrderFor, matchSapoAccount, sapoPushProblems, type SapoPushInput } from '../../src/modules/integrations/domain/sapo-order.ts';

/**
 * ĐẨY ĐƠN SANG SAPO – TỰ ĐỘNG, BẮT BUỘC khi sinh đơn hàng / lập HĐKT (thay "Copy báo giá vào Sapo" của web cũ):
 * chọn kho → tạo đơn NHÁP Sapo (mã = số báo giá, NV phụ trách Sapo = người phụ trách báo giá) cùng lúc với đơn / HĐKT web.
 * Sapo lỗi → KHÔNG có đơn / HĐKT nào. Khách / SKU chưa có trên Sapo thì tạo; đơn Sapo cùng mã đã có thì chỉ liên kết.
 */
const origin = 'https://trial.test', SECRET = 's'.repeat(40);
type Raw = Record<string, any>;

/** Sapo giả có trạng thái: đọc / tạo khách, sản phẩm, đơn; ghi lại mọi yêu cầu ghi. */
function fakeSapo(opts: { forbidOrders?: boolean } = {}) {
  const db = {
    accounts: [{ id: 21, full_name: 'Tên emp', email: 'emp@x.vn', status: 'active' }, { id: 22, full_name: 'Tên mgr', email: 'other@x.vn' }],
    locations: [{ id: 7, name: 'Kho Q1' }, { id: 8, name: 'Kho Hà Nội' }, { id: 9, name: 'Kho cũ', status: 'inactive' }],
    customers: [{ id: 501, name: 'Công ty Hoàng Long', tax_code: '0101234567' }] as Raw[],
    variants: [{ id: 901, product_id: 90, sku: 'LHC', barcode: 'LHC' }] as Raw[],
    orders: [] as Raw[],
  };
  const writes: { method: string; path: string; body: Raw }[] = [];
  let seq = 1000;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), path = url.pathname.replace(/^\/admin/, ''), method = init?.method ?? 'GET', q = url.searchParams.get('query') ?? '';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (method !== 'GET') writes.push({ method, path, body });
    if (path === '/accounts.json') return Response.json({ accounts: db.accounts });
    if (path === '/locations.json') return Response.json({ locations: db.locations });
    if (path === '/customers.json' && method === 'GET') return Response.json({ customers: db.customers.filter(c => JSON.stringify(c).toLowerCase().includes(q.toLowerCase())) });
    if (path === '/customers.json') { const c = { id: ++seq, ...body.customer }; db.customers.push(c); return Response.json({ customer: c }); }
    const cust = path.match(/^\/customers\/(\d+)\.json$/);
    if (cust) { const c = db.customers.find(x => String(x.id) === cust[1]); return c ? Response.json({ customer: c }) : new Response('{}', { status: 404 }); }
    if (path === '/variants/search.json') return Response.json({ variants: db.variants.filter(v => v.sku.toLowerCase().includes(q.toLowerCase())) });
    if (path === '/products.json') { const pid = ++seq, v = { ...body.product.variants[0], id: ++seq, product_id: pid }; db.variants.push(v); return Response.json({ product: { id: pid, variants: [v] } }); }
    if (path === '/orders.json' && method === 'GET') return Response.json({ orders: db.orders.filter(o => JSON.stringify(o).includes(q)) });
    if (path === '/orders.json') {
      if (opts.forbidOrders) return new Response('{}', { status: 403 });
      const o = body.order, lines: Raw[] = o.order_line_items;
      const total = Math.round(lines.reduce((s, l) => s + l.price * l.quantity * (1 + (l.tax_rate_override ?? 0) / 100), 0));
      // Sapo tự cấp mã SON… → app phải sửa lại mã = số báo giá.
      const created = { ...o, id: ++seq, code: 'SON' + seq, reference_number: '', total };
      db.orders.push(created); return Response.json({ order: created });
    }
    const ord = path.match(/^\/orders\/(\d+)\.json$/);
    if (ord) {
      const o = db.orders.find(x => String(x.id) === ord[1]); if (!o) return new Response('{}', { status: 404 });
      if (method === 'PUT') Object.assign(o, body.order);
      return Response.json({ order: o });
    }
    return new Response('{}', { status: 404 });
  }) as typeof globalThis.fetch;
  return { db, writes, fetch };
}

async function setup(opts: { forbidOrders?: boolean; connect?: boolean } = {}) {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const sapo = fakeSapo(opts), router = createAppRouter();
  const env = { db, passwordIterations: 1000, sapoSyncToken: SECRET, sapoFetch: sapo.fetch };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const mgr = await login('mgr@x.vn'), emp = await login('emp@x.vn');
  if (opts.connect !== false) assert.equal((await call('/admin/sapo-session', mgr, 'POST', { cookie: '_admin_session_id=abc' })).status, 200);
  await db.insert(customers).values({ id: '501', name: 'Công ty Hoàng Long', contact: 'Chị Lan', phone: '0901', email: '', address: '1 Lê Lợi', search: '', taxCode: '0101234567', customerCode: 'HL01', sourceVersion: 0, syncedAt: '' });
  const ROWS = [{ name: 'Bình giữ nhiệt', sku: 'LHC', unit: 'cái', qty: 10, price: 200000, taxRate: 8 }, { name: 'Hộp quà mới', sku: 'HQ-NEW', unit: 'hộp', qty: 5, price: 100000, taxRate: 8 }];
  /** Báo giá đã duyệt của emp (người phụ trách = emp). */
  const makeQuote = async (quoteNo: string, rows: object[] = ROWS) => {
    const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo, customer: 'Công ty Hoàng Long', customerId: '501', customerTaxCode: '0101234567', contact: 'Chị Lan', phone: '0901', vat: 8, date: '2026-10-09', rows });
    assert.equal(q.status, 201, JSON.stringify(q.data));
    assert.equal((await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 1 })).status, 200);
    return q.data.id as string;
  };
  const orderCount = async () => (await db.select({ id: salesOrders.id }).from(salesOrders)).length;
  return { db, sapo, call, mgr, emp, makeQuote, orderCount };
}

test('sinh đơn hàng: chọn kho → đơn web + đơn nháp Sapo cùng lúc; đúng mã, đúng NV phụ trách; tạo SKU thiếu; Sapo đã có cùng mã thì liên kết', async () => {
  const { sapo, call, emp, makeQuote, orderCount } = await setup();
  const qid = await makeQuote('B2B_BG20261009_001');

  const pre = (await call(`/sapo/preview?quoteId=${qid}`, emp)).data;
  assert.equal(pre.connected, true, JSON.stringify(pre));
  assert.deepEqual(pre.locations, [{ id: 7, name: 'Kho Q1' }, { id: 8, name: 'Kho Hà Nội' }], 'bỏ kho ngừng hoạt động');
  assert.deepEqual(pre.account, { id: 21, name: 'Tên emp' }, 'NV phụ trách Sapo = người phụ trách báo giá (khớp email)');
  assert.deepEqual([pre.code, pre.problems, pre.required], ['B2B_BG20261009_001', [], true]);
  assert.equal(sapo.writes.length, 0, 'xem trước không ghi gì vào Sapo');

  // Không chọn kho / kho ngừng hoạt động → không có đơn.
  assert.equal((await call('/orders', emp, 'POST', { quoteId: qid })).data.code, 'SAPO_LOCATION_REQUIRED');
  assert.equal((await call('/orders', emp, 'POST', { quoteId: qid, sapoLocationId: 9 })).data.code, 'SAPO_LOCATION_INVALID');
  assert.equal(await orderCount(), 0);

  const r = await call('/orders', emp, 'POST', { quoteId: qid, sapoLocationId: 8 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual([r.data.sapo.status, r.data.sapo.code, r.data.sapo.location, r.data.sapo.account, r.data.sapo.warnings], ['created', 'B2B_BG20261009_001', 'Kho Hà Nội', 'Tên emp', []]);
  const created = sapo.db.orders[0]!;
  assert.deepEqual([created.status, created.location_id, created.assignee_id, created.account_id, created.customer_id], ['draft', 8, 21, 21, 501]);
  assert.equal(created.code, 'B2B_BG20261009_001', 'Sapo cấp mã SON… → sửa lại đúng số báo giá');
  assert.deepEqual(created.order_line_items.map((l: Raw) => [l.price, l.quantity, l.tax_rate_override]), [[200000, 10, 8], [100000, 5, 8]]);
  assert.ok(sapo.writes.some(w => w.path === '/products.json' && w.body.product.variants[0].sku === 'HQ-NEW'), 'SKU chưa có thì tạo sản phẩm Sapo');
  const detail = (await call(`/orders/${r.data.id}`, emp)).data.order;
  assert.equal(detail.sapoOrderCode, 'B2B_BG20261009_001'); assert.match(detail.sapoOrderUrl, /\/admin\/orders\/\d+$/);

  // Đơn Sapo cùng số báo giá đã có (vd. copy từ web cũ) → liên kết, không tạo thêm; tổng lệch thì cảnh báo.
  const q2 = await makeQuote('B2B_BG20261009_002');
  sapo.db.orders.push({ id: 7777, code: 'B2B_BG20261009_002', reference_number: 'B2B_BG20261009_002', total: 1 });
  const again = await call('/orders', emp, 'POST', { quoteId: q2, sapoLocationId: 7 });
  assert.deepEqual([again.status, again.data.sapo.status, again.data.sapo.id], [201, 'existing', '7777']);
  assert.match(again.data.sapo.warnings.join(), /Tổng tiền trên Sapo/);
  assert.equal(sapo.db.orders.length, 2);
});

test('lập HĐKT: đơn luồng HĐKT chưa đẩy; lập HĐKT mới đẩy Sapo (ghi chú có số HĐKT); Sapo lỗi → không có HĐKT', async () => {
  const ok = await setup();
  const qid = await ok.makeQuote('B2B_BG20261009_003');
  const o = await ok.call('/orders', ok.emp, 'POST', { quoteId: qid, flow: 'contract' });
  assert.deepEqual([o.status, o.data.sapo], [201, null], 'luồng HĐKT: đơn tạm chưa đẩy');
  assert.equal((await ok.call(`/sapo/preview?orderId=${o.data.id}`, ok.emp)).data.code, 'B2B_BG20261009_003');
  const contract = { orderId: o.data.id, legalEntity: 'BN', depositRate: 30, paymentDays: 15, signedDate: '2026-10-09' };
  assert.equal((await ok.call('/contracts', ok.emp, 'POST', contract)).data.code, 'SAPO_LOCATION_REQUIRED');
  const k = await ok.call('/contracts', ok.emp, 'POST', { ...contract, sapoLocationId: 7 });
  assert.equal(k.status, 201, JSON.stringify(k.data));
  assert.equal(k.data.sapo.status, 'created');
  assert.ok(ok.sapo.db.orders[0]!.note.includes('HĐKT: ' + k.data.contractNo), 'ghi chú đơn Sapo có số HĐKT');
  assert.equal((await ok.call(`/sapo/preview?orderId=${o.data.id}`, ok.emp)).data.pushed.code, 'B2B_BG20261009_003');

  // Sapo từ chối (thiếu quyền) → không lập HĐKT, không tạo đơn hàng.
  const bad = await setup({ forbidOrders: true });
  const q2 = await bad.makeQuote('B2B_BG20261009_004');
  const denied = await bad.call('/orders', bad.emp, 'POST', { quoteId: q2, sapoLocationId: 7 });
  assert.deepEqual([denied.status, denied.data.code], [403, 'SAPO_PERMISSION_DENIED']);
  assert.equal(await bad.orderCount(), 0, 'Sapo lỗi → không có đơn hàng');
  const o2 = await bad.call('/orders', bad.emp, 'POST', { quoteId: q2, flow: 'contract' });
  const k2 = await bad.call('/contracts', bad.emp, 'POST', { orderId: o2.data.id, legalEntity: 'BN', depositRate: 30, paymentDays: 15, sapoLocationId: 7 });
  assert.equal(k2.status, 403);
  assert.equal((await bad.db.select().from(salesContracts)).length, 0, 'Sapo lỗi → không có HĐKT');
  assert.equal((await bad.call(`/orders/${o2.data.id}`, bad.emp)).data.contract, null);
});

test('chưa kết nối Sapo / dòng thiếu SKU / không có quyền xem báo giá → báo rõ, không tạo đơn', async () => {
  const off = await setup({ connect: false });
  const qid = await off.makeQuote('B2B_BG20261009_001');
  const pre = (await off.call(`/sapo/preview?quoteId=${qid}`, off.emp)).data;
  assert.equal(pre.connected, false); assert.match(pre.message, /Chưa kết nối Sapo/);
  assert.equal((await off.call('/orders', off.emp, 'POST', { quoteId: qid, sapoLocationId: 7 })).status, 409);
  assert.equal(await off.orderCount(), 0);

  const s = await setup();
  const noSku = await s.makeQuote('B2B_BG20261009_005', [{ name: 'Hàng tự do', sku: '', qty: 1, price: 1000 }]);
  assert.match((await s.call(`/sapo/preview?quoteId=${noSku}`, s.emp)).data.problems.join(), /chưa có mã SKU/);
  assert.equal((await s.call('/orders', s.emp, 'POST', { quoteId: noSku, sapoLocationId: 7 })).data.code, 'SAPO_PUSH_INVALID');
  assert.equal(await s.orderCount(), 0);
  const ncc = (await s.call('/login', '', 'POST', { email: 'ncc@x.vn', password: PASSWORD })).cookie;
  assert.equal((await s.call(`/sapo/preview?quoteId=${noSku}`, ncc)).status, 403);
  assert.equal(s.sapo.writes.length, 0);
});

test('đẩy Sapo: hàm thuần – kiểm dữ liệu, khớp đơn đúng mã, khớp tài khoản phụ trách, dựng đơn nháp', () => {
  const input: SapoPushInput = { code: 'B2B_BG20261009_001', orderNo: 'DH_20261009_001', quoteNo: 'B2B_BG20261009_001', quoteType: 'B2B', contractNo: '',
    customer: { sapoId: 501, name: 'Khách', customerCode: '', taxCode: '', phone: '', email: '', contact: '', address: '' },
    lines: [{ sku: 'A', name: 'A', unit: 'cái', qty: 2, unitPrice: 1000, taxRate: 8 }, { sku: '', name: 'B', unit: '', qty: 1, unitPrice: 5, taxRate: 0 }],
    ownerName: 'Lan', ownerPhone: '', expectedDeliveryDate: '2026-10-20', subtotal: 2005, tax: 160, total: 2165 };
  assert.match(sapoPushProblems(input).join(), /Dòng 2 chưa có mã SKU/);
  assert.equal(isSapoOrderFor({ code: 'B2B_BG20261009_0012' }, 'B2B_BG20261009_001'), false, 'không khớp chuỗi con');
  assert.equal(isSapoOrderFor({ code: 'SON1', tags: ['web-bao-gia', 'B2B_BG20261009_001'] }, 'B2B_BG20261009_001'), true);
  assert.equal(matchSapoAccount([{ id: 1, full_name: 'Nguyễn Văn Lan', status: 'inactive' }, { id: 2, full_name: 'nguyen van lan' }], { email: '', name: 'Nguyễn Văn Lan' })?.id, 2);
  const o = buildSapoOrder({ ...input, lines: [input.lines[0]!] }, { locationId: 7, sourceId: 1, priceListId: 2 }, { customerId: 501, accountId: 21, variants: [{ id: 9, product_id: 90 }] });
  assert.deepEqual([o.code, o.status, o.location_id, o.assignee_id, o.customer_id], ['B2B_BG20261009_001', 'draft', 7, 21, 501]);
  assert.deepEqual(o.order_line_items![0], { product_id: 90, variant_id: 9, is_freeform: false, price: 1000, tax_included: false, tax_rate_override: 8, quantity: 2, note: 'Ngày giao: 2026-10-20' });
});

