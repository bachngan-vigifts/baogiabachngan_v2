# POS: nạp sẵn tồn Lock và Minh Long

## Phạm vi

- POS nạp danh mục tối thiểu, giá, mã quét và tồn cho toàn bộ sản phẩm đủ điều kiện của quầy cùng phản hồi options đầu tiên. Sau bước khởi tạo, tìm mã chưa từng mở cũng có số tồn tại chỗ; nguồn kho khác được tải nền.
- Số bán được = max(0, tồn vật lý tại kho bán − số đang giữ được phân bổ cho kho đó). Không cộng tồn nhà cung cấp, kho khác, hàng đang về hoặc số đồng bộ Sapo vào tồn được bán.
- Kho chưa chốt tồn đầu kỳ hiện “Chưa chốt tồn”; chưa tải được số hiện “Chưa xác nhận tồn”, không coi là hết hàng và không cho chọn. Đã giữ hết tách khỏi hết tại kho bán.
- Bỏ giới hạn danh sách hiển thị khi tính giữ hàng cho POS. Test 5.001 dòng giữ xác nhận không bỏ sót sau dòng 5.000. Không thay quy tắc phân bổ, không tự đóng/hủy giữ.
- Snapshot đọc trong transaction repeatable-read/read-only. Checkout vẫn khóa và kiểm tra tồn mới tại máy chủ.

## Bộ đệm và cập nhật

Bộ đệm chỉ trong RAM, tách tài khoản/quầy/bảng giá; đổi người xóa bộ đệm. Không lưu token hoặc ghi outbox. Snapshot trên 20.000 sản phẩm trả unavailable và dùng đường tải phân trang, không nhận một phần danh mục là toàn bộ.

Khi POS đang hiển thị, cập nhật snapshot gọn mỗi 30 giây, khi quay lại app và sau các thao tác tải lại POS. Metadata chỉ lấy lúc đầu hoặc đổi phạm vi. Số quá 15 giây được đánh dấu cũ; lỗi mạng giữ số lần cuối và báo chưa lấy được số mới. Không hứa số trên máy luôn trùng tức thời với các máy khác. API chi tiết/snapshot chạy nền nhường thao tác ghi; phản hồi cũ không ghi đè số mới hơn. Lỗi 401/403 xóa số và dừng cập nhật nền.

## Kiểm chứng tự động

- `tests/app/pos-stock-preload.test.ts`: quyền/phạm vi kho và bảng giá, nguồn tồn ledger khác số đồng bộ, giữ hàng, nhập trả hàng, kho chưa mở, bộ đệm theo tài khoản, dữ liệu sai/phiên bản lạ, hơn 5.000 dòng giữ.
- Bộ test POS, stock sources, request priority, kiến trúc và trial UI đã đạt.
- TypeScript typecheck đạt.
- `scripts/testing/pos-stock-ready.mjs`: app thật nối API/PGlite bằng dữ liệu giả, chặn mạng ra ngoài. General catalog snapshot cố ý lỗi, chi tiết sản phẩm trễ 2 giây. Cả Lock/Minh Long ở 390px và 1280px tìm sản phẩm chưa mở, thấy tồn và thêm giỏ trước khi API chi tiết trả về; kiểm tra đổi giá, tồn thay đổi từ ngoài và phản hồi snapshot chậm không đè số mới. Chưa tải tồn không bị lọc thành hết hàng.
- `results.json` và ảnh đính kèm là kết quả local Chromium; thời gian tìm khoảng 0,1–0,2 giây sau khởi tạo, không phải cam kết tốc độ production. Chưa kiểm tra Safari trên iPhone thật.

Chạy trình duyệt local:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/pos-stock-ready.mjs
```

## Chưa xác minh production

Chưa đọc được tồn thật của LHC3329BEG/LHC3329DGRN, ánh xạ kho của quầy và số giữ liên quan. Automatic approval review từ chối truy vấn vì ràng buộc không truy vấn production trước đó; đang chờ chủ doanh nghiệp cho phép đọc phạm vi này. Vì vậy chưa kết luận nguyên nhân hai mã trong ảnh (sai kho, tồn đầu kỳ, giữ hàng hay dữ liệu khác). Bản sửa này khắc phục đường tải/hiển thị và một trường hợp cắt số giữ tìm thấy trong code; không tự sửa số tồn thật.

Không migration, không sửa dữ liệu production, không thay phiên/cron/đồng bộ Sapo.
