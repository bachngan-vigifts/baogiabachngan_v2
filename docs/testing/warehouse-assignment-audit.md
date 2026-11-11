# Rà soát phân công Kho — PR #623

Ngày kiểm tra: 11/11/2026. Nền bản PR trước: `584766b8`. Kiểm thử thao tác bằng dữ liệu tổng hợp, không tạo chứng từ production hoặc đăng nhập mạo danh nhân viên thật.

## Lỗi tái hiện và sửa

| Bước | Lỗi trước khi sửa | Sau sửa |
|---|---|---|
| Đề xuất / bắt đầu | Thu hồi quyền đóng gói vẫn cho nhân viên bắt đầu phần việc | Kiểm tra quyền nghiệp vụ hiện tại cùng phân công kho, từ chối 403 |
| Tự đề xuất | Người đã khóa vẫn được giữ ở assignment chưa chuẩn bị | Tính lại người hợp lệ; không sửa assignment đã bắt đầu |
| Đồng bộ lời nhắc | Thêm người nhận sau khi đã giao một nhân viên chưa liên kết vào việc gốc | Liên kết alias vào assignment đã chuẩn bị; không phát sinh run/điểm thứ hai |
| Giao việc | Phiếu chưa có ngày hẹn bị chặn dù Manager đã nhập hạn phần việc | Nhận hạn rõ ràng và lý do được duyệt; giữ nguyên chứng từ nguồn |
| Nhận qua luồng cũ | Kho chưa được phân công vẫn có thể nhận việc hoặc cấu hình bằng API cũ | Kiểm tra kho/quyền khi claim, chặn bỏ qua phân công nguồn bằng cấu hình/Tasks cũ khi workspace đã cấu hình |
| Yêu cầu làm lại | Phần đã làm bị kẹt nếu chứng từ nguồn hoàn tất | Cho làm lại phần đã bắt đầu và bị Manager trả lại; giữ giờ bắt đầu, lỗi lần đầu, trạng thái nguồn; không mở phần chưa từng làm |
| Xác nhận kết quả | Kho không còn hợp lệ có thể rơi về kiểm tra PO cũ yếu hơn | Assignment phải còn khớp nguồn/kho trước khi xác nhận |
| CI / triển khai | Migration mới thiếu trong manifest gate SQL tháng 11 | Bổ sung ánh xạ tới `assert-warehouse-workspace.sql`; giữ nguyên kiểm tra bắt buộc |

Sáu lỗi đầu được tái hiện bằng bộ test mới: trước sửa 0/6 đạt, sau sửa đạt. Lỗi fallback xác nhận được tái hiện riêng: trước sửa trả 200, sau sửa trả 409. Lỗi manifest lấy từ shard 2 của CI run `42976881784` (bản PR trước); ba shard khác và Supabase Preview đạt. Trạng thái CI bản sửa phải kiểm tra theo SHA mới, không dùng kết quả bản cũ để kết luận đã xanh toàn bộ.

## Ma trận kiểm tra

| Tác nhân / tình huống | Kết quả mong đợi đã kiểm chứng |
|---|---|
| Không có phiên | 401 |
| Manager | Mở lựa chọn, giao một người/team, duyệt/đề nghị làm lại |
| Sale, Sale Admin có quyền xem rộng, kế toán, nhân viên quầy, NCC | 403 tại workspace/phân công/source-sync |
| Hai nhân viên Kho trong cùng team | Chỉ thấy phần của mình; truy cập/chỉnh phần người khác bị 403 |
| Nhân viên tự duyệt, đổi người, hủy hoặc duyệt khoảng chờ | 403 |
| Nhân viên bị khóa/xóa | Loại khỏi roster; phiên cũ không bắt đầu được (401) |
| Thu hồi quyền nghiệp vụ hoặc bỏ phân công kho | Không bắt đầu; không tự cấp lại quyền |
| Kho nguồn không xác định / không có người hợp lệ | Không giao bừa; Manager nhận cảnh báo, nút xác nhận bị khóa |
| Điều chuyển xuất | Dùng kho đi |
| Điều chuyển nhận | Dùng kho đến; việc nhận của chức vụ bán hàng vẫn ở luồng hiện tại, không chiếm làm việc Kho |
| Cùng payload gửi đồng thời / phản hồi bị mất | Một assignment; gửi lại trả kết quả đã lưu |
| Hai payload một người/team khác nhau cùng lúc | Một thành công, một 409; không trộn run và phần việc |
| Người đang bận | Phần việc chờ lượt, không có hai slot hoạt động |
| Nguồn chưa hoàn tất / nguồn hủy / đổi kho | Không xác nhận sai hoặc tự ghi tồn kho |
| Tháng đã chốt | Không thêm định mức vào kỳ đã chốt; lịch sử điểm chốt giữ nguyên |
| Team / alias | Tổng trọng số một việc; không cộng thêm task cha/lời nhắc |
| Thông báo phân công | Chỉ hai thành viên được chọn, không gửi Sale/kế toán/NCC không liên quan |

## Kết quả kiểm thử

- PGlite: 60/60 tests hồi quy liên quan đạt (bao gồm 13 ca audit mới, 9 ca phân công nguồn và các ca workspace/availability/payroll/notification/tasks/architecture).
- PostgreSQL 17 thật, kết nối pool nhiều luồng: 22/22 tests của hai file phân công/audit đạt. PostgreSQL tạm chạy local, đã dừng và xóa container sau thử nghiệm; không dùng DB production.
- Gate migration: 3/3 đạt, bao gồm đối chiếu manifest, chạy lặp trong READ ONLY, phát hiện định nghĩa/quyền sai.
- Chromium: 6 kịch bản PC 1440/mobile 390 đạt; không lỗi JS/tràn ngang. Bao gồm mất phản hồi sau commit rồi retry, thiếu người đủ quyền và thiếu kho nguồn.
- TypeScript và build UI đạt. Không sửa hoặc bỏ test cũ để làm xanh.

Các ca API dùng fixture với vai trò/quyền tương ứng cấu hình thực tế. Việc đối chiếu danh mục nhân viên/kho production chỉ là SELECT. Chưa kiểm thử bấm lưu bằng tài khoản nhân viên thật trên production: PR còn mở, migration tính năng chưa chạy ở đó.

## Giới hạn còn lại

Cấu hình kho bán hiện gán theo chức vụ, không phải một bảng phân công từng cá nhân. Workspace vẫn dành cho nhóm Kho và Manager; không tự mở cho chức vụ bán hàng. Kho chưa có nhóm Kho hợp lệ và phiếu thiếu kho nguồn cần Manager quyết định cấu hình/dữ liệu đúng. Không thay đổi các giá trị đó trong lần kiểm tra này.

Sau khi đã giao và bắt đầu, không tự chuyển team/ghi đè giờ công khi chứng từ đổi kho. Hệ thống chặn để Manager đối soát. Kiểm kê chưa có producer mới trong phạm vi PR này. Số liệu tốc độ là fixture localhost, chưa thay thế đo tải production hay dữ liệu lớn.
