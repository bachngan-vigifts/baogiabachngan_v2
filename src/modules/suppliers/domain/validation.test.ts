import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../../core/errors.ts';
import { validateApproval, validateConfirmation, validateDepositRequest, validateDeliveryReady, validatePaidAmount, validateSignatureUpload, cleanInternalOrderNumber, type ExpectedRow } from './validation.ts';

const msg = (fn: () => unknown) => { try { fn(); return 'OK'; } catch (e) { return e instanceof AppError ? `${e.status}:${e.message}` : 'LỖI LẠ'; } };
const expected: ExpectedRow[] = [{ sku: 'A1', name: 'Nồi', quantity: 10 }, { sku: 'B2', name: 'Chảo', quantity: 5 }];
const approved = new Map([['a1', 25], ['b2', 10]]);
const goodRows = [
  { sku: 'A1', quantity: 10, purchaseDiscount: 25, promisedDate: '2026-10-20', confirmed: true },
  { sku: 'B2', quantity: 5, purchaseDiscount: 10, promisedDate: '2026-10-20', confirmed: true },
];

test('duyệt đơn: email đúng dạng, CC tối đa 20 và hợp lệ, chiết khấu đủ từng mã trong 0..100', () => {
  const ok = validateApproval(expected, { supplierEmail: ' ncc@x.vn ', ccEmail: 'a@x.vn; b@x.vn,', itemDiscounts: [{ sku: 'a1', purchaseDiscount: 25 }, { sku: 'B2', purchaseDiscount: '10' }] });
  assert.deepEqual(ok, { supplierEmail: 'ncc@x.vn', cc: ['a@x.vn', 'b@x.vn'], itemDiscounts: [{ sku: 'A1', purchaseDiscount: 25 }, { sku: 'B2', purchaseDiscount: 10 }] });
  const base = { supplierEmail: 'ncc@x.vn', ccEmail: '', itemDiscounts: [{ sku: 'A1', purchaseDiscount: 1 }, { sku: 'B2', purchaseDiscount: 2 }] };
  assert.equal(msg(() => validateApproval(expected, { ...base, supplierEmail: 'sai' })), '400:Thông tin phê duyệt đơn hàng không hợp lệ.');
  assert.equal(msg(() => validateApproval(expected, { ...base, ccEmail: 'a@x.vn;sai' })), '400:Email CC không hợp lệ.');
  assert.equal(msg(() => validateApproval(expected, { ...base, itemDiscounts: [base.itemDiscounts[0]] })), '400:Nhập chiết khấu cho đầy đủ từng mã hàng.');
  assert.equal(msg(() => validateApproval(expected, { ...base, itemDiscounts: [base.itemDiscounts[0], { sku: 'B2', purchaseDiscount: 101 }] })), '400:Chiết khấu từng mã phải từ 0 đến 100%.');
  assert.equal(msg(() => validateApproval(expected, { ...base, itemDiscounts: [base.itemDiscounts[0], { sku: 'a1', purchaseDiscount: 3 }] })), '400:Chiết khấu từng mã phải từ 0 đến 100%.'); // trùng SKU
  assert.equal(msg(() => validateApproval(expected, { ...base, itemDiscounts: [base.itemDiscounts[0], { sku: 'ZZ', purchaseDiscount: 3 }] })), '400:Danh sách mã hàng và chiết khấu không khớp đơn đặt hàng.');
});

test('NCC xác nhận: ghi lại thay đổi ngày hẹn và chiết khấu so với đơn gốc', () => {
  const same = validateConfirmation(expected, approved, '2026-10-20', goodRows);
  assert.deepEqual([same.dateChanges, same.discountChanges, same.confirmations.map(c => c.sku)], [[], [], ['A1', 'B2']]);
  const changed = validateConfirmation(expected, approved, '2026-10-20', [
    { ...goodRows[0], promisedDate: '2026-10-25', purchaseDiscount: 20, supplierNote: 'Trễ nguyên liệu' }, goodRows[1]]);
  assert.deepEqual(changed.dateChanges, [{ sku: 'A1', name: 'Nồi', from: '2026-10-20', to: '2026-10-25', note: 'Trễ nguyên liệu' }]);
  assert.deepEqual(changed.discountChanges, [{ sku: 'A1', name: 'Nồi', from: 25, to: 20, note: 'Trễ nguyên liệu' }]);
});

