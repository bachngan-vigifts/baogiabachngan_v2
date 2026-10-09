import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { eq } from 'drizzle-orm';
import { customers, customerStaff } from '../../src/modules/customers/schema.ts';
import { salesOrders } from '../../src/modules/sales/schema.ts';
import { buildSapoOrder, isSapoOrderFor, matchSapoAccount, sapoPushProblems, type SapoPushInput } from '../../src/modules/integrations/domain/sapo-order.ts';

/**
 * ĐẨY ĐƠN SANG SAPO (thay "Copy báo giá vào Sapo" của web cũ): sinh đơn / HĐKT → chọn kho → tạo đơn NHÁP Sapo,
 * mã đơn = số báo giá, người phụ trách Sapo = người phụ trách đơn; không tạo trùng; khách / SKU chưa có thì tạo.
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
  const makeOrder = async (quoteNo: string, rows: object[] = [{ name: 'Bình giữ nhiệt', sku: 'LHC', unit: 'cái', qty: 10, price: 200000, taxRate: 8 }, { name: 'Hộp quà mới', sku: 'HQ-NEW', unit: 'hộp', qty: 5, price: 100000, taxRate: 8 }]) => {
    const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo, customer: 'Công ty Hoàng Long', customerId: '501', contact: 'Chị Lan', phone: '0901', vat: 8, date: '2026-10-09', rows });
    assert.equal(q.status, 201, JSON.stringify(q.data));
    assert.equal((await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 1 })).status, 200);
    const o = await call('/orders', emp, 'POST', { quoteId: q.data.id }); assert.equal(o.status, 201, JSON.stringify(o.data));
    return o.data.id as string;
  };
  return { db, sapo, call, mgr, emp, makeOrder };
}

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

test('đẩy Sapo: xem trước → chọn kho → tạo đơn nháp đúng mã, đúng NV phụ trách; tạo SKU thiếu; bấm lại không tạo trùng', async () => {
  const { db, sapo, call, mgr, emp, makeOrder } = await setup();
  const id = await makeOrder('B2B_BG20261009_001');

  const pre = (await call(`/orders/${id}/sapo`, emp)).data;
  assert.equal(pre.connected, true, JSON.stringify(pre));
  assert.deepEqual(pre.locations, [{ id: 7, name: 'Kho Q1' }, { id: 8, name: 'Kho Hà Nội' }], 'bỏ kho ngừng hoạt động');
  assert.deepEqual(pre.account, { id: 21, name: 'Tên emp' }, 'NV phụ trách Sapo = người phụ trách báo giá (khớp email)');
  assert.deepEqual([pre.code, pre.problems], ['B2B_BG20261009_001', []]);
  assert.equal(sapo.writes.length, 0, 'xem trước không ghi gì vào Sapo');

  assert.equal((await call(`/orders/${id}/sapo-push`, emp, 'POST', {})).status, 400, 'chưa chọn kho');
  assert.equal((await call(`/orders/${id}/sapo-push`, emp, 'POST', { locationId: 9 })).status, 400, 'kho ngừng hoạt động');
  const r = await call(`/orders/${id}/sapo-push`, emp, 'POST', { locationId: 8 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'created');
  assert.equal(r.data.sapoOrder.code, 'B2B_BG20261009_001', 'Sapo cấp mã SON… → sửa lại đúng số báo giá');
  assert.deepEqual(r.data.warnings, []);
  const created = sapo.db.orders[0]!;
  assert.deepEqual([created.status, created.location_id, created.assignee_id, created.account_id, created.customer_id], ['draft', 8, 21, 21, 501]);
  assert.deepEqual(created.order_line_items.map((l: Raw) => [l.price, l.quantity, l.tax_rate_override]), [[200000, 10, 8], [100000, 5, 8]]);
  assert.deepEqual(r.data.products, [{ sku: 'LHC', action: 'existing' }, { sku: 'HQ-NEW', action: 'created' }], 'SKU chưa có thì tạo sản phẩm Sapo');
  assert.equal(r.data.customer.action, 'existing', 'khách Sapo theo mã khách đồng bộ');

  // Đơn web lưu liên kết; chi tiết đơn có link Sapo.
  const detail = (await call(`/orders/${id}`, emp)).data.order;
  assert.equal(detail.sapoOrderCode, 'B2B_BG20261009_001'); assert.match(detail.sapoOrderUrl, /\/admin\/orders\/\d+$/);
  // Bấm lại: không gọi tạo đơn nữa.
  const writes = sapo.writes.length;
  assert.equal((await call(`/orders/${id}/sapo-push`, emp, 'POST', { locationId: 8 })).data.status, 'existing');
  assert.equal((await call(`/orders/${id}/sapo`, emp)).data.pushed.code, 'B2B_BG20261009_001');
  assert.equal(sapo.writes.length, writes);

  // Đơn đã có trên Sapo từ trước (copy ở web cũ cùng số báo giá) → liên kết, không tạo thêm.
  const id2 = await makeOrder('B2B_BG20261009_002');
  sapo.db.orders.push({ id: 7777, code: 'B2B_BG20261009_002', reference_number: 'B2B_BG20261009_002', total: 1 });
  const again = await call(`/orders/${id2}/sapo-push`, emp, 'POST', { locationId: 7 });
  assert.deepEqual([again.data.status, again.data.sapoOrder.id], ['existing', '7777']);
  assert.match(again.data.warnings.join(), /Tổng tiền trên Sapo/, 'tổng lệch thì cảnh báo');
  assert.equal(sapo.db.orders.length, 2);

  // Quyền: người không xem được đơn thì không đẩy được; đơn huỷ không đẩy.
  const id3 = await makeOrder('B2B_BG20261009_003');
  const ncc = (await call('/login', '', 'POST', { email: 'ncc@x.vn', password: PASSWORD })).cookie;
  assert.equal((await call(`/orders/${id3}/sapo-push`, ncc, 'POST', { locationId: 7 })).status, 403, 'tài khoản NCC');
  await db.update(salesOrders).set({ ownerId: 'mgr', createdBy: 'mgr' }).where(eq(salesOrders.id, id3));
  await db.delete(customerStaff);
  assert.equal((await call(`/orders/${id3}/sapo-push`, emp, 'POST', { locationId: 7 })).status, 404, 'đơn không thuộc phạm vi xem');
  await db.update(salesOrders).set({ status: 'cancelled' });
  assert.equal((await call(`/orders/${id3}/sapo-push`, mgr, 'POST', { locationId: 7 })).status, 409);
});

test('đẩy Sapo: thiếu SKU / chưa kết nối / thiếu quyền Sapo → báo rõ, nhả giữ chỗ để thử lại', async () => {
  const noSession = await setup({ connect: false });
  const id = await noSession.makeOrder('B2B_BG20261009_001');
  const pre = (await noSession.call(`/orders/${id}/sapo`, noSession.emp)).data;
  assert.equal(pre.connected, false); assert.match(pre.message, /Chưa kết nối Sapo/);
  assert.equal((await noSession.call(`/orders/${id}/sapo-push`, noSession.emp, 'POST', { locationId: 7 })).status, 409);

  const s = await setup({ forbidOrders: true });
  const bad = await s.makeOrder('B2B_BG20261009_004', [{ name: 'Hàng tự do', sku: '', qty: 1, price: 1000 }]);
  assert.match((await s.call(`/orders/${bad}/sapo`, s.emp)).data.problems.join(), /chưa có mã SKU/);
  assert.equal((await s.call(`/orders/${bad}/sapo-push`, s.emp, 'POST', { locationId: 7 })).status, 400);

  const oid = await s.makeOrder('B2B_BG20261009_005');
  const denied = await s.call(`/orders/${oid}/sapo-push`, s.emp, 'POST', { locationId: 7 });
  assert.equal(denied.status, 403); assert.equal(denied.data.code, 'SAPO_PERMISSION_DENIED');
  const [row] = await s.db.select({ code: salesOrders.sapoOrderCode, id: salesOrders.sapoOrderId }).from(salesOrders).where(eq(salesOrders.id, oid));
  assert.deepEqual(row, { code: null, id: null }, 'lỗi thì nhả giữ chỗ, bấm lại được');
});
