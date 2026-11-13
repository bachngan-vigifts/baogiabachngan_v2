# Tester CRM trong cloud ChatGPT/Codex

Ngày chuẩn bị: 13/11/2026. Đây là bộ điều khiển đang kiểm chứng, chưa phải xác nhận đã thay thế GitHub CI.

## Kiến trúc

ChatGPT/Codex xử lý yêu cầu hoặc kiểm tra theo lịch, lấy PR/SHA và gọi bộ điều khiển tin cậy. Compute nằm trong cloud ChatGPT của tác vụ. GitHub chỉ lưu source/PR và nhận Check, không cần chạy GitHub Actions để thực hiện bộ test mới.

Bộ chạy gồm launch.sh, runner.mjs, publish.py và test_publish.py trong scripts/ci/chatgpt-cloud/. Launcher giữ khóa một worker, chuẩn bị Node 22.22.0 và dependency; runner chạy trong container PHP 8.3 có Git, Python 3.11+, tomllib, jq và curl. Container non-root, giới hạn 4 CPU/12 GiB, không có Docker socket hay credential host, không có mạng ngoài khi thực thi test. Cùng 4 shard và glob của GitHub CI, 2 shard đồng thời, mỗi shard concurrency 2 và checkout riêng. Typecheck/build UI/PDF runtime vẫn bắt buộc.

Không cần cài Windows, không cần quyền VPS n8n, không dùng CircleCI. Việc chạy tiêu thụ tài nguyên/hạn mức ChatGPT/Codex theo tài khoản và môi trường; không có cam kết chi phí bằng 0 hoặc chạy liên tục.

## Chạy thủ công

Cloud Linux x86_64 cần Docker local hoạt động, GitHub CLI kết nối đọc repo, Python 3.11+, curl/xz/tar/flock/openssl và đủ tài nguyên. Launcher từ chối root và worker chạy chồng, luôn chọn Docker socket local thay cho context từ xa. Không đổi Docker daemon, storage driver, mạng proxy/CA hoặc sudo của nền tảng.

Chuẩn bị clone độc lập của repo. Với PR, fetch refs/pull/N/merge, checkout detached M và xác minh cha M là main B, head H. Giữ clone ở thư mục riêng, không dùng main working tree để chạy test. Gọi từ bộ điều khiển đã pin, không lấy script thực thi của chính PR:

```sh
bash /trusted-controller/launch.sh /path/to/standalone-checkout MERGE_SHA /workspace/cloud-tester PR_NUMBER
```

Bỏ PR_NUMBER chỉ để thử baseline; baseline không được công bố thành required check.

Job control nằm ngoài artifacts được mount vào container. Kết quả gồm mã thoát thật của tiến trình, manifest, summary.json, log và bốn JUnit. Publisher từ chối SHA cũ, thiếu shard/lệnh, thay đổi bộ chạy, mọi test bị skip, lỗi/hủy/timeout, thiếu quyền hoặc luật main chưa đúng. Mất worker không được biến thành check success.

## GitHub App riêng

Kết nối GitHub hiện tại đọc/ghi source được nhưng API Commit Status và API Checks đều trả 403 khi thử trên commit nhánh thử; không có check thành công nào được ghi. Cần GitHub App do chủ repo sở hữu, chỉ cài vào baogiabachngan_v2, với:

- Contents: read.
- Pull requests: read.
- Administration: read, để xác minh luật main.
- Checks: write, để tạo/cập nhật kết quả, không chạy máy GitHub Actions.

Không cấp Contents/Actions/Administration write cho tester. Tắt webhook nếu dùng quét theo lịch. Không cần public web server để nhận webhook ở chế độ này.

Các binding cloud:

- CHATGPT_CI_APP_ID: App ID.
- CHATGPT_CI_INSTALLATION_ID: installation ID chỉ chọn repo CRM.
- CHATGPT_CI_APP_KEY_FILE: đường dẫn file private key từ binding bí mật, không phải nội dung key trong repo/chat.

