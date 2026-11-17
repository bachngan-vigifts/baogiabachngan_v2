import {registerSubmissionReview} from '../../src/modules/sales/api/submission-review.ts';
import {registerProductionFiles,bindProductionFiles} from '../../src/modules/sales/api/production-files.ts';
import {registerQuoteDesignImages,checkDesignKeys,withDesignImages} from '../../src/modules/quotes/api/design-images.ts';
import { pendingGhnEdit, assertNoPendingGhnEdit } from '../../src/modules/sales/domain/pos-ghn-edit.ts';
import { posOrderStoreScope } from '../../src/modules/sales/api/pos-access.ts';
import assert from 'node:assert/strict';
import { seesAllAsSaleAdmin } from '../../src/modules/staff/domain/roles.ts';
import { test } from 'node:test';
import { canApprove, can } from '../../src/modules/staff/domain/permissions.ts';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { quotationPredicate } from '../../src/modules/quotes/api/department-access.ts';
import {quoteEditState,registerQuoteEditRequests} from '../../src/modules/quotes/api/edit-requests.ts';
import { departmentOwner } from '../../src/modules/staff/api/department.ts';
import { amendmentLines, amendmentSchedules } from '../../src/modules/sales/domain/amendments.ts';

const line = (id: string, lineNo: number, sku: string, qty = 10) =>
  ({ id, lineNo, sku, name: sku, unit: 'cái', qty, unitPrice: 100, taxRate: 8, amount: qty * 100, deliveredQty: 0 });
test('reorder and price change preserve IDs referenced by deliveries and packing', () => {
  const a = line('a', 1, 'A'), b = line('b', 2, 'B');
  const plan = amendmentLines([a, b], [{ ...b, lineNo: 1 }, { ...a, lineNo: 2, unitPrice: 200 }], new Map(), new Set(['a']));
  assert.deepEqual(plan.updates.map(l => l.id), ['b', 'a']);
  assert.ok(plan.updates[1]);
  assert.equal(plan.updates[1].unitPrice, 200);
  assert.equal(plan.remove.length, 0);
});
test('quantity cannot fall below delivered or reserved quantities', () => {
  const a = { ...line('a', 1, 'A'), deliveredQty: 4 };
  assert.throws(() => amendmentLines([a], [{ ...a, qty: 3 }], new Map(), new Set()), /số đã giao/);
  assert.throws(() => amendmentLines([a], [{ ...a, qty: 7 }], new Map([['a', 8]]), new Set()), /lên lịch/);
  const increased = amendmentLines([a], [{ ...a, qty: 12 }], new Map([['a', 8]]), new Set()).updates[0];
  assert.ok(increased);
  assert.equal(increased.deliveredQty, 4);
});
test('referenced product cannot disappear; unreferenced product can be replaced', () => {
  const a = line('a', 1, 'A');
  assert.throws(() => amendmentLines([a], [line('b', 1, 'B')], new Map(), new Set(['a'])), /chứng từ/);
  const plan = amendmentLines([a], [line('b', 1, 'B')], new Map(), new Set());
  assert.ok(plan.updates[0]);
  assert.equal(plan.updates[0].id, null);
  assert.ok(plan.remove[0]);
  assert.equal(plan.remove[0].id, 'a');
});
test('paid schedule IDs stay stable without duplicating receivables', () => {
  const schedules = [
    { id: 'deposit', kind: 'deposit' as const, amount: 300, dueDate: '2026-10-09', note: '' },
    { id: 'balance', kind: 'balance' as const, amount: 700, dueDate: null, note: '' },
  ];
  const plan = amendmentSchedules(schedules, [
    { kind: 'deposit', amount: 400, dueDate: '2026-10-10', note: '' },
    { kind: 'balance', amount: 1600, dueDate: null, note: '' },
  ], new Set(['deposit']));
  assert.deepEqual(plan.updates.map(s => s.id), ['deposit', 'balance']);
  assert.equal(plan.updates.reduce((sum, s) => sum + s.amount, 0), 2000);
  const zero = amendmentSchedules(schedules, [{ kind: 'balance', amount: 1000, dueDate: null, note: '' }], new Set(['deposit']));
  assert.equal(zero.updates.find(s => s.id === 'deposit')?.amount, 0);
  assert.equal(zero.updates.reduce((sum, s) => sum + s.amount, 0), 1000);
  assert.deepEqual(zero.remove, []);
});

