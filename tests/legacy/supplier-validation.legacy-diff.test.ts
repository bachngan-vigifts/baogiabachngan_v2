/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/core/errors.ts';
import { legacyAvailable, skipReason, loadLegacy, bucketWith, buildShipment, baseScenario, attempt, members, rng, picker, ID, STOCK_ROWS, DETAIL_ROWS, type Scenario } from './harness.ts';
import { validateApproval, validateConfirmation, validateDepositRequest, validateDeliveryReady, validatePaidAmount, validateSignatureUpload, cleanInternalOrderNumber, type ExpectedRow } from '../../src/modules/suppliers/domain/validation.ts';
import { computeOrderTotals } from '../../src/modules/suppliers/domain/order-totals.ts';

const L: any = legacyAvailable ? await loadLegacy() : null;
const opts = { skip: skipReason };
const N = 1500;

const expected: ExpectedRow[] = STOCK_ROWS.map(r => ({ ...r })); // bản cũ chỉ có sku+quantity trong stockRows (không có tên)
const approvedMap = new Map([['a1', 25], ['b2', 10]]);
const wrap = (fn: () => unknown) => { try { return { ok: true as const, value: fn() }; } catch (e) { return e instanceof AppError ? { ok: false as const, status: e.status, message: e.message } : { ok: false as const, status: -1, message: String(e) }; } };
const sameOutcome = (mine: ReturnType<typeof wrap>, legacy: Awaited<ReturnType<typeof attempt>>, ctx: string) => {
  assert.equal(mine.ok, legacy.ok, `${ctx}: ${mine.ok ? 'bản mới nhận, bản cũ từ chối: ' + (legacy as any).message : 'bản mới từ chối (' + (mine as any).message + '), bản cũ nhận'}`);
  if (!mine.ok && !legacy.ok) assert.deepEqual({ status: mine.status, message: mine.message }, { status: legacy.status, message: legacy.message }, ctx);
};

// ---- bộ sinh dữ liệu gửi lên: đột biến từ một body hợp lệ ----
const dates = ['2026-10-20', '2026-10-25', '2026-11-01', '', 'abc', '2026-13-01', '2026-1-5', undefined, 20261020, null];
function mutateRows(r: () => number, rows: any[], fields: Record<string, readonly unknown[]>): any {
  const pick = picker(r);
  let out: any = structuredClone(rows);
  for (let i = 0, ops = Math.floor(r() * 4); i < ops; i++) {
    if (!Array.isArray(out)) break;
    const op = pick(['drop', 'dup', 'field', 'field', 'field', 'sku', 'nonarray', 'null', 'extra'] as const);
    const idx = Math.floor(r() * Math.max(out.length, 1));
    if (op === 'drop') out.splice(idx, 1);
    else if (op === 'dup') out.push(structuredClone(out[idx]));
    else if (op === 'field') { const f = pick(Object.keys(fields)); if (out[idx] && typeof out[idx] === 'object') out[idx][f] = pick(fields[f]!); }
    else if (op === 'sku' && out[idx]) out[idx].sku = pick(['a1', ' B2 ', 'ZZ', '', 'A1 ', 0, null, 'b2']);
    else if (op === 'nonarray') out = pick(['x', {}, null, undefined, 7] as const);
    else if (op === 'null') out[idx] = null;
    else if (op === 'extra') out.push({ sku: 'C3', quantity: 1, confirmed: true });
  }
  return out;
}