Publisher tạo installation token ngắn hạn bằng JWT; chỉ truyền token tới api.github.com. Token/key không vào container chạy test. Không dùng PAT của người quản trị để cho tester quyền push/merge main.

## Điều kiện chuyển khỏi GitHub Actions

1. Chạy đầy đủ bộ test trên cloud và kiểm chứng các ca sai SHA, thiếu runtime, hủy, lỗi test, thiếu artifact và commit/main đổi. Thử nghiệm synthetic không thay cho suite CRM thật.
2. Đăng ký App, gắn bí mật trong môi trường cloud; xác nhận công cụ thấy binding sẵn sàng và API Checks hoạt động. Chạy PR thật, ghi nhận App ID và check name chatgpt-cloud/test.
3. Main hiện được GitHub branch API báo protected:false; integration cũ không có quyền đọc classic protection. Trước khi chuyển phải bật classic protection: yêu cầu PR, required check chatgpt-cloud/test với đúng App ID, strict up-to-date, áp dụng cả admin, tắt force push/delete. Publisher hiện xác minh classic protection; ruleset-only chưa được chứng nhận tương đương nên sẽ không báo success.
4. Thử PR lỗi thực tế, chứng minh không merge được khi check thiếu/fail/cancel/action_required. Không dùng neutral/skipped cho lỗi hay thiếu bằng chứng.
5. Lưu/gắn môi trường cloud cho tác vụ, xác minh một lần chạy thật từ task. Phiên hiện có không bảo đảm provisioning/24-7 cho tương lai; cần kiểm chứng cấu hình môi trường của automation.
6. Sau khi đạt các điều kiện mới mở PR tắt CI GitHub cũ và đổi required check. Không để main có khoảng trống không kiểm tra.

Deploy API/UI và các workflow vận hành vẫn ở GitHub Actions và chưa thay đổi. Tắt CI kiểm tra PR không đồng nghĩa đã chuyển toàn bộ deploy/vận hành. Nếu cần dừng cả các luồng đó, thiết kế và kiểm chứng riêng việc cấp secret/deploy/rollback.

## Trạng thái lúc chuẩn bị

- Bộ validator/publisher đã có các ca synthetic kiểm chứng việc chặn báo xanh sai; kết quả này không phải kết quả suite CRM.
- Trong cloud đã chuẩn bị Node 22.22.0, PHP 8.3.36, Python 3.13.5; các lượt đầu phát hiện thiếu Python/jq, đã hủy và sửa môi trường, không sửa source ứng dụng.
- Baseline đang đối chiếu main tại cf089db088471c45b2ecab960dc74b9a226ef789. Trạng thái cuối và số test phải lấy từ artifact thật, không suy từ tài liệu này.
- Chưa tạo lịch tự động, chưa ghi check thật, chưa đổi main/luật bảo vệ, chưa tắt GitHub CI hoặc deploy production.

## Khôi phục

Giữ workflow GitHub cũ trong lịch sử cho đến khi chuyển ổn định. Nếu cloud/token/quota lỗi, check phải pending/fail/action_required và main tiếp tục bị chặn. Khôi phục CI cũ cùng required check bằng thay đổi được chủ repo duyệt; không bỏ guard để merge tạm.

## Link đăng ký App đã điền quyền

https://github.com/settings/apps/new?name=BachNgan+ChatGPT+Tester&description=Personal+check+publisher+for+CRM+tests+executed+in+ChatGPT+cloud&url=https%3A%2F%2Fgithub.com%2Fbachngan-vigifts%2Fbaogiabachngan_v2&public=false&webhook_active=false&request_oauth_on_install=false&contents=read&pull_requests=read&administration=read&checks=write

Đây là link tới form chính thức của GitHub, không tự đăng ký App. Chủ repo xem lại rồi tạo App, chọn Install App > Only select repositories > baogiabachngan_v2. Sau đó tạo private key và gắn file qua Secrets của cloud; không gửi file/key vào chat. App ID và installation ID là metadata, có thể dùng để cấu hình. App riêng chỉ gửi/đọc check và xác minh luật, không thực thi CI trên GitHub.
