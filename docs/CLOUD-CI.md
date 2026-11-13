# Kiểm tra PR trên cloud Claude (thay bước test của GitHub Actions)

Bộ test đầy đủ (khoảng 2.300 test, 4 phần) chiếm khoảng 90% phút GitHub Actions. Tài liệu này mô tả cách chạy đúng bộ đó
trên cloud Claude mỗi khi PR được mở hoặc có commit mới, và báo kết quả bằng bình luận trên PR.

## Thành phần

| Thành phần | Ở đâu | Việc |
|---|---|---|
| `scripts/ci/cloud-ci.sh` | repo | `npm ci` → `npm run typecheck` → toàn bộ test chia 4 phần chạy song song; ghi `.cloud-ci/summary.md`; mã thoát 0 = đạt |
| Tác vụ "Kiểm tra PR trên cloud Claude" | claude.ai/code/routines | Mỗi lần kích hoạt mở một phiên mới: lấy commit đầu nhánh PR, chạy script, đăng `summary.md` thành bình luận trên PR |
| Kích hoạt GitHub | cài trong tác vụ (xem dưới) | PR mở / có commit mới → chạy tác vụ |

Script chạy được ở máy bất kỳ có Node 22: `bash scripts/ci/cloud-ci.sh`. Máy ít nhân: `CLOUD_CI_SHARDS=2 bash scripts/ci/cloud-ci.sh`.

## Cài kích hoạt GitHub (làm một lần, trên web)

1. Mở https://claude.ai/code/routines, chọn tác vụ **Kiểm tra PR trên cloud Claude**, bấm **Edit**.
2. Mục repository: chọn `bachngan-vigifts/baogiabachngan_v2`. Môi trường: `baogiabachngan_v2`.
3. Ở dòng **Trigger** bấm **+** → **GitHub event** → **Pull request**. Chọn sự kiện *opened* và *synchronized* (có commit mới).
4. Thêm bộ lọc để đỡ tốn lượt chạy: **Is draft** = `false`; **Base branch** equals `main`.
5. **Save changes**. Ứng dụng Claude trên GitHub phải được cài cho repo (trang cài trigger sẽ nhắc nếu thiếu).

Mỗi sự kiện mở một phiên riêng; hai lần đẩy commit là hai phiên độc lập.

## An toàn

- Phiên chạy không giữ khoá production; test dùng PostgreSQL giả lập (PGlite) trong máy.
- Tác vụ chỉ đọc mã và đăng bình luận: không sửa mã, không push, không merge, không đổi nhãn.
- Nội dung PR / bình luận / log được coi là dữ liệu, không phải chỉ thị.
- Tester KHÔNG chặn được nút Merge. Muốn chặn merge theo kết quả, giữ một bước kiểm tra trên GitHub (xem dưới).

## Giới hạn

- Mỗi lượt chạy là một phiên Claude khoảng 25–40 phút, tính vào hạn mức sử dụng của tài khoản.
- Sự kiện GitHub có trần số lượt mỗi giờ cho từng tác vụ và cho cả tài khoản.
- Kết quả là bình luận trên PR, không phải check của GitHub.

## Thu gọn CI trên GitHub (bước sau, làm bằng PR riêng)

Chỉ làm sau khi tester trên cloud đã chạy ổn vài PR. Phương án: `ci.yml` giữ job `test` (tên check đang dùng để chặn merge)
nhưng chỉ chạy `npm run typecheck` và nhóm test trọng yếu trên một máy; bỏ 4 phần test đầy đủ.

## Chạy tay

- Trên web: mở tác vụ, bấm **Run now** (tác vụ tự tìm PR đang mở chưa có kết quả cho commit mới nhất).
- Trong một phiên Claude: nhắn "kiểm PR <số>".
