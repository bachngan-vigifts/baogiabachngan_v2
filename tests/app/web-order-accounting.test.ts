import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { employees, credentials } from '../../src/modules/staff/schema.ts';
import {
  webStoreOrders as web,
  posRegisters,
} from '../../src/modules/sales/pos-schema.ts';
import {
  salesOrders,
  customerPayments,
  deliveries,
} from '../../src/modules/sales/schema.ts';
import { stockMoves } from '../../src/modules/inventory/schema.ts';
import { tasks } from '../../src/modules/tasks/schema.ts';
import { auditLogs } from '../../src/core/db/schema.ts';
import { readWebAccounting } from '../../src/modules/sales/domain/web-order-accounting.ts';

async function fixture() {
  const f = await setup();
  await f.db
    .insert(employees)
    .values({
      id: 'accountant',
      name: 'Kế toán',
      email: 'accountant@x.vn',
      role: 'employee',
      positionId: 'accounting',
      createdAt: new Date().toISOString(),
    });
  await f.db
    .insert(credentials)
    .values({
      memberId: 'accountant',
      passwordHash: await hashPassword(PASSWORD, 1000),
      version: 0,
    });
  const accountant = (
    await f.call('/login', '', 'POST', {
      email: 'accountant@x.vn',
      password: PASSWORD,
    })
  ).cookie;
  assert.ok(accountant);
  await f.db
    .update(posRegisters)
    .set({ name: 'CỬA HÀNG LOCKNLOCK CẦN THƠ' })
    .where(eq(posRegisters.id, f.registerId));
  const ml = await f.call('/pos/registers', f.mgr, 'POST', {
    name: 'Showroom Minh Long',
    warehouseId: 'pos-wh',
    pricePolicyId: 'retail-vat',
    secondPricePolicyId: 'retail',
  });
  assert.equal(ml.status, 200);
  await f.db
    .insert(web)
    .values(
      ['lock', 'minhlong'].map((source) => ({
        id: source,
        source: source as 'lock' | 'minhlong',
        externalId: source === 'lock' ? '21553' : '8001',
        orderNo: source === 'lock' ? '21553' : '8001',
        customerName: 'Khách thử',
        phone: '0901234567',
        registerId: source === 'lock' ? f.registerId : ml.data.id,
        status: 'processing',
        ghnStatus: 'delivered',
        ghnOrderCode: source.toUpperCase() + '-GHN',
        total: 108000,
        lines: JSON.stringify([
          {
            sku: '00123',
            name: 'Ly sứ',
            quantity: 1,
            subtotal: 100000,
            subtotalTax: 8000,
            total: 100000,
            totalTax: 8000,
          },
        ]),
        stockStatus: 'issued' as const,
        orderedAt: '2026-11-04T00:00:00Z',
        updatedAt: '2026-11-04T00:00:00Z',
      })),
    );
  const path = (id: string) => '/orders/' + encodeURIComponent('web:' + id);
  const detail = async (id = 'lock') => {
    const response = await f.call(path(id), accountant);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  };
  return { ...f, accountant, path, detail };
}

