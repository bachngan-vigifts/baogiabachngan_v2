import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAction, nextActions, orderStage, ALL_ACTIONS, DEFAULT_RULES, LEGACY_RULES, type OrderFacts, type WorkflowActor, type OrderAction } from './workflow.ts';

const facts = (o: Partial<OrderFacts> = {}): OrderFacts => ({ source: 'supplier-order', approvalStatus: 'approved', supplierId: 'S1', confirmed: false, hasSignatureStep: false, hasSignatureFile: false, depositRequested: false, depositPaid: false, deliveryReady: false, received: false, ...o });
const actor = (o: Partial<WorkflowActor> & { id: string }): WorkflowActor => ({ role: 'employee', active: true, positionId: null, supplierId: null, ...o });
const mgr = actor({ id: 'm', role: 'manager', positionId: 'manager' });
const emp = actor({ id: 'e', positionId: 'sale' });
const s1 = actor({ id: 'n1', role: 'supplier', positionId: 'supplier', supplierId: 'S1' });
const s2 = actor({ id: 'n2', role: 'supplier', positionId: 'supplier', supplierId: 'S2' });
const acts = (a: WorkflowActor, o: Partial<OrderFacts> = {}, rules = DEFAULT_RULES) => nextActions(a, facts(o), rules);
const res = (action: OrderAction, a: WorkflowActor, o: Partial<OrderFacts> = {}, rules = DEFAULT_RULES) => { const c = checkAction(action, a, facts(o), rules); return c.ok ? 'OK' : `${c.status}:${c.message}`; };

test('kịch bản một đơn đi hết vòng đời: nút nào hiện với ai ở từng bước', () => {
  // 1. chờ duyệt: chỉ Manager thấy nút duyệt; NCC chưa thấy gì
  const pending = { approvalStatus: 'pending' };
  assert.deepEqual(acts(mgr, pending), ['approve']); // chưa duyệt thì chưa nhập kho được (luật siết chặt mặc định)
  assert.deepEqual(acts(mgr, pending, LEGACY_RULES), ['approve', 'receive']); // bản cũ cho nhập kho cả đơn chưa duyệt
  assert.deepEqual(acts(s1, pending), []);
  assert.deepEqual(acts(emp, pending), []);
  // 2. đã duyệt, chờ NCC xác nhận: NCC ký / nhập số phiếu / yêu cầu cọc; chưa xác nhận được vì chưa có bản ký
  assert.deepEqual(acts(s1), ['set_internal_number', 'upload_signature', 'request_deposit']);
  // 3. đã tải bản ký: thêm xoá bản ký và xác nhận
  assert.deepEqual(acts(s1, { hasSignatureStep: true, hasSignatureFile: true }), ['set_internal_number', 'upload_signature', 'delete_signature', 'confirm', 'request_deposit']);
  // 4. đã xác nhận: hết nút xác nhận và xoá bản ký (khoá); có báo sẵn sàng giao
  const confirmed = { confirmed: true, hasSignatureStep: true, hasSignatureFile: true };
  assert.deepEqual(acts(s1, confirmed), ['set_internal_number', 'request_deposit', 'mark_delivery_ready']); // đã xác nhận: bản ký bị khoá (không xoá, không thay)
  // 5. đã yêu cầu cọc: Manager có nút ghi nhận cọc; NCC vẫn yêu cầu lại được cho tới khi nhận cọc
  assert.ok(acts(mgr, { ...confirmed, depositRequested: true }).includes('pay_deposit'));
  assert.ok(!acts(mgr, confirmed).includes('pay_deposit'));
  // 6. đã nhận cọc: hết nút yêu cầu cọc
  assert.ok(!acts(s1, { ...confirmed, depositRequested: true, depositPaid: true }).includes('request_deposit'));
  // 7. đã báo sẵn sàng giao: có nút bỏ báo
  assert.ok(acts(s1, { ...confirmed, deliveryReady: true }).includes('unmark_delivery_ready'));
  assert.ok(!acts(s1, confirmed).includes('unmark_delivery_ready'));
  // 8. đã nhập kho: NCC chỉ còn sửa số phiếu nội bộ; Manager còn ghi nhận cọc nếu đã yêu cầu
  const received = { ...confirmed, received: true, depositRequested: true };
  assert.deepEqual(acts(s1, received), ['set_internal_number']);
  assert.deepEqual(acts(mgr, received), ['set_internal_number', 'pay_deposit']);
});

