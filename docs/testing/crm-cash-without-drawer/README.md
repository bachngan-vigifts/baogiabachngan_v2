# Thu tiền mặt đơn/HĐKT CRM không cần két

## Hành vi

Manager hoặc nhân viên có chức vụ `sale`, `sale-admin`, `sales-lock`, `sales-ml` được ghi phiếu thu tiền mặt cho đơn/HĐKT `channel=crm` trong phạm vi đơn họ được truy cập. Không cần ca POS/két đang mở, kể cả két đã chốt đầu kỳ. Có ca đang mở cũng không tự gắn phiếu CRM vào ca đó.

Phiếu lưu phương thức cash, người thu, ngày thu, số tiền, ghi chú; paymentSource=manual, shiftId=null. Phiếu giảm công nợ; không tăng số dư hoặc thu tiền của ca POS. Nhật ký ghi nhận `cashHandling=outside_drawer`. Hộp thu tiền hiển thị rõ tiền mặt do người thu giữ, không cộng két. Không tự tạo phiếu nộp két.

Giữ nguyên kiểm quyền/phạm vi đơn, ngày thu, số tiền còn phải thu, khóa giao dịch, chống gửi trùng, quyền huỷ phiếu. Client không thể bật ngoại lệ bằng một field tự gửi. Đơn POS, COD và cọc/trả trước vẫn đi qua kiểm tra ca/két/chuyến giao hiện tại. Không đổi quy tắc thu tiền cho chức vụ khác.

## Kiểm chứng

- `tests/app/crm-cash-without-drawer.test.ts`: đủ các chức vụ Sale và Manager, két đã có đầu kỳ nhưng chưa có ca; thu thành công, công nợ giảm, người thu được lưu, không đổi két. Gửi cùng mã đồng thời và gửi lại giữ một phiếu. Có ca vẫn không tự đưa tiền CRM vào két. Huỷ thu hoàn công nợ, không đổi két. Chặn thu vượt và NCC; chức vụ ngoài danh sách không tự gửi field để bỏ điều kiện két.
- Các bộ `cash.test.ts`, `sales.test.ts`, `pos.test.ts` kiểm tra luồng tiền/ca/két và ghi thu POS hiện tại.
- Typecheck, kiến trúc và trial UI.
- Browser `scripts/testing/crm-cash-without-drawer.mjs`: CRM thật + router/PGlite bằng dữ liệu giả, chặn mạng browser ra ngoài. Sale/Manager 1280px và Sale Admin 390px đều mở đơn, chọn tiền mặt, thấy chú thích, ghi thu được khi chưa mở ca; công nợ giảm, két không đổi. Chuyển sang hình thức chuyển khoản ẩn chú thích. Không lỗi JS.

Ảnh và results.json là dữ liệu thử local Chromium, không phải production. Chưa thử Safari/iPhone thật. Không migration, không thao tác tiền/két/dữ liệu production, không thay phiên/cron/đồng bộ Sapo.