test('NCC xác nhận: từ chối thiếu dòng, trùng SKU, chưa tick, ngày/chiết khấu sai, số lượng không khớp, SKU lạ', () => {
  const run = (rows: unknown) => msg(() => validateConfirmation(expected, approved, '2026-10-20', rows));
  assert.equal(run(goodRows), 'OK');
  assert.equal(run([goodRows[0]]), '400:Cần xác nhận đầy đủ từng mã hàng.');
  assert.equal(run('x'), '400:Cần xác nhận đầy đủ từng mã hàng.');
  const tick = '400:NCC cần tick xác nhận CK, SL và ngày hẹn giao cho từng mã.';
  assert.equal(run([goodRows[0], { ...goodRows[1], confirmed: false }]), tick);
  assert.equal(run([goodRows[0], { ...goodRows[1], confirmed: 'true' }]), tick); // phải đúng boolean true
  assert.equal(run([goodRows[0], { ...goodRows[1], promisedDate: '2026-13-40' }]), tick);
  assert.equal(run([goodRows[0], { ...goodRows[1], promisedDate: '' }]), tick);
  assert.equal(run([goodRows[0], { ...goodRows[1], purchaseDiscount: 101 }]), tick);
  assert.equal(run([goodRows[0], { ...goodRows[1], purchaseDiscount: 'abc' }]), tick);
  assert.equal(run([goodRows[0], { ...goodRows[0] }]), tick); // trùng SKU
  const mismatch = '400:Thông tin xác nhận không khớp đơn đã gửi NCC.';
  assert.equal(run([goodRows[0], { ...goodRows[1], quantity: 4 }]), mismatch);
  assert.equal(run([goodRows[0], { ...goodRows[1], sku: 'ZZ' }]), mismatch);
  assert.equal(run([goodRows[0], { ...goodRows[1], sku: ' b2 ' }]), 'OK'); // khoảng trắng và hoa/thường không ảnh hưởng
});

test('yêu cầu đặt cọc: tick đủ từng mã khớp số lượng; tỷ lệ cọc 0..100 (mặc định giữ tỷ lệ hiện tại hoặc 30)', () => {
  const rows = goodRows.map(r => ({ sku: r.sku, quantity: r.quantity, confirmed: true }));
  assert.deepEqual(validateDepositRequest(expected, rows, { provided: false }, 50), { depositRate: 50 });
  assert.deepEqual(validateDepositRequest(expected, rows, { provided: false }, null), { depositRate: 30 });
  assert.deepEqual(validateDepositRequest(expected, rows, { provided: true, value: 0 }, 50), { depositRate: 0 });
  assert.equal(msg(() => validateDepositRequest(expected, rows, { provided: true, value: 101 }, 50)), '400:Tỷ lệ cọc phải từ 0 đến 100%.');
  assert.equal(msg(() => validateDepositRequest(expected, rows, { provided: true, value: 'x' }, 50)), '400:Tỷ lệ cọc phải từ 0 đến 100%.');
  const tick = '400:Tick chọn đầy đủ từng sản phẩm trước khi yêu cầu đặt cọc.';
  assert.equal(msg(() => validateDepositRequest(expected, [rows[0]], { provided: false }, 30)), tick);
  assert.equal(msg(() => validateDepositRequest(expected, [rows[0], { ...rows[1], confirmed: false }], { provided: false }, 30)), tick);
  assert.equal(msg(() => validateDepositRequest(expected, [rows[0], { ...rows[1], quantity: 9 }], { provided: false }, 30)), '400:Danh sách sản phẩm chọn không khớp đơn đã gửi NCC.');
});