test('XÁC NHẬN ĐƠN ↔ bản cũ: cùng nhận/từ chối, cùng thông báo, cùng bản ghi xác nhận và danh sách đổi ngày/chiết khấu (1.500 ca ngẫu nhiên)', opts, async () => {
  const r = rng(101), fields = { quantity: [10, 5, 4, 11, 0, -1, '10', '5', 9.5, null, undefined], purchaseDiscount: [25, 10, 0, 100, 101, -1, '30', 'abc', null, undefined, 12.5], promisedDate: dates, confirmed: [true, false, 'true', 1, undefined, null], supplierNote: ['', 'Trễ hàng', 'x'.repeat(600), undefined], note: ['ghi chú', undefined] } as const;
  const good = [{ sku: 'A1', quantity: 10, purchaseDiscount: 25, promisedDate: '2026-10-20', confirmed: true }, { sku: 'B2', quantity: 5, purchaseDiscount: 10, promisedDate: '2026-10-20', confirmed: true }];
  let accepted = 0;
  for (let i = 0; i < N; i++) {
    const rows = i === 0 ? good : mutateRows(r, good, fields);
    const b = bucketWith([buildShipment(baseScenario)]);
    const legacy = await attempt(() => L.confirmSupplierOrder(b, { id: ID, rows }, members.supplier1));
    const mine = wrap(() => validateConfirmation(expected, approvedMap, '2026-10-20', rows));
    sameOutcome(mine, legacy, `#${i} ${JSON.stringify(rows)}`);
    if (legacy.ok && mine.ok) {
      accepted++; const s = b.shipment(), m = (mine as any).value;
      assert.deepEqual(m.confirmations, s.supplierConfirmations, `xác nhận #${i}`);
      assert.deepEqual(m.dateChanges, s.supplierDateChanges, `đổi ngày #${i}`);
      assert.deepEqual(m.discountChanges, s.supplierDiscountChanges, `đổi chiết khấu #${i}`);
    }
  }
  assert.ok(accepted > 100 && accepted < N - 100, `phân bố nhận/từ chối lệch: nhận ${accepted}/${N}`);
});

test('YÊU CẦU ĐẶT CỌC ↔ bản cũ: cùng nhận/từ chối, cùng tỷ lệ cọc được lưu (1.500 ca)', opts, async () => {
  const r = rng(202), pick = picker(r), fields = { quantity: [10, 5, 4, 11, '10', null, undefined], confirmed: [true, false, 'true', undefined] } as const;
  const good = tickRows();
  const rates: unknown[] = ['ABSENT', 'ABSENT', 'ABSENT', 0, 20, 50, 100, 101, -1, 'x', 12.345, '40', null, undefined];
  let accepted = 0;
  for (let i = 0; i < N; i++) {
    const rows = i === 0 ? good : mutateRows(r, good, fields), rate = pick(rates);
    const body: any = { id: ID, rows }; if (rate !== 'ABSENT') body.depositRate = rate;
    const b = bucketWith([buildShipment(baseScenario)]);
    const legacy = await attempt(() => L.requestSupplierDeposit(b, body, members.supplier1));
    const mine = wrap(() => validateDepositRequest(expected, rows, { provided: rate !== 'ABSENT', value: rate }, 30));
    sameOutcome(mine, legacy, `#${i} ${JSON.stringify(body)}`);
    if (legacy.ok && mine.ok) { accepted++; assert.equal((mine as any).value.depositRate, b.shipment().depositRate, `tỷ lệ cọc #${i}`); }
  }
  assert.ok(accepted > 100 && accepted < N - 100, `phân bố nhận/từ chối lệch: nhận ${accepted}/${N}`);
});
function tickRows() { return STOCK_ROWS.map(x => ({ sku: x.sku, quantity: x.quantity, confirmed: true })); }

test('BÁO SẴN SÀNG GIAO ↔ bản cũ: giao đủ/một phần, cùng nhận/từ chối và cùng dữ liệu được lưu (1.500 ca)', opts, async () => {
  const r = rng(303), pick = picker(r), fields = { sku: ['A1', 'a1', 'B2', 'ZZ', '', null], quantity: [1, 5, 10, 11, 0, -1, '3', 2.5, null] } as const;
  const sc: Scenario = { ...baseScenario, confirmed: true };
  const goodPartial = [{ sku: 'A1', quantity: 4 }, { sku: 'B2', quantity: 5 }];
  let accepted = 0;
  for (let i = 0; i < N; i++) {
    const body: any = { id: ID };
    const mode = pick(['full', 'partial', 'PARTIAL', ' partial ', undefined, 'x', '']); if (mode !== undefined) body.mode = mode;
    const d = pick(['2026-10-30', '2026-12-31', '', 'abc', '2026-13-01', undefined, '2026-1-5']);
    const dkey = pick(['deliveryDate', 'date', 'both', 'emptyThenDate']);
    if (dkey === 'deliveryDate') body.deliveryDate = d; else if (dkey === 'date') body.date = d; else if (dkey === 'both') { body.deliveryDate = d; body.date = '2026-11-05'; } else { body.deliveryDate = ''; body.date = d; }
    if (r() < 0.8) body.rows = mutateRows(r, goodPartial, fields);
    const b = bucketWith([buildShipment(sc)]);
    const legacy = await attempt(() => L.markSupplierDeliveryReady(b, body, members.supplier1));
    const mine = wrap(() => validateDeliveryReady(expected, body));
    sameOutcome(mine, legacy, `#${i} ${JSON.stringify(body)}`);
    if (legacy.ok && mine.ok) {
      accepted++; const s = b.shipment(), m = (mine as any).value;
      assert.deepEqual([m.mode, m.deliveryDate], [s.supplierDeliveryReadyMode, s.supplierDeliveryReadyDate], `#${i}`);
      assert.deepEqual(m.rows, s.supplierDeliveryReadyRows.map((x: any) => ({ sku: x.sku, name: x.name, quantity: x.quantity })), `dòng giao #${i}`);
    }
  }
  assert.ok(accepted > 100 && accepted < N - 100, `phân bố nhận/từ chối lệch: nhận ${accepted}/${N}`);
});

