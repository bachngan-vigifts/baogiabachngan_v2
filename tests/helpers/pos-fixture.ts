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
import { posShifts, posStockCounts, posPaymentRequests } from '../../src/modules/sales/pos-schema.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { readFileSync } from 'node:fs';
import { memoryFileStore } from '../../src/core/storage/file-store.ts';
import { readdirSync } from 'node:fs';
import type { StaffEnv } from '../../src/modules/staff/api/auth-routes.ts';
const origin = 'https://trial.test';
export async function setup(opts: { viaClaw?: boolean } = {}) {
  const { db, d1, client } = await createTestDb();
  await seedStaff(d1);
  await db.insert(employees).values({
    id: 'cashier2',
    name: 'Cashier 2',
    email: 'cashier2@x.vn',
    role: 'employee',
    positionId: 'sales-lock',
    createdAt: new Date().toISOString(),
  });
  await db
    .insert(credentials)
    .values({ memberId: 'cashier2', passwordHash: await hashPassword(PASSWORD, 1000), version: 0 });
  await db.insert(warehouses).values({ id: 'pos-wh', name: 'Kho POS', kind: 'stock' });
  await db.insert(pricePolicies).values([
    { id: 'retail-vat', name: 'Giá bán lẻ (+ VAT)' },
    { id: 'retail', name: 'Giá bán lẻ' },
  ]);
  await db.insert(products).values({ sku: '00123', name: 'Ly sứ', unit: 'cái', updatedAt: new Date().toISOString() });
  await db.insert(productPrices).values([
    { sku: '00123', policyId: 'retail-vat', price: 108000 },
    { sku: '00123', policyId: 'retail', price: 100000 },
  ]);
  await db
    .insert(productStock)
    .values({ sku: '00123', warehouseId: 'pos-wh', quantity: 1000, updatedAt: new Date().toISOString() });
  await db.transaction((tx) =>
    postMoves(tx, 'mgr', [
      { sku: '00123', warehouseId: 'pos-wh', qty: 10, kind: 'opening', refType: 'opening', refId: 'opening-pos' },
    ]),
  );
  const router = createAppRouter(),
    files = memoryFileStore();
  const hooks: { url: string; body: any }[] = [];
  const sapoWebhookFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    hooks.push({ url: String(input), body: JSON.parse(String(init?.body || '{}')) });
    return Response.json({ success: true, runId: 'pos-run-1' });
  }) as typeof fetch;
  const env: StaffEnv = { db, files, passwordIterations: 1000, sapoOrderPush: 'off', sepayPosApiKeyHash: '8670e3ad137cfc09a44e3316e36267a695abd71e002c4164f5acfe647665befd', wooLockTokenHash: '1c71edfcc47c4d1f168a858fbfe643fe90e9d52c058894f1754c6f4b6c879e20', wooMinhLongTokenHash: '268737b3767d678ff42efe0546f93fd8199c9da722fe1aa12c892483775f4fcd', ...(opts.viaClaw ? { sapoOrderMode: 'n8n' as const, sapoWebhookFetch } : {}) };
  const call = async (path: string, cookie = '', method = 'GET', body?: unknown) => {
    const r = await router.handle(
      new Request(origin + '/api/staff' + path, {
        method,
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
    return {
      status: r.status,
      data: (await r.json()) as any,
      cookie: r.headers.get('set-cookie')?.split(';')[0] || '',
    };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const mgr = await login('mgr@x.vn'),
    emp = await login('emp@x.vn'),
    other = await login('cashier2@x.vn'),
    ncc = await login('ncc@x.vn');
  const made = await call('/pos/registers', mgr, 'POST', {
    name: 'Quầy Lock',
    warehouseId: 'pos-wh',
    pricePolicyId: 'retail-vat',
    secondPricePolicyId: 'retail',
    taxRate: 8,
    bankCode: 'VCB',
    bankAccount: '123456',
    bankAccountName: 'BACH NGAN',
  });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const registerId = made.data.id;
  assert.equal(
    (await call('/cash/config', mgr, 'POST', { openingAmount: 500000, reason: 'Tiền đầu kỳ kiểm thử' })).status,
    200,
  );
  const open = async (cookie = emp, cash = 500000) => {
    const x = await call('/pos/shifts/open', cookie, 'POST', {
      key: crypto.randomUUID(),
      registerId,
      openingCash: (await call('/cash', cookie)).data.nextOpeningCash,
    });
    assert.equal(x.status, 201, JSON.stringify(x.data));
    return x.data;
  };
  const cart = (shiftId: string, extra: Record<string, unknown> = {}) => ({
    key: crypto.randomUUID(),
    registerId,
    shiftId,
    pricePolicyId: 'retail-vat',
    rows: [{ sku: '00123', qty: 2, discountType: 'percent', discountValue: 10 }],
    method: 'cash',
    tendered: 200000,
    ...extra,
  });
  return { db, client, files, hooks, router, env, call, mgr, emp, other, ncc, registerId, open, cart };
}
