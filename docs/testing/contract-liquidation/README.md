# Thanh lý HĐKT có ảnh và Manager duyệt

## Quy tắc

“Đã thanh lý” màu xanh lá là trạng thái riêng bên cạnh trạng thái ký. Nhân viên không tự đánh dấu hoàn tất. Người phụ trách/người tạo, Kế toán hoặc Manager gửi đề nghị với đúng một ảnh và hai xác nhận: đã nhận hồ sơ gốc; hoàn tất dịch vụ, khoản phí và nghĩa vụ khác. Chỉ vai trò Manager được duyệt/từ chối; quyền duyệt được uỷ nhiệm thông thường không thay thế Manager.

Máy chủ kiểm tra phạm vi đơn, chữ ký và ngày ký, giá trị khớp đơn, giao đủ hàng, kết thúc mọi chuyến, bằng chứng xuất kho thực, tất toán tiền và đổi/trả, hoá đơn chính thức nếu có yêu cầu. Những nghĩa vụ dịch vụ không có số liệu tự động cần người gửi và Manager đối chiếu thực tế. Ảnh lưu bucket private, URL ký 15 phút chỉ cấp sau kiểm tra phạm vi. Không dùng ảnh như bằng chứng tự động thay cho kiểm tra hồ sơ gốc.

Đề nghị chỉ chuyển sang chờ duyệt; duyệt yêu cầu phiên bản và dấu vân tay nghĩa vụ khớp. Nếu nghĩa vụ thay đổi sau khi duyệt, badge chuyển “Cần rà soát thanh lý”, giữ lịch sử và cho gửi lại. Không khoá nghiệp vụ khác hoặc tự trừ tồn/thu tiền. Không xoá cứng chứng từ có lịch sử thanh lý.

## Triển khai thủ công

1. Chủ doanh nghiệp tự kiểm tra và chạy **`migrations/postgres/20261031041111_contract_liquidation_review.sql`** theo quy trình hiện có. File tạo bằng CLI `supabase migration new`, chỉ thêm bảng/index/RLS; không backfill hoặc tự đổi trạng thái HĐKT cũ.
2. Sau đó mới đưa API/UI của PR vào main và triển khai theo quy trình hiện có. Kiểm tra bộ nhớ file private đã cấu hình như các ảnh nghiệp vụ khác; không cần bucket mới.
3. Nếu UI/API có trước migration, phần thanh lý báo chưa khởi tạo; các mục duyệt cũ vẫn chạy. Khi rollback app, giữ bảng và ảnh để bảo toàn hồ sơ; không DROP hoặc xoá ảnh đã gắn chứng từ.

Chưa chạy migration/deploy/ghi dữ liệu production. Không đụng phiên, cron hay đồng bộ Sapo; không sửa lương.

## Gửi lại và giới hạn

- Mỗi lần gửi có clientKey riêng, unique theo người gửi; cùng mã khác nội dung bị 409. Khóa dòng cha, khóa tiền hiện có và unique một đề nghị đang chờ/đã duyệt bảo vệ thao tác đồng thời. Xét duyệt có revision và phát lại kết quả cùng quyết định.
- Nhật ký trong transaction; thông báo sau commit có thể không tới nếu hệ thống thông báo lỗi. Hàng chờ duyệt Manager vẫn lấy từ bảng thật, không phụ thuộc thông báo. PR không triển khai outbox thông báo.
- Ảnh upload trước transaction. Ảnh của lần phát lại hoặc từ chối xác định được dọn; nếu không rõ DB đã commit hay chưa thì giữ ảnh để không xoá bằng chứng đã ghi. Có thể có ảnh mồ côi khi tiến trình chết; không tự dọn khi chưa đối soát DB. Không hứa atomic giữa object storage và Postgres.
- Dữ liệu lịch sử thiếu xuất kho/thu tiền/ngày ký không được suy đoán đã hoàn tất. Phải bổ sung chứng từ hợp lệ theo quy trình hiện có.

## Kiểm chứng

- Typecheck; 25/25 kiểm thử hồi quy (thanh lý, sửa HĐKT, hàng chờ duyệt và cấu trúc UI). API/PGlite: scope, ảnh giả/thiếu/thừa, gửi đồng thời cùng mã, xung đột nội dung, chỉ Manager, hàng chờ duyệt, điều kiện tiền/kho/giao/invoice, thay đổi sau duyệt, từ chối/gửi lại, replay không lặp audit, lỗi lưu ảnh, mất phản hồi commit vẫn giữ ảnh, chống xoá cứng.
- Browser thật `scripts/testing/contract-liquidation.mjs`, module CRM đầy đủ + API/PGlite cục bộ, 1280px/390px. Chặn request ngoài máy. Nhân viên gửi ảnh, mô phỏng 502 sau commit và thử lại cùng intent, Manager xem ảnh/xác nhận/duyệt; xanh chỉ sau xác nhận API. Huỷ chứng từ tiền sau duyệt làm badge yêu cầu rà soát. Không lỗi JS.
- Ảnh trong thư mục này là dữ liệu kiểm thử tổng hợp, không có hồ sơ khách thật.