test('DUYỆT ĐƠN ↔ bản cũ: email, CC, chiết khấu từng mã – cùng nhận/từ chối và cùng dữ liệu lưu (1.500 ca)', opts, async () => {
  const r = rng(404), pick = picker(r), fields = { sku: ['A1', 'a1', 'B2', ' b2 ', 'ZZ', '', null], purchaseDiscount: [0, 10, 25, 100, 101, -1, '30', 'abc', null, undefined] } as const;
  const sc: Scenario = { ...baseScenario, approvalStatus: 'pending', confirmed: false, sigUploaded: false };
  const goodDiscounts = [{ sku: 'A1', purchaseDiscount: 25 }, { sku: 'B2', purchaseDiscount: 10 }];
  const many = Array.from({ length: 21 }, (_, i) => `c${i}@x.vn`).join(';');
  const emails = ['ncc@x.vn', ' a@b.co ', 'sai', '', 'a b@x.vn', 'a@b', undefined, 0];
  const ccs = ['', 'a@x.vn;b@x.vn', 'a@x.vn, b@x.vn,', 'a@x.vn;sai', ';;', many, undefined];
  let accepted = 0;
  for (let i = 0; i < N; i++) {
    const body: any = { id: ID, supplierEmail: pick(emails), ccEmail: pick(ccs), itemDiscounts: i === 0 ? goodDiscounts : mutateRows(r, goodDiscounts, fields) };
    const b = bucketWith([buildShipment(sc)]);
    const legacy = await attempt(() => L.approveSupplierOrder(b, body, members.manager));
    const mine = wrap(() => validateApproval(expected, body));
    sameOutcome(mine, legacy, `#${i} ${JSON.stringify(body)}`);
    if (legacy.ok && mine.ok) {
      accepted++; const s = b.shipment(), m = (mine as any).value;
      assert.deepEqual([m.supplierEmail, m.cc.join(', ')], [s.supplierEmail, s.ccEmail], `#${i}`);
      assert.deepEqual(m.itemDiscounts, s.itemDiscounts, `chiết khấu #${i}`);
    }
  }
  assert.ok(accepted > 50 && accepted < N - 100, `phân bố nhận/từ chối lệch: nhận ${accepted}/${N}`);
});

test('GHI NHẬN CỌC ↔ bản cũ: số tiền mặc định = tiền cọc tính được, và các giá trị hợp lệ/không hợp lệ', opts, async () => {
  const sc: Scenario = { ...baseScenario, confirmed: true, depositRequested: true };
  const totals = computeOrderTotals({ depositRate: 30, paidAmount: 0, rows: DETAIL_ROWS.map((x, i) => ({ quantity: x.quantity, price: x.price, printFee: x.printFee, taxRate: x.taxRate, purchaseDiscount: [25, 10][i]!, confirmedPurchaseDiscount: null })) });
  for (const input of [undefined, null, '', 0, '0', 123456, '123456', 99.5, -1, 1e12, 1e12 + 1, 'abc', NaN, Infinity, '1e3']) {
    const b = bucketWith([buildShipment(sc)]);
    const body: any = { id: ID }; if (input !== undefined) body.paidAmount = input;
    const legacy = await attempt(() => L.paySupplierDeposit(b, body, members.manager));
    const mine = wrap(() => validatePaidAmount(input, totals.depositAmount));
    sameOutcome(mine, legacy, String(input));
    if (legacy.ok && mine.ok) assert.equal((mine as any).value, b.shipment().paidAmount, `số tiền ${String(input)}`);
  }
  assert.equal(totals.depositAmount, 546480);
});

