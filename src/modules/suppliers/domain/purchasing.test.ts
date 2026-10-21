import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedules, checkPurchase, purchaseActions, purchaseState, receiptProgress, remainingToOrder, supplierDebt, validateReceipt, type Actor } from './purchasing.ts';

const mgr: Actor = { id: 'm', role: 'manager', active: true, positionId: 'manager' };
const emp: Actor = { id: 'e', role: 'employee', active: true, positionId: 'sale' };
const other: Actor = { id: 'o', role: 'employee', active: true, positionId: 'sale' };
const kho: Actor = { id: 'k', role: 'employee', active: true, positionId: 'warehouse' };
const kt: Actor = { id: 'a', role: 'employee', active: true, positionId: 'accounting' };
const ncc: Actor = { id: 'n', role: 'supplier', active: true, positionId: 'supplier' };
const draft = { approvalStatus: 'pending', supplierStatus: 'pending', cancelledAt: null, createdBy: 'e' };
const approved = { ...draft, approvalStatus: 'approved' };
const none = { anyReceived: false, fullyReceived: false, paid: 0 };

test('quyền đơn mua: nháp người tạo / Manager sửa; duyệt chỉ Manager; nhận hàng kho + Manager; trả tiền Manager + kế toán', () => {
  assert.deepEqual(purchaseActions(emp, draft, none), ['edit', 'cancel']);
  assert.deepEqual(purchaseActions(other, draft, none), [], 'nhân viên khác không sửa nháp của người khác');
  assert.deepEqual(purchaseActions(mgr, draft, none), ['edit', 'approve', 'cancel', 'pdf']);
  assert.deepEqual(purchaseActions(mgr, approved, none), ['confirm', 'receive', 'pay', 'schedule', 'cancel', 'pdf']);
  assert.deepEqual(purchaseActions(kho, approved, none), ['receive']);
  assert.deepEqual(purchaseActions(kt, approved, none), ['confirm', 'receive', 'pay', 'schedule', 'pdf']);
  assert.deepEqual(purchaseActions(emp, approved, none), [], 'đơn đã duyệt: nhân viên chỉ xem');
  assert.deepEqual(purchaseActions(ncc, approved, none), [], 'tài khoản NCC không dùng trang nội bộ');
  assert.equal(checkPurchase('receive', kho, draft, none).ok, false, 'chưa duyệt chưa nhận');
  assert.equal(checkPurchase('cancel', mgr, approved, { ...none, anyReceived: true }).ok, false, 'đã nhận hàng không huỷ');
  assert.equal(checkPurchase('cancel', mgr, approved, { ...none, paid: 1 }).ok, false, 'đã trả tiền không huỷ');
  assert.deepEqual(purchaseActions(mgr, { ...approved, cancelledAt: 'x' }, none), ['pdf']);
});

test('nhận hàng từng đợt: đạt / hỏng / còn thiếu; chặn vượt số thiếu, mã lạ, ngày tương lai', () => {
  const lines = [{ id: 'l1', sku: 'A', name: 'Ly', quantity: 10 }, { id: 'l2', sku: 'B', name: 'Đĩa', quantity: 5 }];
  let p = receiptProgress(lines, [{ lineId: 'l1', goodQty: 6, damagedQty: 1 }]);
  assert.deepEqual(p.lines.map(l => [l.good, l.damaged, l.missing]), [[6, 1, 4], [0, 0, 5]]);
  assert.equal(purchaseState(approved, p), 'partially_received');
  assert.throws(() => validateReceipt(p, { lines: [{ lineId: 'l1', goodQty: 5 }] }, '2026-10-14'), /vượt số còn thiếu 4/);
  assert.throws(() => validateReceipt(p, { lines: [{ lineId: 'x', goodQty: 1 }] }, '2026-10-14'), /không thuộc đơn/);
  assert.throws(() => validateReceipt(p, { lines: [{ lineId: 'l1', goodQty: 0 }] }, '2026-10-14'), /ít nhất một mã/);
  assert.throws(() => validateReceipt(p, { receivedDate: '2026-10-15', lines: [{ lineId: 'l1', goodQty: 1 }] }, '2026-10-14'), /sau hôm nay/);
  const ok = validateReceipt(p, { lines: [{ lineId: 'l1', goodQty: 4 }, { lineId: 'l2', goodQty: 5, damagedQty: 0 }] }, '2026-10-14');
  assert.equal(ok.receivedDate, '2026-10-14');
  p = receiptProgress(lines, [{ lineId: 'l1', goodQty: 6, damagedQty: 1 }, ...ok.lines]);
  assert.equal(p.fullyReceived, true); assert.equal(purchaseState(approved, p), 'received');
});