test('NCC khác không thấy đơn: mọi thao tác ở cổng bị từ chối 404; nhân viên thường 403; tài khoản khoá 403', () => {
  const notYours = 'Không tìm thấy đơn NCC của tài khoản này.';
  for (const a of ['set_internal_number', 'upload_signature', 'delete_signature', 'confirm', 'request_deposit', 'mark_delivery_ready', 'unmark_delivery_ready'] as OrderAction[]) {
    assert.equal(res(a, s2, { hasSignatureStep: true }), `404:${notYours}`, a);
    assert.equal(res(a, emp), '403:Chỉ tài khoản NCC được xác nhận đơn NCC.', a);
    assert.equal(res(a, { ...s1, active: false }), '403:Tài khoản đã bị khoá.', a);
    assert.equal(res(a, actor({ id: 'n3', role: 'supplier', positionId: 'supplier', supplierId: null })), `404:${notYours}`, a); // NCC chưa gắn nhà cung cấp
  }
  assert.deepEqual(acts(s2, { hasSignatureStep: true }), []);
});

test('chức vụ NCC mà vai trò lệch: vẫn chỉ làm như NCC (đúng NCC của đơn), không được quyền Manager', () => {
  const skewedMgr = actor({ id: 'x', role: 'manager', positionId: 'supplier', supplierId: 'S2' });
  assert.equal(res('approve', skewedMgr, { approvalStatus: 'pending' }), '403:Chỉ Manager được phê duyệt đơn đặt hàng NCC.');
  assert.equal(res('receive', skewedMgr), '403:Chỉ Manager được xác nhận nhập kho.');
  assert.match(res('request_deposit', skewedMgr), /^404:/); // sai NCC
  assert.equal(res('request_deposit', { ...skewedMgr, supplierId: 'S1' }), 'OK');
});

test('đơn chưa duyệt hoặc không phải đơn NCC: cổng NCC coi như không tồn tại (404)', () => {
  assert.equal(res('confirm', s1, { approvalStatus: 'pending', hasSignatureStep: true }), '404:Không tìm thấy đơn NCC đã gửi.');
  assert.equal(res('confirm', s1, { source: 'incoming-stock', hasSignatureStep: true }), '404:Không tìm thấy đơn NCC đã gửi.');
  assert.equal(res('pay_deposit', mgr, { approvalStatus: 'pending', depositRequested: true }), '404:Không tìm thấy đơn NCC đã gửi.');
  assert.equal(res('approve', mgr, { source: 'incoming-stock', approvalStatus: 'pending' }), '404:Không tìm thấy đơn đặt hàng NCC.');
});

test('duyệt đơn: chỉ Manager, chỉ khi chờ duyệt và chưa nhập kho', () => {
  assert.equal(res('approve', mgr, { approvalStatus: 'pending' }), 'OK');
  assert.equal(res('approve', emp, { approvalStatus: 'pending' }), '403:Chỉ Manager được phê duyệt đơn đặt hàng NCC.');
  assert.equal(res('approve', s1, { approvalStatus: 'pending' }), '403:Chỉ Manager được phê duyệt đơn đặt hàng NCC.');
  assert.equal(res('approve', mgr), '409:Đơn này đã được phê duyệt.');
  assert.equal(res('approve', mgr, { approvalStatus: 'pending', received: true }), '409:Đơn này đã nhập kho.');
});

test('xác nhận đơn: cần bản ký (tải lên hoặc đã tải mẫu về) và chưa xác nhận', () => {
  assert.equal(res('confirm', s1), '400:Vui lòng upload ảnh hoặc file bản ký xác nhận trước khi bấm Xác nhận.');
  assert.equal(res('confirm', s1, { hasSignatureStep: true }), 'OK');
  assert.equal(res('confirm', s1, { hasSignatureStep: true, confirmed: true }), '409:Đơn này đã được NCC xác nhận.');
});

test('đặt cọc: yêu cầu được tới khi đã nhận cọc; ghi nhận cọc chỉ Manager và phải có đề nghị trước', () => {
  assert.equal(res('request_deposit', s1), 'OK');
  assert.equal(res('request_deposit', s1, { depositPaid: true }), '409:Đơn này đã nhận tiền cọc.');
  assert.equal(res('pay_deposit', mgr), '400:Đơn này chưa có đề nghị thanh toán.');
  assert.equal(res('pay_deposit', mgr, { depositRequested: true }), 'OK');
  assert.equal(res('pay_deposit', s1, { depositRequested: true }), '403:Chỉ Manager được ghi nhận thanh toán cọc NCC.');
  assert.equal(res('pay_deposit', emp, { depositRequested: true }), '403:Chỉ Manager được ghi nhận thanh toán cọc NCC.');
});

test('báo sẵn sàng giao: chỉ khi đã xác nhận và chưa nhập kho', () => {
  assert.equal(res('mark_delivery_ready', s1), '409:Chỉ đơn đã duyệt mới được báo sẵn sàng giao.');
  assert.equal(res('mark_delivery_ready', s1, { confirmed: true }), 'OK');
  assert.equal(res('mark_delivery_ready', s1, { confirmed: true, received: true }, LEGACY_RULES), '409:Đơn đã nhập kho, không cần báo sẵn sàng giao.');
});

