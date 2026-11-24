# Kiểm kê theo StockTakes — #823

Yêu cầu trực tiếp của Anh Thái: giao diện kiểm kê theo KiotViet; tự thực hiện không chờ Claude.
Tham chiếu ảnh1214×1003 và khảo sát read-only24/11/2026; không tạo/cân bằng phiếu trên KiotViet.
Base cập nhật: `1cc56429` (đã có sidebar xanh #825). Không dùng dữ liệu production trong test.

## Thay đổi

- Danh sách có bộ lọc Ngày tạo/Trạng thái bên trái, tìm mã phiếu, icon tạo/xuất/cột/thiết lập/trợ giúp,
  đánh dấu, chọn dòng/gộp,15cột có thể ẩn/hiện, phân trang10/15/20/30/50/100.
- Chi tiết bung ngay trong bảng: Thông tin; mã/trạng thái/người/ngày tạo và cân bằng;
  tìm mã/tên;5cột hàng; ghi chú;4tổng số lượng; Hủy/Sao chép/Xuất file/Lưu/In.
- Form tìm/quét (camera hoặc máy quét), chọn nhóm, mở form thêm sản phẩm sẵn có,
 4tab Tất cả/Khớp/Lệch/Chưa kiểm, ảnh/lọc/sắp xếp, nhập Excel có preview và tải mẫu,
 Lưu tạm/Hoàn thành. F3/Ctrl+S/F9/Esc có nút tương đương.
- Kho của CRM được giữ làm phạm vi nghiệp vụ; không sao chép logo/tài khoản hoặc dịch vụ hỗ trợ KiCi của KiotViet.
 Nhóm hàng lấy category trong catalogue đã khớp SKU CRM, không giả thương hiệu thành nhóm.
 Mục Khác trong menu hiển thị không thêm tùy chọn chưa quan sát được.
- Preset ngày/tuần/tháng/quý/năm, khoảng tùy chỉnh lịch kép và preset âm lịch Việt Nam UTC+7.
- Phiếu tạm lưu máy chủ, revision chống ghi đè; command receipt giữ khóa/nội dung khi mất response.
  Khi chưa rõ kết quả thì khóa input, khôi phục cùng request, không tạo khóa mới.
- Hoàn thành chỉ Manager; zero khác chưa kiểm. Snapshot drift chặn mặc định, chỉ áp delta sau xác nhận.
 Hủy đã cân bằng chỉ Manager, đảo đúng bút toán gốc, giữ phát sinh về sau; không xóa ledger.
 Người/ngày cân bằng gốc vẫn còn sau hủy. Sửa phiếu đã cân bằng chỉ ghi chú.
- Gộp cùng kho và phiên bản: cộng actual cùng SKU, phiếu nguồn ghi hủy do gộp và liên kết phiếu đích.
  SKU trùng có phần chưa kiểm bị chặn. Sao chép giữ danh sách, lấy tồn hiện hành và để actual chưa kiểm.
- Adapter đọc phiếu cũ; giữ clientKey/hash gốc và audit. Phiếu từng bị từ chối có chú thích rõ,
 không khẳng định đó từng là hủy phiếu đã ghi kho. Route review cũ không vượt qua revision mới.
- Giá vốn/giá trị chỉ Manager ở API và export. Không có key/hash lệnh trong response xem chung.
- Điện thoại giữ control trong vùng cuộn; thanh lưu nằm trong viewport. Chat/nhắc việc/thông báo
 được đưa lên trên thanh lưu; kiểm hit-test cả4góc và tâm nút Hoàn thành.

## Kiểm tra

- Test đỏ ban đầu: route workspace chưa có, bộ `stocktake-workspace.test.ts` exit1 trước triển khai.
- 14 file liên quan pass (inventory, stocktake cũ/mới, architecture, trial-ui, migration).
- Sau rà soát: workspace API, helper nhập/ngày, schema/gate và architecture tiếp tục pass.
- `tsc --noEmit`: exit0; `ui:build`: exit0, không đổi file tự sinh; `git diff --check`: sạch.
- `PLAYWRIGHT_MODULE=<playwright/index.mjs> node --import tsx scripts/testing/stocktake-workspace.mjs`:
 Chromium1214/1280/390, fullCRM+PGlite, chặn toàn bộ request ngoài localhost.
 Đã kiểm inline detail, lưu/mở lại,0/blank, Excel numeric SKU format00000, mất response sau commit,
 offline trước gửi, retry cùng key, beforeunload hủy reload giữ count, hoàn thành/hủy giữ phát sinh sau,
 cột/dấu sao/lọc ngày/xuất Excel/in giả/sao chép/gộp/nhóm. Không pageerror/tràn ngang.
- Migration riêng: gate thiếu schema báo missing; chạy migration, gate đạt; chạy lại cùng migration/gate đạt.
 Mô phỏng default privileges cấp ALL cho service_role: migration thu hồi DELETE/TRUNCATE đúng yêu cầu.

Ảnh ở thư mục này dùng dữ liệu giả. Số phiếu/người/giá chỉ phục vụ fixture.
In đã gọi đúng renderer và stub printer; chưa thử máy in thật, Safari/iOS thật hoặc PostgreSQL đa kết nối.
Dấu sao/cột lưu theo tài khoản trên thiết bị; không đồng bộ các tùy chọn đó giữa thiết bị.
Chưa kiểm mọi tùy chọn tenant KiotViet, không tuyên bố giống100% những phần chưa quan sát.

## Migration và thứ tự triển khai

1. Migration `migrations/postgres/20261124043000_stocktake_workspace.sql` phải lên main và CI xanh.
2. Chạy **chỉ đọc** `scripts/sql/assert-stocktake-workspace.sql`. Nếu đạt thì không chạy lại migration.
 Nếu đúng lỗi missing, chạy migration một lần, sau đó gate phải đạt. Không chỉnh dữ liệu tay.
 Migration chỉ thêm2bảng metadata/receipt+index/RLS, không đổi CHECK hoặc backfill adjustment cũ.
3. Workflow API đã thêm gate trước đổi secrets/publish. Thiếu migration sẽ dừng, giữ API đang hoạt động.
4. Sau gate đạt, chạy lại triển khai API; xanh mới tới giao diện (workflow UI chờ API đúng source).
5. Smoke production chỉ đọc: mở danh sách/phiếu và kiểm quyền. Không tạo/cân bằng phiếu thử trên production.

Chưa chạy migration production, chưa deploy module từ nhánh này.
Rollback: giữ bảng/receipt/audit; không DROP hoặc xóa chứng từ. Có thể tạm ngừng tạo phiếu mới và
 sửa tiếp trên API tương thích. Không rollback thẳng UI/API cũ khi còn draft mới chưa xử lý:
 UI cũ không có renderer cho draft mới. Muốn lui UI, giữ backend versioned và hoàn tất/xuất các draft trước.
