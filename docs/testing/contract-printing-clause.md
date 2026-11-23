# HĐKT: Điều 2.1 theo trạng thái in

Mục 2.1 dùng hai nội dung do người dùng cung cấp:

- Không in: “Quy cách sản phẩm” và chất lượng theo tiêu chuẩn NSX.
- Có in: kiểu dáng/nội dung/kích thước/vị trí theo mẫu duyệt; màu từ 80%; vị trí logo lệch 2–3 mm; bên A chịu chi phí nếu đổi nội dung/kích thước/vị trí sau mẫu thật; chất lượng theo tiêu chuẩn NSX.

Trạng thái lấy từ thông tin in đã xác nhận trên đơn. Hồ sơ cũ dùng `printingInfo`
trên báo giá nguồn, gồm phí và mô tả in; không suy ra chỉ theo loại báo giá hoặc
pháp nhân. Lỗi tải báo giá nguồn chặn dựng bản xem thay vì âm thầm coi là không in.

Bộ dựng áp dụng cùng một nội dung cho xem trước, Word đơn và bộ ZIP. Mục 2.1 tự
điền và khóa chỉnh riêng trên hồ sơ; mẫu gốc vẫn quản lý theo phiên bản như cũ.
Không sửa file DOCX gốc hoặc snapshot đã lưu. Bản mẫu chung đã rút gọn cho đơn
không in vẫn khôi phục đúng điều khoản khi tạo hồ sơ có in.

Các chỉnh sửa ngoài 2.1 được chuyển chỉ số đoạn theo số đoạn thay đổi, giữ nguyên
nội dung, định dạng và hash kiểm tra. Metadata `printingClause` trong JSON hồ sơ
đánh dấu phiên bản/trạng thái đã dựng để lưu/mở lại và đổi trạng thái không lệch
các chỉnh sửa sau Điều II. Chỉnh sửa cũ nằm trong chính mục 2.1 được thay bằng
nội dung tự điền; thay đổi chỉ ghi vào DB khi người có quyền bấm Lưu. Không cập
nhật hàng loạt hợp đồng cũ, tiền, thuế, tồn kho hoặc chữ ký. Không cần migration.

Kiểm tra:

```sh
npm run typecheck
npm run ui:build
node --import tsx --test tests/app/contract-document.test.ts tests/app/contract-representative.test.ts tests/app/contract-terms-layout.test.ts tests/app/contract-loader.test.ts tests/app/contract-templates.test.ts tests/architecture.test.ts
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/contract-printing-clause.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/contract-document-consistency.mjs
```

Chromium dùng dữ liệu giả, mẫu DOCX thật cho cả Bách Ngân/Vigifts; kiểm cả hai
trạng thái in, mẫu chung rút gọn, giữ chỉnh sửa ngoài 2.1, lưu/mở lại, đổi trạng
thái, bản xem/ZIP và modal thực tế PC/mobile. Ảnh và kết quả tại
`/workspace/artifacts/contract-printing-clause/`. Chưa xác minh trên production.
