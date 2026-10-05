/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyAvailable, skipReason, loadLegacy, bucketWith, buildShipment, baseScenario, attempt, members, actors, rng, picker, ID, STOCK_ROWS, DETAIL_ROWS, type Scenario } from './harness.ts';
import { checkAction, LEGACY_RULES, type OrderAction, type OrderFacts, type WorkflowActor } from '../../src/modules/suppliers/domain/workflow.ts';

const L: any = legacyAvailable ? await loadLegacy() : null;
const opts = { skip: skipReason };

const factsOf = (sc: Scenario): OrderFacts => ({
  source: sc.source, approvalStatus: sc.approvalStatus, supplierId: sc.supplierKey, confirmed: sc.confirmed,
  hasSignatureStep: sc.sigUploaded || sc.sigDownloaded, hasSignatureFile: sc.sigUploaded,
  depositRequested: sc.depositRequested, depositPaid: sc.depositPaid, deliveryReady: sc.deliveryReady, received: sc.received,
});

const goodConfirmRows = [
  { sku: 'A1', quantity: 10, purchaseDiscount: 25, promisedDate: '2026-10-20', confirmed: true },
  { sku: 'B2', quantity: 5, purchaseDiscount: 10, promisedDate: '2026-10-20', confirmed: true },
];
const tickRows = STOCK_ROWS.map(r => ({ sku: r.sku, quantity: r.quantity, confirmed: true }));

/** Gọi hàm bản cũ tương ứng với từng hành động, với dữ liệu gửi lên HỢP LỆ (để chỉ còn lỗi do trạng thái/quyền). */
const legacyCall = (action: OrderAction, b: any, m: any): Promise<any> => ({
  approve: () => L.approveSupplierOrder(b, { id: ID, supplierEmail: 's1@x.vn', ccEmail: '', itemDiscounts: [{ sku: 'A1', purchaseDiscount: 25 }, { sku: 'B2', purchaseDiscount: 10 }] }, m),
  set_internal_number: () => L.updateSupplierInternalOrderNumber(b, { id: ID, supplierInternalOrderNumber: 'PO-9' }, m),
  upload_signature: () => L.uploadSupplierOrderSignature(b, { id: ID, fileName: 'k.png', mimeType: 'image/png', dataBase64: 'aGVsbG8=' }, m),
  delete_signature: () => L.deleteSupplierOrderSignature(b, { id: ID }, m),
  confirm: () => L.confirmSupplierOrder(b, { id: ID, rows: goodConfirmRows }, m),
  request_deposit: () => L.requestSupplierDeposit(b, { id: ID, rows: tickRows }, m),
  pay_deposit: () => L.paySupplierDeposit(b, { id: ID, paidAmount: 1000 }, m),
  mark_delivery_ready: () => L.markSupplierDeliveryReady(b, { id: ID, mode: 'full', deliveryDate: '2026-10-30' }, m),
  unmark_delivery_ready: () => L.markSupplierDeliveryReady(b, { id: ID, ready: false }, m),
  receive: () => L.receiveIncomingStock(b, { id: ID, warehouse: 'KHO' }, m),
})[action]();

test('MÁY TRẠNG THÁI ↔ bản cũ: cùng cho phép/từ chối, cùng mã lỗi và thông báo, trên mọi tổ hợp trạng thái × hành động × người dùng', opts, async () => {
  const bools = [false, true];
  const actions: OrderAction[] = ['approve', 'set_internal_number', 'upload_signature', 'delete_signature', 'confirm', 'request_deposit', 'pay_deposit', 'mark_delivery_ready', 'unmark_delivery_ready', 'receive'];
  let compared = 0;
  const outcomes = new Map<string, number>();
  for (const source of ['supplier-order', 'incoming-stock']) for (const approvalStatus of ['pending', 'approved']) for (const supplierKey of ['S1', 'S2'] as const)
    for (const confirmed of bools) for (const sig of ['none', 'uploaded', 'downloaded'])
      for (const depositRequested of bools) for (const depositPaid of bools) for (const deliveryReady of bools) for (const received of bools) {
        const sc: Scenario = { source, approvalStatus, supplierKey, confirmed, sigUploaded: sig === 'uploaded', sigDownloaded: sig === 'downloaded', depositRequested, depositPaid, deliveryReady, received };
        for (const action of actions) for (const who of Object.keys(members) as (keyof typeof members)[]) {
          const legacy = await attempt(() => legacyCall(action, bucketWith([buildShipment(sc)]), members[who]));
          const c = checkAction(action, actors[who] as WorkflowActor, factsOf(sc), LEGACY_RULES);
          const mine = c.ok ? { ok: true } : { ok: false, status: c.status, message: c.message };
          assert.deepEqual(mine, legacy, `${action} bởi ${who} – ${JSON.stringify(sc)}`);
          compared++;
          const key = legacy.ok ? 'OK' : `${legacy.status}:${legacy.message}`; outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
        }
      }
  assert.ok(compared > 25000, `chỉ so ${compared} ca`);
  // Chống test rỗng: bản cũ phải trả về cả chấp nhận lẫn nhiều loại từ chối khác nhau (không phải mọi ca cùng lỗi do hạ tầng giả).
  assert.ok((outcomes.get('OK') ?? 0) > 2000, `quá ít ca được chấp nhận: ${outcomes.get('OK')}`);
  assert.ok(outcomes.size >= 14, `chỉ có ${outcomes.size} loại kết quả: ${[...outcomes.keys()].join(' | ')}`);
  for (const [k, n] of outcomes) assert.ok(!/Cannot|undefined|is not|TypeError/i.test(k), `lỗi hạ tầng giả lọt vào kết quả (${n} ca): ${k}`);
});