test('nhập kho: chỉ Manager; nhập lần hai là không làm gì (không lỗi), không hiện nút', () => {
  assert.equal(res('receive', mgr), 'OK');
  assert.equal(res('receive', emp), '403:Chỉ Manager được xác nhận nhập kho.');
  assert.equal(res('receive', s1), '403:Chỉ Manager được xác nhận nhập kho.');
  assert.deepEqual(checkAction('receive', mgr, facts({ received: true })), { ok: true, noop: true });
  assert.ok(!acts(mgr, { received: true }).includes('receive'));
});

test('SIẾT CHẶT so với bản cũ (mặc định bật, tắt được): sau nhập kho khoá thao tác NCC; xác nhận rồi không xoá bản ký; không nhập kho đơn chưa duyệt', () => {
  const done = { confirmed: true, hasSignatureStep: true, hasSignatureFile: true };
  // khoá sau nhập kho
  for (const a of ['upload_signature', 'delete_signature', 'request_deposit', 'unmark_delivery_ready'] as OrderAction[]) {
    assert.equal(res(a, s1, { ...done, received: true }), '409:Đơn đã nhập kho, không thể thay đổi.', a);
    assert.notEqual(res(a, s1, { ...done, received: true }, { ...DEFAULT_RULES, freezeAfterReceipt: false }), '409:Đơn đã nhập kho, không thể thay đổi.', a + ' (tắt cờ)');
  }
  assert.equal(res('set_internal_number', s1, { ...done, received: true }), 'OK'); // ngoại lệ có chủ đích
  // xoá bản ký sau khi xác nhận
  assert.equal(res('delete_signature', s1, done), '409:Đơn đã được NCC xác nhận, không thể xoá bản ký.');
  assert.equal(res('upload_signature', s1, done), '409:Đơn đã được NCC xác nhận, không thể thay bản ký.'); // tải bản mới = thay bản cũ
  assert.equal(res('upload_signature', s1, done, { ...DEFAULT_RULES, lockSignatureAfterConfirm: false }), 'OK');
  assert.equal(res('upload_signature', s1, { hasSignatureStep: true, hasSignatureFile: true }), 'OK'); // chưa xác nhận thì thay được
  assert.equal(res('delete_signature', s1, done, { ...DEFAULT_RULES, lockSignatureAfterConfirm: false }), 'OK');
  assert.equal(res('delete_signature', s1, { hasSignatureFile: true, hasSignatureStep: true }), 'OK'); // chưa xác nhận thì xoá được
  // nhập kho đơn NCC chưa duyệt
  assert.equal(res('receive', mgr, { approvalStatus: 'pending' }), '409:Đơn NCC chưa được duyệt, chưa thể nhập kho.');
  assert.equal(res('receive', mgr, { approvalStatus: 'pending' }, { ...DEFAULT_RULES, receiveRequiresApproval: false }), 'OK');
  assert.equal(res('receive', mgr, { source: 'incoming-stock', approvalStatus: 'approved' }), 'OK'); // hàng sắp về thường không cần duyệt
  // cờ chưa bật mặc định: yêu cầu cọc trước khi xác nhận (bản cũ cho phép)
  assert.equal(res('request_deposit', s1), 'OK');
  assert.equal(res('request_deposit', s1, {}, { ...DEFAULT_RULES, depositRequiresConfirmation: true }), '409:Cần xác nhận đơn trước khi yêu cầu đặt cọc.');
});

test('giai đoạn hiển thị', () => {
  assert.equal(orderStage({ approvalStatus: 'pending', confirmed: false, received: false }), 'pending_approval');
  assert.equal(orderStage({ approvalStatus: 'approved', confirmed: false, received: false }), 'awaiting_confirmation');
  assert.equal(orderStage({ approvalStatus: 'approved', confirmed: true, received: false }), 'confirmed');
  assert.equal(orderStage({ approvalStatus: 'approved', confirmed: true, received: true }), 'received');
  assert.equal(orderStage({ approvalStatus: 'pending', confirmed: false, received: true }), 'received');
});

test('nextActions luôn là tập con của checkAction (nút hiện thì máy chủ phải cho phép)', () => {
  for (const a of [mgr, emp, s1, s2, { ...s1, active: false }]) {
    for (const approvalStatus of ['pending', 'approved']) for (const confirmed of [false, true]) for (const received of [false, true]) for (const depositRequested of [false, true]) {
      const o = facts({ approvalStatus, confirmed, received, depositRequested, hasSignatureStep: confirmed, hasSignatureFile: confirmed });
      for (const act of nextActions(a, o)) assert.equal(checkAction(act, a, o).ok, true, `${a.id} ${act}`);
      assert.ok(ALL_ACTIONS.length === 10);
    }
  }
});
