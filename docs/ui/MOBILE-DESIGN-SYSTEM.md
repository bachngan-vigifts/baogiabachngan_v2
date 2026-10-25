# Giao diện CRM trên điện thoại

Tham chiếu: `he-thong-giao-dien-crm.md` anh Thái gửi và hai ảnh mẫu HĐKT / bốn kiểu trang (25/10/2026). Áp dụng tài liệu và ảnh bốn trang cho điểm khác nhau giữa các mẫu: **số tiền đầy đủ ở danh sách và chi tiết, chỉ rút gọn ở KPI**.

## Quy ước

- Be Vietnam Pro; tiêu đề gốc 22, trang con/sheet 18, dòng chính 15, nội dung 14, phụ 12. Ô nhập 16px để Safari không tự phóng to. Vùng bấm chính 44px.
- Nền #F4F6F9, thẻ trắng, viền #E3E8EF; navy #102A56, xanh #12805C; thẻ/nút bo 12px, ô nhập 10px.
- Nút tạo/saving giữ ngoài menu; thao tác phụ trong một menu gốc. Dùng chính phần tử DOM hiện có: giữ form, sự kiện ủy quyền, trạng thái ẩn/khóa và xác nhận nghiệp vụ.
- Thanh dưới: Công việc, Báo giá, Đơn hàng, Khách hàng, Thêm. Chỉ hiện trang người dùng được phép xem; vai trò kho dùng các lối tắt được cấp quyền. Ẩn khi nhập form/bàn phím/hộp thoại.
- Một hàng trạng thái; lọc chi tiết trong sheet “Lọc · n”. Giá trị lọc và truy vấn máy chủ cũ giữ nguyên. “Xem n kết quả” lấy tổng từ phản hồi, không đoán số liệu.
- Desktop giữ bảng/sidebar. HĐKT dùng panel phải từ 1280px và sheet trên điện thoại; phần tử chi tiết gốc được trả lại vị trí khi rời trang/đổi kích thước.
- Báo giá: một cột, các phần hiện cùng lúc, nút Lưu cố định đáy; trường phụ của dòng hàng mở qua “Chi tiết”. Không đổi công thức giá/thuế/chiết khấu.

## Bản nháp báo giá trên thiết bị

Tự lưu sau 700ms sửa, tối đa 2MiB, hết hạn 7 ngày; tách theo tài khoản, chứng từ và phiên bản máy chủ. Chỉ khôi phục khi người dùng chọn, không ghi API, không tự tạo chứng từ/gửi duyệt. Xóa khi lưu CRM thành công hoặc đăng xuất. Nếu trình duyệt chặn lưu trữ thì báo rõ, vẫn cho sửa và lưu CRM bình thường. Không khôi phục nháp cũ lên phiên bản mới của máy chủ.

## Các đợt

| Đợt | Phạm vi |
|---|---|
| P1 | Khung chung, công việc, báo giá/form, đơn hàng, khách hàng/chi tiết, chăm sóc, HĐKT/chi tiết |
| P2 | Giao hàng, đóng gói, nhận hàng, công nợ, sổ quỹ, mua NCC, NCC, tra hàng/hỏi tồn; POS giữ mẫu riêng |
| P3 | Dashboard, kho/tồn/sổ kho, điều chuyển, sản phẩm, nhân sự/lương, phân quyền, sơ đồ |

Mỗi đợt PR riêng, không tự merge/deploy. Không sửa API, schema, quyền, công thức tiền, tồn kho, Sapo, GHN hoặc cron.

## Kiểm tra

```sh
npm run typecheck
npm run ui:build
node --import tsx --test tests/app/quote-device-draft.test.ts tests/app/quote-customer-race.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/mobile-design-system.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/testing/mobile-actions.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/testing/pos-mobile-scroll.mjs
```

`mobile-design-system.mjs` chạy **router CRM thật + PGlite mới**, chỉ ở localhost; tạo dữ liệu giả trong DB thử. Kiểm tra bộ lọc chỉ đọc, quyền sở hữu DOM khi mở HĐKT, thử lại sau lỗi, nháp sau tải lại; chụp 390px/1280px. `mobile-actions.mjs` kiểm tra menu, form/submitter, file mẫu, thao tác động, đổi kích thước tại 360/390/430/1280px. Toàn bộ suite chạy hai shard qua CI. Chưa thay kiểm tra trên Safari/iPhone thật.
