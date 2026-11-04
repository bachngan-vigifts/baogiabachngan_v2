import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { deliveries, salesOrders } from '../../src/modules/sales/schema.ts';
import { webStoreOrders } from '../../src/modules/sales/pos-schema.ts';

test('POS board returns scoped carrier snapshots for both websites and each COD shipment', async () => {
  const f = await setup();
  const shift = await f.open();
  const checkout = await f.call(
    '/pos/checkout',
    f.emp,
    'POST',
    f.cart(shift.id),
  );
  assert.equal(checkout.status, 201);
  f.env.ghnFetch = async () => {
    throw new Error('Listing must never contact GHN');
  };
  const [base] = await f.db
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.id, checkout.data.id));
  assert.ok(base);
  await f.db.insert(salesOrders).values([
    {
      ...base,
      id: 'cod-visible',
      orderNo: 'COD-VISIBLE',
      fulfillmentMode: 'cod',
      checkoutKey: null,
    },
    {
      ...base,
      id: 'cod-filtered',
      orderNo: 'COD-FILTERED',
      fulfillmentMode: 'cod',
      checkoutKey: null,
    },
  ]);
  const now = new Date().toISOString();
  await f.db.insert(deliveries).values(
    [
      {
        id: 'shipment1',
        orderId: 'cod-visible',
        carrier: ' GHN ',
        trackingCode: 'COD1',
        trackingStatus: 'delivered',
      },
      {
        id: 'shipment2',
        orderId: 'cod-visible',
        carrier: 'ghn',
        trackingCode: 'COD2',
        trackingStatus: 'cancel',
        status: 'cancelled' as const,
      },
      {
        id: 'not-ghn',
        orderId: 'cod-visible',
        carrier: 'Other',
        trackingCode: 'OTHER',
        trackingStatus: 'delivered',
      },
      {
        id: 'empty',
        orderId: 'cod-visible',
        carrier: 'GHN',
        trackingCode: ' ',
        trackingStatus: '',
      },
      {
        id: 'filtered',
        orderId: 'cod-filtered',
        carrier: 'GHN',
        trackingCode: 'HIDDEN',
        trackingStatus: 'picked',
      },
    ].map((d) => ({
      ...d,
      deliveryNo: d.id,
      plannedDate: base.orderDate,
      createdBy: 'emp',
      createdAt: now,
      updatedAt: now,
    })),
  );
  await f.db.insert(webStoreOrders).values(
    ['lock', 'minhlong'].map((source) => ({
      id: 'shipping-' + source,
      source: source as 'lock' | 'minhlong',
      externalId: '123',
      registerId: f.registerId,
      orderNo: 'WEB-' + source,
      status: 'processing',
      ghnOrderCode: source === 'lock' ? 'LOCK123' : 'ML123',
      ghnStatus: source === 'lock' ? 'delivered' : 'ready_to_pick',
      orderedAt: now,
      updatedAt: now,
    })),
  );
  const board = await f.call(
    `/pos/orders?registerId=${f.registerId}&q=COD-VISIBLE`,
    f.emp,
  );
  assert.equal(board.status, 200);
  assert.equal(board.data.orders.length, 1);
  assert.deepEqual(
    board.data.orders[0].ghnShipments.map(
      (s: { trackingCode: string; trackingStatus: string }) => [
        s.trackingCode,
        s.trackingStatus,
      ],
    ),
    [
      ['COD1', 'delivered'],
      ['COD2', 'cancel'],
    ],
  );
  const web = await f.call(
    `/pos/orders?registerId=${f.registerId}&source=web`,
    f.emp,
  );
  assert.equal(web.status, 200);
  assert.deepEqual(
    web.data.orders
      .map((o: { source: string; ghnOrderCode: string; ghnStatus: string }) => [
        o.source,
        o.ghnOrderCode,
        o.ghnStatus,
      ])
      .sort(),
    [
      ['lock', 'LOCK123', 'delivered'],
      ['minhlong', 'ML123', 'ready_to_pick'],
    ],
  );
  const empty = await f.call(
    `/pos/orders?registerId=${f.registerId}&q=not-an-order`,
    f.emp,
  );
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data.orders, []);
  const other = await f.call('/pos/registers', f.mgr, 'POST', {
    name: 'Quầy khác',
    warehouseId: 'pos-wh',
    pricePolicyId: 'retail-vat',
    secondPricePolicyId: 'retail',
    taxRate: 8,
  });
  assert.equal(other.status, 200);
  assert.equal(
    (await f.call(`/pos/orders?registerId=${other.data.id}`, f.emp)).status,
    403,
  );
});
