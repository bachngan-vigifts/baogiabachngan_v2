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
