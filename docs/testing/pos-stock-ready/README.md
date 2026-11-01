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

## Đối chiếu production ngày 01/11/2026

Chủ doanh nghiệp đã cho phép đọc tồn hai mã, kho quầy và số đang giữ. Kết quả tại thời điểm kiểm tra:

| SKU | Tồn ledger kho bán | Số đồng bộ | Giữ hiệu lực/đơn chưa giao |
| --- | ---: | ---: | ---: |
| LHC3329BEG | 20 | 20 | 0 |
| LHC3329DGRN | 10 | 11 | 0 |

Cả quầy Lock và Minh Long trỏ MINH LONG - LOCKNLOCK CẦN THƠ, kho đã chốt đầu kỳ, hai sản phẩm active/approved. Mã DGRN có đầu kỳ 11 và một lần xuất POS −1 nên tồn ledger 10; không được lấy số đồng bộ 11 thay thế. Không có giữ báo giá, giữ đơn, giữ POS có hiệu lực hoặc dòng đơn draft/confirmed/delivering của hai mã. Vì vậy tại lúc kiểm tra không có căn cứ tồn/giữ khiến POS hết hàng tại quầy Lock/Minh Long.

Đã xác minh trong code đường hiển thị số chưa tải có thể hiện “Hết hàng”; chưa tái hiện phiên trình duyệt production tại lúc chụp ảnh nên không khẳng định đây là nguyên nhân duy nhất. Không sửa dữ liệu kho hoặc bỏ giữ hàng để làm số dương.

Không migration, không sửa dữ liệu production, không thay phiên/cron/đồng bộ Sapo.
