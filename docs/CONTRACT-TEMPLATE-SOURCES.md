# File mẫu hồ sơ theo loại tài liệu

Mỗi công ty BN/VG có mẫu riêng cho HDKT, TAM_UNG và BBNT. Nút “Mẫu … gốc” bám theo tab đang xem. Manager có thể tải mẫu Word gốc, sửa trên máy, chọn upload, xem trước và bấm Lưu mẫu chung để công bố. Tối đa3MB/file .docx; giữ các trường <<…>> và bảng hàng hoá của mẫu gốc. File chọn xong chưa tự lưu.

Mẫu Word upload là nguồn đầy đủ (bao gồm định dạng/ảnh). Chỉnh file đó trên máy rồi upload lại; không sửa từng đoạn của file upload trong preview. Cách sửa đoạn mẫu HĐKT đóng gói sẵn vẫn hoạt động khi chưa thay bằng file upload. TAM_UNG/BBNT không mở nhầm editor HĐKT nữa. Không thay đổi loại giấy đề nghị tạm ứng thành quyết toán hay thay công thức tiền/thuế.

## Quyền và phiên bản

Quản lý/tải mẫu chung: Manager như cơ chế mẫu hiện có. Hồ sơ mới chốt tham chiếu brand/type/revision/SHA256 trong templateSnapshot do máy chủ tạo; người dùng không tự gửi snapshot. Hồ sơ cũ giữ snapshot đã có hoặc mẫu đóng gói sẵn nếu được lập trước cơ chế snapshot. Phiên bản upload là bất biến, chỉ INSERT, không ghi đè/xoá file đã công bố. Mẫu BN/VG và ba loại tài liệu độc lập.

File lưu ở FileStore/bucket private hiện có. URL ký tên300giây chỉ cấp cho Manager khi quản lý mẫu, hoặc người có quyền xem chính Đơn hàng/HĐKT đang tham chiếu phiên bản đó. Không chấp nhận fileKey/URL tuỳ ý từ client. Thiếu/hỏng file, sai digest hoặc thiếu phiên bản: báo lỗi, không dùng mẫu mới nhất hay mẫu mặc định để che lỗi. Snapshot v2 có sourceHash của bộ tham chiếu và baseSourceHash của mẫu HĐKT đóng gói sẵn; giao diện cũ sẽ không xác nhận nhầm mẫu tĩnh là nguồn của hồ sơ v2.

Upload dùng clientKey + revision; replay phải cùng brand/type/digest/phiên bản gốc. Khoá transaction theo brand/type, một lần lưu thắng khi cùng revision. Lưu file trước transaction, ghi phiên bản + audit trong transaction. Khi mất ACK commit, kiểm tra file đã được tham chiếu trước khi dọn; nếu không xác minh được thì giữ file private để tránh xoá file đã công bố. Có thể có file mồ côi khi hệ thống không xác minh được; không chạy tác vụ dọn dữ liệu production trong PR.

## Kiểm tra file

Kiểm tra cả client (trước preview) và server: kích thước nén3MB, giải nén8MB, XML1MB/mục, tối đa128 mục và128 mức XML. Kiểm EOCD/central/local header, tên/kích thước/CRC; đọc ZIP theo từng chunk nhỏ, không giải nén vô hạn. Chặn mục trùng/traversal/mã hoá, macro/ActiveX/nhúng HTML-OLE, liên kết ngoài, DTD/entity và fieldcode liên kết/DDE. Đối chiếu đúng bộ trường và bảng hàng hoá theo file gốc của loại tài liệu; không nhận mẫu khác loại vì đổi tên file.

Manifest yêu cầu sinh từ file .docx đóng gói: `python3 scripts/testing/contract-template-sources-manifest.py --write`; chạy không --write để kiểm tra. Hai thư viện fflate0.8.2, saxes6.0.0 được pin trong lockfile. Bundle kiểm tra upload được tải khi chọn file, không tải parser nặng cho mọi lần mở CRM.

## Địa danh biên bản

Province lấy từ Địa điểm giao hàng đang điền trong hồ sơ, dùng bộ nhận diện tỉnh đã có (34 tỉnh/thành, hỗ trợ tên cũ). “Ấp Đông Hòa, Xã Kim Sơn, Đồng Tháp” → “Đồng Tháp, ngày…”. Tên đường/phường trùng tên tỉnh hoặc địa chỉ có nhiều tỉnh mâu thuẫn không bị đoán thành tỉnh giao hàng. Không đổi ngày/tháng/năm hoặc số tiền; bản xem và Word/ZIP dùng cùng bộ dựng.

## Triển khai và rollback

**Chưa chạy migration production.** Trước khi merge/deploy cần duyệt và chạy `20261124045004_contract_template_sources.sql` theo quy trình migration đang áp dụng (preflight READ ONLY, một lần ghi, kiểm tra READ ONLY sau). Migration chỉ tạo bảng mới, RLS, PK/unique/check; BEGIN/COMMIT, lock_timeout5s, statement_timeout60s; không backfill hay sửa hợp đồng/tiền/tồn. Gate `scripts/sql/assert-contract-template-sources.sql` đã nối vào deploy-api.yml và november-migration-coverage.json. Thứ tự: migration → assert READ ONLY → deploy API → deploy UI → Manager thử file thật đã được duyệt.

Trước khi có hồ sơ dùng nguồn upload có thể revert API/UI; giữ bảng/file để không mất lịch sử. **Sau khi đã có snapshot v2, ưu tiên giữ reader v2 và sửa tiến (hoặc chỉ tắt đường upload mới). Không quay về writer API cũ để tiếp tục lập hồ sơ như bình thường** vì writer cũ không chốt nguồn upload. Nếu bắt buộc rollback toàn bộ, tạm dừng tạo/đổi hồ sơ và thông báo các hồ sơ v2 chưa xem/tải được cho đến khi khôi phục reader. Giao diện cũ sẽ fail-closed với snapshot v2; không tự dùng mẫu mặc định. Không DROP bảng, xoá file hay sửa snapshot của hồ sơ để làm rollback xanh.

## Kiểm chứng và giới hạn

Dữ liệu/Storage giả, router/PGlite cục bộ; không dùng dữ liệu hoặc gọi tích hợp production. Chromium390/1280 kiểm đúng tab, tải đúng bytes mẫu gốc, file sai bị chặn trước lưu, staging, lưu mới, sửa mẫu HĐKT cũ, xung đột giữ chỉnh sửa, hồ sơ cũ không đổi, hồ sơ mới nhận nguồn upload, địa danh preview/Word trùng nhau. PGlite chỉ một kết nối; không thay kiểm thử deadlock nhiều kết nối PostgreSQL. Chưa thử Safari/thiết bị thật hoặc file Word riêng của công ty trên production.

Script JSDOM cũ `contract-template-dom.mjs` bị timeout preview trong môi trường này ngay cả trên main trước sửa (7e61ff76); không skip/disable. Bổ sung mock metadata cho API mới, giữ các assertion cũ. Các ca tương ứng về sửa mẫu gốc và hồ sơ cũ/mới được chạy thêm trong Chromium với DOCX thật; báo riêng lỗi JSDOM nền thay vì coi nó đạt.