test('Accounting records and corrects invoice numbers on both delivered web stores without another sale, payment or stock movement', async () => {
  const f = await fixture(),
    stock = await f.db.select().from(stockMoves);
  for (const id of ['lock', 'minhlong']) {
    const before = await f.detail(id);
    assert.equal(before.document.canIssueInvoice, true);
    assert.equal(before.canEdit, false);
    const invoice = {
      invoiceNo: 'HD-' + id,
      invoiceDate: '2026-11-04',
      revision: 0,
    };
    const response = await f.call(
      f.path(id) + '/invoice',
      f.accountant,
      'PUT',
      invoice,
    );
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const after = await f.detail(id);
    assert.equal(after.document.invoiceNo, invoice.invoiceNo);
    assert.equal(after.document.invoiceIssuedBy, 'accountant');
    assert.equal(after.document.invoiceStatus, 'issued');
    assert.equal(after.document.accountingRevision, 1);
    assert.deepEqual(after.items, before.items);
    assert.equal(after.document.total, before.document.total);
    assert.equal(after.document.ghnStatus, 'delivered');
    assert.equal(after.document.stockStatus, 'issued');
    const corrected = await f.call(
      f.path(id) + '/invoice',
      f.accountant,
      'PUT',
      { ...invoice, invoiceNo: invoice.invoiceNo + '-sua', revision: 1 },
    );
    assert.equal(corrected.status, 200, JSON.stringify(corrected.data));
    assert.equal(
      (await f.detail(id)).document.invoiceNo,
      invoice.invoiceNo + '-sua',
    );
  }
  const list = await f.call(
    '/orders?flow=order&source=web&invoice=issued',
    f.accountant,
  );
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.total, 2);
  assert.equal(list.data.invoicePending, 0);
  assert.ok(
    list.data.orders.every((o: { invoiceNo: string }) =>
      o.invoiceNo.endsWith('-sua'),
    ),
  );
  assert.deepEqual(await f.db.select().from(stockMoves), stock);
  assert.equal((await f.db.select().from(salesOrders)).length, 0);
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
  assert.equal((await f.db.select().from(deliveries)).length, 0);
});