test('UPLOAD BẢN KÝ ↔ bản cũ: loại file, tên, kích thước (kể cả sát ngưỡng 6 MB)', opts, async () => {
  const sc: Scenario = { ...baseScenario, sigUploaded: false };
  const MB6 = 6 * 1024 * 1024;
  const cases: { name: any; mime: any; size: number }[] = [];
  for (const mime of ['image/png', 'image/jpeg', 'image/jpg', 'IMAGE/WEBP', 'application/pdf', 'application/zip', 'text/html', '', undefined, ' image/png ']) for (const name of ['ky.png', '  ', '', undefined, 'x'.repeat(300)]) cases.push({ name, mime, size: 100 });
  for (const size of [1, MB6 - 1, MB6, MB6 + 1]) cases.push({ name: 'ky.pdf', mime: 'application/pdf', size });
  for (const c of cases) {
    const b = bucketWith([buildShipment(sc)]);
    const dataBase64 = Buffer.alloc(c.size, 1).toString('base64');
    const legacy = await attempt(() => L.uploadSupplierOrderSignature(b, { id: ID, fileName: c.name, mimeType: c.mime, dataBase64 }, members.supplier1));
    const mine = wrap(() => validateSignatureUpload({ fileName: c.name, mimeType: c.mime, sizeBytes: c.size }));
    sameOutcome(mine, legacy, JSON.stringify({ ...c }));
    if (legacy.ok && mine.ok) {
      const f = b.shipment().supplierSignatureFile, m = (mine as any).value;
      assert.deepEqual([m.fileName, m.extension, f.size], [f.name, f.key.slice(f.key.lastIndexOf('.')), c.size], JSON.stringify(c));
      assert.equal(m.mimeType, f.type === 'image/jpg' ? 'image/jpeg' : f.type); // bản mới chuẩn hoá jpg → jpeg
    }
  }
});

test('SỐ PHIẾU NỘI BỘ NCC ↔ bản cũ: tối đa 100 ký tự, cắt khoảng trắng', opts, async () => {
  for (const v of ['', ' PO-1 ', 'x'.repeat(100), 'x'.repeat(101), ' ' + 'x'.repeat(100) + ' ', 0, null, undefined, 'Đơn số 5']) {
    const b = bucketWith([buildShipment(baseScenario)]);
    const legacy = await attempt(() => L.updateSupplierInternalOrderNumber(b, { id: ID, supplierInternalOrderNumber: v }, members.supplier1));
    const mine = wrap(() => cleanInternalOrderNumber(v));
    sameOutcome(mine, legacy, JSON.stringify(v));
    if (legacy.ok && mine.ok) assert.equal((mine as any).value, b.shipment().supplierInternalOrderNumber);
  }
});

test('KHÁC BIỆT CÓ CHỦ ĐÍCH so với bản cũ: ngày không tồn tại (31/02) bị từ chối; tên trong danh sách thay đổi lấy từ dòng hàng', opts, async () => {
  // bản cũ nhận "2026-02-31" vì Date.parse cuốn sang tháng sau
  const row = (d: string) => ({ sku: 'A1', quantity: 10, purchaseDiscount: 25, promisedDate: d, confirmed: true });
  const rows = (d: string) => [row(d), { ...row(d), sku: 'B2', quantity: 5, purchaseDiscount: 10 }];
  const b = bucketWith([buildShipment(baseScenario)]);
  assert.equal((await attempt(() => L.confirmSupplierOrder(b, { id: ID, rows: rows('2026-02-31') }, members.supplier1))).ok, true);
  assert.equal(wrap(() => validateConfirmation(expected, approvedMap, '2026-10-20', rows('2026-02-31'))).ok, false);
  // bản cũ ghi name '' vì stockRows không có tên; bản mới nhận tên từ dòng hàng
  const named = validateConfirmation([{ sku: 'A1', name: 'Nồi', quantity: 10 }, { sku: 'B2', name: 'Chảo', quantity: 5 }], approvedMap, '2026-10-20', [{ ...row('2026-10-25') }, rows('2026-10-20')[1]]);
  assert.deepEqual(named.dateChanges.map(c => c.name), ['Nồi']);
});