test('công nợ NCC: không cọc / cọc / nhiều đợt; trả áp kỳ sớm nhất; quá hạn; huỷ khoản trả không tính', () => {
  assert.deepEqual(buildSchedules(1000, {}).map(s => [s.kind, s.amount]), [['balance', 1000]]);
  const s = buildSchedules(1000, { deposit: { mode: 'percent', value: 30, dueDate: '2026-10-01' }, installments: [{ amount: 200, dueDate: '2026-10-10' }], balanceDueDate: '2026-11-01' });
  assert.deepEqual(s.map(x => [x.kind, x.amount, x.dueDate]), [['deposit', 300, '2026-10-01'], ['installment', 200, '2026-10-10'], ['balance', 500, '2026-11-01']]);
  assert.throws(() => buildSchedules(1000, { deposit: { mode: 'amount', value: 2000 } }), /cọc/);
  assert.throws(() => buildSchedules(100, { installments: [{ amount: 200 }] }), /vượt/);
  const d = supplierDebt(1000, s, [{ amount: 350, paidDate: '2026-10-02', voidedAt: null }, { amount: 999, paidDate: '2026-10-03', voidedAt: 'x' }], '2026-10-14');
  assert.deepEqual([d.paid, d.balance, d.overdue, d.nextDueDate, d.nextDueAmount, d.status], [350, 650, 150, '2026-11-01', 500, 'overdue']);
  assert.equal(supplierDebt(1000, s, [{ amount: 1000, paidDate: '2026-10-02', voidedAt: null }], '2026-12-01').status, 'paid');
});

test('chống mua trùng: còn cần đặt = cần − đã đặt; gộp mã lặp, không phân biệt hoa thường', () => {
  const r = remainingToOrder([{ sku: 'ly1', name: 'Ly', unit: 'cái', quantity: 6 }, { sku: 'LY1', name: 'Ly', unit: 'cái', quantity: 4 }, { sku: 'B', name: 'B', unit: '', quantity: 3 }], new Map([['ly1', 7]]));
  assert.deepEqual(r.map(x => [x.sku, x.quantity, x.ordered, x.remaining]), [['ly1', 10, 7, 3], ['B', 3, 0, 3]]);
});


test('Sale Admin và Kế toán có xác nhận, nhận hàng, trả NCC, lịch trả, PDF; không có quyền duyệt/huỷ thay Manager',()=>{
  for(const positionId of ['sale-admin','accounting']) {
    const actor: Actor={id:'office',role:'employee',active:true,positionId};
    for(const action of ['confirm','receive','pay','schedule','pdf'] as const) assert.equal(checkPurchase(action,actor,approved,none).ok,true);
    for(const action of ['approve','cancel'] as const) assert.equal(checkPurchase(action,actor,approved,none).ok,false);
    assert.equal(checkPurchase('confirm',{...actor,active:false},approved,none).ok,false);
    assert.equal(checkPurchase('receive',{...actor,role:'supplier'},approved,none).ok,false);
    assert.equal(checkPurchase('receive',actor,draft,none).ok,false);
    assert.equal(checkPurchase('confirm',actor,{...approved,cancelledAt:'2026-10-21'},none).ok,false);
    assert.equal(checkPurchase('receive',actor,approved,{...none,fullyReceived:true}).ok,false);
  }
});
