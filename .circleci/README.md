# Tester CRM độc lập với GitHub Actions — bản chuẩn bị

Repo: bachngan-vigifts/baogiabachngan_v2. Ngày: 13/11/2026.

## Mục tiêu và phạm vi hiện tại

CircleCI Cloud chạy bộ kiểm tra PR; GitHub giữ source, PR và luật chặn merge. Không cần cài Windows hoặc truy cập máy chủ n8n. Giai đoạn này chỉ thêm cấu hình trên nhánh riêng; chưa kết nối CircleCI, chưa thay luật bảo vệ, chưa tắt GitHub CI, chưa merge hoặc deploy.

Workflow deploy API/UI trên GitHub là luồng riêng. Chuyển CI kiểm tra PR không tự chuyển các workflow deploy/vận hành; phạm vi đó cần thiết kế riêng nếu muốn dừng toàn bộ GitHub Actions.

## Cấu hình

- Một job crm-tester, parallelism 4. Cần xác minh bằng lượt chạy thật rằng trạng thái job/check tổng hợp đúng cả bốn node.
- Ubuntu 24.04 image 2026.10.1; Node 22.22.0 tải từ nodejs.org, kiểm checksum; PHP 8.3.
- Cùng hai glob tests/**/*.test.ts và src/**/*.test.ts, concurrency=2, bốn shard rời nhau như CI đang có. Không dùng intelligent test selection hoặc tự bỏ test.
- Mỗi node kiểm SHA checkout bằng CIRCLE_SHA1, kiểm tổng/index shard, lưu SHA và checksum package-lock. Typecheck và build UI chạy ở node 0; PDF runtime được kiểm trên mọi node.
- Node test runner ghi JUnit và giữ mã thoát. Mất worker/timeout hoặc chưa có đủ kết quả phải chặn merge. AI review không thay thế kết quả test.
- Cache chỉ chứa npm download; npm ci vẫn cài đúng lockfile. Không cache kết quả test như bằng chứng đã chạy.
- Không có deploy, production DB, app secrets hoặc token push/merge trong job. Không gắn secret context production. Danh sách biến cấm trong preflight chỉ là kiểm tra bổ sung, không thay cho việc cấp quyền tối thiểu.

## Những gì đã xác minh

Cấu hình đã được kiểm trong bộ nhớ bằng JSON schema công khai của CircleCI-Public/circleci-yaml-language-server và bash -n cho từng run step. Đã kiểm đủ parallelism/glob và đường trả mã thoát. Không gửi cấu hình hoặc source riêng tư tới CircleCI để validate.

Chưa chạy pipeline CircleCI, chưa chạy đầy đủ bộ test CRM trên môi trường mới, chưa thử các ca fail/cancel/credit cạn/merge bị chặn. Chưa thể chứng nhận tương đương CI hiện tại.

## Kết nối và chi phí — cần chủ repo thực hiện/duyệt

1. Dùng CircleCI Free trước, không mở gói trả phí hoặc tự nạp credits. Trang pricing hiện công bố 30.000 credits/tháng, 5 active users và 2 GB storage. Credits của nhiều node được cộng; chưa có số đo để hứa rẻ hơn GitHub. Đo credits thực tế trên machine/medium trước cutover. Nguồn: https://circleci.com/pricing/.
2. Kết nối CircleCI GitHub App, chỉ chọn repo CRM. Xem quyền thực tế ở màn hình GitHub trước khi cấp; không dùng OAuth toàn bộ repo khi có thể dùng App giới hạn một repo. Kết nối sẽ cho CircleCI đọc source code riêng tư và metadata PR/check của repo đã chọn. Chưa có dữ liệu repo được chuyển tới CircleCI trong giai đoạn chuẩn bị này.
3. Cấu hình pipeline và checkout source cùng repo. Chọn trigger PR vào main, gồm PR mới, cập nhật commit và reopened. Tránh tạo trigger push + PR trùng nhau. Bật auto-cancel redundant workflows. Không bật add-on trả phí hoặc auto-rerun để che flaky test.
4. Bật cập nhật trạng thái/check về GitHub; ghi lại tên check và nguồn GitHub App từ lượt chạy thật, không đoán tên.

## Bảo vệ main và điều kiện chuyển

GitHub branch API hiện trả protected:false; rules/branches/main trả danh sách rỗng. Integration hiện tại bị 403 khi đọc classic branch protection. Vì vậy chưa có bằng chứng main đang bắt buộc test trước merge.

Trước cutover, chủ repo cần bật ruleset/branch protection có:
- Require pull request và required status check thực tế từ CircleCI App.
- Yêu cầu nhánh cập nhật với main trước merge.
- Chặn bypass/force push/delete theo chính sách chủ repo.
- Quy trình duyệt thay đổi cấu hình CI để PR không tự làm yếu bộ kiểm tra.

Kiểm thử trên nhánh riêng và lưu bằng chứng:
- Full suite đúng SHA xanh, đủ cả bốn shard và typecheck/build.
- Lỗi typecheck và lỗi test không được thành công dù node khác xanh.
- Hủy pipeline/mất worker/thiếu dependency/credit cạn không cho merge.
- Commit mới không dùng kết quả commit cũ; main thay đổi thì cập nhật nhánh và test lại theo luật strict.
- PR lỗi thực tế bị nút merge chặn; tên check/source App phải khớp cấu hình bảo vệ.

Chỉ khi các điều kiện đạt mới mở PR cutover tắt trigger GitHub CI cũ và thay required check, không để khoảng trống cho merge khi check mới chưa sẵn sàng.

## Khôi phục

Nếu CircleCI lỗi hoặc hết credits, main tiếp tục bị chặn. Khôi phục workflow GitHub cũ và required check theo thay đổi được chủ repo duyệt, rồi chạy lại đúng SHA. Không bỏ kiểm tra để merge tạm.

## Nguồn công khai

- https://circleci.com/pricing/
- https://circleci.com/developer/machine/image/ubuntu-2404
- https://circleci.com/docs/guides/permissions-authentication/users-organizations-and-integrations-guide/
- https://raw.githubusercontent.com/CircleCI-Public/circleci-yaml-language-server/refs/heads/main/schema.json
