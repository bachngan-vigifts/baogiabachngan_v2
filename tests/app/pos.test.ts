import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, warehouses, pricePolicies, productPrices, productStock } from '../../src/modules/catalog/schema.ts';
import { employees, credentials } from '../../src/modules/staff/schema.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
import { stockBalances, stockMoves } from '../../src/modules/inventory/schema.ts';
import {
  salesOrders,
  salesOrderLines,
  customerPayments,
  deliveries,
  packingSlips,
  packingSlipLines,
} from '../../src/modules/sales/schema.ts';
import { posRegisters, posShifts, posStockCounts, posPaymentRequests } from '../../src/modules/sales/pos-schema.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { readFileSync } from 'node:fs';
import { memoryFileStore } from '../../src/core/storage/file-store.ts';
import { readdirSync } from 'node:fs';
const origin = 'https://trial.test';
import { setup } from '../helpers/pos-fixture.ts';
import { auditLogs } from '../../src/core/db/schema.ts';
test('POS mở ca không cần kiểm đếm; không ghi số đếm giả, giữ lịch sử cũ', async () => {
  const f = await setup();
  const opened = await f.call('/pos/shifts/open', f.emp, 'POST', {
    key: crypto.randomUUID(), registerId: f.registerId, openingCash: 500000,
  });
  assert.equal(opened.status, 201, JSON.stringify(opened.data));
  assert.equal((await f.db.select().from(posStockCounts)).length, 0);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10);
  assert.equal((await f.call('/pos/options', f.emp)).data.shifts[0].memberName, 'Tên emp');
  assert.equal((await f.call('/pos/shifts/' + opened.data.id, f.emp)).data.openingCount, null);
  const audit = await f.db.select().from(auditLogs).where(eq(auditLogs.entityId, opened.data.id));
  assert.ok(!audit.some(x => JSON.parse(x.data || '{}').openingCount));
  await f.db.insert(posStockCounts).values({ shiftId: opened.data.id, sku: '00123', systemQty: 10, countedQty: 7, note: 'Lịch sử cũ' });
  assert.equal((await f.call('/pos/shifts/' + opened.data.id, f.emp)).data.openingCount.count, 1);
  assert.equal((await f.call('/cash/shifts/' + opened.data.id + '/close', f.emp, 'POST', { countedCash: 500000 })).status, 200);
  const next = await f.call('/pos/shifts/open', f.emp, 'POST', {
    key: crypto.randomUUID(), registerId: f.registerId, openingCash: 500000,
    counts: [null, { sku: '00123', countedQty: '' }],
  });
  assert.equal(next.status, 201, JSON.stringify(next.data));
  assert.equal((await f.db.select().from(posStockCounts)).length, 1);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10);
  assert.equal((await f.call('/pos/shifts/' + next.data.id, f.emp)).data.openingCount, null);
});
test('POS giữ chính sách khách mới dùng ngay nhưng khách chờ duyệt sẵn có vẫn không được dùng', async () => {
  const f = await setup(), s = await f.open();
  const made = await f.call('/pos/customers', f.emp, 'POST', { name: 'Khách chờ duyệt', phone: '0901234567' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  await f.db.update(customers).set({ approvalStatus: 'pending' }).where(eq(customers.id, made.data.id));
  const preview = await f.call('/pos/preview', f.emp, 'POST', f.cart(s.id, { customerId: made.data.id }));
  assert.equal(preview.status, 400, JSON.stringify(preview.data));
  const checkout = await f.call('/pos/checkout', f.emp, 'POST', f.cart(s.id, { customerId: made.data.id }));
  assert.equal(checkout.status, 400, JSON.stringify(checkout.data));
  assert.equal((await f.db.select().from(salesOrders)).length, 0);
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10);
});
test('POS options trả quầy mặc định theo chức vụ và giữ ca hiện có', async () => {
  const { db, call, emp, other, mgr, registerId, open } = await setup();
  await db.update(posRegisters).set({ name: 'Quầy Lock' }).where(eq(posRegisters.id, registerId));
  const ml = await call('/pos/registers', mgr, 'POST', {
    name: 'Quầy Minh Long',
    warehouseId: 'pos-wh',
    pricePolicyId: 'retail-vat',
    secondPricePolicyId: 'retail',
  });
  assert.equal(ml.status, 200, JSON.stringify(ml.data));
  const lockOptions = await call('/pos/options', other);
  assert.equal(lockOptions.status, 200);
  assert.equal(lockOptions.data.defaultRegisterId, registerId);
  const shift = await open();
  await db.update(employees).set({ positionId: 'sales-ml' }).where(eq(employees.id, 'emp'));
  const mlOptions = await call('/pos/options', emp);
  assert.equal(mlOptions.status, 200);
  assert.equal(mlOptions.data.defaultRegisterId, ml.data.id);
  assert.equal(mlOptions.data.current.id, shift.id);
  assert.equal(mlOptions.data.current.registerId, registerId);
});
test('POS: bill tạm và QR chỉ yêu cầu, không tạo đơn/ghi thu/trừ tồn; giá do server tính', async () => {
  const { db, call, emp, open, cart } = await setup(),
    s = await open(),
    b = cart(s.id);
  const preview = await call('/pos/preview', emp, 'POST', {
    ...b,
    total: 1,
    rows: [{ ...b.rows[0], price: 1 }],
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.total, 194400);
  assert.equal(preview.data.temporary, true);
  assert.equal(preview.data.orderNo, undefined);
  const qr = await call('/pos/qr', emp, 'POST', b);
  assert.equal(qr.status, 200, JSON.stringify(qr.data));
  assert.match(qr.data.url, /amount=194400/);
  assert.equal((await db.select().from(salesOrders)).length, 0);
  assert.equal((await db.select().from(customerPayments)).length, 0);
  assert.equal((await db.select().from(stockMoves)).length, 1);
  assert.equal((await db.select().from(stockBalances))[0]!.qty, 10);
  const noConfirm = await call('/pos/checkout', emp, 'POST', {
    ...b,
    method: 'transfer',
    paymentRequestId: qr.data.id,
  });
  assert.equal(noConfirm.status, 400);
  const paid = await call('/pos/checkout', emp, 'POST', {
    ...b,
    method: 'transfer',
    confirmed: true,
    paymentRequestId: qr.data.id,
  });
  assert.equal(paid.status, 201, JSON.stringify(paid.data));
  assert.equal((await db.select().from(customerPayments))[0]!.paymentSource, 'vietqr');
});
test('POS: checkout idempotent, đúng tiền thối và snapshot; chọn giá không VAT; trừ tồn dùng chung CRM', async () => {
  const { db, call, emp, open, cart } = await setup(),
    s = await open(),
    b = cart(s.id);
  const [a, c] = await Promise.all([call('/pos/checkout', emp, 'POST', b), call('/pos/checkout', emp, 'POST', b)]);
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(a.data.id, c.data.id);
  assert.equal(a.data.change, 5600);
  assert.equal((await db.select().from(customerPayments)).length, 1);
  assert.equal((await db.select().from(stockBalances))[0]!.qty, 8);
  const product = await call('/products/00123', emp);
  assert.equal(product.data.product.stock['pos-wh'], 8);
  const base = await call(
    '/pos/preview',
    emp,
    'POST',
    cart(s.id, { pricePolicyId: 'retail', rows: [{ sku: '00123', qty: 1 }] }),
  );
  assert.equal(base.data.total, 100000);
  assert.equal(base.data.tax, 0);
  const changed = await call('/pos/checkout', emp, 'POST', {
    ...b,
    rows: [{ sku: '00123', qty: 3 }],
  });
  assert.equal(changed.status, 409);
  assert.equal((await call('/pos/bills/' + a.data.id, emp)).status, 200);
});
test('POS production: checkout gửi đúng số đơn, chi nhánh và nhân viên qua n8n/Claw; replay không gửi lại', async () => {
  const f = await setup({ viaClaw: true }), s = await f.open(), b = f.cart(s.id);
  const made = await f.call('/pos/checkout', f.emp, 'POST', b);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.sapo.status, 'updating');
  assert.equal(f.hooks.length, 1);
  const hook = f.hooks[0]!;
  assert.match(hook.url, /crm-pos-order-from-web-to-claw$/);
  assert.equal(hook.body.event, 'crm_pos_create_sapo_order');
  assert.equal(hook.body.order_no, made.data.orderNo);
  assert.equal(hook.body.external_reference, made.data.orderNo);
  assert.equal(hook.body.idempotency_key, `pos:${made.data.orderNo}`);
  assert.deepEqual([hook.body.branch.name, hook.body.branch.warehouse_name], ['Quầy POS', 'Kho POS']);
  assert.deepEqual([hook.body.responsible, hook.body.responsible_email], ['Tên emp', 'emp@x.vn']);
  assert.equal(hook.body.items[0].sku, '00123');
  const replay = await f.call('/pos/checkout', f.emp, 'POST', b);
  assert.equal(replay.status, 201);
  assert.equal(f.hooks.length, 1);
});
test('POS SePay: đúng mã, tài khoản và số tiền thì tự xác nhận QR; sai tiền không ghi nhận', async () => {
  const f = await setup(), s = await f.open(), b = f.cart(s.id), qr = await f.call('/pos/qr', f.emp, 'POST', b);
  assert.equal(qr.status, 200, JSON.stringify(qr.data));
  const webhook = async (amount: number) => {
    const r = await f.router.handle(new Request(origin + '/api/staff/integrations/sepay/pos-payment', {
      method: 'POST', headers: { origin, 'content-type': 'application/json', authorization: 'Apikey test-sepay-key' },
      body: JSON.stringify({ id: 92704, transferType: 'in', transferAmount: amount, accountNumber: '123456', code: qr.data.content, content: qr.data.content + ' thanh toan' }),
    }), f.env);
    return { status: r.status, data: await r.json() as any };
  };
  assert.equal((await webhook(qr.data.amount - 1)).status, 409);
  assert.equal((await f.call(`/pos/qr/${qr.data.id}/status`, f.emp)).data.paid, false);
  const paid = await webhook(qr.data.amount);
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal((await f.call(`/pos/qr/${qr.data.id}/status`, f.emp)).data.paid, true);
  const checkout = await f.call('/pos/checkout', f.emp, 'POST', { ...b, method: 'transfer', confirmed: true, paymentRequestId: qr.data.id });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.data));
  const status = await f.call(`/pos/qr/${qr.data.id}/status`, f.emp);
  assert.equal(status.data.consumed, true);
  assert.equal(status.data.order.orderNo, checkout.data.orderNo);
  assert.equal((await webhook(qr.data.amount)).status, 200, 'SePay retry phải idempotent');
});
test('POS: kiểm quyền và ca, không xem ca/bill người khác; khách POS dùng ngay; mã vạch không mất số 0', async () => {
  const { db, call, emp, mgr, other, ncc, registerId, open, cart } = await setup();
  assert.equal((await call('/pos/options', ncc)).status, 403);
  assert.equal((await call('/pos/registers', emp, 'POST', {})).status, 403);
  assert.equal((await call('/pos/checkout', emp, 'POST', cart('not-open'))).status, 404);
  const s = await open();
  assert.equal((await call('/pos/shifts/' + s.id, other)).status, 404);
  assert.equal((await call('/pos/shifts/' + s.id, mgr)).status, 200);
  assert.equal(
    (
      await call('/pos/shifts/open', emp, 'POST', {
        key: crypto.randomUUID(),
        registerId,
        openingCash: 0,
        counts: [],
      })
    ).status,
    409,
  );
  const customer = await call('/pos/customers', emp, 'POST', {
    name: 'Khách mới',
    phone: '0901234567',
  });
  assert.equal(customer.status, 201, JSON.stringify(customer.data));
  assert.equal(
    (await db.select().from(customers).where(eq(customers.id, customer.data.id)))[0]!.approvalStatus,
    'approved',
  );
  assert.equal(
    (
      await call('/pos/barcodes', mgr, 'POST', {
        sku: '00123',
        barcode: '000008888',
      })
    ).status,
    200,
  );
  const found = await call('/pos/catalog?registerId=' + registerId + '&q=000008888', emp);
  assert.equal(found.data.products[0].sku, '00123');
  assert.equal(found.data.products[0].available, 10);
  const bill = await call('/pos/checkout', emp, 'POST', cart(s.id, { customerId: customer.data.id }));
  assert.equal((await call('/pos/bills/' + bill.data.id, other)).status, 404);
});
test('POS: thiếu tồn và CK vượt mức bị từ chối; không ghi một phần khi thất bại', async () => {
  const { db, call, emp, open, cart } = await setup(),
    s = await open();
  for (const rows of [
    [{ sku: '00123', qty: 11 }],
    [{ sku: '00123', qty: 1, discountType: 'percent', discountValue: 101 }],
    [{ sku: '00123', qty: 1, discountType: 'amount', discountValue: 108001 }],
  ]) {
    const r = await call('/pos/checkout', emp, 'POST', cart(s.id, { rows, tendered: 99999999 }));
    assert.ok([400, 409].includes(r.status), JSON.stringify(r.data));
  }
  assert.equal((await db.select().from(salesOrders)).length, 0);
  assert.equal((await db.select().from(customerPayments)).length, 0);
  assert.equal((await db.select().from(stockBalances))[0]!.qty, 10);
});
test('POS: lệch tiền mặt khác 0 phải có lý do; kết ca idempotent và snapshot không đổi', async () => {
  const { db, call, emp, other, open, cart } = await setup(),
    s = await open();
  const bill = await call('/pos/checkout', emp, 'POST', cart(s.id));
  assert.equal(bill.status, 201);
  const report = await call('/pos/shifts/' + s.id, emp);
  assert.equal(report.data.expectedCash, 694400);
  assert.equal(
    (
      await call('/pos/shifts/' + s.id + '/close', emp, 'POST', {
        countedCash: 694399,
      })
    ).status,
    400,
  );
  const [a, b] = await Promise.all([
    call('/pos/shifts/' + s.id + '/close', emp, 'POST', {
      countedCash: 694399,
      reasonCode: 'other',
      reasonNote: 'Thiếu 1 đồng',
    }),
    call('/pos/shifts/' + s.id + '/close', emp, 'POST', {
      countedCash: 694399,
      reasonCode: 'other',
      reasonNote: 'Thiếu 1 đồng',
    }),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(b.status, 200, JSON.stringify(b.data));
  assert.equal(a.data.shift.closedAt, b.data.shift.closedAt);
  assert.equal(a.data.cashDifference, -1);
  assert.equal((await db.select().from(posShifts)).filter((x) => x.closedAt).length, 1);
  assert.equal((await call('/pos/shifts/' + s.id, other)).status, 404);
  assert.equal((await call('/pos/checkout', emp, 'POST', cart(s.id))).status, 409);
  const receipt = (await db.select().from(customerPayments))[0]!;
  assert.equal(
    (
      await call('/payments/' + receipt.id + '/void', emp, 'POST', {
        reason: 'Lý do thử',
      })
    ).status,
    403,
  );
  const next = await open(emp, 0);
  assert.notEqual(next.id, s.id);
  assert.equal((await call('/pos/shifts/' + s.id, emp)).data.cashDifference, -1);
});
test('POS: COD chưa thu không vào két, được kết ca; thu ca sau chỉ ghi một lần vào ca hiện tại', async () => {
  const { db, call, emp, mgr, other, open, cart } = await setup(),
    s = await open();
  const order = await call(
    '/pos/checkout',
    emp,
    'POST',
    cart(s.id, {
      fulfillmentMode: 'cod',
      delivery: {
        address: '123 Test',
        plannedDate: '2026-10-18',
        receiverName: 'Khách',
        receiverPhone: '0901234567',
      },
    }),
  );
  assert.equal(order.status, 201, JSON.stringify(order.data));
  const [delivery] = await db.select().from(deliveries);
  assert.ok(delivery);
  assert.equal(
    (
      await call('/pos/cod/' + delivery.id + '/collect', emp, 'POST', {
        shiftId: s.id,
        key: crypto.randomUUID(),
        method: 'cash',
        confirmed: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call('/deliveries/' + delivery.id + '/status', mgr, 'PUT', {
        status: 'delivered',
      })
    ).status,
    200,
  );
  assert.equal((await db.select().from(stockBalances))[0]!.qty, 8);
  const report = await call('/pos/shifts/' + s.id, emp);
  assert.equal(report.data.cash, 0);
  assert.equal(report.data.expectedCash, 500000);
  assert.equal(report.data.cod.pending.count, 1);
  assert.equal(report.data.cod.pending.amount, 194400);
  const closed = await call('/pos/shifts/' + s.id + '/close', emp, 'POST', {
    countedCash: 500000,
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.data));
  const next = await open(other, 0),
    b = {
      shiftId: next.id,
      key: crypto.randomUUID(),
      method: 'cash',
      confirmed: true,
    };
  const [a, r] = await Promise.all([
    call('/pos/cod/' + delivery.id + '/collect', other, 'POST', b),
    call('/pos/cod/' + delivery.id + '/collect', other, 'POST', b),
  ]);
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(a.data.id, r.data.id);
  const current = await call('/pos/shifts/' + next.id, other);
  assert.equal(current.data.cash, 194400);
  assert.equal(current.data.cod.pending.count, 0);
  assert.equal((await call('/pos/shifts/' + s.id, emp)).data.cod.pending.count, 1, 'báo cáo ca cũ giữ nguyên');
  assert.equal((await db.select().from(customerPayments)).length, 1);
});
test('POS: bảng mới bật RLS và revoke truy cập trực tiếp', async () => {
  const { client } = await setup();
  await client.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  const file = readdirSync('migrations/postgres').find((x) => x.endsWith('_supabase_access_pos.sql'))!;
  await client.exec(readFileSync('migrations/postgres/' + file, 'utf8'));
  const { rows } = await client.query<{
    relname: string;
    relrowsecurity: boolean;
    anon_select: boolean;
  }>(
    "select c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') as anon_select from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('pos_registers','pos_shifts','pos_shift_templates','pos_shift_stock_counts','pos_payment_requests','product_barcodes')",
  );
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.relrowsecurity && !r.anon_select));
});
test('POS: không chốt lại tồn Sapo đè lên hàng đã bán; giảm 100% vẫn xuất hàng nhưng không tạo thu 0 đồng', async () => {
  const { db, call, emp, mgr, open, cart } = await setup(),
    s = await open();
  const b = await call(
    '/pos/checkout',
    emp,
    'POST',
    cart(s.id, {
      rows: [{ sku: '00123', qty: 1, discountType: 'percent', discountValue: 100 }],
      tendered: 0,
    }),
  );
  assert.equal(b.status, 201, JSON.stringify(b.data));
  assert.equal(b.data.total, 0);
  assert.equal((await db.select().from(customerPayments)).length, 0);
  const reset = await call('/inventory/opening', mgr, 'POST', {
    confirm: true,
  });
  assert.equal(reset.status, 409, JSON.stringify(reset.data));
  assert.equal((await db.select().from(stockBalances))[0]!.qty, 9);
});
test('POS: COD đóng gói rồi giao chỉ trừ kho một lần; chuyển khoản COD không cộng tiền két', async () => {
  const { db, call, emp, mgr, open, cart } = await setup(),
    s = await open();
  const order = await call(
    '/pos/checkout',
    emp,
    'POST',
    cart(s.id, {
      fulfillmentMode: 'cod',
      delivery: {
        address: '123 Test',
        receiverName: 'Khách',
        receiverPhone: '0901234567',
      },
    }),
  );
  assert.equal(order.status, 201, JSON.stringify(order.data));
  const [line] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.data.id));
  const [delivery] = await db.select().from(deliveries);
  assert.ok(line && delivery);
  const now = new Date().toISOString(),
    slipId = crypto.randomUUID();
  await db.insert(packingSlips).values({
    id: slipId,
    orderId: order.data.id,
    slipNo: 'DG_POS_TEST',
    source: 'warehouse',
    status: 'sent',
    createdBy: 'emp',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(packingSlipLines).values({
    id: crypto.randomUUID(),
    slipId,
    orderLineId: line.id,
    sku: line.sku,
    name: line.name,
    unit: line.unit,
    qty: line.qty,
  });
  const photo = 'data:image/jpeg;base64,' + Buffer.from('anh-dong-goi').toString('base64');
  const packed = await call('/packing/' + slipId + '/confirm', mgr, 'POST', {
    warehouseId: 'pos-wh',
    photos: [photo],
  });
  assert.equal(packed.status, 200, JSON.stringify(packed.data));
  assert.equal((await db.select().from(stockBalances))[0]!.qty, 8);
  const done = await call('/deliveries/' + delivery.id + '/status', mgr, 'PUT', { status: 'delivered' });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal((await db.select().from(stockBalances))[0]!.qty, 8);
  const collected = await call('/pos/cod/' + delivery.id + '/collect', emp, 'POST', {
    shiftId: s.id,
    key: crypto.randomUUID(),
    method: 'transfer',
    confirmed: true,
  });
  assert.equal(collected.status, 201, JSON.stringify(collected.data));
  const report = (await call('/pos/shifts/' + s.id, emp)).data;
  assert.equal(report.cash, 0);
  assert.equal(report.transfer, 194400);
  assert.equal(report.expectedCash, 500000);
  assert.equal(report.cod.receivedInShift.amount, 194400);
  assert.equal(report.cod.pending.count, 0);
});
