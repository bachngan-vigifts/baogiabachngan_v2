import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { fixture, ok, sku } from '../helpers/warehouse-lifecycle-fixture.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
import {
  orderStockHolds,
  salesOrders,
} from '../../src/modules/sales/schema.ts';
import { warehouses } from '../../src/modules/catalog/schema.ts';

async function setup(holdQuote = false) {
  const f = await fixture(),
    c = {
      ...f.cookies,
      emp: f.cookies.emp!,
      mgr: f.cookies.mgr!,
      ncc: f.cookies.ncc!,
    };
  await postMoves(f.db, 'mgr', [
    {
      sku,
      warehouseId: 'vig',
      qty: 6,
      kind: 'receipt',
      refType: 'supplier_receipt',
      refId: 'contract-stock',
    },
  ]);
  const quote = ok(
    await f.call('/quotes', c.emp, 'POST', {
      type: 'HRC',
      quoteNo: 'HOLD-' + crypto.randomUUID(),
      customer: 'Khách hợp đồng',
      customerTaxCode: '0312345678',
      vat: 8,
      rows: [{ sku, name: 'Bộ trà', unit: 'Bộ', qty: 5, price: 2000 }],
    }),
    201,
  );
  ok(
    await f.call(`/quotes/${quote.id}/approve`, c.mgr, 'POST', { revision: 1 }),
  );
  if (holdQuote)
    ok(await f.call(`/quotes/${quote.id}/hold`, c.emp, 'POST', {}), 201);
  const contract = ok(
    await f.call('/contracts', c.emp, 'POST', {
      quoteId: quote.id,
      legalEntity: 'VG',
      warehouseId: 'vig',
    }),
    201,
  );
  const base = `/orders/${contract.orderId}/holds`;
  const approve = () =>
    f.call(`/orders/${contract.orderId}/status`, c.mgr, 'PUT', {
      status: 'confirmed',
      verified: true,
      costWarningsReviewed: true,
    });
  return { ...f, cookies: c, contract, base, approve };
}

test('HĐKT dùng cùng lượng giữ với đơn: giữ thêm, gửi lặp, gia hạn và huỷ; hiển thị đúng số hợp đồng, không cộng trùng', async () => {
  const f = await setup(),
    c = f.cookies;
  const draft = ok(await f.call(f.base, c.emp));
  assert.equal(draft.canHold, false);
  assert.match(draft.blockedReason, /Duyệt.*HĐKT/);
  assert.equal(
    (await f.call(f.base, c.emp, 'POST', { clientKey: 'contract-draft' }))
      .status,
    409,
  );
  ok(await f.approve());
  // Nhân viên chỉ được mở HĐKT vẫn thao tác được, không phải cấp thêm quyền Đơn hàng.
  ok(
    await f.call('/permissions/positions/sale', c.mgr, 'PUT', {
      perms: ['page.contracts'],
    }),
  );
  assert.equal(ok(await f.call(f.base, c.emp)).canHold, true);
  const key = 'contract-hold-0001';
  const held = ok(await f.call(f.base, c.emp, 'POST', { clientKey: key }), 201);
  assert.equal(
    held.lines.reduce((sum: number, l: { qty: number }) => sum + l.qty, 0),
    5,
  );
  assert.equal(
    ok(await f.call(f.base, c.emp, 'POST', { clientKey: key })).replayed,
    true,
  );
  const all = ok(await f.call('/stock-holds', c.mgr)).holds.filter(
    (h: { orderId: string }) => h.orderId === f.contract.orderId,
  );
  assert.equal(all.length, 1);
  assert.equal(all[0].qty, 5);
  assert.equal(all[0].contractNo, f.contract.contractNo);
  assert.equal(
    (await f.call(f.base + '/extend', c.emp, 'POST', {})).status,
    403,
  );
  const before = ok(await f.call(f.base, c.emp)).holds[0].expiresAt;
  ok(await f.call(f.base + '/extend', c.mgr, 'POST', {}));
  const extended = ok(await f.call(f.base, c.emp));
  assert.equal(
    Date.parse(extended.holds[0].expiresAt) - Date.parse(before),
    5 * 864e5,
  );
  assert.equal(extended.canExtend, false);
  assert.equal(ok(await f.call(f.base, c.mgr)).canExtend, true);
  assert.equal(
    (await f.call(f.base + '/release', c.emp, 'POST', { reason: '' })).status,
    400,
  );
  ok(
    await f.call(f.base + '/release', c.emp, 'POST', {
      reason: 'Khách đổi lịch',
    }),
  );
  assert.equal(ok(await f.call(f.base, c.emp)).holds.length, 0);
  assert.equal(
    await f.balance(),
    6,
    'giữ / huỷ giữ không làm thay đổi tồn vật lý',
  );
});