// Exercise the actual contract handler without network or a database dependency.
const routeSource = readFileSync(new URL('../../src/modules/sales/api/routes.ts', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
function handler(body: any, role = 'manager', orderStatus = 'confirmed', path = 'put/contracts/:id') {
  const handlers = new Map<string, any>(), updates: any[] = [], inserts: any[] = [];
  const contract = { data:'{}', id: 'k', orderId: 'o', revision: 2, status: 'signed', value: 1000, depositRate: 30, depositAmount: 300, paymentDays: 5, signedDate: '2026-10-09' };
  const order = { id: 'o', status: orderStatus, total: 1000 };
  const rows = [[path.includes('/orders/') ? order : { order }], [contract], [], [], []];
  const query = (result: any) => {
    const q: any = { then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject) };
    for (const method of ['from', 'where', 'innerJoin', 'limit', 'for', 'orderBy']) q[method] = () => q;
    return q;
  };
  const db: any = {
    transaction: (fn: any) => fn(db),
    select: () => query(rows.shift() || []),
    update: () => ({ set: (data: any) => { updates.push(data); return { where: () => ({ returning: async () => [{ ...contract, ...data }] }) }; } }),
    insert: () => ({ values: async (data: any) => { inserts.push(data); } }),
  };
  const table = new Proxy({}, { get: (_, key) => String(key) });
  const ctx: any = {
    // This VM isolates contract handlers; return and order-product APIs have real-router integration tests.
    registerSubmissionReview, registerProductionFiles, bindProductionFiles, registerCrmReturnRoutes: () => {}, registerContractTemplateRoutes: () => {}, registerContractLiquidationRoutes: () => {}, registerCashCollectionRoutes: () => {}, registerWebOrderEdits: () => {}, registerOrderProductsRoutes: () => {}, pendingGhnEdit, assertNoPendingGhnEdit,
    departmentOwner, quotationPredicate, seesAllAsSaleAdmin, canApprove, can, posOrderStoreScope, isNotNull: () => null, isNull: () => null, quoteSaveHooks: { beforeSave: [], afterSave: [] },
    customerStaff: table, salesOrders: table, salesContracts: table, paymentSchedules: table, customerPayments: table, deliveries: table,
    or: () => null, eq: () => null, and: () => null, desc: () => null, sql: () => null,
    CONTRACT_STATUSES: ['draft', 'signed', 'completed', 'cancelled'],
    readJson: async () => body, json: (v: any) => v, amendmentSchedules,
    contractSchedules: (total: number, rate: number, date: string) => [
      { kind: 'deposit', amount: total * rate / 100, dueDate: date, note: '' },
      { kind: 'balance', amount: total * (100 - rate) / 100, dueDate: null, note: '' },
    ],
    AppError: class extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } },
    crypto: { randomUUID: () => 'new-id' },
  };
  runInNewContext(stripTypeScriptTypes(routeSource) + '\nthis.register = registerSalesRoutes;', ctx);
  const router: any = {};
  for (const method of ['get', 'post', 'put', 'delete']) router[method] = (path: string, fn: any) => handlers.set(method + path, fn);
  ctx.register(router);
  const call = () => handlers.get(path)({ req: {}, params: { id: 'k' }, env: { db }, state: { session: { member: { id: 'm', role } } } });
  return { call, updates, inserts };
}
test('employee cannot change any part of an approved contract, including Word edits', async () => {
  const h = handler({ details: { edits: {} } }, 'employee');
  await assert.rejects(h.call(), (e: any) => e.status === 403);
  assert.equal(h.updates.length, 0);
});
test('manager changes signed contract financial fields and updates receivable schedules', async () => {
  const h = handler({ revision: 2, depositRate: 40, paymentDays: 7 });
  await h.call();
  assert.equal(h.updates[0].depositAmount, 400);
  assert.equal(h.updates[0].paymentDays, 7);
  assert.equal(h.updates[0].revision, 3);
  assert.equal(h.inserts.reduce((sum, s) => sum + s.amount, 0), 1000);
});
test('stale revision and invalid financial terms cannot change a contract', async () => {
  for (const body of [{ revision: 1 }, { depositRate: 101 }, { paymentDays: 1.5 }]) {
    const h = handler(body);
    await assert.rejects(h.call(), (e: any) => [400, 409].includes(e.status));
    assert.equal(h.updates.length, 0);
  }
});

test('employee cannot cancel an approved order', async () => {
  const h = handler({ status: 'cancelled' }, 'employee', 'confirmed', 'put/orders/:id/status');
  await assert.rejects(h.call(), (e: any) => e.status === 403);
  assert.equal(h.updates.length, 0);
});

test('employee cannot edit or delete an approved quote through the API', async () => {
  const source = readFileSync(new URL('../../src/modules/quotes/api/routes.ts', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
  const handlers = new Map<string, any>();
  const table = new Proxy({}, { get: (_, key) => String(key) });
  const sql: any = () => null;
  sql.join = () => null; sql.raw = () => null;
  const ctx: any = {
    quotationPredicate, registerQuoteDesignImages, registerQuoteEditRequests, quoteEditState, checkDesignKeys, withDesignImages, sql, quotations: table, eq: () => null, and: () => null,
    quotationEditScope: () => ({ sql: '', bindings: [] }),
    cleanQuotation: (data: any) => data, readJson: async () => ({ revision: 1, data: {} }),
    AppError: class extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } },
  };
  runInNewContext(stripTypeScriptTypes(source) + '\nthis.register = registerQuoteRoutes;', ctx);
  const router: any = {};
  for (const method of ['get', 'post', 'put', 'delete']) router[method] = (path: string, fn: any) => handlers.set(method + path, fn);
  ctx.register(router);
  const query: any = {};
  // The approved quote exists, but there are no edit-request/permission audit events.
  let selected: unknown;
  query.from = (source: unknown) => { selected = source; return query; };
  for (const method of ['where', 'limit', 'for', 'orderBy']) query[method] = () => query;
  query.then = (resolve: any) => Promise.resolve(selected === table ? [{ id:'q',revision:1,approvalStatus:'approved' }] : []).then(resolve);
  const db: any = { transaction: (fn: any) => fn(db), select: () => query };
  const c = { req: {}, params: { id: 'q' }, env: { db }, state: { session: { member: { id: 'employee', role: 'employee' } } } };
  for (const path of ['put/quotes/:id', 'delete/quotes/:id']) await assert.rejects(handlers.get(path)(c), (e: any) => e.status === 403);
});