test('báo sẵn sàng giao: giao đủ hoặc giao một phần (số lượng 1..số đặt, không trùng, đúng mã)', () => {
  const full = validateDeliveryReady(expected, { deliveryDate: '2026-10-30' });
  assert.deepEqual(full, { mode: 'full', deliveryDate: '2026-10-30', rows: [{ sku: 'A1', name: 'Nồi', quantity: 10 }, { sku: 'B2', name: 'Chảo', quantity: 5 }] });
  assert.equal(validateDeliveryReady(expected, { mode: 'PARTIAL', date: '2026-10-30', rows: [{ sku: 'b2', quantity: 3 }] }).rows[0]!.sku, 'B2');
  assert.equal(msg(() => validateDeliveryReady(expected, { deliveryDate: '2026-02-31' })), '400:Chọn ngày muốn giao hợp lệ.');
  assert.equal(msg(() => validateDeliveryReady(expected, {})), '400:Chọn ngày muốn giao hợp lệ.');
  const partial = (rows: unknown) => msg(() => validateDeliveryReady(expected, { mode: 'partial', deliveryDate: '2026-10-30', rows }));
  assert.equal(partial([]), '400:Chọn ít nhất 1 mã hàng khi giao một phần.');
  assert.equal(partial([{ sku: 'ZZ', quantity: 1 }]), '400:Mã hàng giao một phần không khớp đơn NCC.');
  assert.equal(partial([{ sku: 'A1', quantity: 1 }, { sku: 'a1', quantity: 2 }]), '400:Mã hàng giao một phần không khớp đơn NCC.');
  const q = '400:Số lượng giao một phần phải lớn hơn 0 và không vượt quá số lượng trong đơn.';
  assert.equal(partial([{ sku: 'A1', quantity: 0 }]), q);
  assert.equal(partial([{ sku: 'A1', quantity: 11 }]), q);
  assert.equal(partial([{ sku: 'A1', quantity: 10 }]), 'OK');
});

test('ghi nhận cọc: mặc định đúng số tiền cọc; 0..1e12', () => {
  assert.equal(validatePaidAmount(undefined, 546480), 546480);
  assert.equal(validatePaidAmount('', 546480), 546480);
  assert.equal(validatePaidAmount(null, 100), 100);
  assert.equal(validatePaidAmount('200000', 546480), 200000);
  assert.equal(validatePaidAmount(0, 546480), 0);
  for (const bad of [-1, 1e12 + 1, 'abc', NaN, Infinity]) assert.equal(msg(() => validatePaidAmount(bad, 1)), '400:Số tiền cọc không hợp lệ.', String(bad));
});

test('upload bản ký: chỉ ảnh/PDF, ≤ 6 MB, tên không rỗng; jpg chuẩn hoá thành jpeg', () => {
  assert.deepEqual(validateSignatureUpload({ fileName: ' ky.JPG ', mimeType: 'image/JPG', sizeBytes: 1000 }), { fileName: 'ky.JPG', mimeType: 'image/jpeg', extension: '.jpg' });
  assert.equal(validateSignatureUpload({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 6 * 1024 * 1024 }).extension, '.pdf');
  assert.equal(msg(() => validateSignatureUpload({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 6 * 1024 * 1024 + 1 })), '400:File ký xác nhận tối đa 6MB.');
  assert.equal(msg(() => validateSignatureUpload({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 0 })), '400:File ký xác nhận tối đa 6MB.');
  assert.equal(msg(() => validateSignatureUpload({ fileName: 'a.zip', mimeType: 'application/zip', sizeBytes: 10 })), '400:Chỉ upload ảnh hoặc file PDF bản ký xác nhận.');
  assert.equal(msg(() => validateSignatureUpload({ fileName: '  ', mimeType: 'image/png', sizeBytes: 10 })), '400:Chỉ upload ảnh hoặc file PDF bản ký xác nhận.');
});

test('số phiếu nội bộ NCC tối đa 100 ký tự', () => {
  assert.equal(cleanInternalOrderNumber('  PO-1 '), 'PO-1');
  assert.equal(cleanInternalOrderNumber(undefined), '');
  assert.equal(msg(() => cleanInternalOrderNumber('x'.repeat(101))), '400:Số phiếu nội bộ NCC tối đa 100 ký tự.');
});