test('HĐKT không giữ hàng khi thiếu kho / đã huỷ; dòng giữ hết hạn không còn trừ tồn', async () => {
  const f = await setup(),
    c = f.cookies;
  ok(await f.approve());
  await f.db
    .update(salesOrders)
    .set({ warehouseId: null })
    .where(eq(salesOrders.id, f.contract.orderId));
  const noWarehouse = ok(await f.call(f.base, c.emp));
  assert.equal(noWarehouse.canHold, false);
  assert.match(noWarehouse.blockedReason, /Chọn kho bán/);
  assert.equal(
    (await f.call(f.base, c.emp, 'POST', { clientKey: 'contract-no-wh' }))
      .status,
    409,
  );
  await f.db
    .update(salesOrders)
    .set({ warehouseId: 'vig' })
    .where(eq(salesOrders.id, f.contract.orderId));
  ok(
    await f.call(f.base, c.emp, 'POST', { clientKey: 'contract-expiry' }),
    201,
  );
  await f.db
    .update(orderStockHolds)
    .set({ expiresAt: '2020-01-01T00:00:00.000Z' })
    .where(eq(orderStockHolds.orderId, f.contract.orderId));
  assert.equal(ok(await f.call(f.base, c.emp)).holds.length, 0);
  assert.equal(
    ok(await f.call('/stock-holds', c.mgr)).holds.some(
      (h: { orderId: string }) => h.orderId === f.contract.orderId,
    ),
    false,
  );
  ok(
    await f.call(`/orders/${f.contract.orderId}/status`, c.mgr, 'PUT', {
      status: 'cancelled',
    }),
  );
  assert.match(ok(await f.call(f.base, c.emp)).blockedReason, /đã huỷ/);
  assert.equal(
    (await f.call(f.base, c.emp, 'POST', { clientKey: 'contract-cancel' }))
      .status,
    409,
  );
});

test('giữ hàng HĐKT kiểm tra phạm vi chứng từ, đăng nhập và khu vực nhân viên', async () => {
  const f = await setup(),
    c = f.cookies;
  ok(await f.approve());
  assert.equal((await f.call(f.base, '')).status, 401);
  assert.equal((await f.call(f.base, c.ncc)).status, 403);
  assert.equal(
    (await f.call('/orders/does-not-exist/holds', c.emp)).status,
    404,
  );
  await f.db
    .update(salesOrders)
    .set({ ownerId: 'sa', createdBy: 'sa' })
    .where(eq(salesOrders.id, f.contract.orderId));
  for (const [path, method, body] of [
    [f.base, 'GET', undefined],
    [f.base, 'POST', { clientKey: 'other-contract' }],
    [f.base + '/release', 'POST', { reason: 'Không thuộc tôi' }],
  ] as const) {
    assert.equal((await f.call(path, c.emp, method, body)).status, 404);
  }
  assert.equal((await f.call(f.base, c.mgr)).status, 200);
  assert.equal(
    (
      await f.db
        .select()
        .from(orderStockHolds)
        .where(eq(orderStockHolds.orderId, f.contract.orderId))
    ).length,
    0,
  );
});