test('Billing metadata has revisions, audit and safe replay, and WooCommerce resync preserves the entered invoice', async () => {
  const f = await fixture(),
    billing = {
      name: 'Công ty khách hàng',
      taxCode: '1801234567',
      email: 'invoice@example.test',
      address: 'Địa chỉ xuất hoá đơn',
      revision: 0,
    };
  let response = await f.call(
    f.path('lock') + '/web-billing',
    f.accountant,
    'PUT',
    billing,
  );
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const invoice = {
    invoiceNo: '0000123',
    invoiceDate: '2026-11-04',
    revision: 1,
  };
  response = await f.call(
    f.path('lock') + '/invoice',
    f.accountant,
    'PUT',
    invoice,
  );
  assert.equal(response.status, 200);
  const before = await f.db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.entityId, 'lock'));
  const replay = await f.call(
    f.path('lock') + '/invoice',
    f.accountant,
    'PUT',
    invoice,
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.equal(
    (await f.db.select().from(auditLogs).where(eq(auditLogs.entityId, 'lock')))
      .length,
    before.length,
  );
  assert.equal(
    (
      await f.call(f.path('lock') + '/invoice', f.accountant, 'PUT', {
        ...invoice,
        invoiceNo: 'other',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call(f.path('lock') + '/web-billing', f.accountant, 'PUT', {
        ...billing,
        taxCode: 'changed',
      })
    ).status,
    409,
  );
  const sync = await f.call(
    '/integrations/woocommerce/lock/order?token=test-lock-token',
    '',
    'POST',
    {
      id: 21553,
      number: '21553',
      status: 'processing',
      total: '108000',
      currency: 'VND',
      billing: { first_name: 'Khách web mới', phone: '0901234567' },
      line_items: [
        { sku: '00123', quantity: 1, total: '100000', total_tax: '8000' },
      ],
    },
  );
  assert.equal(sync.status, 200, JSON.stringify(sync.data));
  const after = await f.detail();
  assert.equal(after.document.invoiceNo, '0000123');
  assert.equal(after.document.billing.taxCode, billing.taxCode);
  const row = (await f.db.select().from(web).where(eq(web.id, 'lock')))[0]!;
  assert.equal(readWebAccounting(row.crmEditSnapshot).revision, 2);
});

test('Invoice entry validates data and order scope, and rejects cancelled orders with no writes', async () => {
  const f = await fixture(),
    input = { invoiceNo: 'HD-1', invoiceDate: '2026-11-04', revision: 0 };
  for (const invalid of [
    { invoiceNo: '' },
    { invoiceNo: 'x'.repeat(201) },
    { invoiceDate: '2026-02-30' },
  ])
    assert.equal(
      (
        await f.call(f.path('lock') + '/invoice', f.accountant, 'PUT', {
          ...input,
          ...invalid,
        })
      ).status,
      400,
    );
  assert.equal(
    (await f.call(f.path('minhlong') + '/invoice', f.emp, 'PUT', input)).status,
    404,
  );
  assert.equal(
    (await f.call(f.path('missing') + '/invoice', f.accountant, 'PUT', input))
      .status,
    404,
  );
  await f.db.update(web).set({ status: 'refunded' }).where(eq(web.id, 'lock'));
  assert.equal(
    (await f.call(f.path('lock') + '/invoice', f.accountant, 'PUT', input))
      .status,
    409,
  );
  assert.equal(
    (await f.db.select().from(web).where(eq(web.id, 'lock')))[0]!
      .crmEditSnapshot,
    '{}',
  );
});

test('Audit failure rolls back invoice metadata, then the same request can succeed', async () => {
  const f = await fixture(),
    input = { invoiceNo: 'ROLLBACK', invoiceDate: '2026-11-04', revision: 0 };
  await f.db.execute(
    sql`create function reject_web_invoice_audit() returns trigger language plpgsql as $$ begin if NEW.action='web-order-invoice' then raise exception 'injected audit failure'; end if; return NEW; end $$`,
  );
  await f.db.execute(
    sql`create trigger reject_web_invoice_audit before insert on audit_logs for each row execute function reject_web_invoice_audit()`,
  );
  assert.equal(
    (await f.call(f.path('lock') + '/invoice', f.accountant, 'PUT', input))
      .status,
    500,
  );
  assert.equal(
    (await f.db.select().from(web).where(eq(web.id, 'lock')))[0]!
      .crmEditSnapshot,
    '{}',
  );
  await f.db.execute(sql`drop trigger reject_web_invoice_audit on audit_logs`);
  assert.equal(
    (await f.call(f.path('lock') + '/invoice', f.accountant, 'PUT', input))
      .status,
    200,
  );
});

test('Manual invoice requests create one task and saving its invoice closes it; an invoiced cart cannot be repriced', async () => {
  const f = await fixture();
  await f.db
    .update(web)
    .set({
      status: 'processing',
      ghnStatus: '',
      ghnOrderCode: '',
      stockStatus: 'none',
    })
    .where(eq(web.id, 'lock'));
  const request = await f.call(
    f.path('lock') + '/invoice-request',
    f.accountant,
    'POST',
    {
      email: 'billing@example.test',
      mode: 'draft',
      note: 'Kiểm tra thông tin khách',
      revision: 0,
    },
  );
  assert.equal(request.status, 200, JSON.stringify(request.data));
  let jobs = await f.db
    .select()
    .from(tasks)
    .where(eq(tasks.autoKey, 'invoice-web:lock'));
  assert.equal(jobs.length, 1);
  assert.notEqual(jobs[0]!.status, 'done');
  assert.match(jobs[0]!.description!, /billing@example.test/);
  const issued = await f.call(
    f.path('lock') + '/invoice',
    f.accountant,
    'PUT',
    { invoiceNo: 'FINISH', invoiceDate: '2026-11-04', revision: 1 },
  );
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  jobs = await f.db
    .select()
    .from(tasks)
    .where(eq(tasks.autoKey, 'invoice-web:lock'));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.status, 'done');
  const list = await f.call(
    '/orders?invoice=requested&source=web',
    f.accountant,
  );
  assert.equal(
    list.data.orders.some(
      (o: { webOrderId: string }) => o.webOrderId === 'lock',
    ),
    false,
  );
  const preview = await f.call(f.path('lock') + '/web/preview', f.mgr, 'POST', {
    lines: [],
  });
  assert.equal(preview.status, 409);
});

test('Two different simultaneous invoice writes cannot overwrite each other at the same revision', async () => {
  const f = await fixture();
  const put = (invoiceNo: string) =>
    f.call(f.path('lock') + '/invoice', f.accountant, 'PUT', {
      invoiceNo,
      invoiceDate: '2026-11-04',
      revision: 0,
    });
  const responses = await Promise.all([put('FIRST'), put('SECOND')]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await f.detail()).document.accountingRevision, 1);
  assert.equal(
    (
      await f.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'web-order-invoice'))
    ).length,
    1,
  );
});
