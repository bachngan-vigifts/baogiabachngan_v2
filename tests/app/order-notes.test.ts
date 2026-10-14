import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderDeliveryAddress, orderNotesFromQuote, syncOrderDeliveryNotes } from '../../src/modules/sales/domain/order-notes.ts';

test('ghi chú báo giá cũ: chỉ giữ giao hàng và hai đợt thanh toán, bỏ VAT/ngân hàng/lời chào', () => {
  const note = orderNotesFromQuote({ customerAddress: 'Địa chỉ pháp lý', notes: `- Tổng giá trị thanh toán đã bao gồm thuế VAT.
- Giá trên chỉ có hiệu lực trong 30 ngày.
- Thời gian giao hàng: Sau khi chốt đơn.
- Địa chỉ giao hàng: Kho giao hàng,
đường số 2.
- Phương thức thanh toán: Chuyển khoản.
- Đơn vị bán hàng: Công ty Bách Ngân
- Mã số thuế: 123
- Số tài khoản: 456 tại Ngân hàng
- Bên Mua sẽ tiến hành tạm ứng 30% trị giá hợp đồng ngay sau khi ký.
- 70% trị giá còn lại của hợp đồng sẽ thanh toán trước khi nhận hàng.
Trân trọng kính chào.` });
  assert.equal(note, '- Thời gian giao hàng: Sau khi chốt đơn.\n- Địa chỉ giao hàng: Kho giao hàng, đường số 2.\n- Thanh toán: Bên Mua sẽ tiến hành tạm ứng 30% trị giá hợp đồng ngay sau khi ký. 70% trị giá còn lại của hợp đồng sẽ thanh toán trước khi nhận hàng. Phương thức: Chuyển khoản.');
});

test('ngày dự kiến và địa chỉ thật thay mặc định, giữ nguyên điều khoản thanh toán tùy chỉnh', () => {
  const source = { deliveryDate: '2026-10-31', customerAddress: 'Kho khách', notes: '- Thời gian giao hàng: Cập nhật sau chốt đơn.\n- Địa chỉ giao hàng: Theo thoả thuận.\n- Thanh toán: Đặt cọc 30%. Còn lại trước khi giao hàng.' };
  assert.equal(orderDeliveryAddress(source), 'Kho khách');
  assert.equal(orderNotesFromQuote(source), '- Thời gian giao hàng: Giao hàng ngày 31/10/2026.\n- Địa chỉ giao hàng: Kho khách\n- Thanh toán: Đặt cọc 30%. Còn lại trước khi giao hàng.');
  const edited = syncOrderDeliveryNotes(orderNotesFromQuote(source), { deliveryDate: '' }, source);
  assert.match(edited, /Cập nhật sau chốt đơn/); assert.match(edited, /Đặt cọc 30%/);
});

test('ngày không hợp lệ không in ra; báo giá thiếu điều khoản không tự bịa thanh toán', () => {
  const note = orderNotesFromQuote({ deliveryDate: '2026-02-30', notes: '- Tổng thanh toán: 1.000 đồng.\n- Số tài khoản: 123' });
  assert.equal(note, '- Thời gian giao hàng: \n- Địa chỉ giao hàng: \n- Thanh toán: ');
});

test('đổi ngày / địa chỉ giao: giữ nguyên mọi dòng nhân viên tự gõ thêm', () => {
  const notes = ['- Thời gian giao hàng: Giao hàng ngày 20/10/2026.', '- Địa chỉ giao hàng: 1 Lê Lợi', '- Thanh toán: 100% trước khi giao', '- Gọi anh Nam trước 30 phút', 'Lưu ý: in logo màu đỏ', 'Giao giờ hành chính'].join('\n');
  const out = syncOrderDeliveryNotes(notes, { deliveryDate: '2026-10-25' }, {});
  assert.equal(out, notes.replace('20/10/2026', '25/10/2026'));
  const addr = syncOrderDeliveryNotes(out, { deliveryAddress: '12 Nguyễn Huệ,\nQ1' }, {});
  assert.deepEqual(addr.split('\n'), ['- Thời gian giao hàng: Giao hàng ngày 25/10/2026.', '- Địa chỉ giao hàng: 12 Nguyễn Huệ, Q1', '- Thanh toán: 100% trước khi giao', '- Gọi anh Nam trước 30 phút', 'Lưu ý: in logo màu đỏ', 'Giao giờ hành chính']);
  // Nhân viên đã xoá dòng giao hàng → thêm lại lên đầu, không đụng phần còn lại.
  assert.equal(syncOrderDeliveryNotes('Ghi chú riêng', { deliveryDate: '2026-10-25', deliveryAddress: 'Kho A' }, {}), '- Thời gian giao hàng: Giao hàng ngày 25/10/2026.\n- Địa chỉ giao hàng: Kho A\nGhi chú riêng');
});