test('Tra tồn tách giữ theo kho / chưa gắn kho, không lộ giữ của kho riêng, không cộng vào tồn vật lý hoặc hàng đang về', async () => {
  const f = await setup(),
    c = f.cookies;
  ok(await f.approve());
  ok(
    await f.call(f.base, c.emp, 'POST', { clientKey: 'lookup-contract' }),
    201,
  );
  const quote = ok(
    await f.call('/quotes', c.emp, 'POST', {
      type: 'B2B',
      quoteNo: 'LOOKUP-SHARED',
      customer: 'Khách giữ chung',
      vat: 8,
      rows: [{ sku, name: 'Bộ trà', unit: 'Bộ', qty: 2, price: 2000 }],
    }),
    201,
  );
  ok(
    await f.call(`/quotes/${quote.id}/approve`, c.mgr, 'POST', { revision: 1 }),
  );
  ok(await f.call(`/quotes/${quote.id}/hold`, c.emp, 'POST', {}), 201);
  const product = (cookie: string) =>
    f
      .call('/inventory/lookup?q=' + sku, cookie)
      .then(ok)
      .then((d) => d.products[0]);
  const full = await product(c.emp);
  assert.equal(full.total, 16);
  assert.equal(full.held.qty, 7);
  assert.equal(full.held.unassigned, 2);
  assert.deepEqual(
    full.held.stock
      .map((s: { warehouseId: string; qty: number }) => [s.warehouseId, s.qty])
      .sort(),
    [
      ['other', 0],
      ['vig', 5],
    ],
  );
  assert.equal(await f.balance(), 6, 'tra tồn không ghi kho');
  assert.ok(full.incoming.qty > 0);
  assert.doesNotMatch(
    JSON.stringify(full.held),
    /Khách|HOLD-|contractNo|price|customer|orderId/,
  );
  await f.db
    .update(warehouses)
    .set({ stockPrivate: true })
    .where(eq(warehouses.id, 'vig'));
  const hidden = await product(c.emp);
  assert.equal(hidden.total, 10);
  assert.equal(
    hidden.held.qty,
    2,
    'giữ 5 tại kho riêng không lộ ra tổng của nhân viên',
  );
  assert.equal(
    hidden.held.stock.some(
      (s: { warehouseId: string }) => s.warehouseId === 'vig',
    ),
    false,
  );
  assert.equal((await product(c.mgr)).held.qty, 7);
});

test('Tra tồn chỉ tính giữ một lần sau khi chuyển báo giá sang HĐKT; huỷ giữ / hết hạn cập nhật về 0', async () => {
  const f = await setup(true),
    c = f.cookies;
  const product = () =>
    f
      .call('/inventory/lookup?q=' + sku, c.mgr)
      .then(ok)
      .then((d) => d.products[0]);
  assert.equal((await product()).held.unassigned, 5);
  ok(await f.approve());
  let p = await product();
  assert.equal(p.held.qty, 5, 'báo giá chuyển sang HĐKT không giữ hai lần');
  assert.equal(p.held.unassigned, 0);
  assert.equal(
    p.held.stock.find((s: { warehouseId: string }) => s.warehouseId === 'vig')
      .qty,
    5,
  );
  ok(
    await f.call(f.base + '/release', c.emp, 'POST', {
      reason: 'Khách đổi lịch',
    }),
  );
  assert.equal((await product()).held.qty, 0);
  ok(await f.call(f.base, c.emp, 'POST', { clientKey: 'lookup-expired' }), 201);
  await f.db
    .update(orderStockHolds)
    .set({ expiresAt: '2020-01-01T00:00:00.000Z' })
    .where(eq(orderStockHolds.orderId, f.contract.orderId));
  p = await product();
  assert.equal(p.held.qty, 0);
  assert.equal(p.total, 16);
});
